import sdk from "matrix-js-sdk";
import * as dotenv from "dotenv";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const requiredEnv = ["PRIVATE_HOMESERVER", "APPSERVICE_TOKEN"];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`Missing environment variable: ${env}`);
    process.exit(1);
  }
}

// Parse args
const args = process.argv.slice(2);
const fileArgIdx = args.indexOf("--file");
if (fileArgIdx === -1 || !args[fileArgIdx + 1]) {
  console.error("Error: Please specify the export file to import using --file <path>");
  console.exit(1);
}

const importFilePath = path.resolve(args[fileArgIdx + 1]);

function mapUserId(publicUserId) {
  if (!publicUserId || !publicUserId.startsWith("@")) return publicUserId;
  const parts = publicUserId.split(":");
  const localpart = parts[0].substring(1); // removes @
  return `@${localpart}:matrix.wetec-server.com`;
}

function generateTempPassword() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function updatePasswordInDb(userId, password) {
  try {
    const hashCmd = `docker exec matrix-synapse python3 -c "import bcrypt; print(bcrypt.hashpw(b'${password}', bcrypt.gensalt()).decode('utf-8'))"`;
    const hash = execSync(hashCmd).toString().trim();
    
    const sql = `UPDATE users SET password_hash = '${hash}' WHERE name = '${userId}'`;
    const updateCmd = `docker exec matrix-postgres psql -U synapse -d synapse -c "${sql}"`;
    execSync(updateCmd);
    
    console.log(`Successfully reset password in database for: ${userId}`);
    return true;
  } catch (err) {
    console.error(`Failed to reset password in database for ${userId}:`, err.message);
    return false;
  }
}

async function run() {
  console.log(`Step 1: Reading export data from: ${importFilePath}...`);
  const dataRaw = await fs.readFile(importFilePath, "utf8");
  const data = JSON.parse(dataRaw);

  const dataDir = path.join(__dirname, "data");
  const credentialsPath = path.join(dataDir, "new-user-credentials.txt");
  await fs.mkdir(dataDir, { recursive: true });

  console.log("Step 2: Identifying unique users for pre-creation...");
  const uniquePublicUsers = new Set();

  // Add all room members and message senders to the set of users to create
  for (const room of data.rooms) {
    for (const m of room.members) {
      if (m.userId) uniquePublicUsers.add(m.userId);
    }
    for (const msg of room.timeline) {
      if (msg.sender) uniquePublicUsers.add(msg.sender);
    }
  }

  console.log(`Found ${uniquePublicUsers.size} unique users in the history. Pre-creating accounts...`);

  // Client for registering users
  const registerClient = sdk.createClient({
    baseUrl: process.env.PRIVATE_HOMESERVER,
    accessToken: process.env.APPSERVICE_TOKEN,
  });

  await fs.writeFile(credentialsPath, `--- Migrated Credentials Generated on ${new Date().toLocaleString()} ---\n\n`, "utf8");

  for (const publicUserId of uniquePublicUsers) {
    const localUserId = mapUserId(publicUserId);
    const localpart = localUserId.split(":")[0].substring(1);
    const tempPassword = generateTempPassword();

    try {
      console.log(`Registering local account: ${localUserId}...`);
      
      const response = await fetch(`${process.env.PRIVATE_HOMESERVER}/_matrix/client/v3/register?access_token=${encodeURIComponent(process.env.APPSERVICE_TOKEN)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: localpart,
          password: tempPassword,
          type: "m.login.application_service"
        })
      });

      const resBody = await response.json();
      if (!response.ok) {
        if (resBody.errcode === "M_USER_IN_USE") {
          console.log(`User ${localUserId} already exists on the server. Resetting password in database...`);
          const success = updatePasswordInDb(localUserId, tempPassword);
          if (success) {
            await fs.appendFile(credentialsPath, `User: ${localUserId} | Temp Password: ${tempPassword}\n`, "utf8");
          }
        } else {
          throw new Error(`[${response.status}] ${resBody.error || JSON.stringify(resBody)}`);
        }
      } else {
        console.log(`Successfully created: ${localUserId}`);
        // Save to credentials log
        await fs.appendFile(credentialsPath, `User: ${localUserId} | Temp Password: ${tempPassword}\n`, "utf8");
      }
    } catch (err) {
      console.error(`Failed to create account for ${localUserId}:`, err.message);
    }
  }
  const mappingsPath = path.join(dataDir, "room-mappings.json");
  let roomMappings = {};
  try {
    const mappingsRaw = await fs.readFile(mappingsPath, "utf8");
    roomMappings = JSON.parse(mappingsRaw);
  } catch (e) {
    // Ignore, file doesn't exist yet
  }

  console.log("\nStep 3: Recreating rooms and replaying timelines...");
  for (const room of data.rooms) {
    const oldRoomId = room.room_id;
    let newRoomId;

    if (roomMappings[oldRoomId]) {
      newRoomId = roomMappings[oldRoomId];
      console.log(`\nRoom "${room.name}" was already migrated. Reusing existing private room ID: ${newRoomId}`);
    } else {
      // Add a sleep between room creations to avoid Synapse rate limiting (429)
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`\nRecreating Room: "${room.name}" (Old ID: ${oldRoomId})`);

      // Determine Room Creator (first member who is registered)
      const membersList = room.members.map(m => mapUserId(m.userId));
      const roomCreator = membersList[0];

      if (!roomCreator) {
        console.warn(`Skipping room "${room.name}" because it has no members.`);
        continue;
      }

      const creatorClient = sdk.createClient({
        baseUrl: process.env.PRIVATE_HOMESERVER,
        accessToken: process.env.APPSERVICE_TOKEN,
        queryParams: { user_id: roomCreator }
      });

      // Create room
      try {
        const createRes = await creatorClient.createRoom({
          name: room.name,
          preset: room.is_encrypted ? "private_chat" : "public_chat",
          initial_state: room.is_encrypted ? [
            {
              type: "m.room.encryption",
              state_key: "",
              content: {
                algorithm: "m.megolm.v1.aes-sha2"
              }
            }
          ] : []
        });
        newRoomId = createRes.room_id;
        console.log(`Created room successfully: ${newRoomId}`);

        // Save mapping
        roomMappings[oldRoomId] = newRoomId;
        await fs.writeFile(mappingsPath, JSON.stringify(roomMappings, null, 2), "utf8");
      } catch (err) {
        console.error(`Failed to create room "${room.name}":`, err.message);
        continue;
      }

      // Force join all other members
      for (const memberId of membersList) {
        if (memberId === roomCreator) continue;
        try {
          console.log(`Inviting and joining ${memberId} into room...`);
          // Creator invites
          await creatorClient.invite(newRoomId, memberId);
          // Member joins
          const memberClient = sdk.createClient({
            baseUrl: process.env.PRIVATE_HOMESERVER,
            accessToken: process.env.APPSERVICE_TOKEN,
            queryParams: { user_id: memberId }
          });
          await memberClient.joinRoom(newRoomId);
        } catch (err) {
          console.warn(`Failed to join ${memberId} to room:`, err.message);
        }
      }

      // Restore Power Levels
      if (room.power_levels) {
        try {
          console.log("Restoring power levels...");
          const mappedUsers = {};
          if (room.power_levels.users) {
            for (const [oldUser, level] of Object.entries(room.power_levels.users)) {
              mappedUsers[mapUserId(oldUser)] = level;
            }
          }
          const mappedPowerLevels = {
            ...room.power_levels,
            users: mappedUsers
          };
          await creatorClient.sendStateEvent(newRoomId, "m.room.power_levels", mappedPowerLevels, "");
        } catch (err) {
          console.warn("Failed to set power levels:", err.message);
        }
      }
    }

    // Replay historical messages
    console.log(`Replaying ${room.timeline.length} timeline events...`);
    for (const msg of room.timeline) {
      const localSender = mapUserId(msg.sender);

      if (msg.decryption_failed) {
        console.log(`Skipping event ${msg.event_id}: Decryption failed on export.`);
        continue;
      }

      // Add a small delay between message sends to prevent hitting Synapse rate limits (429)
      await new Promise(resolve => setTimeout(resolve, 150));

      const senderClient = sdk.createClient({
        baseUrl: process.env.PRIVATE_HOMESERVER,
        accessToken: process.env.APPSERVICE_TOKEN,
        queryParams: { user_id: localSender }
      });

      // Handle attachment uploads
      if (msg.local_attachment_path) {
        const attachmentPath = path.join(dataDir, msg.local_attachment_path);
        try {
          const buffer = await fs.readFile(attachmentPath);
          console.log(`Uploading local attachment to private homeserver: ${msg.content.body || "file"}`);

          const uploadRes = await senderClient.uploadContent(buffer, {
            name: msg.content.body || "file",
            type: msg.content.info ? msg.content.info.mimetype : "application/octet-stream",
            queryParams: { user_id: localSender }
          });

          msg.content.url = uploadRes.content_uri;
        } catch (err) {
          console.warn(`Failed to upload attachment ${msg.content.body}:`, err.message);
        }
      }

      // Send the event using timestamp massaging (passing path relative to client/v3 prefix)
      // We generate a deterministic transaction ID based on the original event ID (stripping special chars)
      // to let Synapse deduplicate events if this script runs multiple times.
      const deterministicEventId = msg.event_id.replace(/[^a-zA-Z0-9]/g, "");
      const txnId = `migration_${deterministicEventId}`;
      const sendPath = `/rooms/${encodeURIComponent(newRoomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;

      try {
        await senderClient.http.authedRequest(
          "PUT",
          sendPath,
          {
            user_id: localSender,
            ts: msg.origin_server_ts
          },
          msg.content
        );
      } catch (err) {
        console.warn(`Failed to replay event ${msg.event_id}:`, err.message);
      }
    }
    console.log(`Finished replaying room: "${room.name}"`);
  }

  console.log("\nMigration import complete! All rooms and timelines have been replayed.");
  process.exit(0);
}

run().catch(err => {
  console.error("Migration import failed:", err);
  process.exit(1);
});

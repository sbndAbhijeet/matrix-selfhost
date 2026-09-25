import sdk from "matrix-js-sdk";
import * as dotenv from "dotenv";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { resetUserPassword } from "./adminApi.js";
import { readReplayJournal, saveReplayJournal } from "./replayJournal.js";

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
  process.exit(1);
}

const importFilePath = path.resolve(args[fileArgIdx + 1]);
const allowPlaintextHistory = args.includes("--allow-plaintext-history");

function mapUserId(publicUserId) {
  if (!publicUserId || !publicUserId.startsWith("@")) return publicUserId;
  const parts = publicUserId.split(":");
  const localpart = parts[0].substring(1); // removes @
  return `@${localpart}:matrix.wetec-server.com`;
}

function generateTempPassword() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}


// Updating via admin api

// function updatePasswordInDb(userId, password) {
//   try {
//     const hashCmd = `docker exec matrix-synapse python3 -c "import bcrypt; print(bcrypt.hashpw(b'${password}', bcrypt.gensalt()).decode('utf-8'))"`;
//     const hash = execSync(hashCmd).toString().trim();
    
//     const sql = `UPDATE users SET password_hash = '${hash}' WHERE name = '${userId}'`;
//     const updateCmd = `docker exec matrix-postgres psql -U synapse -d synapse -c "${sql}"`;
//     execSync(updateCmd);
    
//     console.log(`Successfully reset password in database for: ${userId}`);
//     return true;
//   } catch (err) {
//     console.error(`Failed to reset password in database for ${userId}:`, err.message);
//     return false;
//   }
// }

async function run() {
  console.log(`Step 1: Reading export data from: ${importFilePath}...`);
  const dataRaw = await fs.readFile(importFilePath, "utf8");
  const data = JSON.parse(dataRaw);

  const dataDir = path.join(__dirname, "data");
  const mappingsPath = path.join(dataDir, "room-mappings.json");
  const replayPath = path.join(dataDir, "replayed-events.json");
  let roomMappings = {};
  try {
    roomMappings = JSON.parse(await fs.readFile(mappingsPath, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const replayJournal = await readReplayJournal(replayPath);
  const ambiguousRooms = data.rooms.filter(room => roomMappings[room.room_id] && !Object.hasOwn(replayJournal, room.room_id));
  if (ambiguousRooms.length) {
    throw new Error(`${ambiguousRooms.length} mapped room(s) have no replay journal. A previous import may already have sent messages. Review those rooms before retrying to avoid duplicates.`);
  }

  const encryptedRooms = data.rooms.filter(room => room.is_encrypted);
  if (encryptedRooms.length && !allowPlaintextHistory) {
    throw new Error(`${encryptedRooms.length} encrypted source room(s) contain history that this importer sends as plaintext. To create unencrypted destination rooms and accept this explicitly, pass --allow-plaintext-history.`);
  }
  const mappedEncryptedRooms = encryptedRooms.filter(room => roomMappings[room.room_id]);
  if (mappedEncryptedRooms.length) {
    throw new Error(`${mappedEncryptedRooms.length} encrypted source room(s) already have destination mappings. Cannot safely replay plaintext into an existing room whose encryption setting is unknown. Inspect the destination rooms and mappings before retrying.`);
  }
  if (encryptedRooms.length) {
    console.warn(`WARNING: ${encryptedRooms.length} encrypted source room(s) will be recreated without encryption. Their imported messages will be stored as plaintext on the destination homeserver.`);
  }
  const roomsWithoutCreator = data.rooms.filter(room => !roomMappings[room.room_id] &&
    (typeof room.creator !== "string" || !/^@[^:]+:.+$/.test(room.creator)));
  if (roomsWithoutCreator.length) {
    throw new Error(`${roomsWithoutCreator.length} room(s) have no valid creator in the export. Re-export with the updated exporter before importing; member order cannot identify the original creator.`);
  }
  const missingAttachments = data.rooms.flatMap(room => room.timeline.filter(msg =>
    msg.content?.file && !msg.local_attachment_path));
  if (missingAttachments.length) {
    throw new Error(`${missingAttachments.length} encrypted attachment(s) have no decrypted local file. Re-export with the updated exporter before importing.`);
  }

  const credentialsPath = path.join(dataDir, "new-user-credentials.txt");
  await fs.mkdir(dataDir, { recursive: true });

  console.log("Step 2: Identifying unique users for pre-creation...");
  const uniquePublicUsers = new Set();

  // Add all room members and message senders to the set of users to create
  for (const room of data.rooms) {
    if (room.creator) uniquePublicUsers.add(room.creator);
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
          const success = await resetUserPassword(
                              localUserId, 
                              tempPassword, 
                              process.env.ADMIN_TOKEN, 
                              process.env.PRIVATE_HOMESERVER
                            );
          if (success) {
            await fs.appendFile(credentialsPath, `User: ${localUserId} | Temp Password: ${tempPassword}\n`, "utf8");
          }
        } else {
          throw new Error(`[${response.status}] ${resBody.error || JSON.stringify(resBody)}`);
        }
      } else {
        console.log(`Successfully created: ${localUserId}`);
        const success = await resetUserPassword(
                              localUserId, 
                              tempPassword, 
                              process.env.ADMIN_TOKEN, 
                              process.env.PRIVATE_HOMESERVER
                            );
        if (success) {
          // Save to credentials log
          await fs.appendFile(credentialsPath, `User: ${localUserId} | Temp Password: ${tempPassword}\n`, "utf8");
        }
      }
    } catch (err) {
      console.error(`Failed to create account for ${localUserId}:`, err.message);
    }
  }
  console.log("\nStep 3: Recreating rooms and replaying timelines...");
  const replay = { sent: 0, alreadySent: 0, failed: 0, undecryptable: 0, roomsSkipped: 0 };
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

      // The original creator may have left the source room, so it need not be in members.
      const membersList = room.members.map(m => mapUserId(m.userId));
      const roomCreator = mapUserId(room.creator);

      const creatorClient = sdk.createClient({
        baseUrl: process.env.PRIVATE_HOMESERVER,
        accessToken: process.env.APPSERVICE_TOKEN,
        queryParams: { user_id: roomCreator }
      });

      // Create room
      try {
        const createRes = await creatorClient.createRoom({
          name: room.name,
          // Encryption does not determine who can join. Keep every migrated room invite-only.
          preset: "private_chat",
          visibility: "private",
          // Replayed events are plaintext. Do not label the destination room encrypted.
          initial_state: []
        });
        newRoomId = createRes.room_id;
        console.log(`Created room successfully: ${newRoomId}`);

        // Save mapping
        roomMappings[oldRoomId] = newRoomId;
        await fs.writeFile(mappingsPath, JSON.stringify(roomMappings, null, 2), "utf8");
        replayJournal[oldRoomId] = {};
        await saveReplayJournal(replayPath, replayJournal);
      } catch (err) {
        console.error(`Failed to create room "${room.name}":`, err.message);
        replay.roomsSkipped++;
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

      if (Object.hasOwn(replayJournal[oldRoomId], msg.event_id)) {
        replay.alreadySent++;
        continue;
      }

      if (msg.decryption_failed) {
        console.log(`Skipping event ${msg.event_id}: Decryption failed on export.`);
        replay.undecryptable++;
        continue;
      }

      // Add a small delay between message sends to prevent hitting Synapse rate limits (429)
      await new Promise(resolve => setTimeout(resolve, 150));

      const senderClient = sdk.createClient({
        baseUrl: process.env.PRIVATE_HOMESERVER,
        accessToken: process.env.APPSERVICE_TOKEN,
        queryParams: { user_id: localSender }
      });
      const content = structuredClone(msg.content);

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

          content.url = uploadRes.content_uri;
          delete content.file;
          if (content.info?.thumbnail_file) {
            delete content.info.thumbnail_file;
            delete content.info.thumbnail_url;
          }
        } catch (err) {
          console.warn(`Failed to upload attachment ${msg.content.body}:`, err.message);
          replay.failed++;
          continue;
        }
      }

      // Send the event using timestamp massaging (passing path relative to client/v3 prefix)
      // We generate a deterministic transaction ID based on the original event ID (stripping special chars)
      // to let Synapse deduplicate events if this script runs multiple times.
      const deterministicEventId = msg.event_id.replace(/[^a-zA-Z0-9]/g, "");
      const txnId = `migration_${deterministicEventId}`;
      const sendPath = `/rooms/${encodeURIComponent(newRoomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;

      let sent;
      try {
        sent = await senderClient.http.authedRequest(
          "PUT",
          sendPath,
          {
            user_id: localSender,
            ts: msg.origin_server_ts
          },
          content
        );
      } catch (err) {
        console.warn(`Failed to replay event ${msg.event_id}:`, err.message);
        replay.failed++;
        continue;
      }
      if (!sent?.event_id) throw new Error(`Server returned no event ID for ${msg.event_id}; inspect the room before retrying`);
      replayJournal[oldRoomId][msg.event_id] = sent.event_id;
      await saveReplayJournal(replayPath, replayJournal);
      replay.sent++;
    }
    console.log(`Finished replaying room: "${room.name}"`);
  }

  console.log(`\nReplay summary: ${replay.sent} sent, ${replay.alreadySent} already recorded, ${replay.failed} failed, ${replay.undecryptable} skipped (could not decrypt on export), ${replay.roomsSkipped} rooms skipped.`);
  if (replay.failed || replay.undecryptable || replay.roomsSkipped) {
    console.error("Migration incomplete. Review the errors above and retry after resolving them.");
    process.exitCode = 1;
  } else {
    console.log("Message replay complete.");
  }
}

run().catch(err => {
  console.error("Migration import failed:", err);
  process.exit(1);
});

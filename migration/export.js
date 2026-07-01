import sdk from "matrix-js-sdk";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import * as dotenv from "dotenv";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const requiredEnv = ["PUBLIC_HOMESERVER", "PUBLIC_USER_ID", "PUBLIC_RECOVERY_KEY"];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`Missing environment variable: ${env}`);
    process.exit(1);
  }
}

if (!process.env.PUBLIC_PASSWORD && (!process.env.PUBLIC_ACCESS_TOKEN || !process.env.PUBLIC_DEVICE_ID)) {
  console.error("Missing environment variable: Either PUBLIC_PASSWORD or both (PUBLIC_ACCESS_TOKEN and PUBLIC_DEVICE_ID) must be set.");
  process.exit(1);
}

async function run() {
  const keyRaw = process.env.PUBLIC_RECOVERY_KEY || "";
  console.log(`Recovery Key length: ${keyRaw.length}`);
  console.log(`Recovery Key starts with: "${keyRaw.substring(0, 15)}..."`);

  // Clean up recovery key input
  let cleanKey = keyRaw.trim();
  if (cleanKey.includes("#")) {
    cleanKey = cleanKey.split("#")[0].trim();
  }
  cleanKey = cleanKey.replace(/^["']|["']$/g, ""); // strip quotes

  const cryptoCallbacks = {
    getSecretStorageKey: async ({ keys }) => {
      const keyId = Object.keys(keys)[0];
      const rawKey = decodeRecoveryKey(cleanKey);
      return [keyId, rawKey];
    }
  };

  let client;

  if (process.env.PUBLIC_ACCESS_TOKEN && process.env.PUBLIC_DEVICE_ID) {
    console.log("Using existing access token and device ID from .env...");
    client = sdk.createClient({
      baseUrl: process.env.PUBLIC_HOMESERVER,
      accessToken: process.env.PUBLIC_ACCESS_TOKEN,
      userId: process.env.PUBLIC_USER_ID,
      deviceId: process.env.PUBLIC_DEVICE_ID,
      store: new sdk.MemoryStore({ localStorage: null }),
      cryptoCallbacks
    });
  } else {
    console.log("Step 1: Logging in to public server...");
    console.log(`Homeserver: ${process.env.PUBLIC_HOMESERVER}`);
    console.log(`User ID: "${process.env.PUBLIC_USER_ID}"`);
    console.log(`Password length: ${process.env.PUBLIC_PASSWORD ? process.env.PUBLIC_PASSWORD.length : 0}`);

    const tempClient = sdk.createClient({
      baseUrl: process.env.PUBLIC_HOMESERVER,
    });

    const loginResponse = await tempClient.login("m.login.password", {
      user: process.env.PUBLIC_USER_ID,
      identifier: {
        type: "m.login.id.user",
        user: process.env.PUBLIC_USER_ID,
      },
      password: process.env.PUBLIC_PASSWORD,
    });

    console.log("Logged in successfully! Setting up client...");
    console.log("\n==================================================");
    console.log("TIP: Add these to your migration/.env to reuse this session and avoid spamming your account with unverified sessions:");
    console.log(`PUBLIC_ACCESS_TOKEN="${loginResponse.access_token}"`);
    console.log(`PUBLIC_DEVICE_ID="${loginResponse.device_id}"`);
    console.log("==================================================\n");

    client = sdk.createClient({
      baseUrl: process.env.PUBLIC_HOMESERVER,
      accessToken: loginResponse.access_token,
      userId: loginResponse.user_id,
      deviceId: loginResponse.device_id,
      store: new sdk.MemoryStore({ localStorage: null }),
      cryptoCallbacks
    });
  }

  console.log("Step 2: Initializing Rust Crypto...");
  await client.initRustCrypto({ useIndexedDB: false });
  const crypto = client.getCrypto();

  console.log("Step 3: Restoring key backup using Recovery Key from Secret Storage...");
  try {
    // Modern Matrix clients store the key backup decryption key inside SSSS
    // (Secure Shared Secret Storage) which is encrypted with your Recovery Key.
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    await crypto.restoreKeyBackup();
    console.log("Megolm keys restored successfully from backup!");
  } catch (err) {
    console.warn("\n⚠️ WARNING: Key backup decryption failed:", err.message);
    console.warn("The script will still continue, but older E2EE historical messages may show as undecryptable. Unencrypted rooms and live messages will migrate normally.\n");
  }

  console.log("Step 4: Syncing client state...");
  client.startClient({ initialSyncLimit: 10 });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Sync timeout")), 60000);
    client.once("sync", (state) => {
      if (state === "PREPARED") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  console.log("Sync complete!");

  const rooms = client.getRooms();
  console.log(`Found ${rooms.length} rooms.`);

  const exportedData = {
    exporter: process.env.PUBLIC_USER_ID,
    exported_at: Date.now(),
    rooms: []
  };

  const dataDir = path.join(__dirname, "data");
  await fs.mkdir(dataDir, { recursive: true });

  for (const room of rooms) {
    console.log(`\nProcessing room: ${room.name} (${room.roomId})...`);

    // Check encryption
    const encryptionEvent = room.currentState.getStateEvents("m.room.encryption", "");
    const isEncrypted = !!encryptionEvent;

    // Get power levels
    const powerLevelsEvent = room.currentState.getStateEvents("m.room.power_levels", "");
    const powerLevels = powerLevelsEvent ? powerLevelsEvent.getContent() : null;

    // Get members
    const members = room.getMembers().map(m => ({
      userId: m.userId,
      name: m.name,
      membership: m.membership
    }));

    // Scrollback to fetch older history (e.g. 500 messages)
    console.log("Fetching message timeline history...");
    try {
      await client.scrollback(room, 500);
    } catch (err) {
      console.warn(`Failed to scrollback for room ${room.name}:`, err.message);
    }

    const events = room.getLiveTimeline().getEvents();
    console.log(`Retrieved ${events.length} timeline events.`);

    const messageTimeline = [];
    for (const e of events) {
      // We only care about normal room messages
      if (e.getType() !== "m.room.message") continue;

      let content = e.getContent();
      let decryptionFailed = false;

      if (e.isDecryptionFailure()) {
        decryptionFailed = true;
      }

      const eventData = {
        event_id: e.getId(),
        sender: e.getSender(),
        origin_server_ts: e.getTs(),
        content: content,
        decryption_failed: decryptionFailed
      };

      // Handle attachments (images/files)
      if (content && content.url && content.url.startsWith("mxc://")) {
        const httpUrl = client.mxcUrlToHttp(content.url);
        if (httpUrl) {
          try {
            console.log(`Downloading attachment: ${content.body || "unnamed"}`);
            const response = await fetch(httpUrl);
            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              const cleanBody = (content.body || "file").replace(/[^a-zA-Z0-9.]/g, "_");
              const attachmentName = `${e.getId()}_${cleanBody}`;
              const attachmentPath = path.join(dataDir, "attachments", attachmentName);

              await fs.mkdir(path.join(dataDir, "attachments"), { recursive: true });
              await fs.writeFile(attachmentPath, buffer);

              eventData.local_attachment_path = `attachments/${attachmentName}`;
            } else {
              console.warn(`Failed to download attachment: ${response.statusText}`);
            }
          } catch (err) {
            console.warn(`Failed to download attachment:`, err.message);
          }
        }
      }

      messageTimeline.push(eventData);
    }

    exportedData.rooms.push({
      room_id: room.roomId,
      name: room.name,
      is_encrypted: isEncrypted,
      power_levels: powerLevels,
      members: members,
      timeline: messageTimeline
    });
  }

  const safeFilename = `history-${process.env.PUBLIC_USER_ID.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
  const outputPath = path.join(dataDir, safeFilename);
  await fs.writeFile(outputPath, JSON.stringify(exportedData, null, 2), "utf8");

  console.log(`\nMigration export complete! File saved to: ${outputPath}`);
  client.stopClient();
  process.exit(0);
}

run().catch(err => {
  console.error("Migration export failed:", err);
  process.exit(1);
});

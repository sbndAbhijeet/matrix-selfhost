import sdk from "matrix-js-sdk";
import { logger as matrixLogger } from "matrix-js-sdk/lib/logger.js";
import { saveMessageToCache } from "./cryptoCache.js";

let client = null;
let syncReady = false;

const silentLogger = {
  trace: () => { },
  debug: () => { },
  info: () => { },
  warn: () => { },
  error: () => { },
  log: () => { },
  getChild: () => silentLogger,
};

Object.assign(matrixLogger, silentLogger);
matrixLogger.disableAll();

export async function getClient() {
  if (client && syncReady) return client;

  const requiredEnv = ["MATRIX_BASE_URL", "MATRIX_USER_ID", "MATRIX_PASSWORD"];
  const missingEnv = requiredEnv.filter((name) => !process.env[name]);
  if (missingEnv.length > 0) {
    throw new Error(`Missing Matrix environment variables: ${missingEnv.join(", ")}`);
  }

  // Step 1 — bare client just to login and get the real deviceId from Synapse
  const tempClient = sdk.createClient({
    baseUrl: process.env.MATRIX_BASE_URL,
    logger: silentLogger,
  });

  const loginResponse = await tempClient.login("m.login.password", {
    user: process.env.MATRIX_USER_ID,
    password: process.env.MATRIX_PASSWORD,
  });

  const { access_token, device_id, user_id } = loginResponse;

  // Step 2 — real client with userId + deviceId set before crypto init
  client = sdk.createClient({
    baseUrl: process.env.MATRIX_BASE_URL,
    accessToken: access_token,
    userId: user_id,
    deviceId: device_id,
    logger: silentLogger,
    store: new sdk.MemoryStore({ localStorage: null }),
  });

  // Step 3 — init Rust crypto using in-memory store (as Node.js does not support native IndexedDB)
  await client.initRustCrypto({
    useIndexedDB: false,
  });

  // Listen for successfully decrypted events and cache them
  client.on("Event.decrypted", async (event) => {
    try {
      if (event.getType() !== "m.room.message") return;
      if (event.isDecryptionFailure()) return;
      await saveMessageToCache(event);
    } catch (err) {
      // Fail silently to avoid breaking the client's internal timeline processing loop
    }
  });

  if (typeof client.setGlobalErrorOnUnknownDevices === "function") {
    client.setGlobalErrorOnUnknownDevices(false);
  }

  client.startClient({
    initialSyncLimit: 50,
    includeArchivedRooms: false,
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Sync timeout after 60s")),
      60000
    );
    client.once("sync", (state) => {
      if (state === "PREPARED") {
        clearTimeout(timeout);
        syncReady = true;
        resolve();
      } else if (state === "ERROR") {
        clearTimeout(timeout);
        reject(new Error("Sync failed with ERROR state"));
      }
    });
  });

  return client;
}

export function isRoomEncrypted(room) {
  const encryptionEvent = room.currentState.getStateEvents("m.room.encryption", "");
  return !!encryptionEvent;
}
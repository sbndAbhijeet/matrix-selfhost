import sdk from "matrix-js-sdk";
import { logger as matrixLogger } from "matrix-js-sdk/lib/logger.js";

let client = null;
let syncReady = false;

const silentLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  log: () => {},
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

  // Explicitly use memory store — no localStorage dependency
  client = sdk.createClient({
    baseUrl: process.env.MATRIX_BASE_URL,
    logger: silentLogger,
    store: new sdk.MemoryStore({ localStorage: null }),
    sessionStore: null,
    cryptoStore: null,
  });

  await client.login("m.login.password", {
    user: process.env.MATRIX_USER_ID,
    password: process.env.MATRIX_PASSWORD,
  });

  client.startClient({ initialSyncLimit: 50 });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Sync timeout after 30s")), 30000);
    client.once("sync", (state) => {
      if (state === "PREPARED") {
        clearTimeout(timeout);
        syncReady = true;
        resolve();
      }
    });
  });

  return client;
}

// Check if a room has encryption enabled
export function isRoomEncrypted(room) {
  const encryptionEvent = room.currentState.getStateEvents("m.room.encryption", "");
  return !!encryptionEvent;
}

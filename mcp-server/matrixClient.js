import sdk from "matrix-js-sdk";
import { logger as matrixLogger } from "matrix-js-sdk/lib/logger.js";
import { loadBinding } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

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

const currentDir = dirname(fileURLToPath(import.meta.url));
const cryptoStorePath = join(currentDir, "crypto-store");

mkdirSync(cryptoStorePath, { recursive: true });

// Load the native Node.js crypto binding.
// This MUST happen before initRustCrypto() so the SDK uses SQLite, not IndexedDB.
loadBinding();

function saveCredentialsToEnv(token, deviceId) {
  try {
    const envPath = join(currentDir, ".env");
    let content = "";
    try {
      content = readFileSync(envPath, "utf8");
    } catch (e) {
      // file might not exist
    }

    const lines = content.split("\n");
    let hasToken = false;
    let hasDevice = false;

    const newLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith("MATRIX_ACCESS_TOKEN=")) {
        hasToken = true;
        return `MATRIX_ACCESS_TOKEN="${token}"`;
      }
      if (trimmed.startsWith("MATRIX_DEVICE_ID=")) {
        hasDevice = true;
        return `MATRIX_DEVICE_ID="${deviceId}"`;
      }
      return line;
    });

    if (!hasToken) {
      newLines.push(`MATRIX_ACCESS_TOKEN="${token}"`);
    }
    if (!hasDevice) {
      newLines.push(`MATRIX_DEVICE_ID="${deviceId}"`);
    }

    writeFileSync(envPath, newLines.join("\n").trim() + "\n", "utf8");
    console.error(`[matrixClient] Automatically saved active session token and device ID to .env`);
  } catch (err) {
    console.error(`[matrixClient] Failed to save session credentials: ${err.message}`);
  }
}

async function waitForSync(sdkClient) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Sync timeout after 60s")),
      60000
    );
    sdkClient.once("sync", (state) => {
      if (state === "PREPARED") {
        clearTimeout(timeout);
        resolve();
      } else if (state === "ERROR") {
        clearTimeout(timeout);
        reject(new Error("Sync failed with ERROR state"));
      }
    });
  });
}

export async function getClient() {
  if (client && syncReady) return client;

  const requiredEnv = ["MATRIX_BASE_URL", "MATRIX_USER_ID", "MATRIX_PASSWORD"];
  const missingEnv = requiredEnv.filter((name) => !process.env[name]);
  if (missingEnv.length > 0) {
    throw new Error(`Missing Matrix environment variables: ${missingEnv.join(", ")}`);
  }

  const userId = process.env.MATRIX_USER_ID;
  const accessToken = process.env.MATRIX_ACCESS_TOKEN;
  const deviceId = process.env.MATRIX_DEVICE_ID;

  let clientSuccess = false;

  if (accessToken && deviceId) {
    try {
      console.error(`[matrixClient] Attempting to resume session with Device ID: ${deviceId}...`);
      client = sdk.createClient({
        baseUrl: process.env.MATRIX_BASE_URL,
        accessToken: accessToken,
        userId: userId,
        deviceId: deviceId,
        logger: silentLogger,
        store: new sdk.MemoryStore({ localStorage: null }),
      });

      await client.initRustCrypto({
        storePath: join(cryptoStorePath, "matrix-crypto.db"),
      });

      client.setGlobalErrorOnUnknownDevices(false);

      client.startClient({
        initialSyncLimit: 50,
        includeArchivedRooms: false,
      });

      await waitForSync(client);
      clientSuccess = true;
      syncReady = true;
      console.error(`[matrixClient] Session resumed successfully!`);
    } catch (err) {
      console.error(`[matrixClient] Saved session failed to resume: ${err.message}. Re-authenticating...`);
      if (client) {
        try {
          client.stopClient();
        } catch (e) {
          // Ignore
        }
        client = null;
      }
    }
  }

  if (!clientSuccess) {
    console.error(`[matrixClient] Performing fresh password login...`);
    const tempClient = sdk.createClient({
      baseUrl: process.env.MATRIX_BASE_URL,
      logger: silentLogger,
    });

    const loginResponse = await tempClient.login("m.login.password", {
      user: userId,
      password: process.env.MATRIX_PASSWORD,
    });

    const newAccessToken = loginResponse.access_token;
    const newDeviceId = loginResponse.device_id;

    client = sdk.createClient({
      baseUrl: process.env.MATRIX_BASE_URL,
      accessToken: newAccessToken,
      userId: userId,
      deviceId: newDeviceId,
      logger: silentLogger,
      store: new sdk.MemoryStore({ localStorage: null }),
    });

    await client.initRustCrypto({
      storePath: join(cryptoStorePath, "matrix-crypto.db"),
    });

    client.setGlobalErrorOnUnknownDevices(false);

    client.startClient({
      initialSyncLimit: 50,
      includeArchivedRooms: false,
    });

    await waitForSync(client);
    syncReady = true;

    saveCredentialsToEnv(newAccessToken, newDeviceId);
  }

  return client;
}


export function isRoomEncrypted(room) {
  const encryptionEvent = room.currentState.getStateEvents("m.room.encryption", "");
  return !!encryptionEvent;
}
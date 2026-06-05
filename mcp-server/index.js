import { webcrypto } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

console.log = console.error;
console.info = console.error;
console.debug = console.error;

const currentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(currentDir, ".env"), quiet: true });

await import("./server.js");

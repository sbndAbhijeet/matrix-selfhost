import { webcrypto } from "node:crypto";

if (typeof Promise.withResolvers === "undefined") {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

globalThis.crypto = webcrypto;

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

console.log = console.error;
console.info = console.error;
console.debug = console.error;

const currentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(currentDir, ".env"), quiet: true });

await import("./server.js");
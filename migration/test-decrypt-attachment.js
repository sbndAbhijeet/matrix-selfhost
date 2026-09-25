import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { decryptAttachment } from "./decryptAttachment.js";

test("decrypts a v2 encrypted attachment and rejects altered ciphertext", () => {
  const key = randomBytes(32);
  const iv = Buffer.concat([randomBytes(8), Buffer.alloc(8)]);
  const plaintext = Buffer.from("Matrix attachment test");
  const cipher = createCipheriv("aes-256-ctr", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const file = {
    v: "v2", iv: iv.toString("base64"),
    key: { alg: "A256CTR", kty: "oct", k: key.toString("base64url") },
    hashes: { sha256: createHash("sha256").update(ciphertext).digest("base64") }
  };
  assert.deepEqual(decryptAttachment(ciphertext, file), plaintext);
  ciphertext[0] ^= 1;
  assert.throws(() => decryptAttachment(ciphertext, file), /hash mismatch/);
  assert.throws(() => decryptAttachment(ciphertext, { ...file, v: "v1" }), /Unsupported/);
});

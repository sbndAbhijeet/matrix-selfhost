import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

export function decryptAttachment(ciphertext, file) {
  if (file?.v !== "v2" || file.key?.alg !== "A256CTR" || file.key?.kty !== "oct" ||
      !file.key.k || !file.iv || !file.hashes?.sha256) {
    throw new Error("Unsupported or incomplete encrypted attachment metadata");
  }
  const key = Buffer.from(file.key.k, "base64url");
  const iv = Buffer.from(file.iv, "base64");
  const expectedHash = Buffer.from(file.hashes.sha256, "base64");
  if (key.length !== 32 || iv.length !== 16 || expectedHash.length !== 32 ||
      !iv.subarray(8).equals(Buffer.alloc(8))) {
    throw new Error("Invalid encrypted attachment key, IV, or hash");
  }
  const actualHash = createHash("sha256").update(ciphertext).digest();
  if (!timingSafeEqual(actualHash, expectedHash)) {
    throw new Error("Encrypted attachment SHA-256 hash mismatch");
  }
  const decipher = createDecipheriv("aes-256-ctr", key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

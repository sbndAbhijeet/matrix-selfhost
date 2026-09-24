import * as fs from "fs/promises";

export async function readReplayJournal(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

export async function saveReplayJournal(filePath, journal) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(journal, null, 2), { mode: 0o600 });
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

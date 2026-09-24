import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReplayJournal, saveReplayJournal } from "./replayJournal.js";

test("event IDs survive a restart and an invalid journal is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "matrix-replay-"));
  const file = join(dir, "replayed-events.json");
  try {
    assert.deepEqual(await readReplayJournal(file), {});
    const journal = { "!old:example.org": { "$source": "$destination" } };
    await saveReplayJournal(file, journal);
    assert.deepEqual(await readReplayJournal(file), journal);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), journal);
    await writeFile(file, "{broken");
    await assert.rejects(readReplayJournal(file), SyntaxError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

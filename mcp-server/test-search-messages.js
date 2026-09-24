import test from "node:test";
import assert from "node:assert/strict";
import { setMockClient } from "./matrixClient.js";
import { searchMessages } from "./tools/searchMessages.js";

function room(id, encrypted = false, events = []) {
  return {
    roomId: id,
    name: id,
    currentState: { getStateEvents: () => encrypted ? {} : null },
    getLiveTimeline: () => ({ getEvents: () => events }),
  };
}

function match(id, roomId, body) {
  return { result: {
    event_id: id,
    room_id: roomId,
    type: "m.room.message",
    sender: "@alice:example.com",
    content: { body },
    origin_server_ts: 1000,
  } };
}

test("searches unencrypted room history across server pages", async () => {
  const plain = room("!plain:example.com");
  const encrypted = room("!secret:example.com", true);
  const calls = [];
  setMockClient({
    getRooms: () => [plain, encrypted],
    search: async (opts) => {
      calls.push(opts);
      return { search_categories: { room_events: calls.length === 1
        ? { results: [match("$1", plain.roomId, "first match")], next_batch: "page-2" }
        : { results: [match("$2", plain.roomId, "older match")] } } };
    },
  });

  const { content } = await searchMessages({ query: "match" });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.search_categories.room_events.filter.rooms, [plain.roomId]);
  assert.equal(calls[1].next_batch, "page-2");
  assert.match(content[0].text, /older match/);
  assert.match(content[0].text, /Encrypted search covered only loaded events/);
});

test("reports server search failure without claiming no matches across history", async () => {
  setMockClient({
    getRooms: () => [room("!plain:example.com")],
    search: async () => { throw new Error("search unavailable"); },
  });
  const { content } = await searchMessages({ query: "meeting" });
  assert.match(content[0].text, /No matches in searched history/);
  assert.match(content[0].text, /Server search failed: search unavailable/);
});

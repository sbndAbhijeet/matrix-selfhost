import test from "node:test";
import assert from "node:assert/strict";
import { setMockClient } from "./matrixClient.js";
import { getMessages } from "./tools/getMessages.js";

function makeRoom(initialCount, pages, failAt = -1) {
  const events = Array.from({ length: initialCount }, (_, i) => makeEvent(i));
  const room = {
    roomId: "!history:example.com",
    name: "History",
    oldState: { paginationToken: pages.length ? "page-0" : null },
    currentState: { getStateEvents: () => null },
    getLiveTimeline: () => ({ getEvents: () => events }),
  };
  let calls = 0;
  setMockClient({
    getRoom: () => room,
    scrollback: async (_room, batchSize) => {
      assert.equal(batchSize, 50);
      if (calls === failAt) throw new Error("network unavailable");
      const page = pages[calls++];
      if (page) events.unshift(...page.map(makeEvent));
      room.oldState.paginationToken = calls < pages.length ? `page-${calls}` : null;
    },
  });
  return { calls: () => calls };
}

function makeEvent(i) {
  return {
    getType: () => "m.room.message",
    getId: () => `$${i}`,
    getTs: () => 0,
    getSender: () => "@tester:example.com",
    getContent: () => ({ msgtype: "m.text", body: `message-${i}` }),
    isDecryptionFailure: () => false,
  };
}

test("fetches multiple history pages before claiming the requested count", async () => {
  const history = makeRoom(50, [Array.from({ length: 50 }, (_, i) => i + 50), Array.from({ length: 50 }, (_, i) => i + 100)]);
  const { content } = await getMessages({ roomId: "!history:example.com", limit: 120 });
  assert.equal(history.calls(), 2);
  assert.match(content[0].text, /Last 120 messages/);
  assert.match(content[0].text, /message-0/);
  assert.doesNotMatch(content[0].text, /Incomplete history/);
});

test("reports a partial result when history fetching fails", async () => {
  makeRoom(2, [[3, 4]], 0);
  const { content } = await getMessages({ roomId: "!history:example.com", limit: 30 });
  assert.match(content[0].text, /Available 2 messages/);
  assert.match(content[0].text, /Incomplete history: History fetch failed/);
});

test("reports reaching the beginning only when pagination is exhausted", async () => {
  const history = makeRoom(2, [[-2, -1]]);
  const { content } = await getMessages({ roomId: "!history:example.com", limit: 30 });
  assert.equal(history.calls(), 1);
  assert.match(content[0].text, /Reached the beginning of available room history \(4 messages/);
  assert.doesNotMatch(content[0].text, /Incomplete history/);
});

test("stops and warns if a history page makes no progress", async () => {
  const events = [makeEvent(1)];
  const room = {
    roomId: "!history:example.com",
    name: "History",
    oldState: { paginationToken: "unchanged" },
    currentState: { getStateEvents: () => null },
    getLiveTimeline: () => ({ getEvents: () => events }),
  };
  let calls = 0;
  setMockClient({ getRoom: () => room, scrollback: async () => { calls++; } });
  const { content } = await getMessages({ roomId: room.roomId, limit: 30 });
  assert.equal(calls, 1);
  assert.match(content[0].text, /Incomplete history: History fetch made no progress/);
});

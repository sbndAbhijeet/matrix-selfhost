import assert from "node:assert";
import { setMockClient } from "./matrixClient.js";

// Import tools
import { sendMessage, sendMessageTool } from "./tools/sendMessage.js";
import { getRoomMembers, getRoomMembersTool } from "./tools/getRoomMembers.js";
import { joinRoom, joinRoomTool } from "./tools/joinRoom.js";
import { leaveRoom, leaveRoomTool } from "./tools/leaveRoom.js";
import { inviteUser, inviteUserTool } from "./tools/inviteUser.js";
import { createRoom, createRoomTool } from "./tools/createRoom.js";

// Mock Client Setup
const mockRooms = {
  "!room1:example.com": {
    roomId: "!room1:example.com",
    name: "Room One",
    getMembers: () => [
      { userId: "@alice:example.com", name: "Alice", membership: "join", powerLevel: 100 },
      { userId: "@bob:example.com", name: "Bob", membership: "join", powerLevel: 50 },
      { userId: "@charlie:example.com", name: "Charlie", membership: "invite", powerLevel: 0 },
    ],
  },
};

let lastSentMessage = null;
let lastJoinedRoom = null;
let lastLeftRoom = null;
let lastInvited = null;
let lastCreatedRoomOptions = null;

const mockClient = {
  getRoom: (roomId) => mockRooms[roomId] || null,
  sendMessage: async (roomId, content) => {
    lastSentMessage = { roomId, content };
    return { event_id: "$event-123456" };
  },
  joinRoom: async (roomIdOrAlias) => {
    lastJoinedRoom = roomIdOrAlias;
    return { roomId: "!joined-room:example.com" };
  },
  leaveRoom: async (roomId) => {
    lastLeftRoom = roomId;
    return {};
  },
  invite: async (roomId, userId) => {
    lastInvited = { roomId, userId };
    return {};
  },
  createRoom: async (options) => {
    lastCreatedRoomOptions = options;
    return { room_id: "!new-room:example.com" };
  },
};

// Install the mock client
setMockClient(mockClient);

async function runTests() {
  console.log("Starting tests...");

  // 1. Test sendMessage SDK & MCP
  console.log("- Testing sendMessage...");
  const msgResult = await sendMessage({
    roomId: "!room1:example.com",
    body: "Hello world",
    formattedBody: "<b>Hello world</b>",
  });
  assert.strictEqual(msgResult.eventId, "$event-123456");
  assert.deepStrictEqual(lastSentMessage, {
    roomId: "!room1:example.com",
    content: {
      msgtype: "m.text",
      body: "Hello world",
      format: "org.matrix.custom.html",
      formatted_body: "<b>Hello world</b>",
    },
  });

  const msgToolResult = await sendMessageTool({
    roomId: "!room1:example.com",
    body: "Hello world",
  });
  assert.ok(msgToolResult.content[0].text.includes("$event-123456"));

  // Test error path
  const msgErrResult = await sendMessageTool({
    roomId: "!nonexistent:example.com",
    body: "Hello",
  });
  assert.ok(msgErrResult.content[0].text.includes("ERROR: Room"));


  // 2. Test getRoomMembers SDK & MCP
  console.log("- Testing getRoomMembers...");
  const members = await getRoomMembers({ roomId: "!room1:example.com" });
  assert.strictEqual(members.length, 3);
  assert.strictEqual(members[0].userId, "@alice:example.com");
  assert.strictEqual(members[0].powerLevel, 100);

  const membersToolResult = await getRoomMembersTool({ roomId: "!room1:example.com" });
  const tableText = membersToolResult.content[0].text;
  assert.ok(tableText.includes("| @alice:example.com | Alice | `join` | 100 |"));
  assert.ok(tableText.includes("| @bob:example.com | Bob | `join` | 50 |"));


  // 3. Test joinRoom SDK & MCP
  console.log("- Testing joinRoom...");
  const joinRes = await joinRoom({ roomIdOrAlias: "#alias:example.com" });
  assert.strictEqual(joinRes.roomId, "!joined-room:example.com");
  assert.strictEqual(lastJoinedRoom, "#alias:example.com");

  const joinToolRes = await joinRoomTool({ roomIdOrAlias: "#alias:example.com" });
  assert.ok(joinToolRes.content[0].text.includes("Successfully joined room"));


  // 4. Test leaveRoom SDK & MCP
  console.log("- Testing leaveRoom...");
  const leaveRes = await leaveRoom({ roomId: "!room1:example.com" });
  assert.strictEqual(leaveRes.success, true);
  assert.strictEqual(lastLeftRoom, "!room1:example.com");

  const leaveToolRes = await leaveRoomTool({ roomId: "!room1:example.com" });
  assert.ok(leaveToolRes.content[0].text.includes("Successfully left room"));


  // 5. Test inviteUser SDK & MCP
  console.log("- Testing inviteUser...");
  const inviteRes = await inviteUser({ roomId: "!room1:example.com", userId: "@david:example.com" });
  assert.strictEqual(inviteRes.success, true);
  assert.deepStrictEqual(lastInvited, { roomId: "!room1:example.com", userId: "@david:example.com" });

  const inviteToolRes = await inviteUserTool({ roomId: "!room1:example.com", userId: "@david:example.com" });
  assert.ok(inviteToolRes.content[0].text.includes("Successfully invited user @david:example.com"));


  // 6. Test createRoom SDK & MCP (with and without encryption)
  console.log("- Testing createRoom...");
  const createRes = await createRoom({
    name: "New Room",
    topic: "Cool room",
    visibility: "private",
    invite: ["@alice:example.com"],
    isEncrypted: true,
  });
  assert.strictEqual(createRes.roomId, "!new-room:example.com");
  assert.strictEqual(lastCreatedRoomOptions.name, "New Room");
  assert.strictEqual(lastCreatedRoomOptions.topic, "Cool room");
  assert.strictEqual(lastCreatedRoomOptions.visibility, "private");
  assert.strictEqual(lastCreatedRoomOptions.preset, "private_chat");
  assert.deepStrictEqual(lastCreatedRoomOptions.invite, ["@alice:example.com"]);
  assert.deepStrictEqual(lastCreatedRoomOptions.initial_state, [
    {
      type: "m.room.encryption",
      state_key: "",
      content: {
        algorithm: "m.megolm.v1.aes-sha2",
      },
    },
  ]);

  const createToolRes = await createRoomTool({
    name: "New Room",
    isEncrypted: true,
  });
  assert.ok(createToolRes.content[0].text.includes("Successfully created room (encrypted)"));

  console.log("All tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed!", err);
  process.exit(1);
});

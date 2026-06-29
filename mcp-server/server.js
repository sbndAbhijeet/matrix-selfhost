import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { listRooms } from "./tools/listRooms.js";
import { getMessages } from "./tools/getMessages.js";
import { searchMessages } from "./tools/searchMessages.js";
import { sendMessageTool } from "./tools/sendMessage.js";
import { getRoomMembersTool } from "./tools/getRoomMembers.js";
import { joinRoomTool } from "./tools/joinRoom.js";
import { leaveRoomTool } from "./tools/leaveRoom.js";
import { inviteUserTool } from "./tools/inviteUser.js";
import { createRoomTool } from "./tools/createRoom.js";

const server = new McpServer({
  name: "matrix-wetec-mcp",
  version: "1.0.0",
});

// Tool: list all rooms you are in
server.tool(
  "list_rooms",
  "List all Matrix rooms you are a member of, showing which are readable vs encrypted",
  {},
  listRooms
);

// Tool: get messages from a specific room
server.tool(
  "get_messages",
  "Get recent messages from a Matrix room. Will refuse and explain if the room is encrypted.",
  {
    roomId: z.string().describe("The room ID, e.g. !abc123:matrix.wetec-server.com"),
    limit: z.number().optional().default(30).describe("How many recent messages to fetch (default 30)"),
  },
  getMessages
);

// Tool: search across all readable rooms
server.tool(
  "search_messages",
  "Search for a keyword or phrase across all unencrypted Matrix rooms you are in",
  {
    query: z.string().describe("Keyword or phrase to search for"),
  },
  searchMessages
);

// Tool: send a message to a specific room
server.tool(
  "send_message",
  "Send a message to a Matrix room. Supports optional HTML formatting via formattedBody.",
  {
    roomId: z.string().describe("The room ID, e.g. !abc123:matrix.wetec-server.com"),
    body: z.string().describe("The plain text message content to send"),
    formattedBody: z.string().optional().describe("Optional HTML-formatted version of the message"),
  },
  sendMessageTool
);

// Tool: list all members of a room
server.tool(
  "get_room_members",
  "Get the list of members in a Matrix room, including their display name and membership status",
  {
    roomId: z.string().describe("The room ID to fetch members for"),
  },
  getRoomMembersTool
);

// Tool: join a room
server.tool(
  "join_room",
  "Join a Matrix room by its ID or alias",
  {
    roomIdOrAlias: z.string().describe("The room ID or alias, e.g. #alias:server.com or !roomid:server.com"),
  },
  joinRoomTool
);

// Tool: leave a room
server.tool(
  "leave_room",
  "Leave a Matrix room by its ID",
  {
    roomId: z.string().describe("The room ID to leave"),
  },
  leaveRoomTool
);

// Tool: invite a user to a room
server.tool(
  "invite_user",
  "Invite a user to a Matrix room",
  {
    roomId: z.string().describe("The room ID"),
    userId: z.string().describe("The Matrix user ID to invite, e.g. @user:server.com"),
  },
  inviteUserTool
);

// Tool: create a new room
server.tool(
  "create_room",
  "Create a new Matrix room with customizable options",
  {
    name: z.string().optional().describe("Optional name for the room"),
    topic: z.string().optional().describe("Optional topic description for the room"),
    visibility: z.enum(["public", "private"]).optional().default("private").describe("Room visibility preset (default private)"),
    invite: z.array(z.string()).optional().describe("Optional list of user IDs to invite initially"),
    isEncrypted: z.boolean().optional().default(false).describe("Whether to enable end-to-end encryption in the new room (default false)"),
  },
  createRoomTool
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[matrix-mcp] Server started and waiting for requests.");

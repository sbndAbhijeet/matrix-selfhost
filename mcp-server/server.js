import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { listRooms } from "./tools/listRooms.js";
import { getMessages } from "./tools/getMessages.js";
import { searchMessages } from "./tools/searchMessages.js";

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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[matrix-mcp] Server started and waiting for requests.");

# Matrix Selfhost

A self-hosted Matrix (Synapse) server with a Claude-powered MCP server that lets Claude Desktop read, search, and summarize your Matrix rooms and messages.

---

## What this project does

- Runs a private Matrix homeserver (Synapse) and PostgreSQL database via Docker.
- Exposes your Matrix rooms and messages to Claude Desktop through an MCP server.
- Includes a legacy bot (`bot/`) that listens for `/summarize` commands

---

## Architecture

```
Claude Desktop (Windows)
        │
        │  stdio / JSON-RPC
        ▼
MCP Server — mcp-server/index.js   (Node.js, runs inside WSL)
        │
        │  matrix-js-sdk (HTTP)
        ▼
Synapse homeserver — localhost:8008  (Docker container)
        │
        ▼
PostgreSQL — localhost:5432          (Docker container)
```

Claude Desktop starts the MCP server automatically when it launches. You do not run the MCP server manually during normal use.

---

## Project structure

```
matrix-selfhost/
├── docker-compose.yml          — starts Synapse and PostgreSQL
├── synapse/                    — Synapse configuration and data
│   ├── homeserver.yaml         — active homeserver config
│   └── media_store/            — uploaded media (volume mount)
├── postgres/                   — PostgreSQL data volume
├── mcp-server/                 — MCP server for Claude Desktop
│   ├── index.js                — entry point: sets up WebCrypto, protects stdout, loads .env
│   ├── server.js               — registers MCP tools
│   ├── matrixClient.js         — Matrix client with E2EE Rust Crypto initialization
│   ├── cryptoCache.js          — SQLite decryption cache driver
│   ├── decrypted_cache.db      — SQLite database (local cache, ignored by Git)
│   ├── tools/
│   │   ├── createRoom.js       — create_room tool
│   │   ├── getMessages.js      — get_messages tool
│   │   ├── getRoomMembers.js   — get_room_members tool
│   │   ├── inviteUser.js       — invite_user tool
│   │   ├── joinRoom.js         — join_room tool
│   │   ├── leaveRoom.js        — leave_room tool
│   │   ├── listRooms.js        — list_rooms tool
│   │   ├── searchMessages.js   — search_messages tool
│   │   └── sendMessage.js      — send_message tool
│   ├── .env                    — your credentials
│   └── package.json
└── bot/                        — bot functions
    ├── listener.js
    ├── summarize.js
    └── package.json
```

---

## Prerequisites

- **Windows with WSL (Ubuntu)** — If the project runs inside WSL
- **Docker Desktop** — with WSL integration enabled
- **Node.js 18 or higher** inside WSL
- **Claude Desktop** — installed on Windows

---

## 1. Start the homeserver

From the project root inside WSL:

```bash
docker-compose up -d
```

Verify Synapse is running:

```bash
curl http://localhost:8008/_matrix/client/versions
```

You should see a JSON response. If you get a connection error, wait a few seconds and try again — Synapse takes a moment to start.

---

## 2. First-time Synapse setup

Run this once to generate `homeserver.yaml` and signing keys before starting the containers:

```bash
mkdir -p synapse

docker run -it --rm \
  -v ./synapse:/data \
  -e SYNAPSE_SERVER_NAME=matrix.wetec-server.com \
  -e SYNAPSE_REPORT_STATS=no \
  matrixdotorg/synapse:latest generate
```

Then open `synapse/homeserver.yaml` and replace the default SQLite database block:

```yaml
# Remove this:
database:
  name: sqlite3
  args:
    database: /data/homeserver.db
```

with:

```yaml
# Add this:
database:
  name: psycopg2
  args:
    user: synapse
    password: synapsepassword
    database: synapse
    host: postgres
    cp_min: 5
    cp_max: 10
```

Now start the containers:

```bash
docker-compose up -d
```

---

## 3. Create Matrix users

Run these commands once after Synapse is running. Repeat the pattern for any additional users you need.

**Admin user:**
```bash
docker exec -it matrix-synapse register_new_matrix_user \
  -c /data/homeserver.yaml http://localhost:8008 \
  -u admin -p admin123 -a
```

**Regular user:**
```bash
docker exec -it matrix-synapse register_new_matrix_user \
  -c /data/homeserver.yaml http://localhost:8008 \
  -u user1 -p user123
```

**Bot user (for the bot):**
```bash
docker exec -it matrix-synapse register_new_matrix_user \
  -c /data/homeserver.yaml http://localhost:8008 \
  -u ai-bot -p bot123
```

To add more users later, repeat the same command with a new `-u` and `-p`. Add `-a` for admin.

---

## 4. Connect Element to your homeserver

1. Open Element (browser or desktop app).
2. Choose **Sign in**.
3. Select **Edit** next to the homeserver URL.
4. Enter `http://localhost:8008`.
5. Log in with one of the users you created above.

---

## 5. Set up the MCP server

### Install dependencies

```bash
cd mcp-server
npm install
```

### Create the environment file

```bash
cp .env.example .env
```

Edit `mcp-server/.env` with your values:

```env
MATRIX_BASE_URL=http://localhost:8008
MATRIX_USER_ID=@your-username:matrix.wetec-server.com
MATRIX_PASSWORD=your-password
```

Use the credentials of the Matrix account you want Claude to act as. Claude will see exactly the rooms that account has joined.

> **Note:** The MCP server loads `.env` by its own file path, so it works correctly regardless of the directory Claude Desktop starts the process from.

---

## 6. Configure Claude Desktop (Windows)

Claude Desktop needs to know how to start the MCP server. Because if the project lives in WSL and Claude Desktop runs on Windows, use `wsl.exe` as the command.

Open the Claude Desktop config file on Windows:

1. Go to Claude Desktop.
2. Go to Settings.
3. Select Developer and click on config and select `claude_desktop_config.json`


Add the `mcpServers` block to the existing JSON. Do not replace the rest of the file — just add it alongside your other keys:

```json
{
  "mcpServers": {
    "matrix-wetec": {
      "command": "wsl.exe", //only if working on wsl else not
      "args": [
        "node",
        "../matrix-selfhost/mcp-server/index.js", //path to index.js (starting point)
      ]
    }
  }
}
```


> **Why `wsl.exe`?** Claude Desktop runs on Windows, but the MCP server is a Node.js process inside WSL. Using `wsl.exe` as the command tells Windows to run `node index.js` inside WSL. 

### Verify Node.js is accessible from Windows

Before restarting Claude Desktop, confirm that WSL Node can be reached from Windows CMD:

```cmd
wsl node --version
```

If this prints a version number (e.g. `v20.x.x`), the config will work. If you get `node not found`, find the full path:

```bash
# inside WSL
which node
```
Then use that full path in the args array

---

## 7. Restart Claude Desktop

After saving the config:

1. Close Claude Desktop.
2. Open Task Manager on Windows.
3. End any remaining Claude Desktop or node processes if present.
4. Open Claude Desktop again.

When Claude loads, you should see a small hammer icon (🔨) in the chat input area. This means the MCP tools are connected. Sometimes your options will show your mcp server is ON

---

## 8. Test the MCP tools

### Send test messages via curl (no Element login needed)

First get your access token:

```bash
curl -X POST http://localhost:8008/_matrix/client/v3/login \
  -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","user":"user1","password":"user123"}'
```

Copy the `access_token` from the response. Then list your joined rooms to find room IDs:

```bash
curl http://localhost:8008/_matrix/client/v3/joined_rooms \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Send a test message to a room:

```bash
curl -X PUT \
  "http://localhost:8008/_matrix/client/v3/rooms/!ROOMID:matrix.wetec-server.com/send/m.room.message/txn1" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"msgtype":"m.text","body":"Test message for MCP"}'
```

Send several messages at once with a shell loop:

```bash
TOKEN="YOUR_ACCESS_TOKEN"
ROOM="!YOUROOMID:matrix.wetec-server.com"
BASE="http://localhost:8008/_matrix/client/v3/rooms"

messages=(
  "Morning team, standup in 10 mins"
  "I pushed the fix for the postgres migration issue"
  "Can someone review the MCP server PR?"
  "Synapse logs are showing high memory usage"
  "Meeting notes from yesterday are in the wiki"
)

for i in "${!messages[@]}"; do
  curl -s -X PUT \
    "$BASE/$ROOM/send/m.room.message/txn$RANDOM$i" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"msgtype\":\"m.text\",\"body\":\"${messages[$i]}\"}" \
    | jq .event_id
  sleep 0.5
done
```

### Ask Claude to use the tools

Once messages are in your rooms, ask Claude naturally:

- "List all my Matrix rooms"
- "Get messages from the dev room"
- "Search for any messages mentioning postgres"
- "Summarize what was discussed in the general room"

---

## Available MCP tools

| Tool | Description |
|------|-------------|
| `list_rooms` | Lists all rooms your account has joined. Marks encrypted rooms with 🔒 and unencrypted rooms with ✅. |
| `get_messages` | Returns recent messages from a room, attempting to decrypt messages in encrypted rooms. |
| `search_messages` | Searches for a keyword across all rooms (both encrypted and unencrypted), skipping messages that cannot be decrypted. |
| `send_message` | Sends a message to a Matrix room (supports optional HTML formatting). |
| `get_room_members` | Lists all members in a Matrix room, including display names, membership status, and power levels. |
| `join_room` | Joins a Matrix room by its ID or alias. |
| `leave_room` | Leaves a Matrix room by its ID. |
| `invite_user` | Invites a user to a Matrix room. |
| `create_room` | Creates a new Matrix room with optional encryption, name, topic, and invitees. |

---

## End-to-End Encryption (E2EE) Support

The MCP server fully supports reading and searching messages inside end-to-end encrypted (E2EE) rooms. To handle E2EE securely and persist decrypted message history across server restarts, the system uses a **Hybrid Memory + SQLite Caching** approach.

### Architectural Approach

1. **Rust Cryptography Core**: The MCP server initializes the Matrix Rust SDK cryptography library (via `matrix-js-sdk`) when starting up.
2. **Dynamic Device Registration**: When logging in, the MCP server registers itself as a new device under your account to receive active key distributions.
3. **Decryption Event Listener**: The server listens to `"Event.decrypted"` events. When the client successfully decrypts an E2EE message, the plaintext contents are immediately persisted locally.
4. **SQLite Cache Layer**: A local, Git-ignored SQLite database (`mcp-server/decrypted_cache.db`) stores the decrypted messages (event ID, room ID, sender, timestamp, body, and message type).
5. **Decryption Fallback**: If the Node.js process restarts, its in-memory cryptography keys are cleared. When querying message history:
   - For events that cannot be decrypted using current in-memory keys, the server queries the SQLite cache by event ID.
   - If the message has been cached during a previous run, the server seamlessly loads the cached plaintext (marked with `🔑 decrypted from cache`).

---

### Decryption Behavior & Edge Cases ⚠️

Due to the nature of the Matrix E2EE protocol (Megolm/Olm), there are key decryption edge cases to be aware of:

*   **New Messages (Fully Decrypted):** When the MCP server is actively running, all incoming encrypted messages are decrypted in real-time and saved to the SQLite database.
*   **Restart Resilience (Fully Decrypted):** If Claude Desktop or the MCP server restarts, any messages decrypted in previous sessions remain readable because they are fetched from the local SQLite cache.
*   **Offline Messages (Undecryptable):** If messages are sent in a room *while the MCP server is shut down / offline*, those messages cannot be decrypted. Since the server was offline, it was never part of the session key exchange. They will show as `[unable to decrypt — key not yet received]`.
*   **Pre-Setup History (Undecryptable):** Historical messages sent *before the MCP server was first initialized* cannot be decrypted for the same reason—the keys were never shared with the MCP server's device.

---



## Bot Setup

The `bot/` folder contains an earlier experiment — a Matrix bot that listens for `/summarize` and replies with a chat summary. It is not the main integration path for this project but is kept as a useful reference for matrix-js-sdk usage patterns (authentication, sync, timeline events, command handling). Later may add additional commands to make more powerful.

To run it:

```bash
cd bot
npm install
node listener.js
```

The bot requires `bot/.env` with:

```env
BOT_USER=@ai-bot:matrix.wetec-server.com
BOT_PASSWORD=bot123
OPENAI_API_KEY=sk-xxxx
```

The bot must be invited to a room before it can respond to commands.
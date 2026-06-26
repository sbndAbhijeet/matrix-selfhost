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
│   ├── matrixClient.js         — Matrix client with silenced SDK logs
│   ├── tools/
│   │   ├── listRooms.js        — list_rooms tool
│   │   ├── getMessages.js      — get_messages tool
│   │   └── searchMessages.js   — search_messages tool
│   ├── .env                    — your credentials
│   └── package.json
└── bot/                        — bot fuctions
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

---

## End-to-End Encryption (E2EE) Support

This MCP server supports reading and searching messages inside end-to-end encrypted (E2EE) rooms. Here is how it works and what limitations to expect:

### How it Works (The Cryptographic Approach)

1. **Rust Cryptography SDK**: The MCP server uses the Matrix Rust SDK cryptography library (integrated into `matrix-js-sdk`) to handle decryption.
2. **Device Registration**: When the MCP server logs into your homeserver, it registers itself as a new device associated with your user account.
3. **In-Memory Key Storage**: Since Node.js does not support native browser IndexedDB out-of-the-box, the cryptography module is configured to use an **in-memory crypto store** (`useIndexedDB: false`).

---

### The Historical Message Decryption Limitation ⚠️

You will notice that **older messages sent before the MCP server was set up/running cannot be decrypted** (they will appear as `[unable to decrypt — key not yet received]`). 

**Is this behavior true and expected? Yes! Here is why:**

1. **How E2EE Works in Matrix**: Under Matrix's Megolm/Olm encryption protocol, when someone sends a message, their client encrypts the message with a temporary session key. Their client then securely shares this session key *only* with the devices that are currently registered and online in that room at that exact moment.
2. **New Device Registration**: Because the MCP server is treated as a **brand new device**, it was not present when those historical messages were sent. Thus, it never received the session keys needed to decrypt them.
3. **In-Memory Store Re-initialization**: Every time Claude Desktop restarts or the MCP server wakes up/restarts, it performs a new login, registers a new device ID, and starts with a completely empty in-memory cryptography database. It has no history of previous cryptographic keys.
4. **Decrypting New Messages**: Only messages sent **while the MCP server is actively running and synced** can be decrypted. When other users or your own client send new messages, their devices will see the MCP server's active device ID and share the encryption keys with it, allowing seamless decryption.

### Tips for Verification

1. Keep Claude Desktop open or make sure the MCP server is connected.
2. Send a new message from a client like Element in an encrypted room.
3. Ask Claude: *"Get messages from [Encrypted Room Name]"*. You should see the newly sent message fully decrypted!

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
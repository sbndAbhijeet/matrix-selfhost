# Matrix-selfhost

Self-hosted Matrix Synapse with a simple Matrix bot that summarizes recent chat using OpenAI.

## Overview

- `docker-compose.yml` runs the Matrix homeserver and Postgres.
- `synapse/` contains the homeserver configuration and media store.
- `bot/` contains the Matrix bot that listens for `/summarize` and replies with a summary.

## Project structure

- `docker-compose.yml` — starts the Postgres and Synapse containers
- `synapse/` — Synapse configuration and persistent data
  - `homeserver.yaml` — active Synapse server config
  - `media_store/` — Synapse media storage volume
- `bot/` — Matrix bot source and dependencies
  - `listener.js` — bot process that reads room messages and responds
  - `package.json` / `pnpm-lock.yaml` — bot package metadata and lockfile
- `mcp-server/` — MCP server that lets Claude Desktop inspect Matrix rooms and messages
  - `index.js` — MCP entrypoint; loads `.env`, installs WebCrypto, and protects MCP stdout
  - `server.js` — registers the MCP tools
  - `matrixClient.js` — creates the Matrix client and silences SDK logs
  - `tools/` — room listing, message reading, and message search tools
- `postgres/` — local Postgres data volume

## Synapse configuration

Before starting the Matrix homeserver for the first time, generate the Synapse configuration and signing keys:

```bash
mkdir -p synapse

docker run -it --rm \
-v ./synapse:/data \
-e SYNAPSE_SERVER_NAME=matrix.wetec-server.com \
-e SYNAPSE_REPORT_STATS=no \
matrixdotorg/synapse:latest generate
```

This creates:

* `homeserver.yaml`
* signing keys
* media store directories
* other required Synapse configuration files

inside the `synapse/` directory.

### Configure PostgreSQL

Open `synapse/homeserver.yaml`.

Replace the default SQLite configuration:

```yaml
database:
  name: sqlite3
  args:
    database: /data/homeserver.db
```

with:

```yaml
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


### Start the services

```bash
docker-compose up -d
```

Verify Synapse is running:

```bash
curl http://localhost:8008/_matrix/client/versions
```

A valid JSON response indicates that the homeserver is running correctly.



## Prerequisites

- Docker and Docker Compose
- Node.js 18+ and `pnpm` or `npm`
- An OpenAI API key for the bot

## Setup

### 1) Start Synapse and Postgres

```bash
docker-compose up -d
```

### 2) Check that Synapse is reachable

```bash
curl http://localhost:8008/_matrix/client/versions
```

### 3) Create the Matrix users

Create the users below with Synapse’s registration helper. These are the accounts you can use for testing:

- Admin: `admin` / `admin123`
- Regular user: `user1` / `user123`
- Bot user: `ai-bot` / `bot123`

Create the admin account first:

```bash
docker exec -it matrix-synapse register_new_matrix_user -c /data/homeserver.yaml http://localhost:8008 -u admin -p admin123 -a
```

Create the normal user:

```bash
docker exec -it matrix-synapse register_new_matrix_user -c /data/homeserver.yaml http://localhost:8008 -u user1 -p user123
```

Create the bot account:

```bash
docker exec -it matrix-synapse register_new_matrix_user -c /data/homeserver.yaml http://localhost:8008 -u ai-bot -p bot123
```

If you need more users later, repeat the same command pattern with a new username and password. Add `-a` when you want an admin account.

### 4) Connect with Element

- Open Element in your browser or desktop app.
- Choose **Sign in**.
- Select **Custom server** or **Homeserver**.
- Set the homeserver URL to `http://localhost:8008`.
- Log in with one of the users you created above, for example `admin` or `user1`.

### 5) Configure the bot — this is the crucial part

The bot will not work until its environment variables are set correctly.

Copy `bot/.env.example` to `bot/.env`, then fill in real values:

```text
BOT_USER=@ai-bot:matrix.wetec-server.com
BOT_PASSWORD=bot123
OPENAI_API_KEY=sk-xxxx
```

Important:

- `BOT_USER` must match the Matrix ID for your bot account.
- `BOT_PASSWORD` must match the password you used when creating the bot user.
- `OPENAI_API_KEY` must be a valid OpenAI key.

### 6) Install dependencies and run the bot

Using `pnpm`:

```bash
cd bot
pnpm install
node listener.js
```

Or using `npm`:

```bash
cd bot
npm install
node listener.js
```

When the bot starts, it logs in as `ai-bot` and listens for room messages.

## How to test

1. Start the stack with `docker-compose up -d`.
2. Create or confirm the users `admin`, `user1`, and `ai-bot`.
3. Log in to Element with `admin` or `user1` using `http://localhost:8008` as the homeserver.
4. Start the bot from the `bot/` folder use `node listener.js`.
5. Invite the bot to the room.
6. Send `/summarize` in that room.
7. The bot replies with a summary.

## Claude Desktop MCP server

The `mcp-server/` folder exposes Matrix tools to Claude Desktop:

- `list_rooms` lists joined rooms and marks encrypted rooms.
- `get_messages` reads recent messages from an unencrypted room.
- `search_messages` searches across unencrypted rooms.

Encrypted rooms are intentionally not readable by this MCP server because end-to-end encrypted message contents are decrypted in a Matrix client such as Element, not by the homeserver.

### MCP server environment

Copy `mcp-server/.env.example` to `mcp-server/.env`, then fill in real values:

```text
MATRIX_BASE_URL=http://localhost:8008
MATRIX_USER_ID=@your-username:matrix.wetec-server.com
MATRIX_PASSWORD=your-password
```

The MCP entrypoint also loads this file by absolute script location, so it still works when Claude Desktop starts the process from a different working directory.

### Claude Desktop configuration from Windows into WSL

When Claude Desktop runs on Windows and the project lives in WSL, configure the MCP server like this:

```json
{
  "mcpServers": {
    "matrix-wetec": {
      "command": "wsl.exe",
      "args": [
        "--cd",
        "/home/bhanu/Projects/matrix-selfhost/mcp-server",
        "node",
        "index.js"
      ]
    }
  }
}
```

Claude Desktop starts `index.js` for you. You only need to run it manually when debugging.

### Restarting Claude Desktop after MCP changes

After changing MCP server code or config:

1. Close Claude Desktop.
2. Open Task Manager.
3. End any remaining Claude Desktop process.
4. Open Claude Desktop again.

This forces Claude to start a fresh MCP server process.

### MCP stdout rule

MCP servers communicate with Claude over stdout using JSON-RPC. Do not write normal logs to stdout from MCP server code or dependencies. Use stderr for logs.

This project protects that rule in `mcp-server/index.js` and `mcp-server/matrixClient.js` by:

- loading `dotenv` quietly
- redirecting `console.log`, `console.info`, and `console.debug` to stderr
- passing a silent logger to `matrix-js-sdk`
- silencing the Matrix SDK root logger and child loggers

## Registering more users

To add another Matrix user, use the same registration command with a new username and password:

```bash
docker exec -it matrix-synapse register_new_matrix_user -c /data/homeserver.yaml http://localhost:8008 -u alice -p alice123
```

For an admin user, add `-a`:

```bash
docker exec -it matrix-synapse register_new_matrix_user -c /data/homeserver.yaml http://localhost:8008 -u alice-admin -p alice123 -a
```

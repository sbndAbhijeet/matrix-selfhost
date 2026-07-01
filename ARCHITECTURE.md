# Architecture & Feature Workflows

This document details the architectural design, component communication flows, and core workflows of the Matrix Selfhost project, including the Claude Desktop MCP Server, SQLite Decryption Cache, and the Public-to-Private Migration Pipeline.

---

## 1. System Components

The project consists of three main service layers:

```
┌────────────────────────────────────────────────────────┐
│               Windows Desktop Environment             │
│  ┌───────────────────┐        ┌─────────────────────┐  │
│  │  Claude Desktop   │◄───────►│    Element Client   │  │
│  └─────────┬─────────┘        └──────────▲──────────┘  │
└────────────┼─────────────────────────────┼─────────────┘
             │ stdio / JSON-RPC            │ HTTP (E2EE)
┌────────────┼─────────────────────────────┼─────────────┐
│            ▼                             ▼             │
│  ┌───────────────────┐        ┌─────────────────────┐  │
│  │    MCP Server     │───────►│  Synapse Homeserver │  │
│  │   (mcp-server/)   │  HTTP  │      (synapse/)     │  │
│  └─────────┬─────────┘        └──────────┬──────────┘  │
│            │                             │             │
│            ▼ SQLite                      ▼ PostgreSQL  │
│  ┌───────────────────┐        ┌─────────────────────┐  │
│  │ Decryption Cache  │        │   Postgres Database │  │
│  │ (decrypted_cache) │        │     (postgres/)     │  │
│  └───────────────────┘        └─────────────────────┘  │
│                   WSL2 Environment                     │
└────────────────────────────────────────────────────────┘
```

---

## 2. Component Workflows

### A. Claude Desktop Tool Execution (MCP Server)
The Model Context Protocol (MCP) server acts as a translator between Claude Desktop (stdio/JSON-RPC) and the Synapse Matrix API.

```mermaid
sequenceDiagram
    autonumber
    participant Claude as Claude Desktop (Windows)
    participant MCP as MCP Server (WSL2 Node)
    participant SDK as matrix-js-sdk
    participant HS as Synapse Homeserver

    Claude->>MCP: JSON-RPC Call: "callTool(get_messages, { roomId })"
    MCP->>SDK: Get room timeline (up to limit)
    SDK->>HS: GET /rooms/{roomId}/messages
    HS-->>SDK: Return raw events list (some encrypted)
    
    alt Event is encrypted (m.room.encrypted)
        SDK->>SDK: Check in-memory keys
        alt Keys present
            SDK->>MCP: Decrypted plaintext event
        else Keys missing
            MCP->>MCP: Query local SQLite decryption cache
            alt Event cached
                MCP-->>SDK: Return cached plaintext (mark: "🔑 cache")
            else Event not cached
                MCP-->>SDK: Return raw encrypted fallback (mark: "[unable to decrypt]")
            end
        end
    end

    MCP-->>Claude: JSON-RPC Response: Plaintext message lists
```

---

## 3. E2EE Cache System (Hybrid Storage)

To handle End-to-End Encryption (E2EE) securely and persist decrypted histories across server restarts, the MCP server utilizes a **Hybrid Memory + SQLite caching layer**.

```mermaid
flowchart TD
    classDef memory fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#fff;
    classDef cache fill:#0f172a,stroke:#10b981,stroke-width:2px,color:#fff;
    classDef database fill:#14532d,stroke:#22c55e,stroke-width:2px,color:#fff;

    Start["Receive Encrypted Event"] --> Decrypt{"Decrypt with Rust-Crypto?"}
    
    Decrypt -->|Success: In-memory keys match| WriteCache["1. Emit 'Event.decrypted'<br>2. Save plaintext to SQLite DB"]:::memory
    Decrypt -->|Failure: Keys missing/process restarted| ReadCache{"Query SQLite DB by Event ID"}:::cache
    
    WriteCache --> StoreCache[("decrypted_cache.db")]:::database
    ReadCache -->|Found| ReturnPlain["Return Cached Text"]:::cache
    ReadCache -->|Not Found| ReturnEnc["Return [Unable to Decrypt] fallback"]:::cache
    
    StoreCache --> ReadCache
```

---

## 4. History Migration Pipeline

The migration pipeline transfers room states, user accounts, and messages from a public homeserver to your private instance.

### A. Export Workflow (export.js)
Retrieves encrypted Megolm keys and room histories from the public server.

```mermaid
sequenceDiagram
    autonumber
    participant Script as export.js
    participant SSSS as SSSS API (matrix.org)
    participant Backup as Key Backup (matrix.org)
    participant Matrix as public matrix.org API

    Script->>Script: Parse PUBLIC_RECOVERY_KEY from .env
    Script->>SSSS: Fetch encrypted backup secret
    Script->>Script: Decrypt secret using Recovery Key (Curve25519)
    Script->>Backup: Download Megolm room keys
    Script->>Script: Import keys to decrypt timeline exports
    Script->>Matrix: Sync room list & fetch historical timelines
    Script->>Script: Write history JSON & download local attachments
```

### B. Import Workflow (import.js)
Pre-creates users, resolves conflicts, and replays histories idempotently.

```mermaid
sequenceDiagram
    autonumber
    participant Script as import.js
    participant Synapse as Local Synapse API
    participant DB as Postgres DB (Docker)

    Script->>Script: Identify unique user IDs in history
    loop For each user
        Script->>Synapse: POST /register?access_token=... (Appservice token)
        alt Account already exists
            Script->>Script: Generate new password
            Script->>DB: docker exec updating Postgres password_hash directly
        end
    end

    loop For each room
        alt Room not yet migrated
            Script->>Synapse: POST /createRoom (On behalf of creator)
            Script->>Synapse: Force join members & Restore power levels
            Script->>Script: Save mapping to room-mappings.json
        else Room already migrated
            Script->>Script: Retrieve Room ID from room-mappings.json
        end

        loop For each event in room timeline
            Script->>Synapse: PUT /send/m.room.message/migration_{eventId}?user_id=Sender&ts=OrigTS
            Note over Synapse: Synapse massages timestamp and deduplicates based on event ID
        end
    end
```

---

## 5. Security & Isolation

### Stdio & stdout protection
Since the MCP server communicates with Claude Desktop over standard input/output (`stdio`), **no process logging is allowed to touch stdout**. 
* Any standard node console logs (`console.log`) are redirected to `stderr` or local log files.
* This ensures that binary JSON-RPC communications between Claude Desktop and Node.js remain completely clean, preventing parser crashes.

### Database isolation
The local SQLite database (`mcp-server/decrypted_cache.db`) and user credentials file (`migration/data/new-user-credentials.txt`) contain sensitive decrypted contents and are excluded from Git repository tracking via `.gitignore`.

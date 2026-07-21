# Continuum

**Agents that remember after they die.**

Continuum is an agentic application whose durable memory lives in **CockroachDB** (task state + semantic embeddings) and whose reasoning/embeddings path targets **Amazon Bedrock**, deployed around an AWS-friendly runtime.

> Built for the CockroachDB × AWS Hackathon — Build with Agentic Memory.

## Why Continuum

Most demo agents keep memory in process RAM. When the process dies, the agent forgets everything and needs a human to re-brief it.

Continuum treats CockroachDB as the system of record:

- **Transactional task cursor** — which step was running when the process died
- **Event log** — auditable trail of what happened
- **Vector memories** — semantic recall of past incidents/decisions in the same database

Jury proof: start a mission → crash after step 2 → resume → remaining steps continue from CockroachDB without re-explaining the goal.

## CockroachDB tools used

| Tool | How Continuum uses it |
| --- | --- |
| **Distributed Vector Indexing** | `agent_memories.embedding VECTOR(1024)` + vector distance recall |
| **Cloud Managed MCP Server** | Cursor connects to the `continuum` cluster via `.cursor/mcp.json` for schema exploration / ops |

## AWS services used

| Service | How Continuum uses it |
| --- | --- |
| **Amazon Bedrock** | Titan embeddings when AWS credentials are configured (local deterministic embeddings as offline fallback) |
| **CockroachDB Cloud on AWS** | Cluster region `eu-central-1` (Frankfurt) |

## Quick start

### Requirements

- Node.js 20+
- CockroachDB Cloud cluster + SQL user
- CA cert at `%APPDATA%\\postgresql\\root.crt` (Windows)
- `.env` with `DATABASE_URL` (see `.env.example`)

### Install & migrate

```bash
npm install
npm run db:ping
npm run db:migrate
```

### Crash / resume demo (CLI)

```bash
npm run demo:kill
npm run demo:resume
```

### Demo UI

```bash
npm run dev:server
```

Open http://127.0.0.1:8787

## Reproduce the submission video

Narrated 1080p demo from the real Continuum UI (not a mockup):

```powershell
npx playwright install ffmpeg
npm.cmd run video:draft
```

Writes `artifacts/video/Continuum-hackathon-demo.mp4` plus captions. Narration source: `docs/video/narration.json`. Disclose on YouTube that narration is AI-generated.

## Architecture

```text
Browser demo UI
   │
   ▼
Agent runtime ──writes──▶ agent_sessions / agent_tasks / agent_events
        │
        └──embeds/recalls──▶ agent_memories (VECTOR)  in CockroachDB (AWS eu-central-1)
                                    ▲
Cursor / MCP ───────────────────────┘  (cockroachlabs.cloud/mcp)
Amazon Bedrock Titan Embeddings V2 ──▶ same VECTOR column
```

Open the live diagram in the demo UI under **Architecture**.

## Project layout

```text
sql/001_init.sql          Schema
src/db/                   CockroachDB client + migrate
src/memory/               Embeddings + durable store
src/agent/runtime.js      Mission runner with crash simulation
src/demo/crash-resume.js  CLI jury proof
src/server.js             Local demo UI
.cursor/mcp.json          CockroachDB Cloud MCP
```

## License

MIT

# AgentBoard — Agent-Native Project Management

**One Trigger. Full Context. Real Output.**

A project-management platform where AI agents are first-class workers. Create tasks on a
Kanban board, tag them **Agent-ready** or **Human**; the moment an agent-ready task enters
the **Sprint** column, an agent automatically picks it up, builds context from workspace
memory, executes, posts important-only updates, and attaches its final output to the card.

This began as a POC (single user, JSON file, polling). It is now a small but real platform:
**multi-user auth, workspaces with members, SQLite persistence, an encrypted credential
vault, real-time updates over SSE, a concurrency-limited agent queue with crash recovery,
and authenticated external webhooks** — still one Next.js deployable with zero extra
runtime dependencies (Node 22's built-in `node:sqlite` and `node:crypto`).

## The core loop

```
Backlog ──▶ Sprint ──▶ Building Context ──▶ Executing ──▶ Completed
   ▲          │(trigger)      (memory,           │
   │          │               similar tasks)     ├──▶ Blocked ── auto-resume when:
 create       └── humans move cards;             │      • a dependency task completes
 & refine         agents drive the rest          │      • a missing MCP/credential is added
                                                 │      • a human answers the agent's question
```

- **Agent-ready vs Human tasks** — humans move their own cards; agents drive theirs.
- **Dependencies** — a task can depend on other tasks (agent *or* human). Moving it to
  Sprint before its dependencies finish sends it to **Blocked**; it auto-resumes when
  they complete.
- **Resources (MCPs / credentials)** — tasks declare required resources. If a required
  resource isn't registered in the workspace, the task blocks with the reason visible;
  adding the resource unblocks and re-triggers it automatically. Secret values are
  **encrypted at rest** (AES-256-GCM) and never returned by the API.
- **Human-in-the-loop** — a task can require human confirmation: the agent finishes the
  deliverable, asks its question, blocks, and completes as soon as a human answers.
- **Important updates only** — the activity feed records context decisions, problems,
  questions and the final output, each attributed to its actor (agent / user / system).
- **External trigger** — `POST /api/webhooks/task-ready` with the workspace's webhook
  token lets any outside system (CI, cron, another tool) fire the agent scan.

## The context framework — how the workspace learns

Every agent run receives three layers of memory, and failure signals feed back in:

1. **Relevant past work** — outputs of similar completed tasks (keyword retrieval).
2. **Workspace lessons** — when a run fails or a human requests changes, Claude distills
   the event into one generalizable lesson (🧠 Memory panel: review, delete, or teach your
   own). The most relevant lessons are injected into every future run.
3. **Revision mode** — a re-run task sees its own previous output, the problems from the
   last run, and the human feedback, and revises instead of restarting.

On top of that, **outcomes**: give a task a *definition of done* and an independent
review pass grades the deliverable against it; the agent revises until it passes (or the
iteration budget `AGENT_MAX_ITERATIONS`, default 2, is spent — unresolved feedback is
appended for human follow-up). The human-review gate (`askHuman`) has two buttons:
**Approve & complete**, or **Request changes** — which re-queues the task for revision
*and* teaches the workspace.

## Platform features

| Area | What you get |
|---|---|
| **Context & memory** | Three-layer run context (similar work, distilled lessons, revision history); approve/revise human gate; outcome grading against a definition of done |
| **Cost tracking** | Every run records model, tokens, duration, iterations and cost; per-task breakdown on the card, workspace total in the top bar |
| **Hybrid executor** | `AGENT_EXECUTOR=hybrid`: plain tasks and file deliverables (generated locally with LibreOffice) run on the Claude subscription at $0; API credits only for MCP-connected tasks; automatic fallback subscription → API → simulation |
| **Auth** | Email + password accounts (scrypt hashing), httpOnly session cookies (30-day, SHA-256-hashed server side), signup/login/logout |
| **Workspaces** | Every user gets a seeded workspace on signup; create more; invite members by email; per-workspace webhook token |
| **Persistence** | SQLite (WAL) via Node's built-in `node:sqlite` — no native deps, transactional, survives restarts |
| **Credential vault** | Resource secrets encrypted with AES-256-GCM; key from `AGENTBOARD_SECRET_KEY` or auto-generated `data/vault.key` (0600) |
| **Real-time** | Per-workspace SSE stream (`/api/workspaces/:wid/events`); the UI refetches on change — no polling (slow fallback poll as safety net) |
| **Agent queue** | Concurrency-limited runner (`AGENT_CONCURRENCY`, default 3), priority-ordered pickup (high → low), per-workspace triggering |
| **Crash recovery** | Every phase transition is persisted; on boot, tasks stuck in Building Context / Executing are re-queued to Sprint automatically |
| **Security** | All workspace APIs require session + membership; webhook requires per-workspace bearer token; agent-run failures land in Blocked with kind `error` |

## Running it

```bash
npm install
npm run dev          # http://localhost:3000  → sign up, you get a demo workspace
```

Production build: `npm run build && npm start`.

- **With a real agent:** `ANTHROPIC_API_KEY=sk-ant-... npm run dev` — execution runs on
  Claude (`claude-opus-4-8` by default; override with `CLAUDE_MODEL`).
- **Without a key:** the runner falls back to **simulation mode** so the entire flow is
  demoable offline — every transition, block and unblock is real; only the deliverable
  text is generated locally.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Real Claude execution (simulation mode without it) |
| `AGENT_EXECUTOR` | `api` | `hybrid`: run text & LibreOffice file tasks on the machine's **Claude subscription** (headless `claude -p` with the claude.ai login — $0 credits) and reserve API credits for MCP-connected work. `subscription`: subscription only. Requires Claude Code logged in on the server; personal use |
| `CLAUDE_MODEL` | `claude-opus-4-8` | Model for API agent runs |
| `AGENT_CONCURRENCY` | `3` | Max simultaneous agent runs |
| `AGENT_MAX_ITERATIONS` | `2` | Outcome-grading revise budget per run |
| `AGENTBOARD_DATA_DIR` | `./data` | SQLite + vault key location |
| `AGENTBOARD_SECRET_KEY` | auto-generated | 64-hex-char AES key for the credential vault |

The store lives in `data/agentboard.db` — delete it to reset. If a legacy POC `data/db.json`
exists, the **first account to sign up imports it automatically** into their workspace.

## Try the flows

1. **Sign up** — you land in a seeded workspace.
2. **Happy path** — New Task → 🤖 Agent-ready → check "Put straight into Sprint".
   Watch it move through Building Context → Executing → Completed live (SSE), and open
   the card to read the final output.
3. **Dependency block** — move "Implement billing webhooks" to Sprint (it depends on the
   human pricing-approval task) → it blocks. Complete the human task → it resumes itself.
4. **Missing credential** — "Sync invoices to the accounting system" is blocked on
   `accounting-api-key`. Add it under **Resources** (optionally with a secret value —
   it's encrypted) → the task resumes by itself.
5. **Human confirmation** — create an agent task with "Agent must ask a human to confirm
   before completing". The agent delivers, asks, blocks; answer in the task drawer.
6. **Team** — 👥 Members → add a teammate by email; they see the same board live.
7. **External trigger** — copy the curl command from the Members panel and fire it from
   anywhere.
8. **Crash recovery** — kill the server while a task is Executing, restart it: the task
   is re-queued to Sprint and picked up again.

## Architecture

| Piece | Choice | Notes |
|---|---|---|
| App | Next.js 15 (App Router, TypeScript) | one deployable, responsive UI works on mobile |
| Store | SQLite (WAL) behind `lib/store.ts`, via `node:sqlite` | zero deps; swap for Postgres by reimplementing `lib/store.ts` |
| Auth | `lib/auth.ts` — scrypt + hashed session tokens | httpOnly, SameSite=Lax cookies |
| Vault | `lib/crypto.ts` — AES-256-GCM | secrets write-only through the API |
| Real-time | `lib/events.ts` (in-process pub/sub) + SSE routes | swap for Redis pub/sub when scaling to multiple instances |
| Agent runner | `lib/agent/runner.ts` — in-process queue | pickup gates → context → execute → complete; boot recovery via `instrumentation.ts` |
| Agent execution | `@anthropic-ai/sdk` (`lib/agent/claude.ts`) | streaming, adaptive thinking; simulation fallback |
| Memory / context | keyword match over completed task outputs | swap for embeddings + knowledge base |

### API

All workspace routes require a session cookie + membership.

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/signup` · `login` · `logout`, `GET /api/auth/me` | accounts & sessions |
| `GET/POST /api/workspaces` | list / create workspaces |
| `GET /api/workspaces/:wid` | workspace meta, members, webhook token |
| `GET/POST /api/workspaces/:wid/members` | list / add members |
| `GET/POST /api/workspaces/:wid/tasks` | list / create tasks |
| `GET/PATCH/DELETE /api/workspaces/:wid/tasks/:id` | read / move / edit / delete |
| `POST /api/workspaces/:wid/tasks/:id/answer` | answer the agent's pending question |
| `GET/POST /api/workspaces/:wid/resources`, `DELETE …/:rid` | workspace MCPs & credentials (optional encrypted secret) |
| `GET /api/workspaces/:wid/events` | SSE stream of board changes |
| `GET/POST /api/workspaces/:wid/lessons`, `DELETE …/:lid` | workspace memory (lessons) |
| `GET /api/workspaces/:wid/stats` | run count, tokens, total cost |
| `POST /api/webhooks/task-ready` | external trigger (`Authorization: Bearer <workspace webhook token>`) |
| `POST /api/webhooks/tasks` | **inbound automation**: external systems create tasks (same bearer token) — e.g. Sentry alert → investigation task |

## Operations

- `npm test` — end-to-end API suite (isolated instance, simulation mode); CI runs it on
  every push (`.github/workflows/ci.yml`).
- `npm run backup` — WAL-checkpointed SQLite backup to `data/backups/` (nightly cron
  recommended); see `deploy/DEPLOY.md`.
- TLS: `deploy/Caddyfile` + instructions in `deploy/DEPLOY.md`.

## What the next iteration would add

- Real MCP connections using the vaulted credentials (`getResourceSecret()` is ready).
- Claude Agent SDK / Managed Agents sessions per task, with tool use and repos mounted.
- Postgres + Redis for multi-instance deployments; per-member roles & permissions.
- Native mobile apps (the UI is responsive and installable as a PWA).

![Board](docs/board.png)
![Task detail](docs/detail.png)

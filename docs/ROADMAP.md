# AgentBoard Roadmap — planned, not yet built

Agreed 2026-07-14. Execute phases in order; each phase is independently shippable.
Conventions: every phase ends with `npm run build && npm test` green, new tests for
new endpoints, deploy via service restart, commit + push.

---

## Phase 1 — Re-execute a task with new instructions  *(Samer's request; smallest, do first)*

**Goal:** any completed/archived agent task can be re-run with additional
instructions, building on the previous output instead of starting over.

- **API:** `POST /api/workspaces/:wid/tasks/:id/rerun { instructions: string }`
  - guard: agent tasks only, not currently `building_context`/`executing`
  - records an `answer`-kind update: `Re-run requested: <instructions>` (actor = user)
  - status → `sprint`, `blocked`/`pendingQuestion` cleared → runner picks it up
  - the existing **revision mode** in `buildContext()` already injects prior output,
    problems, and answer updates — the new instructions ride that path unchanged
  - optionally distill the instructions into a workspace lesson (same as revise flow)
- **UI:** "↺ Re-run with instructions" button in the task drawer for
  completed/archived agent tasks → small textarea modal.
- **Detail:** keep previous attachments until the new run replaces them; run history
  already shows both runs with cost.
- **Effort:** ~half a day. **Files:** runner.ts (extract shared revise helper),
  new route, TaskDetail.tsx, tests.

## Phase 2 — Development impact summary  *(Samer's request)*

**Goal:** for dev-flavored tasks, see *what* was developed — files/code touched,
tables/migrations affected, endpoints added — per task and aggregated.

- **Capture:** after each successful run, a cheap extraction pass (subscription
  executor, $0) turns the deliverable + tool activity into a structured manifest:
  ```json
  { "summary": "…", "files": ["lib/store.ts"], "tables": ["lessons"],
    "endpoints": ["POST /api/…"], "migrations": ["ALTER TABLE …"], "links": ["<PR url>"] }
  ```
  Stored in a new `task_impact` column (JSON) on tasks. Sources:
  - subscription file tasks: diff the task workdir before/after
  - GitHub MCP tasks: PR/commit URLs from the output
  - otherwise: extract from the deliverable text (best effort, flagged as such)
- **UI:** "Impact" section in the task drawer (chips for files/tables/endpoints).
- **Rollup:** `GET /api/workspaces/:wid/impact?since=…` + a "Development summary"
  panel: agent-generated digest of everything shipped in a period or per epic —
  answers "what did we build this week, which tables and code were affected."
- **Effort:** ~1 day. **Files:** claude.ts/subscription.ts (extraction pass),
  db/store (column + rollup query), new route, TaskDetail + a summary modal.

## Phase 3 — Assignees + "waiting on you" inbox + Slack routing

**Goal:** attack the human bottleneck for multi-member teams.

- Schema: `tasks.assignee_user_id`, `tasks.reviewer_user_id` (nullable).
- Human tasks get an assignee; agent tasks with the review gate get a reviewer —
  the approve/revise question routes to that person.
- **Inbox:** `GET /api/workspaces/:wid/inbox` → tasks blocked on *me*
  (reviewer questions + my assigned human tasks in sprint). Top-bar badge with
  count; inbox panel listing cards.
- Slack: DM the assignee/reviewer on block (extend notify.ts; per-user Slack
  member ID stored on the user profile; falls back to the channel webhook).
- **Effort:** ~1 day.

## Phase 4 — Task graph: informs-dependencies, epics, cycle detection

- **Informs edges:** new `task_edges` table (`from_id, to_id, kind: 'blocks'|'informs'`);
  keep the legacy `dependencies` array as `blocks` edges (migrate on boot).
  `informs` doesn't gate — it injects the upstream output into the downstream
  task's context (one more layer in `buildContext`).
- **Cycle detection (bug fix — do even without the rest):** DFS on edge writes;
  reject with 400 "would create a cycle: A → B → A".
- **Epic decomposition:** task type `epic`: the agent proposes a subtask DAG
  (JSON: title/type/DoD/executor/edges) → approval UI (edit/remove rows) →
  bulk-create. Epic card shows child progress; completes when children do.
- **Graph view:** simple SVG DAG of the workspace (no new deps; dagre-style
  layout by level), critical-path highlight.
- **Effort:** 2–3 days (epics are most of it).

## Phase 5 — Governance: roles, budgets, audit log

- Roles: `owner | admin | member | viewer` (viewer read-only; only admin+ manage
  resources/members/budgets; only admin+ approve API-pinned tasks over the cap).
- Budgets: workspace monthly credit cap + per-task ceiling (`task_runs` cost data
  already exists); when exceeded → tasks auto-route to subscription or block with
  kind `budget`. Admin approval gate: API-pinned tasks estimated > $X need an
  admin approve before running.
- Audit log table: actor, action, target, ts for member/resource/budget/approval
  events; panel in Members modal.
- Runner controls: pause/resume runner per workspace (flag checked by
  `triggerAgents`), max runs/day.
- **Effort:** ~2 days.

## Phase 6 — Automation & ops polish

- Task templates (prefilled DoD/requirements/executor) + "create from template".
- Scheduled tasks: `schedules` table (cron expr → task template), tick loop in
  boot.ts; UI in a Schedules modal.
- Rules: "when task with tag X completes → create Y" (single rule shape first).
- Resource health checks: nightly MCP handshake validation (reuse the probe
  logic), status dot per resource, problem lesson on failure.
- Workspace export (JSON) / import.
- **Effort:** ~2 days.

---

## Suggested order & rough budget

| Phase | What | Est. |
|---|---|---|
| 1 | Re-run with instructions | 0.5d |
| 2 | Dev impact summary | 1d |
| 3 | Inbox + assignees + Slack | 1d |
| 4 | Graph: informs, epics, cycles | 2–3d |
| 5 | Roles, budgets, audit | 2d |
| 6 | Automation & ops | 2d |

Cycle detection from Phase 4 can be pulled forward any time — it's a latent
deadlock bug (A→B→A leaves both tasks blocked forever).

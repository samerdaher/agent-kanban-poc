import fs from 'node:fs';
import path from 'node:path';
import { db, uid, now, getMeta, setMeta } from './db';
import { encryptSecret, decryptSecret, randomToken, hashPassword, verifyPassword } from './crypto';
import { publish } from './events';
import {
  Task,
  TaskUpdate,
  UpdateKind,
  Resource,
  ResourceKind,
  User,
  Member,
  MemberRole,
  Workspace,
} from './types';

/* ============================== users ================================= */

function rowToUser(r: Record<string, unknown>): User {
  return {
    id: r.id as string,
    email: r.email as string,
    name: r.name as string,
    createdAt: r.created_at as string,
  };
}

export function createUser(email: string, name: string, password: string): User {
  const normalized = email.trim().toLowerCase();
  const existing = db().prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existing) throw new Error('An account with this email already exists.');
  const user: User = { id: uid('u'), email: normalized, name: name.trim(), createdAt: now() };
  db()
    .prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, user.email, user.name, hashPassword(password), user.createdAt);
  return user;
}

export function authenticate(email: string, password: string): User | null {
  const row = db()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.trim().toLowerCase()) as Record<string, unknown> | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash as string)) return null;
  return rowToUser(row);
}

export function getUserById(id: string): User | null {
  const row = db().prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserByEmail(email: string): User | null {
  const row = db().prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToUser(row) : null;
}

export function countUsers(): number {
  const row = db().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return Number(row.n);
}

/* ============================ workspaces =============================== */

export function createWorkspace(
  name: string,
  ownerId: string,
  opts: { seed?: boolean } = {},
): Workspace {
  const ws = { id: uid('w'), name: name.trim(), createdAt: now() };
  db()
    .prepare('INSERT INTO workspaces (id, name, owner_id, webhook_token, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ws.id, ws.name, ownerId, randomToken(24), ws.createdAt);
  db()
    .prepare('INSERT INTO members (workspace_id, user_id, role, added_at) VALUES (?, ?, ?, ?)')
    .run(ws.id, ownerId, 'owner', now());
  if (opts.seed) seedWorkspace(ws.id, ownerId);
  return { ...ws, role: 'owner' };
}

export function listWorkspaces(userId: string): Workspace[] {
  const rows = db()
    .prepare(
      `SELECT w.id, w.name, w.created_at, m.role FROM workspaces w
       JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.created_at`,
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    role: r.role as MemberRole,
    createdAt: r.created_at as string,
  }));
}

export function getWorkspaceRole(workspaceId: string, userId: string): MemberRole | null {
  const row = db()
    .prepare('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?')
    .get(workspaceId, userId) as { role: MemberRole } | undefined;
  return row?.role ?? null;
}

export function getWorkspaceMeta(
  workspaceId: string,
): { id: string; name: string; webhookToken: string; createdAt: string } | null {
  const row = db().prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    webhookToken: row.webhook_token as string,
    createdAt: row.created_at as string,
  };
}

export function getWorkspaceIdByWebhookToken(token: string): string | null {
  const row = db().prepare('SELECT id FROM workspaces WHERE webhook_token = ?').get(token) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

export function listMembers(workspaceId: string): Member[] {
  const rows = db()
    .prepare(
      `SELECT m.user_id, m.role, m.added_at, u.email, u.name FROM members m
       JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.added_at`,
    )
    .all(workspaceId) as Record<string, unknown>[];
  return rows.map((r) => ({
    userId: r.user_id as string,
    email: r.email as string,
    name: r.name as string,
    role: r.role as MemberRole,
    addedAt: r.added_at as string,
  }));
}

export function addMemberByEmail(workspaceId: string, email: string): Member {
  const user = getUserByEmail(email);
  if (!user) throw new Error('No account with that email — ask them to sign up first.');
  if (getWorkspaceRole(workspaceId, user.id)) throw new Error('Already a member of this workspace.');
  const addedAt = now();
  db()
    .prepare('INSERT INTO members (workspace_id, user_id, role, added_at) VALUES (?, ?, ?, ?)')
    .run(workspaceId, user.id, 'member', addedAt);
  publish(workspaceId);
  return { userId: user.id, email: user.email, name: user.name, role: 'member', addedAt };
}

export function listAllWorkspaceIds(): string[] {
  const rows = db().prepare('SELECT id FROM workspaces').all() as { id: string }[];
  return rows.map((r) => r.id);
}

/* ============================== tasks ================================== */

function rowToTask(r: Record<string, unknown>, updates: TaskUpdate[]): Task {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    title: r.title as string,
    description: r.description as string,
    type: r.type as Task['type'],
    status: r.status as Task['status'],
    priority: r.priority as Task['priority'],
    tags: JSON.parse(r.tags as string),
    requirements: JSON.parse(r.requirements as string),
    dependencies: JSON.parse(r.dependencies as string),
    askHuman: Boolean(r.ask_human),
    blocked: r.blocked ? JSON.parse(r.blocked as string) : null,
    pendingQuestion: (r.pending_question as string) ?? null,
    updates,
    output: (r.output as string) ?? null,
    attachments: r.attachments ? JSON.parse(r.attachments as string) : [],
    createdBy: (r.created_by as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    completedAt: (r.completed_at as string) ?? null,
  };
}

function loadUpdates(taskId: string): TaskUpdate[] {
  const rows = db()
    .prepare('SELECT * FROM task_updates WHERE task_id = ? ORDER BY ts, id')
    .all(taskId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    ts: r.ts as string,
    kind: r.kind as UpdateKind,
    actor: r.actor as string,
    text: r.text as string,
  }));
}

export function listTasks(workspaceId: string): Task[] {
  const rows = db()
    .prepare('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at DESC')
    .all(workspaceId) as Record<string, unknown>[];
  return rows.map((r) => rowToTask(r, loadUpdates(r.id as string)));
}

export function getTask(id: string): Task | undefined {
  const row = db().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTask(row, loadUpdates(id)) : undefined;
}

/** Agent-ready tasks sitting in Sprint — the runner's pickup queue. */
export function listSprintAgentTasks(workspaceId?: string): Task[] {
  const sql = `SELECT * FROM tasks WHERE type = 'agent' AND status = 'sprint'
    ${workspaceId ? 'AND workspace_id = ?' : ''}
    ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at`;
  const rows = (workspaceId ? db().prepare(sql).all(workspaceId) : db().prepare(sql).all()) as Record<
    string,
    unknown
  >[];
  return rows.map((r) => rowToTask(r, []));
}

export function listTasksByStatus(statuses: Task['status'][]): Task[] {
  const placeholders = statuses.map(() => '?').join(',');
  const rows = db()
    .prepare(`SELECT * FROM tasks WHERE status IN (${placeholders})`)
    .all(...statuses) as Record<string, unknown>[];
  return rows.map((r) => rowToTask(r, []));
}

export function createTask(
  workspaceId: string,
  input: Partial<Task> & Pick<Task, 'title' | 'type'>,
  createdBy: string | null,
): Task {
  const task: Task = {
    id: uid(),
    workspaceId,
    description: '',
    status: 'backlog',
    priority: 'medium',
    tags: [],
    requirements: [],
    dependencies: [],
    askHuman: false,
    blocked: null,
    pendingQuestion: null,
    updates: [],
    output: null,
    attachments: [],
    createdBy,
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
    ...input,
  };
  db()
    .prepare(
      `INSERT INTO tasks (id, workspace_id, title, description, type, status, priority, tags,
        requirements, dependencies, ask_human, blocked, pending_question, output, attachments,
        created_by, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.id,
      task.workspaceId,
      task.title,
      task.description,
      task.type,
      task.status,
      task.priority,
      JSON.stringify(task.tags),
      JSON.stringify(task.requirements),
      JSON.stringify(task.dependencies),
      task.askHuman ? 1 : 0,
      task.blocked ? JSON.stringify(task.blocked) : null,
      task.pendingQuestion,
      task.output,
      JSON.stringify(task.attachments),
      task.createdBy,
      task.createdAt,
      task.updatedAt,
      task.completedAt,
    );
  publish(workspaceId);
  return task;
}

/** Persist the mutable fields of an (in-memory mutated) task. */
export function saveTask(task: Task) {
  task.updatedAt = now();
  db()
    .prepare(
      `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, tags = ?,
        requirements = ?, dependencies = ?, ask_human = ?, blocked = ?, pending_question = ?,
        output = ?, attachments = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
    )
    .run(
      task.title,
      task.description,
      task.status,
      task.priority,
      JSON.stringify(task.tags),
      JSON.stringify(task.requirements),
      JSON.stringify(task.dependencies),
      task.askHuman ? 1 : 0,
      task.blocked ? JSON.stringify(task.blocked) : null,
      task.pendingQuestion,
      task.output,
      JSON.stringify(task.attachments),
      task.updatedAt,
      task.completedAt,
      task.id,
    );
  publish(task.workspaceId);
}

export function addUpdate(task: Task, kind: UpdateKind, text: string, actor = 'agent') {
  const update: TaskUpdate = { id: uid('up'), ts: now(), kind, actor, text };
  db()
    .prepare('INSERT INTO task_updates (id, task_id, ts, kind, actor, text) VALUES (?, ?, ?, ?, ?, ?)')
    .run(update.id, task.id, update.ts, kind, actor, text);
  task.updates.push(update);
  task.updatedAt = update.ts;
  db().prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(update.ts, task.id);
  publish(task.workspaceId);
}

export function deleteTask(id: string): boolean {
  const task = getTask(id);
  if (!task) return false;
  db().prepare('DELETE FROM tasks WHERE id = ?').run(id);
  publish(task.workspaceId);
  return true;
}

/* ============================ resources ================================ */

function rowToResource(r: Record<string, unknown>): Resource {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    name: r.name as string,
    kind: r.kind as ResourceKind,
    url: (r.url as string) ?? null,
    hasSecret: Boolean(r.secret_enc),
    addedAt: r.added_at as string,
  };
}

export function listResources(workspaceId: string): Resource[] {
  const rows = db()
    .prepare('SELECT * FROM resources WHERE workspace_id = ? ORDER BY added_at')
    .all(workspaceId) as Record<string, unknown>[];
  return rows.map(rowToResource);
}

export function addResource(
  workspaceId: string,
  input: { name: string; kind: ResourceKind; url?: string; secret?: string },
  addedBy: string | null,
): Resource {
  const existing = db()
    .prepare('SELECT id FROM resources WHERE workspace_id = ? AND name = ?')
    .get(workspaceId, input.name.trim());
  if (existing) throw new Error('A resource with this name already exists in the workspace.');
  const url = input.url?.trim() || null;
  if (url && !/^https:\/\//.test(url)) throw new Error('MCP server URLs must be https://');
  const res = {
    id: uid('r'),
    workspaceId,
    name: input.name.trim(),
    kind: input.kind,
    url,
    hasSecret: Boolean(input.secret),
    addedAt: now(),
  };
  db()
    .prepare(
      'INSERT INTO resources (id, workspace_id, name, kind, url, secret_enc, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      res.id,
      workspaceId,
      res.name,
      res.kind,
      res.url,
      input.secret ? encryptSecret(input.secret) : null,
      addedBy,
      res.addedAt,
    );
  publish(workspaceId);
  return res;
}

export function deleteResource(workspaceId: string, resourceId: string): boolean {
  const info = db()
    .prepare('DELETE FROM resources WHERE id = ? AND workspace_id = ?')
    .run(resourceId, workspaceId);
  if (Number(info.changes) === 0) return false;
  publish(workspaceId);
  return true;
}

/** Decrypt a vaulted secret (for wiring real MCP connections; never sent to the UI). */
export function getResourceSecret(workspaceId: string, name: string): string | null {
  const row = db()
    .prepare('SELECT secret_enc FROM resources WHERE workspace_id = ? AND name = ?')
    .get(workspaceId, name) as { secret_enc: string | null } | undefined;
  return row?.secret_enc ? decryptSecret(row.secret_enc) : null;
}

/* ===================== seed & legacy JSON import ======================= */

export function seedWorkspace(workspaceId: string, ownerId: string) {
  const mk = (partial: Partial<Task> & Pick<Task, 'title' | 'type'>) =>
    createTask(workspaceId, partial, ownerId);

  const done = mk({
    title: 'Design the REST API for the customer portal',
    description:
      'Define resource-oriented endpoints for accounts, invoices and payments. Include auth strategy and pagination conventions.',
    type: 'agent',
    status: 'completed',
    tags: ['api', 'backend'],
    completedAt: now(),
    output:
      '## API Design — Customer Portal\n\n- `GET /api/accounts/:id` — account profile\n- `GET /api/accounts/:id/invoices?cursor=` — cursor pagination, 25/page\n- `POST /api/payments` — idempotency-key header required\n\nAuth: OAuth2 client-credentials for service calls, session JWT for the SPA. All list endpoints use cursor pagination with `next_cursor`.',
  });
  addUpdate(done, 'status', 'Picked up by agent.');
  addUpdate(done, 'output', 'Final API design delivered.');

  const blockedCreds = mk({
    title: 'Sync invoices to the accounting system',
    description: 'Push completed invoices to the external accounting provider nightly.',
    type: 'agent',
    status: 'blocked',
    tags: ['integration'],
    requirements: ['accounting-api-key'],
    blocked: {
      kind: 'missing_resource',
      detail: 'Waiting for resource: accounting-api-key',
      refs: ['accounting-api-key'],
    },
  });
  addUpdate(blockedCreds, 'status', 'Picked up by agent.');
  addUpdate(
    blockedCreds,
    'problem',
    'Missing credential "accounting-api-key". Moving to Blocked until it is added to workspace resources.',
  );

  const humanTask = mk({
    title: 'Approve the Q3 pricing table',
    description: 'Product owner needs to sign off on the new pricing tiers before the billing work starts.',
    type: 'human',
    status: 'sprint',
    tags: ['decision'],
  });

  mk({
    title: 'Write onboarding emails (3-step drip)',
    description:
      'Draft a three-email onboarding sequence for new workspace admins: welcome, first-task nudge, power-features tour. Friendly, concise tone.',
    type: 'agent',
    status: 'backlog',
    tags: ['content'],
  });

  mk({
    title: 'Implement billing webhooks',
    description: 'Handle invoice.paid and invoice.failed webhooks; depends on pricing approval.',
    type: 'agent',
    status: 'backlog',
    tags: ['backend', 'billing'],
    dependencies: [humanTask.id],
  });

  addResource(workspaceId, { name: 'github-mcp', kind: 'mcp' }, ownerId);
  addResource(workspaceId, { name: 'workspace-context', kind: 'credential' }, ownerId);
}

/**
 * One-time import of the POC's data/db.json into the first user's workspace,
 * so existing boards survive the SQLite migration.
 */
export function importLegacyJson(workspaceId: string, ownerId: string): boolean {
  if (getMeta('legacy_imported')) return false;
  const file = path.join(process.cwd(), 'data', 'db.json');
  let legacy: {
    tasks?: Record<string, unknown>[];
    resources?: { name?: string; kind?: string; addedAt?: string }[];
  };
  try {
    legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  const idMap = new Map<string, string>();
  for (const t of legacy.tasks || []) {
    const task = createTask(
      workspaceId,
      {
        title: String(t.title || 'Untitled'),
        description: String(t.description || ''),
        type: t.type === 'human' ? 'human' : 'agent',
        status: (t.status as Task['status']) || 'backlog',
        priority: (t.priority as Task['priority']) || 'medium',
        tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
        requirements: Array.isArray(t.requirements) ? t.requirements.map(String) : [],
        dependencies: Array.isArray(t.dependencies) ? t.dependencies.map(String) : [],
        askHuman: Boolean(t.askHuman),
        blocked: (t.blocked as Task['blocked']) || null,
        pendingQuestion: (t.pendingQuestion as string) || null,
        output: (t.output as string) || null,
        createdAt: String(t.createdAt || now()),
        completedAt: (t.completedAt as string) || null,
      },
      ownerId,
    );
    idMap.set(String(t.id), task.id);
    for (const u of (t.updates as { kind?: string; text?: string }[]) || []) {
      addUpdate(task, (u.kind as UpdateKind) || 'info', String(u.text || ''));
    }
  }
  // remap dependency ids to the new task ids
  for (const newId of idMap.values()) {
    const task = getTask(newId);
    if (!task || !task.dependencies.length) continue;
    task.dependencies = task.dependencies.map((d) => idMap.get(d) || d).filter(Boolean);
    saveTask(task);
  }
  for (const r of legacy.resources || []) {
    if (!r.name) continue;
    try {
      addResource(workspaceId, { name: r.name, kind: r.kind === 'credential' ? 'credential' : 'mcp' }, ownerId);
    } catch {
      /* duplicate name — skip */
    }
  }
  setMeta('legacy_imported', now());
  return true;
}

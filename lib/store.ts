import fs from 'node:fs';
import path from 'node:path';
import { db, uid, now, getMeta, setMeta } from './db';
import { encryptSecret, decryptSecret, randomToken, hashPassword, verifyPassword } from './crypto';
import { publish } from './events';
import {
  Task,
  TaskUpdate,
  UpdateKind,
  TaskRun,
  Lesson,
  LessonKind,
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

export function getWorkspaceMeta(workspaceId: string): {
  id: string;
  name: string;
  webhookToken: string;
  createdAt: string;
  monthlyBudgetUsd: number | null;
  runnerPaused: boolean;
} | null {
  const row = db().prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    webhookToken: row.webhook_token as string,
    createdAt: row.created_at as string,
    monthlyBudgetUsd: row.monthly_budget_usd == null ? null : Number(row.monthly_budget_usd),
    runnerPaused: Boolean(row.runner_paused),
  };
}

export function setWorkspaceSettings(
  workspaceId: string,
  patch: { monthlyBudgetUsd?: number | null; runnerPaused?: boolean },
) {
  if (patch.monthlyBudgetUsd !== undefined) {
    db().prepare('UPDATE workspaces SET monthly_budget_usd = ? WHERE id = ?').run(patch.monthlyBudgetUsd, workspaceId);
  }
  if (patch.runnerPaused !== undefined) {
    db().prepare('UPDATE workspaces SET runner_paused = ? WHERE id = ?').run(patch.runnerPaused ? 1 : 0, workspaceId);
  }
  publish(workspaceId);
}

export function isRunnerPaused(workspaceId: string): boolean {
  const row = db().prepare('SELECT runner_paused FROM workspaces WHERE id = ?').get(workspaceId) as
    | { runner_paused: number }
    | undefined;
  return Boolean(row?.runner_paused);
}

/** API-credit spend this calendar month vs the workspace budget. */
export function budgetStatus(workspaceId: string): { budget: number | null; spentThisMonth: number; over: boolean } {
  const meta = getWorkspaceMeta(workspaceId);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const row = db()
    .prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM task_runs WHERE workspace_id = ? AND ts >= ?')
    .get(workspaceId, monthStart.toISOString()) as { c: number };
  const budget = meta?.monthlyBudgetUsd ?? null;
  const spent = Number(row.c);
  return { budget, spentThisMonth: spent, over: budget !== null && spent >= budget };
}

/* ------------------------------ audit --------------------------------- */

export function logAudit(
  workspaceId: string,
  actor: { id: string; name: string } | null,
  action: string,
  target = '',
  detail = '',
) {
  db()
    .prepare(
      'INSERT INTO audit_log (id, workspace_id, actor_user_id, actor_name, action, target, detail, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(uid('a'), workspaceId, actor?.id ?? null, actor?.name ?? 'system', action, target, detail.slice(0, 400), now());
}

export function listAudit(workspaceId: string, limit = 100) {
  const rows = db()
    .prepare('SELECT * FROM audit_log WHERE workspace_id = ? ORDER BY ts DESC LIMIT ?')
    .all(workspaceId, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    actorUserId: (r.actor_user_id as string) ?? null,
    actorName: r.actor_name as string,
    action: r.action as string,
    target: r.target as string,
    detail: r.detail as string,
    ts: r.ts as string,
  }));
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

export function addMemberByEmail(workspaceId: string, email: string, role: MemberRole = 'member'): Member {
  const user = getUserByEmail(email);
  if (!user) throw new Error('No account with that email — ask them to sign up first.');
  if (getWorkspaceRole(workspaceId, user.id)) throw new Error('Already a member of this workspace.');
  const safeRole: MemberRole = ['admin', 'member', 'viewer'].includes(role) ? role : 'member';
  const addedAt = now();
  db()
    .prepare('INSERT INTO members (workspace_id, user_id, role, added_at) VALUES (?, ?, ?, ?)')
    .run(workspaceId, user.id, safeRole, addedAt);
  publish(workspaceId);
  return { userId: user.id, email: user.email, name: user.name, role: safeRole, addedAt };
}

export function setMemberRole(workspaceId: string, userId: string, role: MemberRole): boolean {
  if (!['admin', 'member', 'viewer'].includes(role)) return false;
  const current = getWorkspaceRole(workspaceId, userId);
  if (!current || current === 'owner') return false; // the owner's role is fixed
  db().prepare('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?').run(role, workspaceId, userId);
  publish(workspaceId);
  return true;
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
    informs: loadInforms(r.id as string),
    askHuman: Boolean(r.ask_human),
    blocked: r.blocked ? JSON.parse(r.blocked as string) : null,
    pendingQuestion: (r.pending_question as string) ?? null,
    updates,
    output: (r.output as string) ?? null,
    attachments: r.attachments ? JSON.parse(r.attachments as string) : [],
    definitionOfDone: (r.definition_of_done as string) ?? null,
    executor: ((r.executor as string) || 'auto') as Task['executor'],
    impact: r.impact ? JSON.parse(r.impact as string) : null,
    plan: r.plan ? JSON.parse(r.plan as string) : null,
    assigneeUserId: (r.assignee_user_id as string) ?? null,
    reviewerUserId: (r.reviewer_user_id as string) ?? null,
    createdBy: (r.created_by as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    completedAt: (r.completed_at as string) ?? null,
  };
}

/* ------------------------- informs edges ------------------------------- */

function loadInforms(taskId: string): string[] {
  const rows = db()
    .prepare("SELECT from_id FROM task_edges WHERE to_id = ? AND kind = 'informs'")
    .all(taskId) as { from_id: string }[];
  return rows.map((r) => r.from_id);
}

export function setInforms(taskId: string, fromIds: string[]) {
  db().prepare("DELETE FROM task_edges WHERE to_id = ? AND kind = 'informs'").run(taskId);
  const ins = db().prepare("INSERT OR IGNORE INTO task_edges (from_id, to_id, kind) VALUES (?, ?, 'informs')");
  for (const f of new Set(fromIds)) if (f !== taskId) ins.run(f, taskId);
}

/** Would adding these blocks-dependencies to task create a cycle (deadlock)? */
export function wouldCreateDependencyCycle(taskId: string, newDeps: string[]): boolean {
  const visited = new Set<string>();
  const stack = [...newDeps];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const row = db().prepare('SELECT dependencies FROM tasks WHERE id = ?').get(id) as
      | { dependencies: string }
      | undefined;
    if (row) stack.push(...(JSON.parse(row.dependencies) as string[]));
  }
  return false;
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
  return rows.map((r) => {
    const task = rowToTask(r, loadUpdates(r.id as string));
    task.runs = listRuns(task.id);
    return task;
  });
}

export function getTask(id: string): Task | undefined {
  const row = db().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTask(row, loadUpdates(id)) : undefined;
}

/** Agent-ready tasks (and epics) sitting in Sprint — the runner's pickup queue. */
export function listSprintAgentTasks(workspaceId?: string): Task[] {
  const sql = `SELECT * FROM tasks WHERE type IN ('agent', 'epic') AND status = 'sprint'
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
    informs: [],
    askHuman: false,
    blocked: null,
    pendingQuestion: null,
    updates: [],
    output: null,
    attachments: [],
    definitionOfDone: null,
    executor: 'auto',
    impact: null,
    plan: null,
    assigneeUserId: null,
    reviewerUserId: null,
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
        definition_of_done, executor, impact, plan, assignee_user_id, reviewer_user_id,
        created_by, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      task.definitionOfDone,
      task.executor,
      task.impact ? JSON.stringify(task.impact) : null,
      task.plan ? JSON.stringify(task.plan) : null,
      task.assigneeUserId,
      task.reviewerUserId,
      task.createdBy,
      task.createdAt,
      task.updatedAt,
      task.completedAt,
    );
  if (task.informs.length) setInforms(task.id, task.informs);
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
        output = ?, attachments = ?, definition_of_done = ?, executor = ?, impact = ?, plan = ?,
        assignee_user_id = ?, reviewer_user_id = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
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
      task.definitionOfDone,
      task.executor,
      task.impact ? JSON.stringify(task.impact) : null,
      task.plan ? JSON.stringify(task.plan) : null,
      task.assigneeUserId,
      task.reviewerUserId,
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
  db().prepare('DELETE FROM task_edges WHERE from_id = ? OR to_id = ?').run(id, id);
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
    health: (r.health as string) ?? null,
    healthCheckedAt: (r.health_checked_at as string) ?? null,
    addedAt: r.added_at as string,
  };
}

export function setResourceHealth(resourceId: string, health: string) {
  db().prepare('UPDATE resources SET health = ?, health_checked_at = ? WHERE id = ?').run(health, now(), resourceId);
}

export function listAllMcpResources(): Resource[] {
  const rows = db()
    .prepare("SELECT * FROM resources WHERE kind = 'mcp' AND url IS NOT NULL")
    .all() as Record<string, unknown>[];
  return rows.map(rowToResource);
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
    health: null,
    healthCheckedAt: null,
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

/* ============================== lessons ================================ */

function rowToLesson(r: Record<string, unknown>): Lesson {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    text: r.text as string,
    kind: r.kind as LessonKind,
    sourceTaskId: (r.source_task_id as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export function addLesson(
  workspaceId: string,
  text: string,
  kind: LessonKind,
  sourceTaskId: string | null,
): Lesson {
  const lesson: Lesson = {
    id: uid('l'),
    workspaceId,
    text: text.trim().slice(0, 300),
    kind,
    sourceTaskId,
    createdAt: now(),
  };
  db()
    .prepare('INSERT INTO lessons (id, workspace_id, text, kind, source_task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(lesson.id, workspaceId, lesson.text, kind, sourceTaskId, lesson.createdAt);
  publish(workspaceId);
  return lesson;
}

export function listLessons(workspaceId: string): Lesson[] {
  const rows = db()
    .prepare('SELECT * FROM lessons WHERE workspace_id = ? ORDER BY created_at DESC')
    .all(workspaceId) as Record<string, unknown>[];
  return rows.map(rowToLesson);
}

export function deleteLesson(workspaceId: string, lessonId: string): boolean {
  const info = db().prepare('DELETE FROM lessons WHERE id = ? AND workspace_id = ?').run(lessonId, workspaceId);
  if (Number(info.changes) === 0) return false;
  publish(workspaceId);
  return true;
}

/* ================================ runs ================================= */

function rowToRun(r: Record<string, unknown>): TaskRun {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    model: r.model as string,
    simulated: Boolean(r.simulated),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    cacheReadTokens: Number(r.cache_read_tokens),
    cacheWriteTokens: Number(r.cache_write_tokens),
    costUsd: Number(r.cost_usd),
    durationMs: Number(r.duration_ms),
    iterations: Number(r.iterations),
    outcome: (r.outcome as string) ?? null,
    ts: r.ts as string,
  };
}

export function recordRun(run: Omit<TaskRun, 'id' | 'ts'> & { workspaceId: string }): TaskRun {
  const full = { ...run, id: uid('run'), ts: now() };
  db()
    .prepare(
      `INSERT INTO task_runs (id, task_id, workspace_id, model, simulated, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, iterations, outcome, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      full.id,
      full.taskId,
      full.workspaceId,
      full.model,
      full.simulated ? 1 : 0,
      full.inputTokens,
      full.outputTokens,
      full.cacheReadTokens,
      full.cacheWriteTokens,
      full.costUsd,
      full.durationMs,
      full.iterations,
      full.outcome,
      full.ts,
    );
  return full;
}

export function listRuns(taskId: string): TaskRun[] {
  const rows = db().prepare('SELECT * FROM task_runs WHERE task_id = ? ORDER BY ts').all(taskId) as Record<
    string,
    unknown
  >[];
  return rows.map(rowToRun);
}

export function workspaceStats(workspaceId: string): {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
} {
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS runs, COALESCE(SUM(input_tokens),0) AS it, COALESCE(SUM(output_tokens),0) AS ot,
        COALESCE(SUM(cost_usd),0) AS cost FROM task_runs WHERE workspace_id = ?`,
    )
    .get(workspaceId) as { runs: number; it: number; ot: number; cost: number };
  return { runs: Number(r.runs), inputTokens: Number(r.it), outputTokens: Number(r.ot), costUsd: Number(r.cost) };
}

/* ================= templates, schedules, rules ========================= */

import type { TaskTemplate, Schedule, Rule } from './types';

const TEMPLATE_FIELDS = [
  'title',
  'description',
  'type',
  'tags',
  'requirements',
  'askHuman',
  'definitionOfDone',
  'executor',
  'priority',
] as const;

export function addTemplate(
  workspaceId: string,
  name: string,
  payload: Record<string, unknown>,
  createdBy: string | null,
): TaskTemplate {
  const clean: Record<string, unknown> = {};
  for (const f of TEMPLATE_FIELDS) if (payload[f] !== undefined) clean[f] = payload[f];
  if (!clean.title) clean.title = name;
  if (!clean.type || !['agent', 'human', 'epic'].includes(clean.type as string)) clean.type = 'agent';
  const t: TaskTemplate = {
    id: uid('tpl'),
    workspaceId,
    name: name.trim().slice(0, 120),
    payload: clean as TaskTemplate['payload'],
    createdAt: now(),
  };
  db()
    .prepare('INSERT INTO task_templates (id, workspace_id, name, payload, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(t.id, workspaceId, t.name, JSON.stringify(t.payload), createdBy, t.createdAt);
  publish(workspaceId);
  return t;
}

export function listTemplates(workspaceId: string): TaskTemplate[] {
  return (db().prepare('SELECT * FROM task_templates WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId) as Record<string, unknown>[]).map(
    (r) => ({
      id: r.id as string,
      workspaceId: r.workspace_id as string,
      name: r.name as string,
      payload: JSON.parse(r.payload as string),
      createdAt: r.created_at as string,
    }),
  );
}

export function getTemplate(workspaceId: string, templateId: string): TaskTemplate | null {
  return listTemplates(workspaceId).find((t) => t.id === templateId) ?? null;
}

export function deleteTemplate(workspaceId: string, templateId: string): boolean {
  const n = Number(db().prepare('DELETE FROM task_templates WHERE id = ? AND workspace_id = ?').run(templateId, workspaceId).changes);
  if (n) publish(workspaceId);
  return n > 0;
}

/** Instantiate a template into a real Sprint task (used by schedules & rules). */
export function createTaskFromTemplate(
  template: TaskTemplate,
  origin: string,
  extraTags: string[] = [],
): Task {
  const p = template.payload;
  const task = createTask(
    template.workspaceId,
    {
      title: p.title,
      description: p.description || '',
      type: p.type,
      status: 'sprint',
      tags: [...new Set([...(p.tags || []), ...extraTags])],
      requirements: p.requirements || [],
      askHuman: Boolean(p.askHuman),
      definitionOfDone: p.definitionOfDone || null,
      executor: p.executor || 'auto',
      priority: p.priority || 'medium',
    },
    null,
  );
  addUpdate(task, 'status', `Created ${origin} from template “${template.name}”.`, 'system');
  return task;
}

export function addSchedule(workspaceId: string, cron: string, templateId: string): Schedule {
  const s: Schedule = { id: uid('sch'), workspaceId, cron: cron.trim(), templateId, enabled: true, lastRun: null, createdAt: now() };
  db()
    .prepare('INSERT INTO schedules (id, workspace_id, cron, template_id, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(s.id, workspaceId, s.cron, templateId, s.createdAt);
  publish(workspaceId);
  return s;
}

export function listSchedules(workspaceId?: string): Schedule[] {
  const rows = (
    workspaceId
      ? db().prepare('SELECT * FROM schedules WHERE workspace_id = ?').all(workspaceId)
      : db().prepare('SELECT * FROM schedules WHERE enabled = 1').all()
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    cron: r.cron as string,
    templateId: r.template_id as string,
    enabled: Boolean(r.enabled),
    lastRun: (r.last_run as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

export function markScheduleRun(scheduleId: string, minuteKey: string) {
  db().prepare('UPDATE schedules SET last_run = ? WHERE id = ?').run(minuteKey, scheduleId);
}

export function deleteSchedule(workspaceId: string, scheduleId: string): boolean {
  const n = Number(db().prepare('DELETE FROM schedules WHERE id = ? AND workspace_id = ?').run(scheduleId, workspaceId).changes);
  if (n) publish(workspaceId);
  return n > 0;
}

export function addRule(workspaceId: string, triggerTag: string, templateId: string): Rule {
  const r: Rule = { id: uid('rul'), workspaceId, triggerTag: triggerTag.trim().toLowerCase(), templateId, enabled: true, createdAt: now() };
  db()
    .prepare('INSERT INTO rules (id, workspace_id, trigger_tag, template_id, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(r.id, workspaceId, r.triggerTag, templateId, r.createdAt);
  publish(workspaceId);
  return r;
}

export function listRules(workspaceId: string): Rule[] {
  return (db().prepare('SELECT * FROM rules WHERE workspace_id = ?').all(workspaceId) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    triggerTag: r.trigger_tag as string,
    templateId: r.template_id as string,
    enabled: Boolean(r.enabled),
    createdAt: r.created_at as string,
  }));
}

export function deleteRule(workspaceId: string, ruleId: string): boolean {
  const n = Number(db().prepare('DELETE FROM rules WHERE id = ? AND workspace_id = ?').run(ruleId, workspaceId).changes);
  if (n) publish(workspaceId);
  return n > 0;
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

import fs from 'fs';
import path from 'path';
import { Db, Task, TaskUpdate, UpdateKind, Resource } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const g = globalThis as unknown as { __agentKanbanDb?: Db };

function now(): string {
  return new Date().toISOString();
}

export function uid(prefix = 't'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function seed(): Db {
  const mk = (partial: Partial<Task> & Pick<Task, 'title' | 'description' | 'type' | 'status'>): Task => ({
    id: uid(),
    priority: 'medium',
    tags: [],
    requirements: [],
    dependencies: [],
    askHuman: false,
    blocked: null,
    pendingQuestion: null,
    updates: [],
    output: null,
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
    ...partial,
  });

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
    updates: [
      { id: uid('u'), ts: now(), kind: 'status', text: 'Picked up by agent.' },
      { id: uid('u'), ts: now(), kind: 'output', text: 'Final API design delivered.' },
    ],
  });

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
    updates: [
      { id: uid('u'), ts: now(), kind: 'status', text: 'Picked up by agent.' },
      {
        id: uid('u'),
        ts: now(),
        kind: 'problem',
        text: 'Missing credential "accounting-api-key". Moving to Blocked until it is added to workspace resources.',
      },
    ],
  });

  const humanTask = mk({
    title: 'Approve the Q3 pricing table',
    description: 'Product owner needs to sign off on the new pricing tiers before the billing work starts.',
    type: 'human',
    status: 'sprint',
    tags: ['decision'],
  });

  const backlog1 = mk({
    title: 'Write onboarding emails (3-step drip)',
    description:
      'Draft a three-email onboarding sequence for new workspace admins: welcome, first-task nudge, power-features tour. Friendly, concise tone.',
    type: 'agent',
    status: 'backlog',
    tags: ['content'],
  });

  const backlog2 = mk({
    title: 'Implement billing webhooks',
    description: 'Handle invoice.paid and invoice.failed webhooks; depends on pricing approval.',
    type: 'agent',
    status: 'backlog',
    tags: ['backend', 'billing'],
    dependencies: [humanTask.id],
  });

  return {
    tasks: [done, blockedCreds, humanTask, backlog1, backlog2],
    resources: [
      { id: uid('r'), name: 'github-mcp', kind: 'mcp', addedAt: now() },
      { id: uid('r'), name: 'workspace-context', kind: 'credential', addedAt: now() },
    ],
  };
}

function load(): Db {
  if (g.__agentKanbanDb) return g.__agentKanbanDb;
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    g.__agentKanbanDb = JSON.parse(raw) as Db;
  } catch {
    g.__agentKanbanDb = seed();
    persist(g.__agentKanbanDb);
  }
  return g.__agentKanbanDb;
}

function persist(db: Db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function getDb(): Db {
  return load();
}

export function saveDb() {
  const db = load();
  persist(db);
}

export function getTask(id: string): Task | undefined {
  return load().tasks.find((t) => t.id === id);
}

export function addUpdate(task: Task, kind: UpdateKind, text: string) {
  task.updates.push({ id: uid('u'), ts: now(), kind, text });
  task.updatedAt = now();
}

export function createTask(input: Partial<Task> & Pick<Task, 'title' | 'type'>): Task {
  const db = load();
  const task: Task = {
    id: uid(),
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
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
    ...input,
  };
  db.tasks.unshift(task);
  persist(db);
  return task;
}

export function addResource(name: string, kind: Resource['kind']): Resource {
  const db = load();
  const res: Resource = { id: uid('r'), name, kind, addedAt: now() };
  db.resources.push(res);
  persist(db);
  return res;
}

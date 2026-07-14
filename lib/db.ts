import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SQLite store (Node's built-in node:sqlite — no native deps).
 * WAL mode for concurrent readers; schema is created idempotently on open.
 * Override the data directory with AGENTBOARD_DATA_DIR (used by tests).
 */

export const DATA_DIR = process.env.AGENTBOARD_DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'agentboard.db');

const g = globalThis as unknown as { __agentboardDb?: DatabaseSync };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  webhook_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  tags TEXT NOT NULL DEFAULT '[]',
  requirements TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  ask_human INTEGER NOT NULL DEFAULT 0,
  blocked TEXT,
  pending_question TEXT,
  output TEXT,
  created_by TEXT,
  attachments TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_ws_status ON tasks(workspace_id, status);
CREATE TABLE IF NOT EXISTS task_updates (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'agent',
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_updates_task ON task_updates(task_id);
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_task_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lessons_ws ON lessons(workspace_id);
CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  model TEXT NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  iterations INTEGER NOT NULL DEFAULT 1,
  outcome TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_ws ON task_runs(workspace_id);
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  secret_enc TEXT,
  added_by TEXT,
  added_at TEXT NOT NULL,
  UNIQUE (workspace_id, name)
);
`;

/** Additive column migrations for databases created by older builds. */
function migrateColumns(d: DatabaseSync) {
  const resCols = (d.prepare('PRAGMA table_info(resources)').all() as { name: string }[]).map((c) => c.name);
  if (!resCols.includes('url')) d.exec('ALTER TABLE resources ADD COLUMN url TEXT');
  const taskCols = (d.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name);
  if (!taskCols.includes('attachments')) {
    d.exec("ALTER TABLE tasks ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
  }
  if (!taskCols.includes('definition_of_done')) {
    d.exec('ALTER TABLE tasks ADD COLUMN definition_of_done TEXT');
  }
}

export function db(): DatabaseSync {
  if (g.__agentboardDb) return g.__agentboardDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new DatabaseSync(DB_FILE);
  d.exec('PRAGMA journal_mode = WAL;');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec('PRAGMA busy_timeout = 5000;');
  d.exec(SCHEMA);
  migrateColumns(d);
  g.__agentboardDb = d;
  return d;
}

export function now(): string {
  return new Date().toISOString();
}

export function uid(prefix = 't'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function getMeta(key: string): string | null {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  db()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

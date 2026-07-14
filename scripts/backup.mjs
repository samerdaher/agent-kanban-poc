#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SQLite backup: checkpoint the WAL, copy the database + vault key into
 * data/backups/<timestamp>/, keep the newest 14. Run from cron:
 *   0 3 * * * cd /opt/agent-kanban-poc && node scripts/backup.mjs
 * For offsite backups, sync data/backups/ to object storage (rclone/litestream).
 */

const DATA = process.env.AGENTBOARD_DATA_DIR || path.join(process.cwd(), 'data');
const BACKUPS = path.join(DATA, 'backups');
const KEEP = 14;

const dbFile = path.join(DATA, 'agentboard.db');
if (!fs.existsSync(dbFile)) {
  console.error(`no database at ${dbFile}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join(BACKUPS, stamp);
fs.mkdirSync(dir, { recursive: true });

const d = new DatabaseSync(dbFile);
d.exec('PRAGMA wal_checkpoint(TRUNCATE);');
d.close();

fs.copyFileSync(dbFile, path.join(dir, 'agentboard.db'));
const keyFile = path.join(DATA, 'vault.key');
if (fs.existsSync(keyFile)) fs.copyFileSync(keyFile, path.join(dir, 'vault.key'));

const all = fs
  .readdirSync(BACKUPS)
  .filter((n) => fs.statSync(path.join(BACKUPS, n)).isDirectory())
  .sort()
  .reverse();
for (const old of all.slice(KEEP)) {
  fs.rmSync(path.join(BACKUPS, old), { recursive: true, force: true });
}

console.log(`backup written: ${dir} (keeping ${Math.min(all.length, KEEP)} of ${all.length})`);

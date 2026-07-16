import { db, getMeta } from './db';
import { pruneSessions } from './auth';
import { recoverInterrupted, reconcileBlocked, triggerAgents } from './agent/runner';
import { listSchedules, getTemplate, createTaskFromTemplate, markScheduleRun } from './store';
import { cronMatches } from './cron';
import { checkResourceHealth } from './health';

/**
 * One-time server boot (wired via instrumentation.ts): open the database,
 * prune expired sessions, re-queue tasks that were mid-run when the process
 * died, fire the agent trigger, and start the schedule/health tick loops.
 */

const g = globalThis as unknown as { __agentboardBooted?: boolean };

function schedulerTick() {
  const nowDate = new Date();
  const minuteKey = nowDate.toISOString().slice(0, 16); // dedupe per minute
  for (const s of listSchedules()) {
    try {
      if (!s.enabled || s.lastRun === minuteKey) continue;
      if (!cronMatches(s.cron, nowDate)) continue;
      markScheduleRun(s.id, minuteKey);
      const tpl = getTemplate(s.workspaceId, s.templateId);
      if (!tpl) continue;
      createTaskFromTemplate(tpl, 'on schedule', ['auto:schedule']);
      triggerAgents(s.workspaceId);
    } catch {
      /* one bad schedule must not stop the loop */
    }
  }
}

export function boot() {
  if (g.__agentboardBooted) return;
  g.__agentboardBooted = true;
  try {
    db();
    void getMeta('boot'); // touch the db early so schema/migrations run
    pruneSessions();
    recoverInterrupted();
    reconcileBlocked();
    triggerAgents();
    setInterval(schedulerTick, 60000).unref?.();
    void checkResourceHealth();
    setInterval(() => void checkResourceHealth(), 6 * 60 * 60 * 1000).unref?.();
    console.log('[agentboard] boot complete — store ready, runner armed, scheduler ticking');
  } catch (err) {
    g.__agentboardBooted = false;
    console.error('[agentboard] boot failed:', err);
  }
}

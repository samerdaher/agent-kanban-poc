import { db } from './db';
import { pruneSessions } from './auth';
import { recoverInterrupted, reconcileBlocked, triggerAgents } from './agent/runner';

/**
 * One-time server boot (wired via instrumentation.ts): open the database,
 * prune expired sessions, re-queue tasks that were mid-run when the process
 * died, and fire the agent trigger.
 */

const g = globalThis as unknown as { __agentboardBooted?: boolean };

export function boot() {
  if (g.__agentboardBooted) return;
  g.__agentboardBooted = true;
  try {
    db();
    pruneSessions();
    recoverInterrupted();
    reconcileBlocked();
    triggerAgents();
    console.log('[agentboard] boot complete — store ready, runner armed');
  } catch (err) {
    g.__agentboardBooted = false;
    console.error('[agentboard] boot failed:', err);
  }
}

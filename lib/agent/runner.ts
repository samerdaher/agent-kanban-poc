import { getDb, getTask, addUpdate, saveDb } from '../store';
import { Task } from '../types';
import { executeTask } from './claude';

/**
 * The agent runner. Watches for agent-ready tasks that enter the Sprint
 * column ("one trigger"), builds context, executes, posts important-only
 * updates and the final output, and handles Blocked transitions for unmet
 * dependencies, missing resources (MCPs / credentials) and human questions.
 *
 * Runs in-process; the running set lives on globalThis so dev-server HMR
 * doesn't double-run tasks.
 */

const g = globalThis as unknown as { __agentRunnerActive?: Set<string> };
function active(): Set<string> {
  if (!g.__agentRunnerActive) g.__agentRunnerActive = new Set();
  return g.__agentRunnerActive;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
}

/** "Memory": find similar completed tasks and reuse their outputs as context. */
function buildContext(task: Task): { summary: string; sources: string[] } {
  const db = getDb();
  const own = keywords(`${task.title} ${task.description} ${task.tags.join(' ')}`);
  const scored = db.tasks
    .filter((t) => t.id !== task.id && t.status === 'completed' && t.output)
    .map((t) => {
      const other = keywords(`${t.title} ${t.description} ${t.tags.join(' ')}`);
      let overlap = 0;
      own.forEach((w) => other.has(w) && overlap++);
      return { t, overlap };
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 3);

  if (!scored.length) return { summary: '', sources: [] };
  const summary = scored
    .map((s) => `From completed task “${s.t.title}”:\n${(s.t.output || '').slice(0, 800)}`)
    .join('\n\n---\n\n');
  return { summary, sources: scored.map((s) => s.t.title) };
}

function unmetDependencies(task: Task): Task[] {
  return task.dependencies
    .map((id) => getTask(id))
    .filter((t): t is Task => Boolean(t) && t!.status !== 'completed');
}

function missingRequirements(task: Task): string[] {
  const have = new Set(getDb().resources.map((r) => r.name.toLowerCase()));
  return task.requirements.filter((r) => !have.has(r.toLowerCase()));
}

function block(task: Task, kind: 'dependency' | 'missing_resource' | 'human_question', detail: string, refs: string[]) {
  task.status = 'blocked';
  task.blocked = { kind, detail, refs };
  addUpdate(task, 'problem', detail);
  saveDb();
}

async function runPipeline(taskId: string) {
  const task = getTask(taskId);
  if (!task) return;

  // ---- Gate 1: dependencies -------------------------------------------
  const deps = unmetDependencies(task);
  if (deps.length) {
    block(
      task,
      'dependency',
      `Blocked on ${deps.length} unfinished dependenc${deps.length > 1 ? 'ies' : 'y'}: ${deps.map((d) => `“${d.title}”`).join(', ')}. Will resume automatically when completed.`,
      deps.map((d) => d.id),
    );
    return;
  }

  // ---- Gate 2: required resources (MCPs / credentials) ----------------
  const missing = missingRequirements(task);
  if (missing.length) {
    block(
      task,
      'missing_resource',
      `Missing required resource${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Add ${missing.length > 1 ? 'them' : 'it'} in workspace Resources to unblock.`,
      missing,
    );
    return;
  }

  // ---- Phase: building context ----------------------------------------
  task.status = 'building_context';
  task.blocked = null;
  addUpdate(task, 'status', 'Agent picked up the task. Building context…');
  saveDb();
  await sleep(2000);

  const fresh = getTask(taskId);
  if (!fresh || fresh.status !== 'building_context') return; // moved by a human meanwhile

  const ctx = buildContext(fresh);
  addUpdate(
    fresh,
    'context',
    ctx.sources.length
      ? `Context built from workspace memory — reused output of: ${ctx.sources.map((s) => `“${s}”`).join(', ')}.`
      : 'No similar past tasks found — proceeding from the task description and workspace knowledge base.',
  );

  // ---- Phase: executing -------------------------------------------------
  fresh.status = 'executing';
  addUpdate(fresh, 'status', 'Execution started.');
  saveDb();

  const result = await executeTask(fresh, ctx.summary);

  const t2 = getTask(taskId);
  if (!t2 || t2.status !== 'executing') return;

  if (result.importantUpdate) addUpdate(t2, 'info', result.importantUpdate);
  t2.output = result.output;

  // ---- Optional gate: human confirmation before completing -------------
  if (t2.askHuman && !t2.updates.some((u) => u.kind === 'answer')) {
    t2.pendingQuestion = 'The deliverable is ready. Please review the output and confirm completion (or give corrections).';
    addUpdate(t2, 'question', t2.pendingQuestion);
    block(t2, 'human_question', 'Waiting on a human answer before completing.', []);
    return;
  }

  finish(t2);
}

function finish(task: Task) {
  task.status = 'completed';
  task.blocked = null;
  task.completedAt = new Date().toISOString();
  addUpdate(task, 'output', 'Final output attached. Task completed.');
  saveDb();
  // Completing this task may unblock others.
  reconcileBlocked();
  triggerAgents();
}

/** Re-check blocked tasks: move back to sprint when their blocker is resolved. */
export function reconcileBlocked() {
  const db = getDb();
  let changed = false;
  for (const task of db.tasks) {
    if (task.status !== 'blocked' || !task.blocked) continue;
    if (task.blocked.kind === 'dependency' && unmetDependencies(task).length === 0) {
      task.status = 'sprint';
      task.blocked = null;
      addUpdate(task, 'status', 'Dependencies completed — task is ready again.');
      changed = true;
    } else if (task.blocked.kind === 'missing_resource' && missingRequirements(task).length === 0) {
      task.status = 'sprint';
      task.blocked = null;
      addUpdate(task, 'status', 'Required resources are now available — task is ready again.');
      changed = true;
    }
  }
  if (changed) saveDb();
}

/** The webhook: fires whenever board state changes. Picks up agent-ready sprint tasks. */
export function triggerAgents() {
  const db = getDb();
  for (const task of db.tasks) {
    if (task.type !== 'agent') continue;
    if (task.status !== 'sprint') continue;
    if (active().has(task.id)) continue;
    active().add(task.id);
    runPipeline(task.id)
      .catch((err) => {
        const t = getTask(task.id);
        if (t) {
          addUpdate(t, 'problem', `Agent run failed: ${err instanceof Error ? err.message : String(err)}`);
          t.status = 'blocked';
          t.blocked = { kind: 'missing_resource', detail: 'Agent run failed — see updates.', refs: [] };
          saveDb();
        }
      })
      .finally(() => active().delete(task.id));
  }
}

/** Human answered the agent's question → resume and complete. */
export function answerQuestion(taskId: string, answer: string): Task | undefined {
  const task = getTask(taskId);
  if (!task || !task.pendingQuestion) return task;
  addUpdate(task, 'answer', `Human: ${answer}`);
  task.pendingQuestion = null;
  if (task.status === 'blocked' && task.blocked?.kind === 'human_question') {
    finish(task);
  }
  return task;
}

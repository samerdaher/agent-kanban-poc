import {
  getTask,
  saveTask,
  addUpdate,
  listTasks,
  listResources,
  listSprintAgentTasks,
  listTasksByStatus,
} from '../store';
import { Task, BlockedKind } from '../types';
import { executeTask } from './claude';
import { notifySlack } from '../notify';

/**
 * The agent runner. Scans for agent-ready tasks in the Sprint column ("one
 * trigger"), builds context from workspace memory, executes with Claude,
 * posts important-only updates and the final output, and handles Blocked
 * transitions (unmet dependencies, missing MCPs/credentials, human questions).
 *
 * Runs in-process with a concurrency-limited queue; state that must survive
 * dev-server HMR lives on globalThis. Because every phase transition is
 * persisted to SQLite, a crash mid-run is recoverable: recoverInterrupted()
 * re-queues in-flight tasks on boot.
 */

const MAX_CONCURRENT = Math.max(1, Number(process.env.AGENT_CONCURRENCY || 3));

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

/** "Memory": find similar completed tasks in the workspace and reuse their outputs. */
function buildContext(task: Task): { summary: string; sources: string[] } {
  const own = keywords(`${task.title} ${task.description} ${task.tags.join(' ')}`);
  const scored = listTasks(task.workspaceId)
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
  const have = new Set(listResources(task.workspaceId).map((r) => r.name.toLowerCase()));
  return task.requirements.filter((r) => !have.has(r.toLowerCase()));
}

function block(task: Task, kind: BlockedKind, detail: string, refs: string[]) {
  task.status = 'blocked';
  task.blocked = { kind, detail, refs };
  saveTask(task);
  addUpdate(task, 'problem', detail);
  notifySlack(task, `🚧 *${task.title}* is blocked (${kind.replace('_', ' ')}): ${detail}`);
}

async function runPipeline(taskId: string) {
  const task = getTask(taskId);
  if (!task || task.status !== 'sprint') return;

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
  saveTask(task);
  addUpdate(task, 'status', 'Agent picked up the task. Building context…');
  await sleep(1500);

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
  saveTask(fresh);
  addUpdate(fresh, 'status', 'Execution started.');

  const result = await executeTask(fresh, ctx.summary);

  const t2 = getTask(taskId);
  if (!t2 || t2.status !== 'executing') return;

  if (result.importantUpdate) addUpdate(t2, 'info', result.importantUpdate);
  t2.output = result.output;
  t2.attachments = result.attachments ?? [];

  // ---- Optional gate: human confirmation before completing -------------
  if (t2.askHuman && !t2.updates.some((u) => u.kind === 'answer')) {
    t2.pendingQuestion =
      'The deliverable is ready. Please review the output and confirm completion (or give corrections).';
    saveTask(t2);
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
  saveTask(task);
  addUpdate(task, 'output', 'Final output attached. Task completed.');
  notifySlack(task, `✅ *${task.title}* completed — output attached to the card.`);
  // Completing this task may unblock others (in any workspace via cross-refs).
  reconcileBlocked();
  triggerAgents();
}

/** Re-check blocked tasks: move back to sprint when their blocker is resolved. */
export function reconcileBlocked(workspaceId?: string) {
  for (const stub of listTasksByStatus(['blocked'])) {
    if (workspaceId && stub.workspaceId !== workspaceId) continue;
    const task = getTask(stub.id);
    if (!task || task.status !== 'blocked' || !task.blocked) continue;
    if (task.blocked.kind === 'dependency' && unmetDependencies(task).length === 0) {
      task.status = 'sprint';
      task.blocked = null;
      saveTask(task);
      addUpdate(task, 'status', 'Dependencies completed — task is ready again.', 'system');
    } else if (task.blocked.kind === 'missing_resource' && missingRequirements(task).length === 0) {
      task.status = 'sprint';
      task.blocked = null;
      saveTask(task);
      addUpdate(task, 'status', 'Required resources are now available — task is ready again.', 'system');
    }
  }
}

/**
 * The trigger: fires whenever board state changes (moves, creates, resources,
 * webhook). Picks up agent-ready sprint tasks up to the concurrency limit.
 */
export function triggerAgents(workspaceId?: string) {
  for (const task of listSprintAgentTasks(workspaceId)) {
    if (active().size >= MAX_CONCURRENT) return; // queue drains as runs finish
    if (active().has(task.id)) continue;
    active().add(task.id);
    runPipeline(task.id)
      .catch((err) => {
        const t = getTask(task.id);
        if (t) {
          t.status = 'blocked';
          t.blocked = {
            kind: 'error',
            detail: `Agent run failed: ${err instanceof Error ? err.message : String(err)}. Move the task back to Sprint to retry.`,
            refs: [],
          };
          saveTask(t);
          addUpdate(t, 'problem', t.blocked.detail);
        }
      })
      .finally(() => {
        active().delete(task.id);
        // A slot opened — pick up anything still waiting in Sprint.
        triggerAgents();
      });
  }
}

/**
 * Crash recovery, called once on boot: tasks stuck mid-run (building_context /
 * executing) are re-queued to Sprint so the trigger picks them up again.
 */
export function recoverInterrupted() {
  for (const stub of listTasksByStatus(['building_context', 'executing'])) {
    if (active().has(stub.id)) continue; // actually running in this process
    const task = getTask(stub.id);
    if (!task) continue;
    task.status = 'sprint';
    task.blocked = null;
    saveTask(task);
    addUpdate(task, 'problem', 'Server restarted mid-run — task re-queued automatically.', 'system');
  }
}

/** Human answered the agent's question → resume and complete. */
export function answerQuestion(taskId: string, answer: string, actor: string): Task | undefined {
  const task = getTask(taskId);
  if (!task || !task.pendingQuestion) return task;
  task.pendingQuestion = null;
  saveTask(task);
  addUpdate(task, 'answer', answer, actor);
  if (task.status === 'blocked' && task.blocked?.kind === 'human_question') {
    finish(task);
  }
  return getTask(taskId);
}

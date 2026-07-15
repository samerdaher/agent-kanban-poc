import {
  getTask,
  saveTask,
  addUpdate,
  listTasks,
  listResources,
  listLessons,
  listSprintAgentTasks,
  listTasksByStatus,
  recordRun,
  getUserById,
  createTask,
  setInforms,
  budgetStatus,
  isRunnerPaused,
} from '../store';
import { Task, BlockedKind } from '../types';
import { executeTask, hasApiKey, subscriptionEnabled } from './claude';
import { distillLesson } from './lessons';
import { extractImpactHeuristic, enrichImpact } from './impact';
import { generateEpicPlan, generateEpicDigest, renderPlanMarkdown } from './planner';
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

/**
 * Context framework. Every run gets three layers:
 *  1. similar completed outputs (what worked before)
 *  2. workspace lessons (distilled from failures & human corrections)
 *  3. the task's own previous attempt + feedback, when it's a re-run
 */
function buildContext(task: Task): { summary: string; note: string } {
  const own = keywords(`${task.title} ${task.description} ${task.tags.join(' ')}`);
  const overlapWith = (text: string) => {
    const other = keywords(text);
    let n = 0;
    own.forEach((w) => other.has(w) && n++);
    return n;
  };

  // 0 — linked outputs (informs edges): explicit, always injected
  const linked = task.informs
    .map((id) => getTask(id))
    .filter((t): t is Task => Boolean(t && t.output));
  const linkedBlock = linked.length
    ? `# Linked task outputs — this task explicitly builds on them\n${linked
        .map((t) => `From “${t.title}”:\n${(t.output || '').slice(0, 1200)}`)
        .join('\n\n---\n\n')}`
    : '';

  // 1 — similar completed outputs
  const similar = listTasks(task.workspaceId)
    .filter((t) => t.id !== task.id && t.status === 'completed' && t.output)
    .map((t) => ({ t, overlap: overlapWith(`${t.title} ${t.description} ${t.tags.join(' ')}`) }))
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 3);
  const similarBlock = similar.length
    ? `# Relevant past work in this workspace\n${similar
        .map((s) => `From completed task “${s.t.title}”:\n${(s.t.output || '').slice(0, 800)}`)
        .join('\n\n---\n\n')}`
    : '';

  // 2 — workspace lessons: matched-by-topic first, then most recent
  const allLessons = listLessons(task.workspaceId);
  const matched = allLessons
    .map((l) => ({ l, overlap: overlapWith(l.text) }))
    .sort((a, b) => b.overlap - a.overlap || (a.l.createdAt < b.l.createdAt ? 1 : -1));
  const picked = matched.slice(0, 5).map((m) => m.l);
  const lessonBlock = picked.length
    ? `# Workspace lessons — learned from past failures & corrections; APPLY THESE\n${picked
        .map((l) => `- ${l.text}`)
        .join('\n')}`
    : '';

  // 3 — previous attempt: this is a re-run, revise instead of restarting
  const problems = task.updates.filter((u) => u.kind === 'problem').slice(-3);
  const answers = task.updates.filter((u) => u.kind === 'answer').slice(-3);
  const isRerun = Boolean(task.output) || answers.length > 0;
  const revisionBlock = isRerun
    ? [
        `# Previous attempt — this task is a RE-RUN. Revise the prior work; fix what was wrong; do not repeat mistakes.`,
        task.output ? `## Prior output (excerpt)\n${task.output.slice(0, 1500)}` : '',
        problems.length ? `## Problems from the last run\n${problems.map((p) => `- ${p.text}`).join('\n')}` : '',
        answers.length
          ? `## Human feedback — this overrides everything else\n${answers.map((a) => `- ${a.actor}: ${a.text}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    : '';

  const summary = [linkedBlock, similarBlock, lessonBlock, revisionBlock].filter(Boolean).join('\n\n---\n\n');
  const parts = [
    linked.length ? `${linked.length} linked output${linked.length > 1 ? 's' : ''}` : '',
    similar.length ? `${similar.length} similar output${similar.length > 1 ? 's' : ''}` : '',
    picked.length ? `${picked.length} workspace lesson${picked.length > 1 ? 's' : ''}` : '',
    isRerun ? 'previous-attempt history (revision mode)' : '',
  ].filter(Boolean);
  const note = parts.length
    ? `Context built from workspace memory: ${parts.join(', ')}.`
    : 'No similar past tasks or lessons found — proceeding from the task description.';
  return { summary, note };
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
  if (task.type === 'epic') return runEpicPipeline(task);

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

  // ---- Gate 3: monthly credit budget -----------------------------------
  const bs = budgetStatus(task.workspaceId);
  if (bs.over && task.executor !== 'subscription') {
    if (subscriptionEnabled()) {
      task.executor = 'subscription';
      saveTask(task);
      addUpdate(
        task,
        'info',
        `Monthly credit budget reached ($${bs.spentThisMonth.toFixed(2)} of $${bs.budget}) — forcing the free subscription executor for this run.`,
        'system',
      );
    } else if (hasApiKey()) {
      block(
        task,
        'budget',
        `Monthly credit budget reached ($${bs.spentThisMonth.toFixed(2)} of $${bs.budget}). Raise the budget in workspace settings to resume.`,
        [],
      );
      return;
    }
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
  addUpdate(fresh, 'context', ctx.note);

  // ---- Phase: executing -------------------------------------------------
  fresh.status = 'executing';
  saveTask(fresh);
  addUpdate(fresh, 'status', 'Execution started.');

  const startedAt = Date.now();
  const result = await executeTask(fresh, ctx.summary);

  const t2 = getTask(taskId);
  if (!t2 || t2.status !== 'executing') return;

  recordRun({
    taskId: t2.id,
    workspaceId: t2.workspaceId,
    model: result.model,
    simulated: result.simulated,
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
    cacheReadTokens: result.usage.cacheRead,
    cacheWriteTokens: result.usage.cacheWrite,
    costUsd: result.billedUsd,
    durationMs: Date.now() - startedAt,
    iterations: result.iterations,
    outcome: result.outcome,
  });

  if (result.importantUpdate) addUpdate(t2, 'info', result.importantUpdate);
  t2.output = result.output;
  t2.attachments = result.attachments ?? [];
  t2.impact = extractImpactHeuristic(t2, result.output);
  if (t2.impact) void enrichImpact(t2.id); // adds an AI summary later, best-effort

  // ---- Optional gate: human confirmation before completing -------------
  // (asks after every revision too — only an explicit approval completes)
  if (t2.askHuman) {
    const reviewer = t2.reviewerUserId ? getUserById(t2.reviewerUserId) : null;
    t2.pendingQuestion = `The deliverable is ready${reviewer ? ` — review requested from ${reviewer.name}` : ''}. Approve to complete, or request changes and the agent will revise.`;
    saveTask(t2);
    addUpdate(t2, 'question', t2.pendingQuestion);
    block(
      t2,
      'human_question',
      `Waiting on ${reviewer ? reviewer.name : 'a human'} to answer before completing.`,
      [],
    );
    return;
  }

  finish(t2);
}

/**
 * Epics have two phases: (1) planning — decompose the goal into a subtask
 * plan and wait for human approval; (2) after the approved children complete
 * (tracked as blocks-dependencies), digest their outputs and finish.
 */
async function runEpicPipeline(task: Task) {
  if (task.plan && task.dependencies.length) {
    const deps = unmetDependencies(task);
    if (deps.length) {
      block(
        task,
        'dependency',
        `Epic waiting on ${deps.length} subtask${deps.length > 1 ? 's' : ''}: ${deps.map((d) => `“${d.title}”`).join(', ')}.`,
        deps.map((d) => d.id),
      );
      return;
    }
    // all children complete → digest
    task.status = 'executing';
    saveTask(task);
    addUpdate(task, 'status', 'All subtasks complete — composing the epic summary.');
    const children = task.dependencies.map((id) => getTask(id)).filter((t): t is Task => Boolean(t));
    const fresh = getTask(task.id);
    if (!fresh || fresh.status !== 'executing') return;
    fresh.output = await generateEpicDigest(fresh, children);
    saveTask(fresh);
    finish(fresh);
    return;
  }

  // planning phase
  task.status = 'building_context';
  task.blocked = null;
  saveTask(task);
  addUpdate(task, 'status', 'Planning the epic — decomposing the goal into subtasks…');
  const ctx = buildContext(task);
  task.status = 'executing';
  saveTask(task);
  const plan = await generateEpicPlan(task, ctx.summary);
  const fresh = getTask(task.id);
  if (!fresh || fresh.status !== 'executing') return;
  fresh.plan = plan;
  fresh.output = renderPlanMarkdown(plan);
  fresh.pendingQuestion = `Proposed plan with ${plan.length} subtasks — approve to create them, or request changes.`;
  saveTask(fresh);
  addUpdate(fresh, 'question', fresh.pendingQuestion);
  block(fresh, 'human_question', 'Waiting for plan approval.', []);
}

/** Approve an epic's plan: create the subtasks with their edges, then track them. */
export function approvePlan(taskId: string, actor: string): Task | undefined {
  const task = getTask(taskId);
  if (!task || task.type !== 'epic' || !task.plan || task.dependencies.length) return task;

  const created: Task[] = [];
  for (const item of task.plan) {
    created.push(
      createTask(
        task.workspaceId,
        {
          title: item.title,
          description: item.description,
          type: item.type,
          status: 'sprint', // dependency gates sequence them automatically
          definitionOfDone: item.definitionOfDone || null,
          askHuman: Boolean(item.askHuman),
          tags: ['epic'],
        },
        task.createdBy,
      ),
    );
  }
  task.plan.forEach((item, i) => {
    if (item.dependsOn.length) {
      created[i].dependencies = item.dependsOn.map((j) => created[j].id);
      saveTask(created[i]);
    }
    if (item.informs?.length) setInforms(created[i].id, item.informs.map((j) => created[j].id));
  });

  task.dependencies = created.map((c) => c.id);
  task.pendingQuestion = null;
  task.blocked = null;
  task.status = 'sprint';
  saveTask(task);
  addUpdate(task, 'status', `Plan approved by ${actor} — ${created.length} subtasks created.`, actor);
  triggerAgents(task.workspaceId);
  return getTask(taskId);
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
    } else if (task.blocked.kind === 'budget' && !budgetStatus(task.workspaceId).over) {
      task.status = 'sprint';
      task.blocked = null;
      saveTask(task);
      addUpdate(task, 'status', 'Budget available again — task is ready.', 'system');
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
    if (isRunnerPaused(task.workspaceId)) continue; // admin paused this workspace
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
          // learn from the failure so the next run avoids it
          void distillLesson(t, 'failure', t.blocked.detail);
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

/**
 * Human answered the agent's question.
 *  - approve → complete the task as delivered
 *  - revise  → the answer is a correction: distill it into workspace memory
 *              and re-queue the task; the next run revises with the feedback
 */
export function answerQuestion(
  taskId: string,
  answer: string,
  actor: string,
  action: 'approve' | 'revise' = 'approve',
): Task | undefined {
  const task = getTask(taskId);
  if (!task || !task.pendingQuestion) return task;
  task.pendingQuestion = null;
  saveTask(task);

  if (action === 'revise') {
    addUpdate(task, 'answer', `Requested changes: ${answer}`, actor);
    void distillLesson(task, 'correction', answer);
    task.status = 'sprint';
    task.blocked = null;
    saveTask(task);
    addUpdate(task, 'status', 'Human requested changes — task re-queued for revision.', 'system');
    triggerAgents(task.workspaceId);
    return getTask(taskId);
  }

  // approving an epic's plan question creates the subtasks instead of finishing
  if (task.type === 'epic' && task.plan && !task.dependencies.length) {
    addUpdate(task, 'answer', answer || 'Plan approved.', actor);
    return approvePlan(taskId, actor);
  }

  addUpdate(task, 'answer', answer || 'Approved.', actor);
  if (task.status === 'blocked' && task.blocked?.kind === 'human_question') {
    finish(task);
  }
  return getTask(taskId);
}

/**
 * Re-execute a finished task with new instructions. The instructions are
 * recorded as an answer-kind update, so revision mode injects them together
 * with the previous output — the agent builds on the prior work instead of
 * starting over. The instructions also feed workspace memory.
 */
export function rerunTask(taskId: string, instructions: string, actor: string): Task | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  addUpdate(task, 'answer', `Re-run requested: ${instructions}`, actor);
  void distillLesson(task, 'correction', instructions);
  task.status = 'sprint';
  task.blocked = null;
  task.pendingQuestion = null;
  task.completedAt = null;
  saveTask(task);
  addUpdate(task, 'status', 'Re-queued for re-execution with new instructions.', 'system');
  triggerAgents(task.workspaceId);
  return getTask(taskId);
}

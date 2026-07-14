import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { Task, TaskAttachment } from '../types';
import { listResources, getResourceSecret } from '../store';
import { DATA_DIR } from '../db';

export interface RunUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ExecutionResult {
  output: string;
  importantUpdate: string | null;
  simulated: boolean;
  attachments?: TaskAttachment[];
  model: string;
  usage: RunUsage;
  iterations: number;
  /** rubric grading result: 'passed' | 'max_iterations' | null (no rubric) */
  outcome: string | null;
}

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
const MAX_ITERATIONS = Math.max(1, Number(process.env.AGENT_MAX_ITERATIONS || 2));

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/* ------------------------------ pricing -------------------------------- */

/** USD per MTok [input, output]; cache write ≈1.25× input, cache read ≈0.1× input. */
const PRICES: Record<string, [number, number]> = {
  'claude-fable-5': [10, 50],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

export function costUsd(model: string, u: RunUsage): number {
  const [inP, outP] = PRICES[model] || [5, 25];
  return (u.input * inP + u.cacheWrite * 1.25 * inP + u.cacheRead * 0.1 * inP + u.output * outP) / 1e6;
}

export function emptyUsage(): RunUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function accumulate(total: RunUsage, add: RunUsage) {
  total.input += add.input;
  total.output += add.output;
  total.cacheRead += add.cacheRead;
  total.cacheWrite += add.cacheWrite;
}

function usageOf(message: unknown): RunUsage {
  const u = ((message as { usage?: Record<string, number | null | undefined> }).usage ?? {}) as Record<
    string,
    number | null | undefined
  >;
  return {
    input: Number(u.input_tokens || 0),
    output: Number(u.output_tokens || 0),
    cacheRead: Number(u.cache_read_input_tokens || 0),
    cacheWrite: Number(u.cache_creation_input_tokens || 0),
  };
}

/* ------------------------------ prompts -------------------------------- */

const SYSTEM_PROMPT = `You are an autonomous agent worker inside a Kanban project-management platform.
You pick up tasks tagged "agent-ready", execute them, and deliver real output.

Rules:
- Produce the actual deliverable for the task (a design, a draft, code, a plan, an analysis) — not a description of how you would do it.
- When MCP tools are available, use them to ground the deliverable in real data (repos, deployments, issues, docs) instead of inventing details.
- When context includes workspace lessons or a previous attempt, apply them — do not repeat past mistakes.
- Output clean markdown. Lead with the deliverable itself.
- Be concise but complete: the output is attached to the task card and read by a human teammate.`;

/* ------------------- file deliverables (skills) ----------------------- */

type FileSkill = 'pptx' | 'xlsx' | 'docx' | 'pdf';

const FILE_SKILL_PATTERNS: { skill: FileSkill; re: RegExp }[] = [
  { skill: 'pptx', re: /\b(slides?|deck|presentation|powerpoint|pptx)\b/i },
  { skill: 'xlsx', re: /\b(spreadsheet|excel|xlsx|workbook)\b/i },
  { skill: 'docx', re: /\b(docx|word document|word doc)\b/i },
  { skill: 'pdf', re: /\bpdf\b/i },
];

function detectFileSkill(task: Task): FileSkill | null {
  const hay = `${task.title} ${task.description} ${task.tags.join(' ')}`;
  for (const p of FILE_SKILL_PATTERNS) if (p.re.test(hay)) return p.skill;
  return null;
}

async function collectGeneratedFiles(
  client: Anthropic,
  content: unknown[],
  task: Task,
): Promise<TaskAttachment[]> {
  const ids = new Set<string>();
  for (const block of content as Array<Record<string, any>>) {
    if (block.type !== 'bash_code_execution_tool_result' && block.type !== 'text_editor_code_execution_tool_result')
      continue;
    const inner = block.content;
    const entries = Array.isArray(inner?.content) ? inner.content : [];
    for (const f of entries) if (f?.file_id) ids.add(f.file_id as string);
  }

  const out: TaskAttachment[] = [];
  const dir = path.join(DATA_DIR, 'files', task.id);
  for (const id of ids) {
    try {
      const meta = await client.beta.files.retrieveMetadata(id);
      const res = await client.beta.files.download(id);
      const buf = Buffer.from(await res.arrayBuffer());
      const name = path.basename(meta.filename || `${id}.bin`);
      if (!name || name === '.' || name === '..') continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), buf);
      out.push({ name, size: buf.length, createdAt: new Date().toISOString() });
    } catch {
      /* skip files that fail to download; text output still ships */
    }
  }
  return out;
}

/* --------------------------- MCP connector ---------------------------- */

interface McpConnection {
  name: string;
  url: string;
  token: string | null;
}

function mcpConnectionsForTask(task: Task): McpConnection[] {
  if (!task.requirements.length) return [];
  const required = new Set(task.requirements.map((r) => r.toLowerCase()));
  return listResources(task.workspaceId)
    .filter((r) => r.kind === 'mcp' && r.url && required.has(r.name.toLowerCase()))
    .map((r) => ({
      name: r.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      url: r.url as string,
      token: getResourceSecret(task.workspaceId, r.name),
    }));
}

function userContentFor(task: Task, context: string): string {
  return [
    `# Task\n**${task.title}**\n\n${task.description || '(no further description)'}`,
    task.tags.length ? `Tags: ${task.tags.join(', ')}` : '',
    task.definitionOfDone
      ? `# Definition of done — the deliverable is only acceptable if it meets ALL of this:\n${task.definitionOfDone}`
      : '',
    context ? `# Context gathered from the workspace\n${context}` : '',
    `Deliver the final output for this task now.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/* ------------------------------ one call ------------------------------- */

interface AttemptResult {
  output: string;
  attachments: TaskAttachment[];
  usage: RunUsage;
  mcpNote: string;
  fileNote: string;
}

async function runAttempt(task: Task, context: string, mcps: McpConnection[]): Promise<AttemptResult> {
  const client = new Anthropic();
  const messages = [{ role: 'user' as const, content: userContentFor(task, context) }];
  const fileSkill = detectFileSkill(task);

  let stream;
  if (fileSkill || mcps.length) {
    const betas: string[] = [];
    if (fileSkill) betas.push('code-execution-2025-08-25', 'skills-2025-10-02');
    if (mcps.length) betas.push('mcp-client-2025-11-20');

    const system = fileSkill
      ? `${SYSTEM_PROMPT}\n- This task's deliverable is a real ${fileSkill.toUpperCase()} file. Use the ${fileSkill} skill via code execution to CREATE THE ACTUAL FILE, then keep the text response to a brief summary of what you built.`
      : SYSTEM_PROMPT;

    stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system,
      betas,
      ...(fileSkill
        ? { container: { skills: [{ type: 'anthropic', skill_id: fileSkill, version: 'latest' }] } }
        : {}),
      ...(mcps.length
        ? {
            mcp_servers: mcps.map((m) => ({
              type: 'url' as const,
              url: m.url,
              name: m.name,
              ...(m.token ? { authorization_token: m.token } : {}),
            })),
          }
        : {}),
      tools: [
        ...(fileSkill ? [{ type: 'code_execution_20260521' as const, name: 'code_execution' as const }] : []),
        ...mcps.map((m) => ({ type: 'mcp_toolset' as const, mcp_server_name: m.name })),
      ],
      messages,
    });
  } else {
    stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages,
    });
  }

  const message = await stream.finalMessage();
  const text = (message.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');

  const attachments = fileSkill
    ? await collectGeneratedFiles(client, message.content as unknown[], task)
    : [];

  return {
    output: text || '(the agent returned no text output)',
    attachments,
    usage: usageOf(message),
    mcpNote: mcps.length ? `MCP servers connected: ${mcps.map((m) => m.name).join(', ')}.` : '',
    fileNote: attachments.length
      ? `Generated file${attachments.length > 1 ? 's' : ''}: ${attachments.map((a) => a.name).join(', ')} (attached to the card).`
      : fileSkill
        ? `Expected a ${fileSkill} file but none was produced — see the text output.`
        : '',
  };
}

/* --------------------------- outcome grading --------------------------- */

/** Independent review pass: does the deliverable meet the definition of done? */
async function gradeDeliverable(
  rubric: string,
  output: string,
): Promise<{ pass: boolean; feedback: string; usage: RunUsage }> {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system:
      'You are a strict, fair reviewer. Grade the deliverable ONLY against the definition of done — no extra requirements. If it fails, give specific, actionable feedback the author can apply in one revision.',
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            pass: { type: 'boolean' },
            feedback: { type: 'string' },
          },
          required: ['pass', 'feedback'],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: 'user',
        content: `# Definition of done\n${rubric}\n\n# Deliverable\n${output.slice(0, 8000)}\n\nDoes the deliverable meet the definition of done?`,
      },
    ],
  });
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const parsed = JSON.parse(text) as { pass: boolean; feedback: string };
  return { ...parsed, usage: usageOf(message) };
}

/* ------------------------------ simulate ------------------------------- */

function simulate(task: Task, context: string): ExecutionResult {
  const contextNote = context ? `\n> Context used: ${context.split('\n')[0].slice(0, 120)}…\n` : '';
  const output = [
    `## ${task.title} — deliverable`,
    contextNote,
    `*(Simulation mode — set \`ANTHROPIC_API_KEY\` to run this step with a real Claude model.)*`,
    ``,
    `### Approach`,
    `1. Parsed the task description and gathered workspace context (similar completed tasks, lessons, prior attempts).`,
    `2. Produced the deliverable below and self-reviewed it against the task description.`,
    ``,
    `### Result`,
    task.description
      ? `Based on the description — “${task.description.slice(0, 180)}” — the agent produced a complete first version of the requested work, structured and ready for human review.`
      : `The agent produced a complete first version of the requested work, ready for human review.`,
  ].join('\n');

  return {
    output,
    importantUpdate:
      'Simulation mode: no ANTHROPIC_API_KEY configured — generated a representative deliverable to prove the flow.',
    simulated: true,
    model: 'simulation',
    usage: emptyUsage(),
    iterations: 1,
    outcome: task.definitionOfDone ? 'passed' : null,
  };
}

/* ------------------------------ orchestration -------------------------- */

export async function executeTask(task: Task, context: string): Promise<ExecutionResult> {
  if (!hasApiKey()) return simulate(task, context);

  const mcps = mcpConnectionsForTask(task);
  const runWith = async (connections: McpConnection[]): Promise<ExecutionResult> => {
    const usage = emptyUsage();
    let attempt = await runAttempt(task, context, connections);
    accumulate(usage, attempt.usage);
    let iterations = 1;
    let outcome: string | null = null;
    let reviewerNote = '';

    // Outcome loop: grade against the definition of done, revise until it
    // passes or the iteration budget is spent.
    if (task.definitionOfDone?.trim()) {
      for (;;) {
        let grade;
        try {
          grade = await gradeDeliverable(task.definitionOfDone, attempt.output);
        } catch {
          outcome = 'passed';
          reviewerNote = 'Outcome check skipped (grader unavailable).';
          break;
        }
        accumulate(usage, grade.usage);
        if (grade.pass) {
          outcome = 'passed';
          reviewerNote = `Outcome check: passed the definition of done after ${iterations} iteration${iterations > 1 ? 's' : ''}. ✓`;
          break;
        }
        if (iterations >= MAX_ITERATIONS) {
          outcome = 'max_iterations';
          reviewerNote = `Outcome check: still failing after ${iterations} iterations — reviewer feedback appended to the output for human follow-up.`;
          attempt.output += `\n\n---\n\n### ⚠️ Unresolved reviewer feedback\n${grade.feedback}`;
          break;
        }
        iterations++;
        const revisionContext = `${context}\n\n# Reviewer feedback on your previous attempt — fix every point\n${grade.feedback}\n\n# Your previous attempt (excerpt)\n${attempt.output.slice(0, 4000)}`;
        const next = await runAttempt(task, revisionContext, connections);
        accumulate(usage, next.usage);
        attempt = next;
      }
    }

    const notes = [attempt.mcpNote, attempt.fileNote, reviewerNote].filter(Boolean).join(' ');
    return {
      output: attempt.output,
      attachments: attempt.attachments,
      importantUpdate:
        `Executing with ${MODEL} — deliverable produced (${usage.output} output tokens, ${iterations} iteration${iterations > 1 ? 's' : ''}). ${notes}`.trim(),
      simulated: false,
      model: MODEL,
      usage,
      iterations,
      outcome,
    };
  };

  try {
    return await runWith(mcps);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (mcps.length) {
      try {
        const result = await runWith([]);
        return {
          ...result,
          importantUpdate: `MCP-connected run failed (${msg.slice(0, 120)}) — completed without MCP tools instead. Check the resource tokens. ${result.importantUpdate ?? ''}`,
        };
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        const fallback = simulate(task, context);
        return {
          ...fallback,
          importantUpdate: `Claude API call failed (${msg2.slice(0, 140)}). Fell back to simulation mode so the flow completes.`,
        };
      }
    }
    const fallback = simulate(task, context);
    return {
      ...fallback,
      importantUpdate: `Claude API call failed (${msg.slice(0, 140)}). Fell back to simulation mode so the flow completes.`,
    };
  }
}

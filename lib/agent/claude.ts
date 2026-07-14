import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { Task, TaskAttachment } from '../types';
import { listResources, getResourceSecret } from '../store';
import { DATA_DIR } from '../db';

export interface ExecutionResult {
  output: string;
  importantUpdate: string | null;
  simulated: boolean;
  attachments?: TaskAttachment[];
}

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = `You are an autonomous agent worker inside a Kanban project-management platform.
You pick up tasks tagged "agent-ready", execute them, and deliver real output.

Rules:
- Produce the actual deliverable for the task (a design, a draft, code, a plan, an analysis) — not a description of how you would do it.
- When MCP tools are available, use them to ground the deliverable in real data (repos, deployments, issues, docs) instead of inventing details.
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

/** Does this task's deliverable look like a real file (.pptx, .xlsx, …)? */
function detectFileSkill(task: Task): FileSkill | null {
  const hay = `${task.title} ${task.description} ${task.tags.join(' ')}`;
  for (const p of FILE_SKILL_PATTERNS) if (p.re.test(hay)) return p.skill;
  return null;
}

/**
 * Pull files the agent created in the code-execution container down to
 * DATA_DIR/files/<taskId>/ so they can be served from the task card.
 */
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

/**
 * Live MCP connections for a task: workspace resources of kind 'mcp' that
 * have an endpoint URL and are listed in the task's requirements. The vaulted
 * secret (if any) is decrypted here and sent as the bearer token — it never
 * reaches the UI.
 */
function mcpConnectionsForTask(task: Task): McpConnection[] {
  if (!task.requirements.length) return [];
  const required = new Set(task.requirements.map((r) => r.toLowerCase()));
  return listResources(task.workspaceId)
    .filter((r) => r.kind === 'mcp' && r.url && required.has(r.name.toLowerCase()))
    .map((r) => ({
      // server names must be simple identifiers
      name: r.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      url: r.url as string,
      token: getResourceSecret(task.workspaceId, r.name),
    }));
}

function userContentFor(task: Task, context: string): string {
  return [
    `# Task\n**${task.title}**\n\n${task.description || '(no further description)'}`,
    task.tags.length ? `Tags: ${task.tags.join(', ')}` : '',
    context ? `# Context gathered from the workspace\n${context}` : '',
    `Deliver the final output for this task now.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/* ----------------------------- execution ------------------------------ */

async function executeWithClaude(task: Task, context: string, mcps: McpConnection[]): Promise<ExecutionResult> {
  const client = new Anthropic();
  const messages = [{ role: 'user' as const, content: userContentFor(task, context) }];
  const fileSkill = detectFileSkill(task);

  let stream;
  if (fileSkill || mcps.length) {
    // Beta surface: Agent Skills (real .pptx/.xlsx/.docx/.pdf files generated
    // in Anthropic's code-execution container) and/or the MCP connector.
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
  // content is BetaContentBlock[] | ContentBlock[] depending on the branch —
  // extract text blocks through a common structural type.
  const text = (message.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');

  const attachments = fileSkill
    ? await collectGeneratedFiles(client, message.content as unknown[], task)
    : [];

  const notes = [
    mcps.length ? `MCP servers connected: ${mcps.map((m) => m.name).join(', ')}.` : '',
    attachments.length ? `Generated file${attachments.length > 1 ? 's' : ''}: ${attachments.map((a) => a.name).join(', ')} (attached to the card).` : '',
    fileSkill && !attachments.length ? `Expected a ${fileSkill} file but none was produced — see the text output.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    output: text || '(the agent returned no text output)',
    importantUpdate: `Executing with ${MODEL} — deliverable produced (${message.usage.output_tokens} output tokens). ${notes}`.trim(),
    simulated: false,
    attachments,
  };
}

function simulate(task: Task, context: string): ExecutionResult {
  const contextNote = context
    ? `\n> Context used: ${context.split('\n')[0].slice(0, 120)}…\n`
    : '';
  const output = [
    `## ${task.title} — deliverable`,
    contextNote,
    `*(Simulation mode — set \`ANTHROPIC_API_KEY\` to run this step with a real Claude model.)*`,
    ``,
    `### Approach`,
    `1. Parsed the task description and gathered workspace context (similar completed tasks, knowledge base).`,
    `2. Produced the deliverable below and self-reviewed it against the task description.`,
    ``,
    `### Result`,
    task.description
      ? `Based on the description — “${task.description.slice(0, 180)}” — the agent produced a complete first version of the requested work, structured and ready for human review.`
      : `The agent produced a complete first version of the requested work, ready for human review.`,
    ``,
    `- Scope covered end-to-end, no open TODOs`,
    `- One assumption flagged for review (see updates)`,
    `- Estimated human review time: ~5 minutes`,
  ].join('\n');

  return {
    output,
    importantUpdate:
      'Simulation mode: no ANTHROPIC_API_KEY configured — generated a representative deliverable to prove the flow.',
    simulated: true,
  };
}

export async function executeTask(task: Task, context: string): Promise<ExecutionResult> {
  if (!hasApiKey()) return simulate(task, context);

  const mcps = mcpConnectionsForTask(task);
  try {
    return await executeWithClaude(task, context, mcps);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the MCP-connected request failed (bad token, unreachable server…),
    // degrade gracefully: run the same task without MCP so work still ships.
    if (mcps.length) {
      try {
        const result = await executeWithClaude(task, context, []);
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

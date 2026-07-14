import Anthropic from '@anthropic-ai/sdk';
import { Task } from '../types';

export interface ExecutionResult {
  output: string;
  importantUpdate: string | null;
  simulated: boolean;
}

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = `You are an autonomous agent worker inside a Kanban project-management platform.
You pick up tasks tagged "agent-ready", execute them, and deliver real output.

Rules:
- Produce the actual deliverable for the task (a design, a draft, code, a plan, an analysis) — not a description of how you would do it.
- Output clean markdown. Lead with the deliverable itself.
- Be concise but complete: the output is attached to the task card and read by a human teammate.`;

async function executeWithClaude(task: Task, context: string): Promise<ExecutionResult> {
  const client = new Anthropic();

  const userContent = [
    `# Task\n**${task.title}**\n\n${task.description || '(no further description)'}`,
    task.tags.length ? `Tags: ${task.tags.join(', ')}` : '',
    context ? `# Context gathered from the workspace\n${context}` : '',
    `Deliver the final output for this task now.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const message = await stream.finalMessage();
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return {
    output: text || '(the agent returned no text output)',
    importantUpdate: `Executing with ${MODEL} — deliverable produced (${message.usage.output_tokens} output tokens).`,
    simulated: false,
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
  try {
    return await executeWithClaude(task, context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const fallback = simulate(task, context);
    return {
      ...fallback,
      importantUpdate: `Claude API call failed (${msg.slice(0, 140)}). Fell back to simulation mode so the flow completes.`,
    };
  }
}

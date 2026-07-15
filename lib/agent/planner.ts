import Anthropic from '@anthropic-ai/sdk';
import { Task, EpicPlanItem } from '../types';
import { MODEL, hasApiKey, subscriptionEnabled } from './claude';
import { subscriptionText } from './subscription';

/**
 * Epic planner: decompose a goal into a small task DAG the human approves,
 * and later digest the children's outputs into the epic's summary.
 * Subscription preferred ($0), API fallback, deterministic canned plan
 * offline (simulation / tests).
 */

const PLAN_SYSTEM = `You decompose a goal into 3-7 concrete subtasks for a Kanban board where AI agents execute 'agent' tasks and people execute 'human' tasks.
Reply with ONLY a JSON array of items:
[{"title": "...", "description": "...", "type": "agent"|"human", "definitionOfDone": "..."?, "askHuman": boolean?, "dependsOn": [indices of items that must complete first], "informs": [indices whose output this item builds on]?}]
Rules: order items roughly by execution; keep dependsOn minimal (only true blockers); use 'human' only for decisions/approvals/things requiring real-world access; give agent tasks a checkable definitionOfDone where possible.`;

function parsePlan(text: string): EpicPlanItem[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[0]) as Partial<EpicPlanItem>[];
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) return null;
    return raw.map((r, i) => ({
      title: String(r.title || `Subtask ${i + 1}`).slice(0, 200),
      description: String(r.description || ''),
      type: r.type === 'human' ? 'human' : 'agent',
      definitionOfDone: typeof r.definitionOfDone === 'string' && r.definitionOfDone ? r.definitionOfDone : undefined,
      askHuman: Boolean(r.askHuman),
      dependsOn: Array.isArray(r.dependsOn) ? r.dependsOn.filter((n) => Number.isInteger(n) && n >= 0 && n < i) : [],
      informs: Array.isArray(r.informs) ? r.informs.filter((n) => Number.isInteger(n) && n >= 0 && n < i) : [],
    }));
  } catch {
    return null;
  }
}

function cannedPlan(task: Task): EpicPlanItem[] {
  const t = task.title.slice(0, 60);
  return [
    { title: `Design the approach: ${t}`, description: 'Lay out the approach, scope and risks.', type: 'agent', dependsOn: [] },
    { title: `Implement: ${t}`, description: 'Execute based on the design.', type: 'agent', dependsOn: [0], informs: [0] },
    { title: `Review & sign off: ${t}`, description: 'Human review of the delivered work.', type: 'human', dependsOn: [1] },
  ];
}

export async function generateEpicPlan(task: Task, context: string): Promise<EpicPlanItem[]> {
  const USER = [
    `# Goal\n${task.title}\n\n${task.description || ''}`,
    context ? `# Workspace context\n${context.slice(0, 3000)}` : '',
    'Produce the plan now.',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    if (subscriptionEnabled()) {
      const res = await subscriptionText(PLAN_SYSTEM, USER);
      const plan = parsePlan(res.text);
      if (plan) return plan;
    } else if (hasApiKey()) {
      const client = new Anthropic();
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        system: PLAN_SYSTEM,
        messages: [{ role: 'user', content: USER }],
      });
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const plan = parsePlan(text);
      if (plan) return plan;
    }
  } catch {
    /* fall through to canned plan */
  }
  return cannedPlan(task);
}

export function renderPlanMarkdown(plan: EpicPlanItem[]): string {
  return [
    '## Proposed plan',
    ...plan.map(
      (p, i) =>
        `${i + 1}. **${p.title}** _(${p.type})_${p.dependsOn.length ? ` — after ${p.dependsOn.map((d) => d + 1).join(', ')}` : ''}\n   ${p.description}${p.definitionOfDone ? `\n   ✅ Done when: ${p.definitionOfDone}` : ''}`,
    ),
    '',
    '_Approve to create these tasks, or use “Re-run with instructions” to request a different plan._',
  ].join('\n');
}

export async function generateEpicDigest(task: Task, children: Task[]): Promise<string> {
  const done = children.filter((c) => c.status === 'completed');
  const fallback = [
    `## Epic completed — ${done.length}/${children.length} subtasks delivered`,
    ...done.map((c) => `- **${c.title}**${c.output ? `: ${c.output.slice(0, 160).replace(/\n/g, ' ')}…` : ''}`),
  ].join('\n');

  const SYSTEM =
    'Write a concise completion summary (markdown, ≤200 words) of an epic based on its subtask outputs: what was delivered overall, and one line per subtask.';
  const USER = children
    .map((c) => `## ${c.title} (${c.status})\n${(c.output || '').slice(0, 1200)}`)
    .join('\n\n')
    .slice(0, 9000);

  try {
    if (subscriptionEnabled()) {
      const res = await subscriptionText(SYSTEM, USER);
      if (res.text.trim()) return res.text.trim();
    } else if (hasApiKey()) {
      const client = new Anthropic();
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      });
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      if (text) return text;
    }
  } catch {
    /* fall back */
  }
  return fallback;
}

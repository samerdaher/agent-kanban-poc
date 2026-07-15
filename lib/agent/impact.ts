import Anthropic from '@anthropic-ai/sdk';
import { Task, TaskImpact } from '../types';
import { getTask, saveTask } from '../store';
import { MODEL, hasApiKey, subscriptionEnabled } from './claude';
import { subscriptionText } from './subscription';

/**
 * Development impact: what did this run touch? A deterministic heuristic pass
 * runs on every deliverable (regexes over the output — files, tables,
 * endpoints, migrations, links); when a model is available, a $0 enrichment
 * pass adds a human-readable summary afterwards.
 */

const uniq = (xs: string[], cap = 30) => [...new Set(xs)].slice(0, cap);

export function extractImpactHeuristic(task: Task, output: string): TaskImpact | null {
  const text = `${output}\n${task.attachments.map((a) => a.name).join('\n')}`;

  const files = uniq([
    ...[...text.matchAll(/(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]+\.(?:tsx?|m?jsx?|py|sql|css|md|json|ya?ml|sh|go|rs|java|php|rb))\b/g)].map(
      (m) => m[1],
    ),
    ...task.attachments.map((a) => a.name),
  ]);
  const tables = uniq(
    [...text.matchAll(/(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?[`"']?(\w+)/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  );
  const endpoints = uniq(
    [...text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/api[\w/:\[\]{}.-]*)/g)].map((m) => `${m[1]} ${m[2]}`),
  );
  const migrations = uniq(
    [...text.matchAll(/^.*\b(?:CREATE|ALTER)\s+TABLE\b.*$/gim)].map((m) => m[0].trim().slice(0, 100)),
    10,
  );
  const links = uniq([...text.matchAll(/https:\/\/github\.com\/[\w./#-]+/g)].map((m) => m[0]), 10);

  if (!files.length && !tables.length && !endpoints.length && !links.length) return null;
  return { summary: '', files, tables, endpoints, migrations, links, source: 'heuristic' };
}

/** Async, best-effort: add a one/two-sentence summary via a model ($0 on subscription). */
export async function enrichImpact(taskId: string): Promise<void> {
  try {
    const task = getTask(taskId);
    if (!task?.impact || task.impact.source === 'ai' || !task.output) return;

    const SYSTEM =
      'Summarize what was developed in 1–2 plain sentences for a change log (what was built/changed, which parts of the system). No preamble, no markdown.';
    const USER = `Deliverable (excerpt):\n${task.output.slice(0, 4000)}\n\nDetected: files ${task.impact.files.join(', ') || '—'}; tables ${task.impact.tables.join(', ') || '—'}; endpoints ${task.impact.endpoints.join(', ') || '—'}`;

    let summary = '';
    if (subscriptionEnabled()) {
      summary = (await subscriptionText(SYSTEM, USER)).text.trim();
    } else if (hasApiKey()) {
      const client = new Anthropic();
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 250,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      });
      summary = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim();
    }
    if (!summary) return;

    const fresh = getTask(taskId);
    if (!fresh?.impact) return;
    fresh.impact = { ...fresh.impact, summary: summary.slice(0, 400), source: 'ai' };
    saveTask(fresh);
  } catch {
    /* impact enrichment is best-effort */
  }
}

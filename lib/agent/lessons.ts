import Anthropic from '@anthropic-ai/sdk';
import { Task, LessonKind } from '../types';
import { addLesson, listLessons } from '../store';
import { MODEL, hasApiKey, subscriptionEnabled } from './claude';
import { subscriptionText } from './subscription';

/**
 * Workspace memory: when a run fails or a human requests changes, distill the
 * event into one generalizable lesson. Lessons are injected into every future
 * run's context, so the next run starts where the last one failed.
 * Best-effort and fire-and-forget — memory must never break the pipeline.
 */
export async function distillLesson(task: Task, kind: LessonKind, detail: string): Promise<void> {
  try {
    const clean = detail.trim();
    if (!clean) return;

    const SYSTEM =
      'You maintain the memory of an autonomous task agent. Given a failure or a human correction, distill ONE generalizable lesson the agent should apply to FUTURE tasks (not a restatement of this task). Imperative voice, ≤140 characters, no quotes. If nothing generalizable can be learned, respond with exactly: NONE';
    const USER = `Task: ${task.title}\n${task.description.slice(0, 300)}\n\nEvent (${kind}): ${clean.slice(0, 600)}`;

    let text: string;
    if (subscriptionEnabled()) {
      // distillation is cheap — run it on the subscription when available
      const res = await subscriptionText(SYSTEM, USER);
      text = res.text.trim();
      if (!text || text === 'NONE' || text.length < 8) return;
    } else if (hasApiKey()) {
      const client = new Anthropic();
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      });
      text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim();
      if (!text || text === 'NONE' || text.length < 8) return;
    } else {
      // no API key (tests / offline): store the raw signal so nothing is lost
      text = `${kind === 'correction' ? 'Human correction' : 'Failure'} on “${task.title.slice(0, 50)}”: ${clean.slice(0, 160)}`;
    }

    // avoid stacking duplicates
    const existing = listLessons(task.workspaceId);
    if (existing.some((l) => l.text.toLowerCase() === text.toLowerCase())) return;
    addLesson(task.workspaceId, text, kind, task.id);
  } catch {
    /* memory is best-effort */
  }
}

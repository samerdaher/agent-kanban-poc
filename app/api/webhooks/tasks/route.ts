import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceIdByWebhookToken, createTask, addUpdate } from '@/lib/store';
import { reconcileBlocked, triggerAgents } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

/**
 * Inbound automation: external systems create tasks directly.
 *   POST /api/webhooks/tasks
 *   Authorization: Bearer <workspace webhook token>
 *   { "title": "...", "description": "...", "type": "agent",
 *     "status": "sprint" | "backlog", "tags": [], "requirements": [],
 *     "definitionOfDone": "...", "askHuman": false }
 *
 * Examples: a Sentry alert opens an investigation task; a PR webhook opens a
 * review task; a nightly cron opens a report task. Defaults to Sprint so the
 * agent picks it up immediately.
 */
export async function POST(req: NextRequest) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : new URL(req.url).searchParams.get('token') || '';
  if (!token) return NextResponse.json({ error: 'Missing webhook token.' }, { status: 401 });
  const wid = getWorkspaceIdByWebhookToken(token);
  if (!wid) return NextResponse.json({ error: 'Invalid webhook token.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (!body.title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const task = createTask(
    wid,
    {
      title: String(body.title).slice(0, 300),
      description: String(body.description || ''),
      type: body.type === 'human' ? 'human' : 'agent',
      status: body.status === 'backlog' ? 'backlog' : 'sprint',
      priority: ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium',
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      requirements: Array.isArray(body.requirements) ? body.requirements.map(String) : [],
      dependencies: [],
      askHuman: Boolean(body.askHuman),
      definitionOfDone: typeof body.definitionOfDone === 'string' && body.definitionOfDone ? body.definitionOfDone : null,
    },
    null,
  );
  addUpdate(task, 'status', 'Created via inbound webhook.', 'webhook');
  reconcileBlocked(wid);
  triggerAgents(wid);
  return NextResponse.json({ task: { id: task.id, status: task.status } }, { status: 201 });
}

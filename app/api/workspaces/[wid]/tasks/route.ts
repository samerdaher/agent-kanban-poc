import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listTasks, listResources, createTask, addUpdate } from '@/lib/store';
import { triggerAgents, reconcileBlocked } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ tasks: listTasks(wid), resources: listResources(wid) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  if (!body.title || !body.type) {
    return NextResponse.json({ error: 'title and type are required' }, { status: 400 });
  }
  const task = createTask(
    wid,
    {
      title: String(body.title),
      description: String(body.description || ''),
      type: body.type === 'human' ? 'human' : 'agent',
      status: body.status === 'sprint' ? 'sprint' : 'backlog',
      priority: ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium',
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      requirements: Array.isArray(body.requirements) ? body.requirements.map(String) : [],
      dependencies: Array.isArray(body.dependencies) ? body.dependencies.map(String) : [],
      askHuman: Boolean(body.askHuman),
      definitionOfDone:
        typeof body.definitionOfDone === 'string' && body.definitionOfDone.trim()
          ? body.definitionOfDone.trim()
          : null,
    },
    auth.user.id,
  );
  addUpdate(task, 'status', `Created by ${auth.user.name}.`, auth.user.name);
  reconcileBlocked(wid);
  triggerAgents(wid);
  return NextResponse.json({ task }, { status: 201 });
}

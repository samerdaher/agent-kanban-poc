import { NextRequest, NextResponse } from 'next/server';
import { getDb, createTask } from '@/lib/store';
import { triggerAgents, reconcileBlocked } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  return NextResponse.json({ tasks: db.tasks, resources: db.resources });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.title || !body.type) {
    return NextResponse.json({ error: 'title and type are required' }, { status: 400 });
  }
  const task = createTask({
    title: String(body.title),
    description: String(body.description || ''),
    type: body.type === 'human' ? 'human' : 'agent',
    status: body.status === 'sprint' ? 'sprint' : 'backlog',
    priority: ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium',
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    requirements: Array.isArray(body.requirements) ? body.requirements.map(String) : [],
    dependencies: Array.isArray(body.dependencies) ? body.dependencies.map(String) : [],
    askHuman: Boolean(body.askHuman),
  });
  reconcileBlocked();
  triggerAgents();
  return NextResponse.json({ task }, { status: 201 });
}

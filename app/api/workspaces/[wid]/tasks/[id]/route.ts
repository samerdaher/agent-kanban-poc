import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { getTask, saveTask, addUpdate, deleteTask } from '@/lib/store';
import { triggerAgents, reconcileBlocked } from '@/lib/agent/runner';
import { TaskStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HUMAN_MOVABLE: TaskStatus[] = ['backlog', 'sprint', 'completed', 'archived'];
const AGENT_WORKING: TaskStatus[] = ['building_context', 'executing'];

type Params = { params: Promise<{ wid: string; id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { wid, id } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  const task = getTask(id);
  if (!task || task.workspaceId !== wid) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ task });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { wid, id } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  const task = getTask(id);
  if (!task || task.workspaceId !== wid) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  if (typeof body.status === 'string') {
    const target = body.status as TaskStatus;
    if (!HUMAN_MOVABLE.includes(target)) {
      return NextResponse.json(
        { error: 'Humans can only move tasks to backlog, sprint or completed — the agent drives the rest.' },
        { status: 400 },
      );
    }
    if (AGENT_WORKING.includes(task.status)) {
      return NextResponse.json({ error: 'Task is currently being worked by the agent.' }, { status: 409 });
    }
    if (target !== task.status) {
      task.status = target;
      task.blocked = null;
      if (target === 'completed') {
        task.completedAt = new Date().toISOString();
        saveTask(task);
        addUpdate(task, 'status', `Marked completed by ${auth.user.name}.`, auth.user.name);
      } else if (target === 'archived') {
        saveTask(task);
        addUpdate(task, 'status', `Archived by ${auth.user.name}.`, auth.user.name);
      } else if (target === 'sprint') {
        saveTask(task);
        addUpdate(
          task,
          'status',
          task.type === 'agent' ? 'Moved to Sprint — agent-ready trigger fired.' : 'Moved to Sprint.',
          auth.user.name,
        );
      } else {
        saveTask(task);
        addUpdate(task, 'status', 'Moved back to Backlog.', auth.user.name);
      }
    }
  }

  let fieldsChanged = false;
  for (const field of ['title', 'description'] as const) {
    if (typeof body[field] === 'string') {
      task[field] = body[field];
      fieldsChanged = true;
    }
  }
  if (['low', 'medium', 'high'].includes(body.priority)) {
    task.priority = body.priority;
    fieldsChanged = true;
  }
  if (Array.isArray(body.requirements)) {
    task.requirements = body.requirements.map(String);
    fieldsChanged = true;
  }
  if (Array.isArray(body.dependencies)) {
    task.dependencies = body.dependencies.map(String);
    fieldsChanged = true;
  }
  if (fieldsChanged) saveTask(task);

  reconcileBlocked(wid);
  triggerAgents(wid);
  return NextResponse.json({ task: getTask(id) });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { wid, id } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  const task = getTask(id);
  if (!task || task.workspaceId !== wid) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (AGENT_WORKING.includes(task.status)) {
    return NextResponse.json({ error: 'Task is currently being worked by the agent.' }, { status: 409 });
  }
  deleteTask(id);
  return NextResponse.json({ ok: true });
}

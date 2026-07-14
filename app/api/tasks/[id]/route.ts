import { NextRequest, NextResponse } from 'next/server';
import { getTask, addUpdate, saveDb, getDb } from '@/lib/store';
import { triggerAgents, reconcileBlocked } from '@/lib/agent/runner';
import { TaskStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HUMAN_MOVABLE: TaskStatus[] = ['backlog', 'sprint', 'completed'];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ task });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json();

  if (typeof body.status === 'string') {
    const target = body.status as TaskStatus;
    if (!HUMAN_MOVABLE.includes(target)) {
      return NextResponse.json(
        { error: 'Humans can only move tasks to backlog, sprint or completed — the agent drives the rest.' },
        { status: 400 },
      );
    }
    if (['building_context', 'executing'].includes(task.status)) {
      return NextResponse.json({ error: 'Task is currently being worked by the agent.' }, { status: 409 });
    }
    if (target !== task.status) {
      task.status = target;
      task.blocked = null;
      if (target === 'completed') {
        task.completedAt = new Date().toISOString();
        addUpdate(task, 'status', 'Marked completed by a human.');
      } else if (target === 'sprint') {
        addUpdate(task, 'status', task.type === 'agent' ? 'Moved to Sprint — agent-ready trigger fired.' : 'Moved to Sprint.');
      } else {
        addUpdate(task, 'status', 'Moved back to Backlog.');
      }
    }
  }

  for (const field of ['title', 'description'] as const) {
    if (typeof body[field] === 'string') task[field] = body[field];
  }
  if (Array.isArray(body.requirements)) task.requirements = body.requirements.map(String);
  if (Array.isArray(body.dependencies)) task.dependencies = body.dependencies.map(String);

  task.updatedAt = new Date().toISOString();
  saveDb();
  reconcileBlocked();
  triggerAgents();
  return NextResponse.json({ task });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const idx = db.tasks.findIndex((t) => t.id === id);
  if (idx === -1) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (['building_context', 'executing'].includes(db.tasks[idx].status)) {
    return NextResponse.json({ error: 'Task is currently being worked by the agent.' }, { status: 409 });
  }
  db.tasks.splice(idx, 1);
  saveDb();
  return NextResponse.json({ ok: true });
}

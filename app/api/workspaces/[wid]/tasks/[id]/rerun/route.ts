import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { getTask } from '@/lib/store';
import { rerunTask } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

/** Re-execute a finished agent task with new instructions (builds on prior output). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const auth = requireMember(req, wid, 'member');
  if (auth instanceof NextResponse) return auth;

  const task = getTask(id);
  if (!task || task.workspaceId !== wid) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (task.type !== 'agent') {
    return NextResponse.json({ error: 'Only agent tasks can be re-executed.' }, { status: 400 });
  }
  if (['building_context', 'executing'].includes(task.status)) {
    return NextResponse.json({ error: 'Task is currently being worked by the agent.' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
  if (!instructions) {
    return NextResponse.json({ error: 'instructions are required — say what should change.' }, { status: 400 });
  }

  return NextResponse.json({ task: rerunTask(id, instructions, auth.user.name) });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { getTask } from '@/lib/store';
import { approvePlan } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

/** Approve an epic's proposed plan → creates the subtasks with their edges. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;

  const task = getTask(id);
  if (!task || task.workspaceId !== wid) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (task.type !== 'epic' || !task.plan) {
    return NextResponse.json({ error: 'This task has no plan to approve.' }, { status: 400 });
  }
  if (task.dependencies.length) {
    return NextResponse.json({ error: 'The plan was already approved.' }, { status: 409 });
  }
  return NextResponse.json({ task: approvePlan(id, auth.user.name) });
}

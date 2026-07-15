import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { getTask } from '@/lib/store';
import { answerQuestion } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const auth = requireMember(req, wid, 'member');
  if (auth instanceof NextResponse) return auth;
  const existing = getTask(id);
  if (!existing || existing.workspaceId !== wid) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const action = body.action === 'revise' ? 'revise' : 'approve';
  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  if (action === 'revise' && !answer) {
    return NextResponse.json({ error: 'Describe the changes you want when requesting a revision.' }, { status: 400 });
  }
  const task = answerQuestion(id, answer, auth.user.name, action);
  return NextResponse.json({ task });
}

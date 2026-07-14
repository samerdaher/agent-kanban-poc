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
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  const existing = getTask(id);
  if (!existing || existing.workspaceId !== wid) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body.answer || typeof body.answer !== 'string') {
    return NextResponse.json({ error: 'answer is required' }, { status: 400 });
  }
  const task = answerQuestion(id, body.answer, auth.user.name);
  return NextResponse.json({ task });
}

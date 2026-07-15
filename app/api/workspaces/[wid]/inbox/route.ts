import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listTasks } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * "Waiting on you": tasks blocked on the current user's input —
 * review questions routed to them (or unrouted ones), plus their assigned
 * human tasks that are still open.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  const me = auth.user.id;

  const items = listTasks(wid)
    .filter((t) => {
      const needsMyReview =
        t.status === 'blocked' &&
        t.blocked?.kind === 'human_question' &&
        (t.reviewerUserId === me || !t.reviewerUserId);
      const myHumanTask =
        t.type === 'human' && t.assigneeUserId === me && ['backlog', 'sprint'].includes(t.status);
      return needsMyReview || myHumanTask;
    })
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      kind: t.pendingQuestion ? 'review' : 'assigned',
      pendingQuestion: t.pendingQuestion,
      updatedAt: t.updatedAt,
    }));

  return NextResponse.json({ items });
}

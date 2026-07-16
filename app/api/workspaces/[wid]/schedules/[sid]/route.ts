import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { deleteSchedule, logAudit } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; sid: string }> },
) {
  const { wid, sid } = await params;
  const auth = requireMember(req, wid, 'admin');
  if (auth instanceof NextResponse) return auth;
  if (!deleteSchedule(wid, sid)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  logAudit(wid, auth.user, 'schedule.deleted', sid, '');
  return NextResponse.json({ ok: true });
}

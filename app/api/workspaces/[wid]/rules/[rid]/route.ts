import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { deleteRule, logAudit } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; rid: string }> },
) {
  const { wid, rid } = await params;
  const auth = requireMember(req, wid, 'admin');
  if (auth instanceof NextResponse) return auth;
  if (!deleteRule(wid, rid)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  logAudit(wid, auth.user, 'rule.deleted', rid, '');
  return NextResponse.json({ ok: true });
}

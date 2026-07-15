import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { setMemberRole, getUserById, logAudit } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Change a member's role (admin+; the owner's role is fixed). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; uid: string }> },
) {
  const { wid, uid } = await params;
  const auth = requireMember(req, wid, 'admin');
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  if (!['admin', 'member', 'viewer'].includes(body.role)) {
    return NextResponse.json({ error: 'role must be admin, member or viewer' }, { status: 400 });
  }
  if (!setMemberRole(wid, uid, body.role)) {
    return NextResponse.json({ error: 'Could not change this role (not a member, or the owner).' }, { status: 400 });
  }
  logAudit(wid, auth.user, 'member.role_changed', getUserById(uid)?.email || uid, `→ ${body.role}`);
  return NextResponse.json({ ok: true });
}

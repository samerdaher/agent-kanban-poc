import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { deleteTemplate } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; tid: string }> },
) {
  const { wid, tid } = await params;
  const auth = requireMember(req, wid, 'member');
  if (auth instanceof NextResponse) return auth;
  if (!deleteTemplate(wid, tid)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

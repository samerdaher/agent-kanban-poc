import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { deleteResource } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; rid: string }> },
) {
  const { wid, rid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  if (!deleteResource(wid, rid)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { deleteLesson } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; lid: string }> },
) {
  const { wid, lid } = await params;
  const auth = requireMember(req, wid, 'member');
  if (auth instanceof NextResponse) return auth;
  if (!deleteLesson(wid, lid)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

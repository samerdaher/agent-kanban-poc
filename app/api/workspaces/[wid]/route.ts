import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { getWorkspaceMeta, listMembers } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  const workspace = getWorkspaceMeta(wid);
  if (!workspace) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ workspace, members: listMembers(wid), role: auth.role });
}

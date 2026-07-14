import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { workspaceStats } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ stats: workspaceStats(wid) });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listAudit } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid, 'admin');
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ entries: listAudit(wid) });
}

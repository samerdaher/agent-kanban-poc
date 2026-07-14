import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { listWorkspaces } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireUser(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ user: auth.user, workspaces: listWorkspaces(auth.user.id) });
}

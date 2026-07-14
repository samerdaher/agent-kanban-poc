import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createWorkspace, listWorkspaces } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireUser(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ workspaces: listWorkspaces(auth.user.id) });
}

export async function POST(req: NextRequest) {
  const auth = requireUser(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Workspace name is required.' }, { status: 400 });
  const workspace = createWorkspace(name, auth.user.id, { seed: Boolean(body.demo) });
  return NextResponse.json({ workspace }, { status: 201 });
}

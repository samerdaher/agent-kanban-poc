import { NextRequest, NextResponse } from 'next/server';
import { authenticate, listWorkspaces } from '@/lib/store';
import { createSession, sessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const user = authenticate(String(body.email || ''), String(body.password || ''));
  if (!user) return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  const { token } = createSession(user.id);
  const res = NextResponse.json({ user, workspaces: listWorkspaces(user.id) });
  res.cookies.set(sessionCookie(token));
  return res;
}

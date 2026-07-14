import { NextRequest, NextResponse } from 'next/server';
import {
  createUser,
  createWorkspace,
  countUsers,
  importLegacyJson,
  seedWorkspace,
  listWorkspaces,
} from '@/lib/store';
import { createSession, sessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const name = String(body.name || '').trim();
  const password = String(body.password || '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const isFirstUser = countUsers() === 0;
  let user;
  try {
    user = createUser(email, name, password);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Signup failed.' }, { status: 409 });
  }

  // First user inherits the POC's data/db.json board if one exists; otherwise
  // every new account starts with a demo board showing the agent flows.
  const ws = createWorkspace(`${name.split(' ')[0]}'s Workspace`, user.id);
  const importedLegacy = isFirstUser && importLegacyJson(ws.id, user.id);
  if (!importedLegacy) seedWorkspace(ws.id, user.id);

  const { token } = createSession(user.id);
  const res = NextResponse.json({ user, workspaces: listWorkspaces(user.id) }, { status: 201 });
  res.cookies.set(sessionCookie(token));
  return res;
}

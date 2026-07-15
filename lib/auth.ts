import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db, now } from './db';
import { sha256Hex, randomToken } from './crypto';
import { getUserById, getWorkspaceRole } from './store';
import { User, MemberRole } from './types';

/**
 * Session auth: 32-byte random bearer tokens in an httpOnly cookie; only the
 * SHA-256 of the token is stored server-side. 30-day expiry.
 */

export const SESSION_COOKIE = 'ab_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db()
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sha256Hex(token), userId, expiresAt, now());
  return { token, expiresAt };
}

export function destroySession(token: string) {
  db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256Hex(token));
}

export function pruneSessions() {
  db().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

export function getUserByToken(token: string | undefined | null): User | null {
  if (!token) return null;
  const row = db()
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(sha256Hex(token)) as { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (row.expires_at < now()) {
    db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256Hex(token));
    return null;
  }
  return getUserById(row.user_id);
}

/** Session cookie attributes, shared by login/signup/logout responses. */
export function sessionCookie(token: string, maxAgeSeconds = SESSION_TTL_MS / 1000) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production' && process.env.AGENTBOARD_INSECURE_COOKIE !== '1',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** For server components/pages. */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  return getUserByToken(jar.get(SESSION_COOKIE)?.value);
}

/** For route handlers: authenticated user or a 401 response. */
export function requireUser(req: NextRequest): { user: User } | NextResponse {
  const user = getUserByToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  return { user };
}

const ROLE_RANK: Record<MemberRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/**
 * For workspace-scoped route handlers: membership check on top of auth.
 * `minRole` gates writes: viewers are read-only; admins govern the workspace.
 */
export function requireMember(
  req: NextRequest,
  workspaceId: string,
  minRole: MemberRole = 'viewer',
): { user: User; role: MemberRole } | NextResponse {
  const auth = requireUser(req);
  if (auth instanceof NextResponse) return auth;
  const role = getWorkspaceRole(workspaceId, auth.user.id);
  if (!role) return NextResponse.json({ error: 'Not a member of this workspace.' }, { status: 403 });
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    return NextResponse.json(
      { error: `This needs the ${minRole} role — you are a ${role} here.` },
      { status: 403 },
    );
  }
  return { user: auth.user, role };
}

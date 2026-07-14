import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listMembers, addMemberByEmail } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ members: listMembers(wid) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });
  try {
    const member = addMemberByEmail(wid, email);
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not add member.' },
      { status: 400 },
    );
  }
}

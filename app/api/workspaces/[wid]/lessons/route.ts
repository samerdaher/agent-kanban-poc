import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listLessons, addLesson } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ lessons: listLessons(wid) });
}

/** Humans can teach the workspace directly ("insight" lessons). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid, 'member');
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || '').trim();
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 });
  const lesson = addLesson(wid, text, 'insight', null);
  return NextResponse.json({ lesson }, { status: 201 });
}

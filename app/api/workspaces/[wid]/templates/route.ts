import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listTemplates, addTemplate } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ templates: listTemplates(wid) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid, 'member');
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const template = addTemplate(wid, name, body.payload && typeof body.payload === 'object' ? body.payload : body, auth.user.id);
  return NextResponse.json({ template }, { status: 201 });
}

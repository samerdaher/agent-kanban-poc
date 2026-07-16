import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listRules, addRule, getTemplate, logAudit } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ rules: listRules(wid) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid, 'admin');
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const triggerTag = String(body.triggerTag || '').trim().toLowerCase();
  if (!triggerTag) return NextResponse.json({ error: 'triggerTag is required' }, { status: 400 });
  if (!getTemplate(wid, String(body.templateId || ''))) {
    return NextResponse.json({ error: 'templateId must reference a template in this workspace' }, { status: 400 });
  }
  const rule = addRule(wid, triggerTag, String(body.templateId));
  logAudit(wid, auth.user, 'rule.created', triggerTag, `template ${body.templateId}`);
  return NextResponse.json({ rule }, { status: 201 });
}

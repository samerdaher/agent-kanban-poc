import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listSchedules, addSchedule, getTemplate, logAudit } from '@/lib/store';
import { isValidCron } from '@/lib/cron';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ schedules: listSchedules(wid) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid, 'admin');
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const cron = String(body.cron || '').trim();
  if (!isValidCron(cron)) {
    return NextResponse.json(
      { error: 'cron must be 5 fields (minute hour day month weekday), e.g. "0 9 * * 1" = Mondays 09:00 UTC' },
      { status: 400 },
    );
  }
  if (!getTemplate(wid, String(body.templateId || ''))) {
    return NextResponse.json({ error: 'templateId must reference a template in this workspace' }, { status: 400 });
  }
  const schedule = addSchedule(wid, cron, String(body.templateId));
  logAudit(wid, auth.user, 'schedule.created', cron, `template ${body.templateId}`);
  return NextResponse.json({ schedule }, { status: 201 });
}

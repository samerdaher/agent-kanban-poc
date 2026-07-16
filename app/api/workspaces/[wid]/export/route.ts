import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import {
  getWorkspaceMeta,
  listMembers,
  listTasks,
  listLessons,
  listResources,
  listTemplates,
  listSchedules,
  listRules,
  listAudit,
  logAudit,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Full workspace export (admin+). Secrets are never included. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid, 'admin');
  if (auth instanceof NextResponse) return auth;

  const meta = getWorkspaceMeta(wid);
  const payload = {
    exportedAt: new Date().toISOString(),
    workspace: meta
      ? { id: meta.id, name: meta.name, createdAt: meta.createdAt, monthlyBudgetUsd: meta.monthlyBudgetUsd }
      : null,
    members: listMembers(wid),
    tasks: listTasks(wid),
    lessons: listLessons(wid),
    resources: listResources(wid), // hasSecret flags only — never secret values
    templates: listTemplates(wid),
    schedules: listSchedules(wid),
    rules: listRules(wid),
    audit: listAudit(wid, 500),
  };
  logAudit(wid, auth.user, 'workspace.exported', '', '');
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="agentboard-${wid}.json"`,
    },
  });
}

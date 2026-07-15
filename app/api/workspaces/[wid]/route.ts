import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { getWorkspaceMeta, listMembers, setWorkspaceSettings, logAudit } from '@/lib/store';
import { reconcileBlocked, triggerAgents } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  const workspace = getWorkspaceMeta(wid);
  if (!workspace) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ workspace, members: listMembers(wid), role: auth.role });
}

/** Workspace governance settings (admin+): monthly budget, runner pause. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid, 'admin');
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));

  if ('monthlyBudgetUsd' in body) {
    const v = body.monthlyBudgetUsd;
    if (v !== null && (typeof v !== 'number' || v < 0)) {
      return NextResponse.json({ error: 'monthlyBudgetUsd must be a non-negative number or null' }, { status: 400 });
    }
    setWorkspaceSettings(wid, { monthlyBudgetUsd: v });
    logAudit(wid, auth.user, 'budget.changed', '', v === null ? 'removed' : `$${v}/month`);
  }
  if ('runnerPaused' in body) {
    setWorkspaceSettings(wid, { runnerPaused: Boolean(body.runnerPaused) });
    logAudit(wid, auth.user, body.runnerPaused ? 'runner.paused' : 'runner.resumed', '', '');
    if (!body.runnerPaused) {
      reconcileBlocked(wid);
      triggerAgents(wid);
    }
  }
  return NextResponse.json({ workspace: getWorkspaceMeta(wid) });
}

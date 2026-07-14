import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceIdByWebhookToken } from '@/lib/store';
import { reconcileBlocked, triggerAgents } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

/**
 * External trigger endpoint ("one trigger"): POST here from any system (CI,
 * cron, another tool) to make the agent re-scan the workspace's Sprint column.
 * Authenticated with the per-workspace webhook token:
 *   Authorization: Bearer <token>   (or ?token=<token>)
 * Find the token in the workspace's Members & Webhook panel.
 */
export async function POST(req: NextRequest) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : new URL(req.url).searchParams.get('token') || '';
  if (!token) return NextResponse.json({ error: 'Missing webhook token.' }, { status: 401 });
  const wid = getWorkspaceIdByWebhookToken(token);
  if (!wid) return NextResponse.json({ error: 'Invalid webhook token.' }, { status: 403 });
  reconcileBlocked(wid);
  triggerAgents(wid);
  return NextResponse.json({ ok: true, triggered: true, workspaceId: wid });
}

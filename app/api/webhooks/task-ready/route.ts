import { NextResponse } from 'next/server';
import { reconcileBlocked, triggerAgents } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

/**
 * External trigger endpoint ("one trigger"): POST here from any system
 * (a CI job, another tool, a cron) to make the agent re-scan the Sprint
 * column and pick up agent-ready tasks.
 */
export async function POST() {
  reconcileBlocked();
  triggerAgents();
  return NextResponse.json({ ok: true, triggered: true });
}

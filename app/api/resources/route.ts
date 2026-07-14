import { NextRequest, NextResponse } from 'next/server';
import { getDb, addResource } from '@/lib/store';
import { reconcileBlocked, triggerAgents } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ resources: getDb().resources });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const resource = addResource(String(body.name), body.kind === 'credential' ? 'credential' : 'mcp');
  // Adding an MCP/credential can unblock tasks waiting on it.
  reconcileBlocked();
  triggerAgents();
  return NextResponse.json({ resource }, { status: 201 });
}

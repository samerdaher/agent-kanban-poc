import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listResources, addResource } from '@/lib/store';
import { reconcileBlocked, triggerAgents } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ resources: listResources(wid) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  try {
    const resource = addResource(
      wid,
      {
        name: String(body.name),
        kind: body.kind === 'credential' ? 'credential' : 'mcp',
        url: typeof body.url === 'string' && body.url ? body.url : undefined,
        secret: typeof body.secret === 'string' && body.secret ? body.secret : undefined,
      },
      auth.user.id,
    );
    // Adding an MCP/credential can unblock tasks waiting on it.
    reconcileBlocked(wid);
    triggerAgents(wid);
    return NextResponse.json({ resource }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not add resource.' },
      { status: 400 },
    );
  }
}

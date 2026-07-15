import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { listTasks } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Development rollup: what was built, which files/tables/endpoints were touched. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;

  const since = new URL(req.url).searchParams.get('since') || '';
  const tasks = listTasks(wid)
    .filter((t) => t.impact && ['completed', 'archived'].includes(t.status))
    .filter((t) => !since || (t.completedAt || t.updatedAt) >= since)
    .map((t) => ({
      id: t.id,
      title: t.title,
      completedAt: t.completedAt,
      impact: t.impact,
    }));

  const totals = {
    tasks: tasks.length,
    files: new Set(tasks.flatMap((t) => t.impact!.files)).size,
    tables: new Set(tasks.flatMap((t) => t.impact!.tables)).size,
    endpoints: new Set(tasks.flatMap((t) => t.impact!.endpoints)).size,
  };
  return NextResponse.json({ tasks, totals });
}

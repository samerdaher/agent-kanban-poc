import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { requireMember } from '@/lib/auth';
import { getTask } from '@/lib/store';
import { DATA_DIR } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; name: string }> },
) {
  const { wid, id, name } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;

  const task = getTask(id);
  if (!task || task.workspaceId !== wid) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // only serve files recorded on the task, by their exact recorded name
  const decoded = decodeURIComponent(name);
  const safe = path.basename(decoded);
  if (!task.attachments.some((a) => a.name === safe)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const filePath = path.resolve(DATA_DIR, 'files', task.id, safe);
  if (!filePath.startsWith(path.resolve(DATA_DIR, 'files', task.id) + path.sep) || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const buf = fs.readFileSync(filePath);
  const ext = path.extname(safe).toLowerCase();
  return new NextResponse(buf, {
    headers: {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safe.replace(/"/g, '')}"`,
      'Content-Length': String(buf.length),
      'Cache-Control': 'private, no-cache',
    },
  });
}

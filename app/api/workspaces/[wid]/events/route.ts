import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { subscribe } from '@/lib/events';

export const dynamic = 'force-dynamic';

/**
 * Server-Sent Events stream. Clients hold this open and refetch board state
 * whenever a "changed" event arrives — no polling.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const auth = requireMember(req, wid);
  if (auth instanceof NextResponse) return auth;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const unsubscribe = subscribe(wid, () => send('data: {"type":"changed"}\n\n'));
      const heartbeat = setInterval(() => send(': heartbeat\n\n'), 25000);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', close);
      send('retry: 3000\n\ndata: {"type":"connected"}\n\n');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

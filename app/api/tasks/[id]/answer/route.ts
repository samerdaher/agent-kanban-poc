import { NextRequest, NextResponse } from 'next/server';
import { answerQuestion } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (!body.answer || typeof body.answer !== 'string') {
    return NextResponse.json({ error: 'answer is required' }, { status: 400 });
  }
  const task = answerQuestion(id, body.answer);
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ task });
}

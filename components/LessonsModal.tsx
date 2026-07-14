'use client';

import { useEffect, useState } from 'react';
import { Lesson } from '@/lib/types';

const KIND_LABEL: Record<Lesson['kind'], string> = {
  correction: '✍️ correction',
  failure: '💥 failure',
  insight: '💡 insight',
};

/**
 * Workspace memory: lessons distilled from failures and human corrections,
 * injected into every future agent run. Humans can add and prune them here.
 */
export default function LessonsModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/workspaces/${workspaceId}/lessons`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    setLessons(data.lessons || []);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    await fetch(`/api/workspaces/${workspaceId}/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
    });
    setText('');
    setBusy(false);
    load();
  }

  async function remove(l: Lesson) {
    await fetch(`/api/workspaces/${workspaceId}/lessons/${l.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>🧠 Workspace Memory</h3>
        <p className="desc" style={{ marginBottom: 14, fontSize: 13, color: 'var(--text-dim)' }}>
          Lessons distilled from failed runs and human corrections. Every future agent run receives the most
          relevant of these — this is how the workspace learns. Delete anything wrong; add your own.
        </p>

        <div className="res-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {lessons.map((l) => (
            <div className="res-item" key={l.id} style={{ alignItems: 'flex-start' }}>
              <span className={`kind ${l.kind === 'insight' ? 'mcp' : 'credential'}`}>{KIND_LABEL[l.kind]}</span>
              <span style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}>{l.text}</span>
              <button className="btn small danger" onClick={() => remove(l)}>
                ✕
              </button>
            </div>
          ))}
          {loaded && lessons.length === 0 && (
            <p className="desc">No lessons yet — they appear automatically when a run fails or you request changes on a deliverable.</p>
          )}
          {!loaded && <p className="desc">Loading…</p>}
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label>Teach the workspace</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='e.g. "Slides for execs: max 5 bullets, no jargon."'
              onKeyDown={(e) => e.key === 'Enter' && add()}
              style={{ flex: 1 }}
            />
            <button className="btn primary" disabled={busy || !text.trim()} onClick={add}>
              Add
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

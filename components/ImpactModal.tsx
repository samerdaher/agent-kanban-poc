'use client';

import { useEffect, useState } from 'react';
import { TaskImpact } from '@/lib/types';

interface ImpactRow {
  id: string;
  title: string;
  completedAt: string | null;
  impact: TaskImpact;
}

/** "What did we develop" — rollup of impact manifests across the workspace. */
export default function ImpactModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ImpactRow[]>([]);
  const [totals, setTotals] = useState<{ tasks: number; files: number; tables: number; endpoints: number } | null>(null);
  const [days, setDays] = useState(7);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    fetch(`/api/workspaces/${workspaceId}/impact?since=${encodeURIComponent(since)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setRows(d.tasks || []);
        setTotals(d.totals || null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [workspaceId, days]);

  return (
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className="modal" style={{ width: 'min(640px, 100%)' }}>
        <h3>🛠 Development summary</h3>
        <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ margin: 0 }}>Window</label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 140 }}>
            <option value={1}>last 24 hours</option>
            <option value={7}>last 7 days</option>
            <option value={30}>last 30 days</option>
            <option value={365}>last year</option>
          </select>
          {totals && (
            <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
              {totals.tasks} tasks · {totals.files} files · {totals.tables} tables · {totals.endpoints} endpoints
            </span>
          )}
        </div>

        <div className="res-list" style={{ maxHeight: 380, overflowY: 'auto' }}>
          {rows.map((r) => (
            <div className="res-item" key={r.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{r.title}</div>
              {r.impact.summary && (
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.45 }}>{r.impact.summary}</div>
              )}
              <div className="status-line">
                {r.impact.files.slice(0, 6).map((f) => (
                  <span key={f} className="chip tag">📄 {f}</span>
                ))}
                {r.impact.tables.map((t) => (
                  <span key={t} className="chip dep">🗄 {t}</span>
                ))}
                {r.impact.endpoints.slice(0, 4).map((e) => (
                  <span key={e} className="chip req">🔀 {e}</span>
                ))}
              </div>
            </div>
          ))}
          {loaded && rows.length === 0 && (
            <p className="desc">No development impact recorded in this window — impact appears when a deliverable touches files, tables, or endpoints.</p>
          )}
          {!loaded && <p className="desc">Loading…</p>}
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

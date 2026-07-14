'use client';

import { useState } from 'react';
import { Resource, ResourceKind } from '@/lib/types';

export default function ResourcesModal({
  resources,
  onClose,
  onChanged,
}: {
  resources: Resource[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ResourceKind>('mcp');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    await fetch('/api/resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), kind }),
    });
    setName('');
    setBusy(false);
    onChanged();
  }

  return (
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>🔌 Workspace Resources</h3>
        <p className="desc" style={{ marginBottom: 14, fontSize: 13, color: 'var(--text-dim)' }}>
          MCP servers and credentials the agent can use. Adding one automatically unblocks tasks waiting on it.
        </p>

        <div className="res-list">
          {resources.map((r) => (
            <div className="res-item" key={r.id}>
              <span className={`kind ${r.kind}`}>{r.kind}</span>
              <span className="name">{r.name}</span>
            </div>
          ))}
          {resources.length === 0 && <p className="desc">No resources yet.</p>}
        </div>

        <div className="field">
          <label>Add resource</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. accounting-api-key"
              onKeyDown={(e) => e.key === 'Enter' && add()}
              style={{ flex: 1 }}
            />
            <select value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)} style={{ width: 130 }}>
              <option value="mcp">MCP server</option>
              <option value="credential">Credential</option>
            </select>
            <button className="btn primary" disabled={busy || !name.trim()} onClick={add}>
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

'use client';

import { useState } from 'react';
import { Resource, ResourceKind } from '@/lib/types';
import { MCP_CATALOG } from '@/lib/mcpCatalog';

export default function ResourcesModal({
  workspaceId,
  resources,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  resources: Resource[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ResourceKind>('mcp');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [tokenHint, setTokenHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registered = new Set(resources.map((r) => r.name.toLowerCase()));
  const catalogLeft = MCP_CATALOG.filter((c) => !registered.has(c.name.toLowerCase()));

  function pickFromCatalog(catalogName: string) {
    const entry = MCP_CATALOG.find((c) => c.name === catalogName);
    if (!entry) return;
    setName(entry.name);
    setKind(entry.kind);
    setUrl(entry.url || '');
    setTokenHint(entry.tokenHint);
    setError(null);
  }

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspaceId}/resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        kind,
        url: url.trim() || undefined,
        secret: secret || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || 'Could not add resource.');
      return;
    }
    setName('');
    setUrl('');
    setSecret('');
    setTokenHint(null);
    onChanged();
  }

  async function remove(r: Resource) {
    if (!confirm(`Remove resource “${r.name}”? Tasks requiring it will block next time they run.`)) return;
    await fetch(`/api/workspaces/${workspaceId}/resources/${r.id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>🔌 Workspace Resources</h3>
        <p className="desc" style={{ marginBottom: 14, fontSize: 13, color: 'var(--text-dim)' }}>
          MCP servers and credentials the agent can use. An MCP resource with a URL becomes a{' '}
          <strong>live connection</strong>: tasks that require it get its tools during execution. Adding one
          automatically unblocks tasks waiting on it. Secrets are encrypted at rest and never shown again.
        </p>

        <div className="res-list">
          {resources.map((r) => (
            <div className="res-item" key={r.id}>
              <span className={`kind ${r.kind}`}>{r.kind}</span>
              <span className="name">{r.name}</span>
              {r.url && (
                <span className="chip tag" title={r.url}>
                  🔗 live
                </span>
              )}
              {r.hasSecret && (
                <span className="chip req" title="Encrypted secret stored in the vault">
                  🔒 vaulted
                </span>
              )}
              <button className="btn small danger" style={{ marginLeft: 'auto' }} onClick={() => remove(r)}>
                ✕
              </button>
            </div>
          ))}
          {resources.length === 0 && <p className="desc">No resources yet.</p>}
        </div>

        {catalogLeft.length > 0 && (
          <div className="field">
            <label>Add from catalog</label>
            <select value="" onChange={(e) => pickFromCatalog(e.target.value)}>
              <option value="" disabled>
                Pick a known integration…
              </option>
              {catalogLeft.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} — {c.description}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label>Name & kind</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. github-mcp or accounting-api-key"
              style={{ flex: 1 }}
            />
            <select value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)} style={{ width: 130 }}>
              <option value="mcp">MCP server</option>
              <option value="credential">Credential</option>
            </select>
          </div>
        </div>

        {kind === 'mcp' && (
          <div className="field">
            <label>MCP server URL (makes it a live connection)</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/mcp — leave empty for a registry-only entry"
            />
          </div>
        )}

        <div className="field">
          <label>Secret / token (optional — stored encrypted)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              className="pw"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Bearer token / API key / webhook URL"
              onKeyDown={(e) => e.key === 'Enter' && add()}
              style={{ flex: 1 }}
            />
            <button className="btn primary" disabled={busy || !name.trim()} onClick={add}>
              Add
            </button>
          </div>
          {tokenHint && <div className="help">💡 {tokenHint}</div>}
          {error && (
            <div className="help" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          )}
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

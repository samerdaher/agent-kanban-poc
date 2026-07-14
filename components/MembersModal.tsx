'use client';

import { useEffect, useState } from 'react';
import { Member } from '@/lib/types';

export default function MembersModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    const res = await fetch(`/api/workspaces/${workspaceId}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    setMembers(data.members || []);
    setWebhookToken(data.workspace?.webhookToken || null);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || 'Could not add member.');
      return;
    }
    setEmail('');
    load();
  }

  const webhookCurl = webhookToken
    ? `curl -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/task-ready -H "Authorization: Bearer ${webhookToken}"`
    : '';

  return (
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>👥 Members & Webhook</h3>

        <div className="res-list">
          {members.map((m) => (
            <div className="res-item" key={m.userId}>
              <span className={`kind ${m.role === 'owner' ? 'credential' : 'mcp'}`}>{m.role}</span>
              <span className="name">{m.name}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: 12, marginLeft: 'auto' }}>{m.email}</span>
            </div>
          ))}
          {members.length === 0 && <p className="desc">Loading…</p>}
        </div>

        <div className="field">
          <label>Add member by email</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com (they must have an account)"
              onKeyDown={(e) => e.key === 'Enter' && invite()}
              style={{ flex: 1 }}
            />
            <button className="btn primary" disabled={busy || !email.trim()} onClick={invite}>
              Add
            </button>
          </div>
          {error && (
            <div className="help" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          )}
        </div>

        {webhookToken && (
          <div className="field">
            <label>External trigger webhook</label>
            <div className="help" style={{ marginBottom: 6 }}>
              Any outside system (CI, cron, another tool) can fire the agent scan for this workspace:
            </div>
            <div className="webhook-box">{webhookCurl}</div>
            <button
              className="btn small"
              style={{ marginTop: 6 }}
              onClick={() => {
                navigator.clipboard?.writeText(webhookCurl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? '✓ Copied' : 'Copy curl command'}
            </button>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

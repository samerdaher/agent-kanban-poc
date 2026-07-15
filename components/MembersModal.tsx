'use client';

import { useEffect, useState } from 'react';
import { Member, AuditEntry } from '@/lib/types';

export default function MembersModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState<string>('member');
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [budget, setBudget] = useState<string>('');
  const [paused, setPaused] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const isAdmin = myRole === 'admin' || myRole === 'owner';

  async function load() {
    const res = await fetch(`/api/workspaces/${workspaceId}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    setMembers(data.members || []);
    setMyRole(data.role || 'member');
    setWebhookToken(data.workspace?.webhookToken || null);
    setBudget(data.workspace?.monthlyBudgetUsd == null ? '' : String(data.workspace.monthlyBudgetUsd));
    setPaused(Boolean(data.workspace?.runnerPaused));
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
      body: JSON.stringify({ email: email.trim(), role: inviteRole }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || 'Could not add member.');
    setEmail('');
    load();
  }

  async function changeRole(userId: string, role: string) {
    const res = await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Could not change role.');
    }
    load();
  }

  async function saveSettings(patch: Record<string, unknown>) {
    const res = await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Could not save settings.');
    }
    load();
  }

  async function loadAudit() {
    const res = await fetch(`/api/workspaces/${workspaceId}/audit`, { cache: 'no-store' });
    if (res.ok) setAudit((await res.json()).entries || []);
    else setAudit([]);
    setShowAudit(true);
  }

  const webhookCurl = webhookToken
    ? `curl -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/tasks -H "Authorization: Bearer ${webhookToken}" -H "Content-Type: application/json" -d '{"title":"Investigate the alert"}'`
    : '';

  return (
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className="modal" style={{ width: 'min(600px, 100%)' }}>
        <h3>👥 Members & Governance</h3>

        <div className="res-list">
          {members.map((m) => (
            <div className="res-item" key={m.userId}>
              <span className={`kind ${m.role === 'owner' || m.role === 'admin' ? 'credential' : 'mcp'}`}>{m.role}</span>
              <span className="name">{m.name}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{m.email}</span>
              {isAdmin && m.role !== 'owner' && (
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.userId, e.target.value)}
                  style={{ marginLeft: 'auto', width: 100, fontSize: 12 }}
                >
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                  <option value="viewer">viewer</option>
                </select>
              )}
            </div>
          ))}
          {members.length === 0 && <p className="desc">Loading…</p>}
        </div>

        {isAdmin && (
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
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ width: 100 }}>
                <option value="admin">admin</option>
                <option value="member">member</option>
                <option value="viewer">viewer</option>
              </select>
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
        )}

        {isAdmin && (
          <div className="field">
            <label>Governance</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>Monthly credit budget $</span>
              <input
                type="text"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="none"
                style={{ width: 90 }}
              />
              <button
                className="btn small"
                onClick={() => saveSettings({ monthlyBudgetUsd: budget.trim() === '' ? null : Number(budget) })}
              >
                Save budget
              </button>
              <button
                className={`btn small${paused ? ' primary' : ''}`}
                onClick={() => saveSettings({ runnerPaused: !paused })}
              >
                {paused ? '▶ Resume agent runner' : '⏸ Pause agent runner'}
              </button>
              <button className="btn small" onClick={loadAudit}>
                📜 Audit log
              </button>
            </div>
            <div className="help">
              Over budget, tasks fall back to the subscription executor (or block). Pausing stops new agent
              pickups; running tasks finish.
            </div>
          </div>
        )}

        {showAudit && audit && (
          <div className="field">
            <label>Audit log (latest {audit.length})</label>
            <div className="res-list" style={{ maxHeight: 180, overflowY: 'auto' }}>
              {audit.map((a) => (
                <div className="res-item" key={a.id} style={{ fontSize: 12 }}>
                  <span className="kind mcp">{a.action}</span>
                  <span style={{ flex: 1 }}>
                    {a.actorName} {a.target && <strong>{a.target}</strong>} {a.detail}
                  </span>
                  <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>{new Date(a.ts).toLocaleString()}</span>
                </div>
              ))}
              {audit.length === 0 && <p className="desc">No audit entries yet.</p>}
            </div>
          </div>
        )}

        {webhookToken && (
          <div className="field">
            <label>Inbound automation webhook</label>
            <div className="help" style={{ marginBottom: 6 }}>
              External systems can create tasks directly (Sentry alert → investigation task, CI failure → fix
              task). Same token also works on <code>/api/webhooks/task-ready</code> to re-trigger scans.
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

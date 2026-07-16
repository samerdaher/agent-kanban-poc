'use client';

import { useEffect, useState } from 'react';
import { TaskTemplate, Schedule, Rule } from '@/lib/types';

/** Templates, schedules ("every Monday create…") and rules ("when tag X completes → create…"). */
export default function AutomationModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [cron, setCron] = useState('0 9 * * 1');
  const [cronTpl, setCronTpl] = useState('');
  const [tag, setTag] = useState('');
  const [tagTpl, setTagTpl] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [t, s, r] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/templates`, { cache: 'no-store' }).then((x) => x.json()),
      fetch(`/api/workspaces/${workspaceId}/schedules`, { cache: 'no-store' }).then((x) => x.json()),
      fetch(`/api/workspaces/${workspaceId}/rules`, { cache: 'no-store' }).then((x) => x.json()),
    ]).catch(() => [{}, {}, {}]);
    setTemplates(t.templates || []);
    setSchedules(s.schedules || []);
    setRules(r.rules || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function post(url: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Request failed.');
    load();
  }

  async function del(url: string) {
    await fetch(url, { method: 'DELETE' });
    load();
  }

  const tplName = (id: string) => templates.find((t) => t.id === id)?.name || id;

  return (
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className="modal" style={{ width: 'min(620px, 100%)' }}>
        <h3>⚙️ Automation</h3>

        <div className="field">
          <label>Task templates ({templates.length})</label>
          <div className="res-list" style={{ maxHeight: 140, overflowY: 'auto' }}>
            {templates.map((t) => (
              <div className="res-item" key={t.id}>
                <span className="kind mcp">{t.payload.type}</span>
                <span className="name">{t.name}</span>
                <button
                  className="btn small danger"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => del(`/api/workspaces/${workspaceId}/templates/${t.id}`)}
                >
                  ✕
                </button>
              </div>
            ))}
            {templates.length === 0 && (
              <p className="desc">No templates — check “Save as template” when creating a task.</p>
            )}
          </div>
        </div>

        <div className="field">
          <label>Schedules — create a task on a cadence (UTC)</label>
          <div className="res-list">
            {schedules.map((s) => (
              <div className="res-item" key={s.id}>
                <span className="kind credential">{s.cron}</span>
                <span className="name">{tplName(s.templateId)}</span>
                <button
                  className="btn small danger"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => del(`/api/workspaces/${workspaceId}/schedules/${s.id}`)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input type="text" value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * 1" style={{ width: 120 }} />
            <select value={cronTpl} onChange={(e) => setCronTpl(e.target.value)} style={{ flex: 1 }}>
              <option value="">pick a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              className="btn primary small"
              disabled={!cron.trim() || !cronTpl}
              onClick={() => post(`/api/workspaces/${workspaceId}/schedules`, { cron: cron.trim(), templateId: cronTpl })}
            >
              Add
            </button>
          </div>
          <div className="help">minute hour day month weekday — e.g. “0 9 * * 1” = every Monday 09:00 UTC.</div>
        </div>

        <div className="field">
          <label>Rules — when a task with a tag completes, create a follow-up</label>
          <div className="res-list">
            {rules.map((r) => (
              <div className="res-item" key={r.id}>
                <span className="kind mcp">#{r.triggerTag}</span>
                <span className="name">→ {tplName(r.templateId)}</span>
                <button
                  className="btn small danger"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => del(`/api/workspaces/${workspaceId}/rules/${r.id}`)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input type="text" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="tag, e.g. deploy" style={{ width: 140 }} />
            <select value={tagTpl} onChange={(e) => setTagTpl(e.target.value)} style={{ flex: 1 }}>
              <option value="">pick a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              className="btn primary small"
              disabled={!tag.trim() || !tagTpl}
              onClick={() => post(`/api/workspaces/${workspaceId}/rules`, { triggerTag: tag.trim(), templateId: tagTpl })}
            >
              Add
            </button>
          </div>
        </div>

        {error && (
          <div className="help" style={{ color: 'var(--danger)', marginBottom: 8 }}>
            {error}
          </div>
        )}

        <div className="modal-actions">
          <a className="btn" href={`/api/workspaces/${workspaceId}/export`}>
            ⬇ Export workspace (JSON)
          </a>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

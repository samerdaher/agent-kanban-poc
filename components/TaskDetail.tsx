'use client';

import { useState } from 'react';
import { Task } from '@/lib/types';

const STATUS_LABEL: Record<Task['status'], string> = {
  backlog: 'Backlog',
  sprint: 'Sprint — ready',
  building_context: 'Building context',
  executing: 'Executing',
  blocked: 'Blocked',
  completed: 'Completed',
  archived: 'Archived',
};

export default function TaskDetail({
  workspaceId,
  task,
  allTasks,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  task: Task;
  allTasks: Task[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const depTitles = task.dependencies
    .map((id) => allTasks.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => `${t!.title}${t!.status === 'completed' ? ' ✓' : ''}`);

  async function sendAnswer(action: 'approve' | 'revise') {
    if (action === 'revise' && !answer.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: answer.trim(), action }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Could not send the answer.');
    }
    setAnswer('');
    setBusy(false);
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete task “${task.title}”? This cannot be undone.`)) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || `Could not delete task (HTTP ${res.status}).`);
      onChanged();
      return;
    }
    onChanged();
    onClose();
  }

  const fileUrl = (name: string) =>
    `/api/workspaces/${workspaceId}/tasks/${task.id}/files/${encodeURIComponent(name)}`;

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="row">
            <h3>{task.title}</h3>
            <button className="close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="status-line" style={{ marginTop: 8 }}>
            <span className={`status-badge st-${task.status}`}>{STATUS_LABEL[task.status]}</span>
            <span className={`chip ${task.type}`}>{task.type === 'agent' ? '🤖 Agent-ready' : '👤 Human'}</span>
            {task.tags.map((t) => (
              <span key={t} className="chip tag">
                {t}
              </span>
            ))}
          </div>
          <div className="task-id-row">
            ID: <code>{task.id}</code>
            <button
              className="btn small"
              onClick={() => {
                navigator.clipboard?.writeText(task.id);
                setCopiedId(true);
                setTimeout(() => setCopiedId(false), 1200);
              }}
            >
              {copiedId ? '✓ copied' : 'copy'}
            </button>
          </div>
        </div>

        <div className="drawer-body">
          {task.blocked && (
            <div className="section">
              <div className="blocked-box">
                <strong>Blocked — {task.blocked.kind.replace('_', ' ')}.</strong> {task.blocked.detail}
              </div>
            </div>
          )}

          {task.pendingQuestion && (
            <div className="section">
              <div className="question-box">
                <p>
                  <strong>❓ Agent question:</strong> {task.pendingQuestion}
                </p>
                <textarea
                  className="answer-textarea"
                  placeholder="Optional note when approving — required when requesting changes (be specific: it becomes a workspace lesson)."
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={3}
                />
                <div className="answer-row" style={{ marginTop: 8 }}>
                  <button className="btn primary" disabled={busy} onClick={() => sendAnswer('approve')}>
                    ✓ Approve & complete
                  </button>
                  <button className="btn" disabled={busy || !answer.trim()} onClick={() => sendAnswer('revise')}>
                    ↺ Request changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {task.description && (
            <div className="section">
              <h4>Description</h4>
              <p className="desc">{task.description}</p>
            </div>
          )}

          {task.definitionOfDone && (
            <div className="section">
              <h4>Definition of done — graded & revised until it passes</h4>
              <p className="desc dod-box">{task.definitionOfDone}</p>
            </div>
          )}

          {task.runs && task.runs.length > 0 && (
            <div className="section">
              <h4>Runs & cost</h4>
              <div className="runs-table">
                {task.runs.map((r) => (
                  <div className="run-row" key={r.id}>
                    <span className="run-model">{r.simulated ? 'simulation' : r.model}</span>
                    <span>
                      {r.iterations} iter · {Math.round(r.durationMs / 1000)}s
                    </span>
                    <span>
                      {(r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens).toLocaleString()} in /{' '}
                      {r.outputTokens.toLocaleString()} out
                    </span>
                    <span className="run-cost">{r.simulated ? '—' : `$${r.costUsd.toFixed(4)}`}</span>
                    {r.outcome && (
                      <span className={`chip ${r.outcome === 'passed' ? 'tag' : 'req'}`}>
                        {r.outcome === 'passed' ? '✓ rubric' : '⚠ max iter'}
                      </span>
                    )}
                  </div>
                ))}
                <div className="run-row total">
                  <span>total</span>
                  <span />
                  <span />
                  <span className="run-cost">
                    ${task.runs.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {(depTitles.length > 0 || task.requirements.length > 0) && (
            <div className="section">
              <h4>Dependencies & Requirements</h4>
              <div className="status-line">
                {depTitles.map((d) => (
                  <span key={d} className="chip dep">
                    ⛓ {d}
                  </span>
                ))}
                {task.requirements.map((r) => (
                  <span key={r} className="chip req">
                    🔑 {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {task.attachments && task.attachments.length > 0 && (
            <div className="section">
              <h4>Attachments — real deliverables</h4>
              <div className="res-list">
                {task.attachments.map((a) => (
                  <a
                    key={a.name}
                    className="res-item"
                    style={{ textDecoration: 'none', color: 'var(--text)' }}
                    href={fileUrl(a.name)}
                  >
                    📎 <span className="name">{a.name}</span>
                    <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 12 }}>
                      {a.size >= 1024 ? `${Math.round(a.size / 1024)} KB` : `${a.size} B`} · download
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {task.output && (
            <div className="section">
              <h4>Final Output</h4>
              <div className="output-box">{task.output}</div>
            </div>
          )}

          <div className="section">
            <h4>Activity — important updates only</h4>
            <div className="timeline">
              {[...task.updates].reverse().map((u, i, arr) => (
                <div className="tl-item" key={u.id}>
                  <div className="tl-rail">
                    <span className={`tl-dot ${u.kind}`} />
                    {i < arr.length - 1 && <span className="tl-line" />}
                  </div>
                  <div className="tl-content">
                    <div className="txt">{u.text}</div>
                    {u.kind === 'output' && task.attachments && task.attachments.length > 0 && (
                      <div className="tl-files">
                        {task.attachments.map((a) => (
                          <a key={a.name} className="tl-file" href={fileUrl(a.name)}>
                            📎 {a.name} <span>⬇ download</span>
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="ts">
                      {u.actor && u.actor !== 'agent' ? `${u.actor} · ` : u.actor === 'agent' ? '🤖 agent · ' : ''}
                      {new Date(u.ts).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
              {task.updates.length === 0 && <p className="desc">No activity yet.</p>}
            </div>
          </div>

          <div className="section">
            <button className="btn small danger" onClick={remove}>
              Delete task
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

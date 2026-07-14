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
};

export default function TaskDetail({
  task,
  allTasks,
  onClose,
  onChanged,
}: {
  task: Task;
  allTasks: Task[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  const depTitles = task.dependencies
    .map((id) => allTasks.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => `${t!.title}${t!.status === 'completed' ? ' ✓' : ''}`);

  async function sendAnswer() {
    if (!answer.trim()) return;
    setBusy(true);
    await fetch(`/api/tasks/${task.id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer }),
    });
    setAnswer('');
    setBusy(false);
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete task “${task.title}”?`)) return;
    await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    onChanged();
    onClose();
  }

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
                <div className="answer-row">
                  <input
                    className="field-input"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontSize: 13.5,
                    }}
                    placeholder="Type your answer…"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendAnswer()}
                  />
                  <button className="btn primary" disabled={busy || !answer.trim()} onClick={sendAnswer}>
                    Answer
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
                    <div className="ts">{new Date(u.ts).toLocaleString()}</div>
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

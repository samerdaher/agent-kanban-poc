'use client';

import { useState } from 'react';
import { Task, Resource, TaskType, TaskExecutor, Member } from '@/lib/types';

export default function NewTaskModal({
  workspaceId,
  tasks,
  resources,
  members,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  tasks: Task[];
  resources: Resource[];
  members: Member[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TaskType>('agent');
  const [tags, setTags] = useState('');
  const [requirements, setRequirements] = useState('');
  const [deps, setDeps] = useState<string[]>([]);
  const [askHuman, setAskHuman] = useState(false);
  const [definitionOfDone, setDefinitionOfDone] = useState('');
  const [executor, setExecutor] = useState<TaskExecutor>('auto');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [reviewerUserId, setReviewerUserId] = useState('');
  const [informs, setInformsIds] = useState<string[]>([]);
  const [toSprint, setToSprint] = useState(false);
  const [busy, setBusy] = useState(false);

  const depCandidates = tasks.filter((t) => t.status !== 'completed' && t.status !== 'archived');

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    await fetch(`/api/workspaces/${workspaceId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        type,
        status: toSprint ? 'sprint' : 'backlog',
        tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
        requirements: requirements.split(',').map((s) => s.trim()).filter(Boolean),
        dependencies: deps,
        informs,
        askHuman,
        definitionOfDone: definitionOfDone.trim() || undefined,
        executor,
        assigneeUserId: assigneeUserId || undefined,
        reviewerUserId: reviewerUserId || undefined,
      }),
    });
    setBusy(false);
    onCreated();
  }

  return (
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>New Task</h3>

        <div className="field">
          <label>Who works this task?</label>
          <div className="type-toggle">
            <button className={type === 'agent' ? 'sel-agent' : ''} onClick={() => setType('agent')}>
              🤖 Agent-ready
            </button>
            <button className={type === 'human' ? 'sel-human' : ''} onClick={() => setType('human')}>
              👤 Human
            </button>
            <button className={type === 'epic' ? 'sel-agent' : ''} onClick={() => setType('epic')}>
              🧩 Epic
            </button>
          </div>
        </div>

        <div className="field">
          <label>Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
        </div>

        <div className="field">
          <label>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              type === 'epic'
                ? 'Describe the goal — the agent proposes a subtask plan for your approval.'
                : type === 'agent'
                  ? 'The more specific the brief, the better the agent output.'
                  : 'Notes for the human assignee.'
            }
          />
        </div>

        <div className="field">
          <label>Tags</label>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="backend, billing (comma-separated)" />
          <div className="help">Tags also power context matching against completed tasks.</div>
        </div>

        {type === 'agent' && (
          <div className="field">
            <label>Runs on</label>
            <select value={executor} onChange={(e) => setExecutor(e.target.value as TaskExecutor)}>
              <option value="auto">🧭 Auto — Claude picks the best fit (recommended)</option>
              <option value="subscription">💳 Claude subscription — $0 credits</option>
              <option value="api">⚡ API credits — pinned claude-opus-4-8</option>
            </select>
            <div className="help">
              Auto: MCP tasks → API; files → LibreOffice on the subscription; everything else Claude decides
              (the decision + reason land in the activity feed).
            </div>
          </div>
        )}

        {type === 'agent' && (
          <div className="field">
            <label>Definition of done (optional)</label>
            <textarea
              value={definitionOfDone}
              onChange={(e) => setDefinitionOfDone(e.target.value)}
              placeholder={'Checkable acceptance criteria, e.g.\n- exactly 5 tweets\n- each under 280 chars\n- includes a call to action'}
            />
            <div className="help">
              When set, an independent review grades the deliverable against this and the agent revises until
              it passes.
            </div>
          </div>
        )}

        {type === 'agent' && (
          <div className="field">
            <label>Required resources (MCPs / credentials)</label>
            <input
              type="text"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="e.g. github-mcp, accounting-api-key"
            />
            <div className="help">
              Available now: {resources.map((r) => r.name).join(', ') || 'none'}. Missing ones move the task to Blocked
              until added.
            </div>
          </div>
        )}

        {type === 'agent' && tasks.some((t) => t.output) && (
          <div className="field">
            <label>Uses output of (context link, non-blocking)</label>
            <div className="dep-list">
              {tasks
                .filter((t) => t.output)
                .slice(0, 20)
                .map((t) => (
                  <label key={t.id}>
                    <input
                      type="checkbox"
                      checked={informs.includes(t.id)}
                      onChange={(e) =>
                        setInformsIds((d) => (e.target.checked ? [...d, t.id] : d.filter((x) => x !== t.id)))
                      }
                    />
                    {t.title} <span style={{ color: 'var(--text-faint)' }}>({t.status})</span>
                  </label>
                ))}
            </div>
            <div className="help">The linked task&apos;s output is injected into this task&apos;s context.</div>
          </div>
        )}

        {depCandidates.length > 0 && (
          <div className="field">
            <label>Depends on</label>
            <div className="dep-list">
              {depCandidates.map((t) => (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={deps.includes(t.id)}
                    onChange={(e) => setDeps((d) => (e.target.checked ? [...d, t.id] : d.filter((x) => x !== t.id)))}
                  />
                  {t.title} <span style={{ color: 'var(--text-faint)' }}>({t.type})</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {type === 'human' && members.length > 0 && (
          <div className="field">
            <label>Assignee</label>
            <select value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)}>
              <option value="">— unassigned —</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {type === 'agent' && (
          <div className="field checkbox-row">
            <input id="askHuman" type="checkbox" checked={askHuman} onChange={(e) => setAskHuman(e.target.checked)} />
            <label htmlFor="askHuman" style={{ margin: 0, textTransform: 'none', letterSpacing: 0 }}>
              Agent must ask a human to confirm before completing
            </label>
          </div>
        )}

        {type === 'agent' && askHuman && members.length > 0 && (
          <div className="field">
            <label>Reviewer (whose approval is requested)</label>
            <select value={reviewerUserId} onChange={(e) => setReviewerUserId(e.target.value)}>
              <option value="">— anyone —</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field checkbox-row">
          <input id="toSprint" type="checkbox" checked={toSprint} onChange={(e) => setToSprint(e.target.checked)} />
          <label htmlFor="toSprint" style={{ margin: 0, textTransform: 'none', letterSpacing: 0 }}>
            Put straight into Sprint {type === 'agent' ? '(fires the agent trigger immediately)' : ''}
          </label>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !title.trim()} onClick={create}>
            Create task
          </button>
        </div>
      </div>
    </div>
  );
}

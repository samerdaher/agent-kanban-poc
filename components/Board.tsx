'use client';

import { useState } from 'react';
import { Task, TaskStatus } from '@/lib/types';

const COLUMNS: { key: TaskStatus; label: string; color: string; hint?: string; droppable: boolean }[] = [
  { key: 'backlog', label: 'Backlog', color: '#9aa3bc', hint: 'create & refine', droppable: true },
  { key: 'sprint', label: 'Sprint', color: '#7c8cff', hint: 'agent trigger', droppable: true },
  { key: 'building_context', label: 'Building Context', color: '#c084fc', hint: 'agent-driven', droppable: false },
  { key: 'executing', label: 'Executing', color: '#58c4ff', hint: 'agent-driven', droppable: false },
  { key: 'blocked', label: 'Blocked', color: '#f87171', hint: 'deps · mcp · human', droppable: false },
  { key: 'completed', label: 'Completed', color: '#4ade80', droppable: true },
];

const WORKING: TaskStatus[] = ['building_context', 'executing'];

export default function Board({
  tasks,
  onSelect,
  onChanged,
}: {
  tasks: Task[];
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);

  async function move(taskId: string, status: TaskStatus) {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.error) alert(data.error);
    }
    onChanged();
  }

  return (
    <main className="board">
      {COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.key);
        return (
          <section
            key={col.key}
            className={`column${overCol === col.key && col.droppable ? ' drop-target' : ''}`}
            onDragOver={(e) => {
              if (!col.droppable) return;
              e.preventDefault();
              setOverCol(col.key);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setOverCol(null);
              if (dragId && col.droppable) move(dragId, col.key);
              setDragId(null);
            }}
          >
            <div className="column-head">
              <span className="swatch" style={{ background: col.color }} />
              <h2>{col.label}</h2>
              {col.hint && <span className="hint">{col.hint}</span>}
              <span className="count">{colTasks.length}</span>
            </div>
            <div className="column-body">
              {colTasks.map((t) => (
                <Card
                  key={t.id}
                  task={t}
                  dragging={dragId === t.id}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => onSelect(t.id)}
                  onMove={move}
                />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function Card({
  task,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
  onMove,
}: {
  task: Task;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  onMove: (id: string, status: TaskStatus) => void;
}) {
  const working = WORKING.includes(task.status);
  const latest = task.updates[task.updates.length - 1];
  const draggable = !working;

  return (
    <article
      className={`card${dragging ? ' dragging' : ''}`}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="title">{task.title}</div>
      <div className="meta">
        <span className={`chip ${task.type}`}>{task.type === 'agent' ? '🤖 Agent-ready' : '👤 Human'}</span>
        {task.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="chip tag">
            {tag}
          </span>
        ))}
        {task.dependencies.length > 0 && <span className="chip dep">⛓ {task.dependencies.length} dep</span>}
        {task.requirements.length > 0 && <span className="chip req">🔑 {task.requirements.length} req</span>}
        {task.blocked && <span className="chip blocked">{blockedLabel(task.blocked.kind)}</span>}
      </div>
      {working && (
        <div className="working-banner">
          <span className="pulse" /> {task.status === 'building_context' ? 'Building context…' : 'Agent executing…'}
        </div>
      )}
      {!working && latest && <div className="latest">{latest.text}</div>}
      <MobileMoveButtons task={task} onMove={onMove} />
    </article>
  );
}

function blockedLabel(kind: string) {
  if (kind === 'dependency') return '⛓ dependency';
  if (kind === 'missing_resource') return '🔑 resource';
  return '❓ human';
}

/** Buttons shown on small screens where drag & drop is impractical. */
function MobileMoveButtons({ task, onMove }: { task: Task; onMove: (id: string, s: TaskStatus) => void }) {
  const options: { label: string; to: TaskStatus }[] = [];
  if (task.status === 'backlog') options.push({ label: '→ Sprint', to: 'sprint' });
  if (task.status === 'sprint') {
    options.push({ label: '← Backlog', to: 'backlog' });
    if (task.type === 'human') options.push({ label: '✓ Done', to: 'completed' });
  }
  if (!options.length) return null;
  return (
    <div className="mobile-move" onClick={(e) => e.stopPropagation()}>
      {options.map((o) => (
        <button key={o.to} className="btn small" onClick={() => onMove(task.id, o.to)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

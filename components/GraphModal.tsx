'use client';

import { Task } from '@/lib/types';

const STATUS_COLOR: Record<string, string> = {
  backlog: '#9aa3bc',
  sprint: '#7c8cff',
  building_context: '#c084fc',
  executing: '#58c4ff',
  blocked: '#f87171',
  completed: '#4ade80',
  archived: '#667089',
};

/** Dependency graph: blocks edges solid, informs edges dashed. */
export default function GraphModal({
  tasks,
  onOpenTask,
  onClose,
}: {
  tasks: Task[];
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  const nodes = tasks.filter((t) => t.status !== 'archived');
  const byId = new Map(nodes.map((t) => [t.id, t]));

  // depth = longest blocks-dependency chain
  const depthMemo = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (seen.has(id)) return 0; // defensive against legacy cycles
    seen.add(id);
    const t = byId.get(id);
    const d = t && t.dependencies.length
      ? 1 + Math.max(...t.dependencies.filter((x) => byId.has(x)).map((x) => depth(x, seen)), -1)
      : 0;
    depthMemo.set(id, d);
    return d;
  };

  const cols = new Map<number, Task[]>();
  for (const n of nodes) {
    const d = depth(n.id);
    cols.set(d, [...(cols.get(d) || []), n]);
  }

  const NODE_W = 170;
  const NODE_H = 44;
  const GAP_X = 70;
  const GAP_Y = 18;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, list] of cols) {
    list.forEach((t, i) => pos.set(t.id, { x: 20 + d * (NODE_W + GAP_X), y: 20 + i * (NODE_H + GAP_Y) }));
  }
  const width = 40 + (Math.max(...[...cols.keys()], 0) + 1) * (NODE_W + GAP_X);
  const height = 40 + Math.max(...[...cols.values()].map((l) => l.length), 1) * (NODE_H + GAP_Y);

  const edge = (from: string, to: string, dashed: boolean, key: string) => {
    const a = pos.get(from);
    const b = pos.get(to);
    if (!a || !b) return null;
    return (
      <path
        key={key}
        d={`M ${a.x + NODE_W} ${a.y + NODE_H / 2} C ${a.x + NODE_W + 35} ${a.y + NODE_H / 2}, ${b.x - 35} ${b.y + NODE_H / 2}, ${b.x} ${b.y + NODE_H / 2}`}
        fill="none"
        stroke={dashed ? '#58c4ff' : '#667089'}
        strokeWidth={1.5}
        strokeDasharray={dashed ? '4 4' : undefined}
        opacity={0.8}
      />
    );
  };

  return (
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className="modal" style={{ width: 'min(860px, 100%)' }}>
        <h3>🕸 Task graph</h3>
        <p className="desc" style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 10 }}>
          solid = blocks (must finish first) · dashed = informs (output feeds context) · click a task to open it
        </p>
        <div style={{ overflow: 'auto', maxHeight: 460, border: '1px solid var(--border)', borderRadius: 8 }}>
          <svg width={width} height={height}>
            {nodes.flatMap((t) => [
              ...t.dependencies.map((d) => edge(d, t.id, false, `b-${d}-${t.id}`)),
              ...t.informs.map((d) => edge(d, t.id, true, `i-${d}-${t.id}`)),
            ])}
            {nodes.map((t) => {
              const p = pos.get(t.id)!;
              return (
                <g
                  key={t.id}
                  transform={`translate(${p.x}, ${p.y})`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    onOpenTask(t.id);
                    onClose();
                  }}
                >
                  <rect width={NODE_W} height={NODE_H} rx={8} fill="#1a1f2e" stroke={STATUS_COLOR[t.status] || '#364060'} strokeWidth={1.5} />
                  <text x={10} y={18} fill="#e8ebf4" fontSize={11} fontWeight={600}>
                    {(t.type === 'epic' ? '🧩 ' : t.type === 'human' ? '👤 ' : '🤖 ') + t.title.slice(0, 20) + (t.title.length > 20 ? '…' : '')}
                  </text>
                  <text x={10} y={33} fill={STATUS_COLOR[t.status] || '#9aa3bc'} fontSize={9.5}>
                    {t.status.replace('_', ' ')}
                  </text>
                </g>
              );
            })}
          </svg>
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

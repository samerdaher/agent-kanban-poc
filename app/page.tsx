'use client';

import { useCallback, useEffect, useState } from 'react';
import { Task, Resource } from '@/lib/types';
import Board from '@/components/Board';
import TaskDetail from '@/components/TaskDetail';
import NewTaskModal from '@/components/NewTaskModal';
import ResourcesModal from '@/components/ResourcesModal';

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showResources, setShowResources] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks', { cache: 'no-store' });
      const data = await res.json();
      setTasks(data.tasks);
      setResources(data.resources);
    } catch {
      /* transient poll failure — next tick will retry */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [refresh]);

  const selected = tasks.find((t) => t.id === selectedId) || null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="dot" /> AgentBoard
        </div>
        <span className="tagline">One Trigger · Full Context · Real Output</span>
        <div className="spacer" />
        <button className="btn" onClick={() => setShowResources(true)}>
          🔌 Resources ({resources.length})
        </button>
        <button className="btn primary" onClick={() => setShowNew(true)}>
          + New Task
        </button>
      </header>

      <Board tasks={tasks} onSelect={setSelectedId} onChanged={refresh} />

      {selected && (
        <TaskDetail task={selected} allTasks={tasks} onClose={() => setSelectedId(null)} onChanged={refresh} />
      )}
      {showNew && (
        <NewTaskModal
          tasks={tasks}
          resources={resources}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            refresh();
          }}
        />
      )}
      {showResources && (
        <ResourcesModal resources={resources} onClose={() => setShowResources(false)} onChanged={refresh} />
      )}
    </div>
  );
}

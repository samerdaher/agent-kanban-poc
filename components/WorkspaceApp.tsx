'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Task, Resource, User, Workspace, Member } from '@/lib/types';
import Board from '@/components/Board';
import TaskDetail from '@/components/TaskDetail';
import NewTaskModal from '@/components/NewTaskModal';
import ResourcesModal from '@/components/ResourcesModal';
import MembersModal from '@/components/MembersModal';
import LessonsModal from '@/components/LessonsModal';
import AutomationModal from '@/components/AutomationModal';
import ImpactModal from '@/components/ImpactModal';
import InboxModal from '@/components/InboxModal';
import GraphModal from '@/components/GraphModal';

export default function WorkspaceApp({
  workspaceId,
  user,
  workspaces,
}: {
  workspaceId: string;
  user: User;
  workspaces: Workspace[];
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showLessons, setShowLessons] = useState(false);
  const [showAutomation, setShowAutomation] = useState(false);
  const [showImpact, setShowImpact] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [inbox, setInbox] = useState<
    { id: string; title: string; status: string; kind: 'review' | 'assigned'; pendingQuestion: string | null; updatedAt: string }[]
  >([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [live, setLive] = useState(false);
  const [creatingWs, setCreatingWs] = useState(false);
  const [spend, setSpend] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tasks`, { cache: 'no-store' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await res.json();
      setTasks(data.tasks || []);
      setResources(data.resources || []);
      fetch(`/api/workspaces/${workspaceId}/stats`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => setSpend(typeof d.stats?.costUsd === 'number' ? d.stats.costUsd : null))
        .catch(() => {});
      fetch(`/api/workspaces/${workspaceId}/inbox`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => setInbox(d.items || []))
        .catch(() => {});
    } catch {
      /* transient failure — SSE reconnect / fallback poll will retry */
    }
  }, [workspaceId]);

  // Real-time: SSE stream drives refreshes; a slow poll is the safety net.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setMembers(d.members || []))
      .catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    refresh();
    const es = new EventSource(`/api/workspaces/${workspaceId}/events`);
    es.onopen = () => setLive(true);
    es.onmessage = () => refreshRef.current();
    es.onerror = () => setLive(false);
    const fallback = setInterval(() => refreshRef.current(), 20000);
    const onFocus = () => refreshRef.current();
    window.addEventListener('focus', onFocus);
    return () => {
      es.close();
      clearInterval(fallback);
      window.removeEventListener('focus', onFocus);
    };
  }, [workspaceId, refresh]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  async function createWorkspace() {
    const name = prompt('Name for the new workspace:');
    if (!name?.trim()) return;
    setCreatingWs(true);
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), demo: false }),
    });
    setCreatingWs(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.workspace) window.location.href = `/w/${data.workspace.id}`;
    else alert(data.error || 'Could not create workspace.');
  }

  const selected = tasks.find((t) => t.id === selectedId) || null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="dot" /> AgentBoard
        </div>
        <select
          className="ws-select"
          value={workspaceId}
          onChange={(e) => {
            if (e.target.value === '__new__') {
              createWorkspace();
              e.target.value = workspaceId;
            } else {
              window.location.href = `/w/${e.target.value}`;
            }
          }}
          disabled={creatingWs}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
          <option value="__new__">＋ New workspace…</option>
        </select>
        <span className={`live-dot${live ? ' on' : ''}`} title={live ? 'Live updates connected' : 'Reconnecting…'} />
        {spend !== null && spend > 0 && (
          <span className="spend-chip" title="Total agent spend in this workspace (all runs)">
            ${spend < 1 ? spend.toFixed(3) : spend.toFixed(2)}
          </span>
        )}
        <div className="spacer" />
        <button className="btn" onClick={() => setShowInbox(true)}>
          📥 {inbox.length > 0 ? <strong style={{ color: 'var(--warn)' }}>{inbox.length}</strong> : '0'}
        </button>
        <button className="btn" onClick={() => setShowGraph(true)}>
          🕸
        </button>
        <button className="btn" onClick={() => setShowImpact(true)}>
          🛠 Dev
        </button>
        <button className="btn" onClick={() => setShowLessons(true)}>
          🧠 Memory
        </button>
        <button className="btn" onClick={() => setShowAutomation(true)}>
          ⚙️ Automation
        </button>
        <button className="btn" onClick={() => setShowMembers(true)}>
          👥 Members
        </button>
        <button className="btn" onClick={() => setShowResources(true)}>
          🔌 Resources ({resources.length})
        </button>
        <button className="btn primary" onClick={() => setShowNew(true)}>
          + New Task
        </button>
        <button className="btn user-chip" onClick={signOut} title={`Signed in as ${user.email} — click to sign out`}>
          {user.name.split(' ')[0]} ↦
        </button>
      </header>

      <Board workspaceId={workspaceId} tasks={tasks} onSelect={setSelectedId} onChanged={refresh} />

      {selected && (
        <TaskDetail
          workspaceId={workspaceId}
          task={selected}
          allTasks={tasks}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
        />
      )}
      {showNew && (
        <NewTaskModal
          workspaceId={workspaceId}
          tasks={tasks}
          resources={resources}
          members={members}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            refresh();
          }}
        />
      )}
      {showResources && (
        <ResourcesModal
          workspaceId={workspaceId}
          resources={resources}
          onClose={() => setShowResources(false)}
          onChanged={refresh}
        />
      )}
      {showMembers && <MembersModal workspaceId={workspaceId} onClose={() => setShowMembers(false)} />}
      {showLessons && <LessonsModal workspaceId={workspaceId} onClose={() => setShowLessons(false)} />}
      {showAutomation && <AutomationModal workspaceId={workspaceId} onClose={() => setShowAutomation(false)} />}
      {showImpact && <ImpactModal workspaceId={workspaceId} onClose={() => setShowImpact(false)} />}
      {showInbox && <InboxModal items={inbox} onOpenTask={setSelectedId} onClose={() => setShowInbox(false)} />}
      {showGraph && <GraphModal tasks={tasks} onOpenTask={setSelectedId} onClose={() => setShowGraph(false)} />}
    </div>
  );
}

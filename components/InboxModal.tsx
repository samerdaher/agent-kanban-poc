'use client';

interface InboxItem {
  id: string;
  title: string;
  status: string;
  kind: 'review' | 'assigned';
  pendingQuestion: string | null;
  updatedAt: string;
}

/** "Waiting on you" — everything blocked on the current user's input. */
export default function InboxModal({
  items,
  onOpenTask,
  onClose,
}: {
  items: InboxItem[];
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>📥 Waiting on you</h3>
        <div className="res-list" style={{ maxHeight: 380, overflowY: 'auto' }}>
          {items.map((i) => (
            <button
              key={i.id}
              className="res-item"
              style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--bg-card)', border: '1px solid var(--border)' }}
              onClick={() => {
                onOpenTask(i.id);
                onClose();
              }}
            >
              <span className={`kind ${i.kind === 'review' ? 'credential' : 'mcp'}`}>
                {i.kind === 'review' ? '❓ review' : '👤 yours'}
              </span>
              <span style={{ flex: 1, fontSize: 13 }}>
                {i.title}
                {i.pendingQuestion && (
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                    {i.pendingQuestion.slice(0, 90)}
                  </span>
                )}
              </span>
            </button>
          ))}
          {items.length === 0 && <p className="desc">Nothing is waiting on you. 🎉</p>}
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

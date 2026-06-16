import type { Session } from '../../types';
import { formatTime } from '../../utils/markdown';
import './Sidebar.css';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  isOpen: boolean;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onToggle: () => void;
  onOverlayClick: () => void;
}

export function Sidebar({
  sessions,
  currentSessionId,
  isOpen,
  onSwitch,
  onDelete,
  onNew,
  onToggle,
  onOverlayClick,
}: SidebarProps) {
  return (
    <>
      <div
        className={`sidebar-overlay${isOpen ? ' show' : ''}`}
        onClick={onOverlayClick}
      />
      <aside className={`sidebar${!isOpen ? ' collapsed' : ''}`}>
        <div className="sidebar-hdr">
          <h2>聊天历史</h2>
          <div className="sidebar-btns">
            <button className="sb-icon-btn" title="新建聊天" onClick={onNew}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button className="sb-icon-btn" title="收起侧边栏" onClick={onToggle}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
          </div>
        </div>
        <div className="sidebar-list">
          {sessions.length === 0 ? (
            <div className="sidebar-empty">
              还没有聊天记录<br />点击上方 + 开始新对话
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={`sidebar-item${s.id === currentSessionId ? ' active' : ''}`}
                onClick={() => onSwitch(s.id)}
              >
                <div className="si-title">{esc(s.title)}</div>
                <div className="si-meta">
                  {formatTime(s.updatedAt)} · {(s.history || []).length} 条
                </div>
                <button
                  className="si-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

function esc(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

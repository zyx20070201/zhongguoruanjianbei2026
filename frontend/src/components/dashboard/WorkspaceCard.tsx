import React from 'react';
import { Copy, Edit3, EllipsisVertical, FileText, Layers3, Trash2 } from 'lucide-react';
import { WorkspaceCardData } from '../../types';

interface WorkspaceCardProps {
  data: WorkspaceCardData;
  onClick: (id: string) => void;
  onEdit: (e: React.MouseEvent, id: string) => void;
  onDuplicate: (e: React.MouseEvent, id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  style?: React.CSSProperties;
}

const emojiOptions = ['📘', '🧪', '🧠', '📐', '💡', '🧭', '🔬', '🗂️', '🎓', '📝'];

const pickEmoji = (seed: string) => {
  if (!seed) return emojiOptions[0];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return emojiOptions[hash % emojiOptions.length];
};

export default function WorkspaceCard({ data, onClick, onEdit, onDuplicate, onDelete, style }: WorkspaceCardProps) {
  const [showMenu, setShowMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const emoji = React.useMemo(() => pickEmoji(`${data.courseName} ${data.description || ''} ${data.major}`), [data.courseName, data.description, data.major]);

  React.useEffect(() => {
    if (!showMenu) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      setShowMenu(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMenu(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showMenu]);

  return (
    <div
      className={`workspace-card workspace-list-item group flex min-h-[292px] cursor-pointer flex-col overflow-visible rounded-2xl border border-[#e0e3e8] bg-[#f5f6f8] shadow-sm transition hover:border-[#d4d8df] hover:shadow-[0_18px_44px_rgba(60,64,67,0.08)] ${showMenu ? '' : 'hover:-translate-y-0.5'}`}
      onClick={() => onClick(data.id)}
      style={style}
    >
      <div className="flex min-h-0 flex-1 flex-col p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-white text-4xl shadow-[0_8px_24px_rgba(60,64,67,0.08)]">
              {emoji}
            </div>
            <div className="mt-4 min-w-0">
              <h3 className="line-clamp-2 text-xl font-semibold leading-tight text-[#202124]">{data.courseName}</h3>
              <p className="mt-2 text-sm text-[#5f6368]">{data.major}</p>
              {data.description && <p className="mt-2 line-clamp-2 text-sm leading-5 text-[#6f7379]">{data.description}</p>}
            </div>
          </div>

          <div ref={menuRef} className="relative" onClick={(event) => event.stopPropagation()}>
            <button
              onClick={(event) => {
                event.stopPropagation();
                setShowMenu((value) => !value);
              }}
              className="rounded-full p-1.5 text-[#7f858d] transition hover:bg-white hover:text-[#34373c]"
            >
              <EllipsisVertical className="h-5 w-5" />
            </button>

            {showMenu && (
              <div
                className="absolute right-0 z-30 mt-2 w-52 origin-top-right overflow-hidden rounded-2xl border border-[#dfe2e7] bg-white py-2 opacity-100 shadow-[0_18px_44px_rgba(60,64,67,0.18)] ring-1 ring-black/[0.03] transition-all duration-200 ease-out animate-in fade-in zoom-in-95 slide-in-from-top-1"
                onClick={(event) => event.stopPropagation()}
              >
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-[#34373c] transition hover:bg-[#f6f7f8]" onClick={(event) => { setShowMenu(false); onEdit(event, data.id); }}>
                  <Edit3 className="h-4 w-4 text-[#73777f]" />
                  Edit
                </button>
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-[#34373c] transition hover:bg-[#f6f7f8]" onClick={(event) => { setShowMenu(false); onDuplicate(event, data.id); }}>
                  <Copy className="h-4 w-4 text-[#73777f]" />
                  Duplicate
                </button>
                <div className="my-1 h-px bg-[#edf0f3]" />
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-[#34373c] transition hover:bg-[#fef2f2] hover:text-[#b42318]" onClick={(event) => { setShowMenu(false); onDelete(event, data.id); }}>
                  <Trash2 className="h-4 w-4 text-[#73777f]" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto flex items-end justify-between gap-4 pt-5 text-sm font-medium text-[#6f7379]">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-end gap-2">
              <Layers3 className="h-4 w-4 text-[#7d8188]" />
              <span>{data.workbenchCount} Workbenches</span>
            </div>
            <div className="flex items-end gap-2">
              <FileText className="h-4 w-4 text-[#7d8188]" />
              <span>{data.fileCount} Files</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span>{data.updatedAt}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

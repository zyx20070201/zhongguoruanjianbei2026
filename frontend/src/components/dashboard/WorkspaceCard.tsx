import React from 'react';
import { Copy, Edit3, EllipsisVertical, FileText, Layers3, Trash2 } from 'lucide-react';
import { WorkspaceCardData } from '../../types';

export const getWorkspaceEmoji = (seed: string) => pickEmoji(seed);

interface WorkspaceCardProps {
  data: WorkspaceCardData;
  onClick: (id: string) => void;
  onEdit: (e: React.MouseEvent, id: string, rect: DOMRect) => void;
  onDuplicate: (e: React.MouseEvent, id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  editedBy?: string;
  style?: React.CSSProperties;
}

const emojiRules: Array<{ emoji: string; keywords: string[] }> = [
  { emoji: '💻', keywords: ['计算机', '编程', '程序', '代码', '软件', '前端', '后端', 'java', 'python', 'c++', 'javascript', 'typescript', '算法'] },
  { emoji: '📊', keywords: ['数据', '统计', '概率', '机器学习', '人工智能', 'ai', '大数据', '挖掘', '分析'] },
  { emoji: '📐', keywords: ['数学', '高数', '线代', '线性代数', '微积分', '几何', '代数'] },
  { emoji: '🧪', keywords: ['化学', '实验', '材料', '生物', '医学', '药学'] },
  { emoji: '🔬', keywords: ['物理', '电路', '电子', '通信', '信号', '自动化', '控制'] },
  { emoji: '🌏', keywords: ['英语', '语言', '翻译', '日语', '外语', '写作'] },
  { emoji: '🏛️', keywords: ['历史', '政治', '法律', '法学', '思政', '社会'] },
  { emoji: '💼', keywords: ['经济', '金融', '管理', '会计', '营销', '商业'] },
  { emoji: '🎨', keywords: ['设计', '艺术', '美术', '视觉', '音乐', '影视'] },
  { emoji: '📚', keywords: ['课程', '学习', '笔记', '复习', '资料'] }
];

const pickEmoji = (seed: string) => {
  const normalizedSeed = seed.trim().toLowerCase();
  if (!normalizedSeed) return '📚';

  const matchedRule = emojiRules.find(rule =>
    rule.keywords.some(keyword => normalizedSeed.includes(keyword.toLowerCase()))
  );

  return matchedRule?.emoji || '📘';
};

export default function WorkspaceCard({ data, onClick, onEdit, onDuplicate, onDelete, editedBy, style }: WorkspaceCardProps) {
  const [showMenu, setShowMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const emoji = React.useMemo(() => getWorkspaceEmoji(`${data.courseName} ${data.description || ''}`), [data.courseName, data.description]);
  const cardRef = React.useRef<HTMLDivElement | null>(null);

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
      className={`workspace-card workspace-list-item group flex min-h-[264px] cursor-pointer flex-col overflow-visible rounded-xl border border-[#e6e6e1] bg-white shadow-[0_1px_2px_rgba(32,33,36,0.04)] transition hover:border-[#d8d8d3] hover:bg-[#fffefa] hover:shadow-[0_14px_34px_rgba(32,33,36,0.07)] ${showMenu ? 'border-[#d8d8d3] bg-[#fffefa]' : 'hover:-translate-y-0.5'}`}
      onClick={() => onClick(data.id)}
      ref={cardRef}
      style={style}
    >
      <div className="flex min-h-0 flex-1 flex-col p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#f7f7f5] text-3xl">
              {emoji}
            </div>
            <div className="mt-4 min-w-0">
              <h3 className="line-clamp-2 text-lg font-semibold leading-tight text-[#202124]">{data.courseName}</h3>
              {data.description && <p className="mt-2 line-clamp-2 text-sm leading-5 text-[#666a70]">{data.description}</p>}
            </div>
          </div>

          <div ref={menuRef} className="relative" onClick={(event) => event.stopPropagation()}>
            <button
              onClick={(event) => {
                event.stopPropagation();
                setShowMenu((value) => !value);
              }}
              className={`rounded-full p-1.5 text-[#7f858d] outline-none transition hover:bg-[#f1f1ef] hover:text-[#34373c] focus-visible:ring-2 focus-visible:ring-[#d8d8d4] ${showMenu ? 'bg-[#f1f1ef] text-[#34373c]' : 'group-hover:bg-[#f7f7f5]'}`}
              aria-label="课程操作"
            >
              <EllipsisVertical className="h-5 w-5" />
            </button>

            {showMenu && (
              <div
                className="absolute right-0 z-30 mt-2 w-56 origin-top-right overflow-hidden rounded-xl border border-[#e3e1db] bg-[#fffefa] p-1.5 text-sm shadow-[0_20px_50px_rgba(32,33,36,0.16)] animate-[workspace-menu-enter_120ms_cubic-bezier(0.16,1,0.3,1)_both]"
                onClick={(event) => event.stopPropagation()}
              >
                <p className="px-3 pb-1.5 pt-1 text-xs font-medium text-[#96999d]">课程</p>
                <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-medium text-[#202124] transition hover:bg-[#f1f1ef]" onClick={(event) => { setShowMenu(false); onEdit(event, data.id, cardRef.current?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect()); }}>
                  <Edit3 className="h-4 w-4 text-[#73777f]" />
                  重新编辑
                </button>
                <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-medium text-[#202124] transition hover:bg-[#f1f1ef]" onClick={(event) => { setShowMenu(false); onDuplicate(event, data.id); }}>
                  <Copy className="h-4 w-4 text-[#73777f]" />
                  创建副本
                </button>
                <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-medium text-[#202124] transition hover:bg-[#f1f1ef]" onClick={(event) => { setShowMenu(false); onDelete(event, data.id); }}>
                  <Trash2 className="h-4 w-4 text-[#73777f]" />
                  删除课程
                </button>
              </div>
            )}
          </div>
        </div>

        {(data.recentTask || data.recentWorkbench) && (
          <div className="mt-1 space-y-1 text-sm leading-5 text-[#666a70]">
            {data.recentTask && <p className="truncate">{data.recentTask}</p>}
            {data.recentWorkbench && <p className="truncate">{data.recentWorkbench}</p>}
          </div>
        )}

        <div className="mt-auto flex flex-col gap-3 pt-5 text-sm font-medium text-[#6f7379]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-end gap-2">
              <Layers3 className="h-4 w-4 text-[#7d8188]" />
              <span>{data.taskCount ?? data.workbenchCount} 个任务</span>
            </div>
            <div className="flex items-end gap-2">
              <Layers3 className="h-4 w-4 text-[#7d8188]" />
              <span>{data.workbenchCount} 个 workbench</span>
            </div>
            <div className="flex items-end gap-2">
              <FileText className="h-4 w-4 text-[#7d8188]" />
              <span>{data.fileCount} 份资料</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#8a8d91]">
            <span>上次由 {editedBy || '你'} 编辑</span>
            <span className="text-[#a6a6a0]">{data.updatedAt}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

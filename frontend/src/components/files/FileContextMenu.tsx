import React from 'react';
import { 
  Edit2, 
  Trash2, 
  Copy, 
  Move,
  Download,
  Plus,
  FolderPlus,
  Upload,
  FileText
} from 'lucide-react';

interface FileContextMenuProps {
  x: number;
  y: number;
  node: any;
  onClose: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string, targetParentId?: string | null) => void;
  onMove: (id: string) => void;
  onDownload: (id: string) => void;
  onCreateFile?: (parentId: string, parentPath: string) => void;
  onCreateNote?: (parentId: string, parentPath: string) => void;
  onCreateFolder?: (parentId: string, parentPath: string) => void;
  onUpload?: (parentId: string, parentPath: string) => void;
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  x,
  y,
  node,
  onClose,
  onRename,
  onDelete,
  onCopy,
  onMove,
  onDownload,
  onCreateFile,
  onCreateNote,
  onCreateFolder,
  onUpload
}) => {
  const isFolder = node.data.nodeType === 'folder';

  return (
    <>
      <div 
        className="fixed inset-0 z-40" 
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div 
        className="fixed z-50 min-w-[160px] rounded-md border border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] py-1 text-sm text-[var(--wb-text)] shadow-lg"
        style={{ left: x, top: y }}
      >
        {isFolder && (
          <>
            <button 
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
              onClick={() => { onCreateFile?.(node.id, node.data.path); onClose(); }}
            >
              <Plus size={14} /> 新建文件
            </button>
            <button 
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
              onClick={() => { onCreateNote?.(node.id, node.data.path); onClose(); }}
            >
              <FileText size={14} /> 新建笔记
            </button>
            <button 
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
              onClick={() => { onCreateFolder?.(node.id, node.data.path); onClose(); }}
            >
              <FolderPlus size={14} /> 新建文件夹
            </button>
            <button 
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
              onClick={() => { onUpload?.(node.id, node.data.path); onClose(); }}
            >
              <Upload size={14} /> 上传
            </button>
            <div className="my-1 h-px bg-[var(--wb-border)]" />
          </>
        )}
        <button 
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          onClick={() => { onRename(node.id); onClose(); }}
        >
          <Edit2 size={14} /> 重命名
        </button>
        <button 
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          onClick={() => { onCopy(node.id, node.data.parentId || null); onClose(); }}
        >
          <Copy size={14} /> 创建副本
        </button>
        <button 
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          onClick={() => { onMove(node.id); onClose(); }}
        >
          <Move size={14} /> 移动到...
        </button>
        {!isFolder && (
          <button 
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
            onClick={() => { onDownload(node.id); onClose(); }}
          >
            <Download size={14} /> 下载
          </button>
        )}
        <div className="my-1 h-px bg-[var(--wb-border)]" />
        <button 
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-300 hover:bg-red-500/10"
          onClick={() => { onDelete(node.id); onClose(); }}
        >
          <Trash2 size={14} /> 删除
        </button>
      </div>
    </>
  );
};

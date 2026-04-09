import React from 'react';
import { 
  File, 
  Folder, 
  FolderOpen, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  Copy, 
  Download,
  Plus,
  FolderPlus,
  Upload
} from 'lucide-react';

interface FileContextMenuProps {
  x: number;
  y: number;
  node: any;
  onClose: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onDownload: (id: string) => void;
  onCreateFile?: (parentId: string, parentPath: string) => void;
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
  onDownload,
  onCreateFile,
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
        className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[160px] text-sm"
        style={{ left: x, top: y }}
      >
        {isFolder && (
          <>
            <button 
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-center gap-2"
              onClick={() => { onCreateFile?.(node.id, node.data.path); onClose(); }}
            >
              <Plus size={14} /> New File
            </button>
            <button 
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-center gap-2"
              onClick={() => { onCreateFolder?.(node.id, node.data.path); onClose(); }}
            >
              <FolderPlus size={14} /> New Folder
            </button>
            <button 
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-center gap-2"
              onClick={() => { onUpload?.(node.id, node.data.path); onClose(); }}
            >
              <Upload size={14} /> Upload
            </button>
            <div className="h-px bg-gray-100 my-1" />
          </>
        )}
        <button 
          className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-center gap-2"
          onClick={() => { onRename(node.id); onClose(); }}
        >
          <Edit2 size={14} /> Rename
        </button>
        <button 
          className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-center gap-2"
          onClick={() => { onCopy(node.id); onClose(); }}
        >
          <Copy size={14} /> Duplicate
        </button>
        {!isFolder && (
          <button 
            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-center gap-2"
            onClick={() => { onDownload(node.id); onClose(); }}
          >
            <Download size={14} /> Download
          </button>
        )}
        <div className="h-px bg-gray-100 my-1" />
        <button 
          className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2"
          onClick={() => { onDelete(node.id); onClose(); }}
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </>
  );
};

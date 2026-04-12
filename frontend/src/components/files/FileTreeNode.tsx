import React, { useEffect, useRef, useState } from 'react';
import { NodeApi } from 'react-arborist';
import { FileSystemObject } from '../../types';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen,
  Image,
  FileText,
  Code,
  Tag
} from 'lucide-react';

interface FileTreeNodeProps {
  node: NodeApi<any>;
  style: React.CSSProperties;
  dragHandle?: (el: HTMLDivElement | null) => void;
  onContextMenu: (e: React.MouseEvent, node: NodeApi<any>) => void;
  onDoubleClick: (node: NodeApi<any>) => void;
  enableWorkbenchDrag?: boolean;
}

const getFileIcon = (node: FileSystemObject, isOpen: boolean) => {
  if ((node as FileSystemObject & { syntheticKind?: string }).syntheticKind === 'tag-group') {
    return <Tag size={16} className="mr-1.5 flex-shrink-0 text-[#f0b45c]" />;
  }

  if (node.nodeType === 'folder') {
    return isOpen ? (
      <FolderOpen size={16} className="mr-1.5 flex-shrink-0 text-[#7fb4ff]" />
    ) : (
      <Folder size={16} className="mr-1.5 flex-shrink-0 text-[#6ea7f6]" />
    );
  }

  const ext = node.extension?.toLowerCase().replace(/^\./, '') || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) {
    return <Image size={16} className="mr-1.5 flex-shrink-0 text-[#9fb0c7]" />;
  }
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'yaml', 'yml', 'xml'].includes(ext)) {
    return <Code size={16} className="mr-1.5 flex-shrink-0 text-[#5aa6ff]" />;
  }
  return <FileText size={16} className="mr-1.5 flex-shrink-0 text-[#8d9aae]" />;
};

export const FileTreeNode: React.FC<FileTreeNodeProps> = ({ 
  node, 
  style, 
  dragHandle,
  onContextMenu,
  onDoubleClick,
  enableWorkbenchDrag = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(node.data.name);
  const autoOpenTimerRef = useRef<number | null>(null);

  // Focus effect for editing
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (node.isEditing) {
      setIsEditing(true);
      setEditName(node.data.name);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setIsEditing(false);
    }
  }, [node.isEditing, node.data.name]);

  useEffect(() => {
    if (node.data.nodeType !== 'folder' || !node.willReceiveDrop || node.isOpen) {
      if (autoOpenTimerRef.current) {
        window.clearTimeout(autoOpenTimerRef.current);
        autoOpenTimerRef.current = null;
      }
      return;
    }

    autoOpenTimerRef.current = window.setTimeout(() => {
      node.open();
      autoOpenTimerRef.current = null;
    }, 450);

    return () => {
      if (autoOpenTimerRef.current) {
        window.clearTimeout(autoOpenTimerRef.current);
        autoOpenTimerRef.current = null;
      }
    };
  }, [node.id, node.data.nodeType, node.isOpen, node.willReceiveDrop]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      node.submit(editName);
    } else if (e.key === 'Escape') {
      node.reset();
    }
  };

  const handleBlur = () => {
    node.submit(editName);
  };

  const isFolder = node.data.nodeType === 'folder';
  const isSynthetic = Boolean((node.data as FileSystemObject & { syntheticKind?: string }).syntheticKind);

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`
        group flex items-center py-1 text-sm select-none transition-colors
        cursor-pointer
        ${node.isDragging ? 'opacity-50' : ''}
        ${node.willReceiveDrop ? 'bg-[rgba(90,166,255,0.18)] text-[var(--wb-text)] ring-1 ring-inset ring-[#79b6ff]' : ''}
        ${node.isSelected && !node.willReceiveDrop ? 'bg-[rgba(90,166,255,0.14)] text-[var(--wb-text)]' : ''}
        ${!node.isSelected && !node.willReceiveDrop ? 'text-[var(--wb-text-muted)] hover:bg-white/5 hover:text-[var(--wb-text)]' : ''}
      `}
      onClick={() => {
        node.select();
        if (isFolder) {
          node.toggle();
        }
      }}
      onDoubleClick={() => {
        if (!isSynthetic) {
          onDoubleClick(node);
        }
      }}
      onContextMenu={(e) => {
        if (isSynthetic) return;
        e.preventDefault();
        e.stopPropagation();
        node.select();
        onContextMenu(e, node);
      }}
    >
      <div 
        className="flex items-center flex-1 pr-2"
        style={{ paddingLeft: `${node.level * 16 + 8}px` }}
      >
        {isFolder ? (
          <div 
            className="mr-1 flex h-4 w-4 items-center justify-center text-[var(--wb-text-dim)] hover:text-[var(--wb-text)]"
            onClick={(e) => {
              e.stopPropagation();
              node.toggle();
            }}
          >
            {node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        ) : (
          <div className="w-5" /> // Spacer for alignment
        )}

        {getFileIcon(node.data, node.isOpen)}

        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className="h-6 min-w-0 flex-1 rounded border border-[var(--wb-accent)] bg-[var(--wb-editor)] px-1 text-sm text-[var(--wb-text)] outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 truncate">{node.data.name}</span>
            {!isSynthetic && node.data.tags && node.data.tags.length > 0 && (
              <span className="truncate rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-[var(--wb-text-dim)]">
                {node.data.tags.slice(0, 2).join(', ')}
                {node.data.tags.length > 2 ? ` +${node.data.tags.length - 2}` : ''}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

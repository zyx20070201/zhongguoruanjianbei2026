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
    return <Tag size={16} className="mr-2 flex-shrink-0 text-[#c47a19]" />;
  }

  if (node.nodeType === 'folder') {
    return isOpen ? (
      <FolderOpen size={16} className="mr-2 flex-shrink-0 text-[#70757a]" />
    ) : (
      <Folder size={16} className="mr-2 flex-shrink-0 text-[#70757a]" />
    );
  }

  const ext = node.extension?.toLowerCase().replace(/^\./, '') || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) {
    return <Image size={16} className="mr-2 flex-shrink-0 text-[#7d8da1]" />;
  }
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'yaml', 'yml', 'xml'].includes(ext)) {
    return <Code size={16} className="mr-2 flex-shrink-0 text-[#1683ff]" />;
  }
  return <FileText size={16} className="mr-2 flex-shrink-0 text-[#8f9398]" />;
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
  const guideLines = Array.from({ length: Math.max(0, node.level) });
  const contentOffset = node.level * 14 + 10;

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`
        group relative flex items-center rounded-lg py-1 text-sm select-none transition-colors
        cursor-pointer
        ${node.isDragging ? 'opacity-50' : ''}
        ${node.willReceiveDrop ? 'bg-[#e8f2ff] text-[#202124] ring-1 ring-inset ring-[#acd3ff]' : ''}
        ${node.isSelected && !node.willReceiveDrop ? 'bg-[#f1f1ef] text-[#202124]' : ''}
        ${!node.isSelected && !node.willReceiveDrop ? 'text-[#2f3337] hover:bg-[#f6f6f4] hover:text-[#202124]' : ''}
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
      {guideLines.map((_, index) => (
        <span
          key={index}
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-[#e4e4e0]"
          style={{ left: `${index * 14 + 18}px` }}
        />
      ))}
      <div 
        className="flex items-center flex-1 pr-2"
        style={{ paddingLeft: `${contentOffset}px` }}
      >
        {isFolder ? (
          <div 
            className="mr-1 flex h-4 w-4 items-center justify-center text-[#7f8388] hover:text-[#202124]"
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
              <span className="truncate rounded bg-[#eef4fb] px-1.5 py-0.5 text-[10px] text-[#64748b]">
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

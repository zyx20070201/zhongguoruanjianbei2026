import React, { useState } from 'react';
import { NodeApi } from 'react-arborist';
import { FileSystemObject } from '../../types';
import { 
  ChevronRight, 
  ChevronDown, 
  File, 
  Folder, 
  FolderOpen,
  Image,
  FileText,
  Code
} from 'lucide-react';

interface FileTreeNodeProps {
  node: NodeApi<FileSystemObject>;
  style: React.CSSProperties;
  onContextMenu: (e: React.MouseEvent, node: NodeApi<FileSystemObject>) => void;
  onDoubleClick: (node: NodeApi<FileSystemObject>) => void;
}

const getFileIcon = (node: FileSystemObject, isOpen: boolean) => {
  if (node.nodeType === 'folder') {
    return isOpen ? (
      <FolderOpen size={16} className="text-blue-500 mr-1.5 flex-shrink-0" />
    ) : (
      <Folder size={16} className="text-blue-500 mr-1.5 flex-shrink-0" />
    );
  }

  const ext = node.extension?.toLowerCase() || '';
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext)) {
    return <Image size={16} className="text-purple-500 mr-1.5 flex-shrink-0" />;
  }
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.c', '.cpp', '.html', '.css'].includes(ext)) {
    return <Code size={16} className="text-yellow-500 mr-1.5 flex-shrink-0" />;
  }
  return <FileText size={16} className="text-gray-500 mr-1.5 flex-shrink-0" />;
};

export const FileTreeNode: React.FC<FileTreeNodeProps> = ({ 
  node, 
  style, 
  onContextMenu,
  onDoubleClick
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(node.data.name);

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

  return (
    <div
      style={style}
      className={`
        flex items-center group cursor-pointer text-sm py-1 select-none
        ${node.isSelected ? 'bg-blue-100 text-blue-900' : 'hover:bg-gray-100 text-gray-700'}
      `}
      onClick={() => {
        if (isFolder) {
          node.toggle();
        } else {
          node.select();
        }
      }}
      onDoubleClick={() => {
        if (!isFolder) {
          onDoubleClick(node);
        }
      }}
      onContextMenu={(e) => {
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
            className="w-4 h-4 flex items-center justify-center mr-1 text-gray-400 hover:text-gray-600"
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
            className="flex-1 bg-white border border-blue-400 rounded px-1 outline-none text-sm h-6 min-w-0"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{node.data.name}</span>
        )}
      </div>
    </div>
  );
};

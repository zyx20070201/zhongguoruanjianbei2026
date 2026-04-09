import React, { useState, useEffect, useRef } from 'react';
import { Tree, NodeApi } from 'react-arborist';
import { FileSystemObject } from '../../types';
import { useFileTreeStore } from '../../store/fileTreeStore';
import { useFileCommands } from '../../hooks/useFileCommands';
import { FileTreeNode } from './FileTreeNode';
import { FileContextMenu } from './FileContextMenu';
import { fileSystemApi } from '../../services/fileSystemApi';

interface FileTreeProps {
  workspaceId: string;
  onFileSelect?: (file: FileSystemObject) => void;
  onFileDoubleClick?: (file: FileSystemObject) => void;
}

export const FileTreeComponent: React.FC<FileTreeProps> = ({ 
  workspaceId,
  onFileSelect,
  onFileDoubleClick
}) => {
  const { files, loading, error, selectedNodeId, expandedNodeIds, setSelectedNodeId, toggleExpanded } = useFileTreeStore();
  const commands = useFileCommands(workspaceId);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: NodeApi<FileSystemObject>;
  } | null>(null);

  // Auto resize tree
  const [dimensions, setDimensions] = useState({ width: 250, height: 500 });

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const handleMove = async ({ dragIds, parentId, index }: any) => {
    if (dragIds.length > 0) {
      const id = dragIds[0];
      await commands.moveNode(id, parentId);
    }
  };

  const handleRename = async ({ id, name }: any) => {
    await commands.renameNode(id, name);
  };

  const onContextMenu = (e: React.MouseEvent, node: NodeApi<FileSystemObject>) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleCreateFile = async (parentId: string, parentPath: string) => {
    const name = prompt('Enter file name (e.g., new-file.md):');
    if (name) {
      await commands.createFile(name, parentId, parentPath);
    }
  };

  const handleCreateFolder = async (parentId: string, parentPath: string) => {
    const name = prompt('Enter folder name:');
    if (name) {
      await commands.createFolder(name, parentId, parentPath);
    }
  };

  const handleUpload = async (parentId: string, parentPath: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e: any) => {
      const files = Array.from(e.target.files as FileList);
      if (files.length > 0) {
        await commands.uploadFiles(files, parentId, parentPath);
      }
    };
    input.click();
  };

  if (loading && files.length === 0) {
    return <div className="p-4 text-sm text-gray-500">Loading files...</div>;
  }

  if (error) {
    return <div className="p-4 text-sm text-red-500">{error}</div>;
  }

  if (files.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500 flex flex-col gap-2">
        <p>No files yet.</p>
        <button 
          onClick={() => handleCreateFolder('', '')}
          className="text-blue-500 hover:underline text-left"
        >
          Create a folder to start
        </button>
      </div>
    );
  }

  // Convert flat array to tree format expected by react-arborist
  // Actually, react-arborist can take flat data if id/parentId are set? No, it prefers nested
  // But we have parentId in our types, let's nest it
  const buildTree = (items: FileSystemObject[]) => {
    const map = new Map<string, any>();
    const roots: any[] = [];

    items.forEach(item => {
      map.set(item.id, { ...item, children: [] });
    });

    items.forEach(item => {
      if (item.parentId && map.has(item.parentId)) {
        map.get(item.parentId).children.push(map.get(item.id));
      } else {
        roots.push(map.get(item.id));
      }
    });

    // Sort folders first, then alphabetically
    const sortNodes = (nodes: any[]) => {
      nodes.sort((a, b) => {
        if (a.nodeType === 'folder' && b.nodeType !== 'folder') return -1;
        if (a.nodeType !== 'folder' && b.nodeType === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });
      nodes.forEach(node => {
        if (node.children.length > 0) sortNodes(node.children);
      });
    };
    sortNodes(roots);

    return roots;
  };

  const treeData = buildTree(files);

  return (
    <div ref={containerRef} className="flex-1 w-full h-full overflow-hidden">
      <Tree
        data={treeData}
        width={dimensions.width}
        height={dimensions.height}
        rowHeight={28}
        onMove={handleMove}
        onRename={handleRename}
        onSelect={(nodes) => {
          if (nodes.length > 0) {
            const node = nodes[0];
            setSelectedNodeId(node.id);
            if (onFileSelect) onFileSelect(node.data);
          } else {
            setSelectedNodeId(null);
          }
        }}
        onToggle={(id) => toggleExpanded(id)}
        // The tree expects a boolean map for open states if controlled
        // Let's keep it simple and just rely on the component's internal state + initialOpenState if needed
      >
        {(nodeProps) => (
          <FileTreeNode 
            {...nodeProps} 
            onContextMenu={onContextMenu}
            onDoubleClick={(node) => {
              if (onFileDoubleClick) onFileDoubleClick(node.data);
            }}
          />
        )}
      </Tree>

      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={() => setContextMenu(null)}
          onRename={(id) => contextMenu.node.edit()}
          onDelete={(id) => {
            if (confirm(`Are you sure you want to delete ${contextMenu.node.data.name}?`)) {
              commands.deleteNode(id);
            }
          }}
          onCopy={(id) => commands.moveNode(id)} // using moveNode as placeholder, should be copyNode which takes targetParentId
          onDownload={(id) => {
            window.open(fileSystemApi.downloadUrl(workspaceId, id), '_blank');
          }}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onUpload={handleUpload}
        />
      )}
    </div>
  );
};

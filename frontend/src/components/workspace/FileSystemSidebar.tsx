import React from 'react';
import { FileTreeComponent } from '../files/FileTree';
import { useFileTree } from '../../hooks/useFileTree';
import { FileSystemObject } from '../../types';
import { Plus, FolderPlus, Upload, RefreshCw } from 'lucide-react';
import { useFileCommands } from '../../hooks/useFileCommands';

interface FileSystemSidebarProps {
  workspaceId: string;
  onFileSelect?: (file: FileSystemObject) => void;
  onFileDoubleClick?: (file: FileSystemObject) => void;
}

export const FileSystemSidebar: React.FC<FileSystemSidebarProps> = ({
  workspaceId,
  onFileSelect,
  onFileDoubleClick
}) => {
  const { refresh, loading } = useFileTree(workspaceId);
  const { createFolder, createFile, uploadFiles } = useFileCommands(workspaceId);

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e: any) => {
      const files = Array.from(e.target.files as FileList);
      if (files.length > 0) {
        await uploadFiles(files);
      }
    };
    input.click();
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200 w-64">
      <div className="p-3 border-b border-gray-200 flex items-center justify-between bg-white">
        <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wider">Files</h2>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => createFile('new-file.md')}
            className="p-1 hover:bg-gray-100 rounded text-gray-500" 
            title="New File"
          >
            <Plus size={16} />
          </button>
          <button 
            onClick={() => createFolder('New Folder')}
            className="p-1 hover:bg-gray-100 rounded text-gray-500" 
            title="New Folder"
          >
            <FolderPlus size={16} />
          </button>
          <button 
            onClick={handleUpload}
            className="p-1 hover:bg-gray-100 rounded text-gray-500" 
            title="Upload"
          >
            <Upload size={16} />
          </button>
          <button 
            onClick={refresh}
            className={`p-1 hover:bg-gray-100 rounded text-gray-500 ${loading ? 'animate-spin' : ''}`}
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-hidden flex flex-col">
        <FileTreeComponent 
          workspaceId={workspaceId}
          onFileSelect={onFileSelect}
          onFileDoubleClick={onFileDoubleClick}
        />
      </div>
    </div>
  );
};

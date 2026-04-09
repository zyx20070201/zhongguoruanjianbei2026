import { FileSystemError } from '../types/fileSystem';

export const validateWorkspaceId = (workspaceId: string) => {
  if (!workspaceId) {
    throw new FileSystemError(400, 'Workspace ID is required');
  }
};

export const validateNodeId = (id: string) => {
  if (!id) {
    throw new FileSystemError(400, 'Node ID is required');
  }
};

export const validateName = (name: string) => {
  if (!name || name.trim() === '') {
    throw new FileSystemError(400, 'Name is required');
  }
  if (name.includes('/')) {
    throw new FileSystemError(400, 'Name cannot contain slashes');
  }
};

export const validatePath = (path: string) => {
  if (!path || !path.startsWith('/')) {
    throw new FileSystemError(400, 'Invalid path format');
  }
};

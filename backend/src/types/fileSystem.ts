export interface CreateFolderDTO {
  workspaceId: string;
  name: string;
  parentId?: string;
  parentPath?: string;
}

export interface CreateFileDTO {
  workspaceId: string;
  name: string;
  content?: string;
  parentId?: string;
  parentPath?: string;
  fileCategory?: string;
  tags?: string[];
}

export interface RenameNodeDTO {
  workspaceId: string;
  id: string;
  newName: string;
}

export interface MoveNodeDTO {
  workspaceId: string;
  id: string;
  targetParentId?: string;
}

export interface CopyNodeDTO {
  workspaceId: string;
  id: string;
  targetParentId?: string;
}

export interface SaveGeneratedContentDTO {
  workspaceId: string;
  targetDir: string;
  filename: string;
  content: string;
  category?: string;
}

export interface UpdateNodeTagsDTO {
  workspaceId: string;
  id: string;
  tags: string[];
}

export class FileSystemError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'FileSystemError';
  }
}

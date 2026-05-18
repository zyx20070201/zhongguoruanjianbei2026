export interface CreateFolderDTO {
  workspaceId: string;
  name: string;
  parentId?: string;
  parentPath?: string;
  workbenchId?: string;
  resourceRole?: string;
  scope?: 'workspace' | 'workbench' | string;
}

export interface CreateFileDTO {
  workspaceId: string;
  name: string;
  content?: string;
  parentId?: string;
  parentPath?: string;
  fileCategory?: string;
  mimeType?: string;
  tags?: string[];
  workbenchId?: string;
  resourceRole?: string;
  resourceType?: string;
  scope?: 'workspace' | 'workbench' | string;
  origin?: string;
  metadata?: Record<string, unknown>;
  indexInBackground?: boolean;
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
  targetDir?: string;
  filename: string;
  content: string | Buffer;
  category?: string;
  mimeType?: string;
  isBinary?: boolean;
  workbenchId?: string;
  resourceRole?: string;
  resourceType?: string;
  scope?: 'workspace' | 'workbench' | string;
  origin?: string;
  metadata?: Record<string, unknown>;
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

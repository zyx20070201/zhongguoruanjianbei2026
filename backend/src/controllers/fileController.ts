import { Request, Response } from 'express';
import { FileSystemService } from '../services/fileSystemService';
import { 
  validateWorkspaceId, 
  validateNodeId, 
  validateName 
} from '../validators/fileSystemValidators';
import { FileSystemError } from '../types/fileSystem';

const getSingleParam = (value: any): string => {
  if (Array.isArray(value)) return String(value[0]);
  if (value == null) return '';
  return String(value);
};

const handleError = (res: Response, error: any) => {
  if (error instanceof FileSystemError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({ error: error.message || 'Internal server error' });
};

// 1. Get File Tree
export const getFileTree = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    validateWorkspaceId(workspaceId);
    
    const tree = await FileSystemService.getFileTree(workspaceId);
    res.json(tree);
  } catch (error: any) {
    handleError(res, error);
  }
};

// 2. Initialize Default File System
export const initFileSystem = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    validateWorkspaceId(workspaceId);

    const result = await FileSystemService.initFileSystem(workspaceId);
    res.json(result);
  } catch (error: any) {
    handleError(res, error);
  }
};

// 3. Create Folder
export const createFolder = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { name, parentId, parentPath } = req.body;
    
    validateWorkspaceId(workspaceId);
    validateName(name);

    const folder = await FileSystemService.createFolder({
      workspaceId,
      name,
      parentId,
      parentPath
    });
    res.json(folder);
  } catch (error: any) {
    handleError(res, error);
  }
};

// 4. Create File
export const createFile = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { name, content, parentId, parentPath, fileCategory } = req.body;
    
    validateWorkspaceId(workspaceId);
    validateName(name);

    const file = await FileSystemService.createFile({
      workspaceId,
      name,
      content,
      parentId,
      parentPath,
      fileCategory
    });
    res.json(file);
  } catch (error: any) {
    handleError(res, error);
  }
};

// 5. Rename Node
export const renameNode = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { id, newName } = req.body;
    
    validateWorkspaceId(workspaceId);
    validateNodeId(id);
    validateName(newName);

    const node = await FileSystemService.renameNode({
      workspaceId,
      id,
      newName
    });
    res.json(node);
  } catch (error: any) {
    handleError(res, error);
  }
};

// 6. Move Node
export const moveNode = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { id, targetParentId } = req.body;
    
    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    const node = await FileSystemService.moveNode({
      workspaceId,
      id,
      targetParentId
    });
    res.json(node);
  } catch (error: any) {
    handleError(res, error);
  }
};

// 7. Delete Node
export const deleteNode = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const id = getSingleParam(req.query.id || req.body.id);
    
    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    await FileSystemService.deleteNode(workspaceId, id);
    res.json({ success: true });
  } catch (error: any) {
    handleError(res, error);
  }
};

// 8. Copy Node
export const copyNode = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { id, targetParentId } = req.body;
    
    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    const node = await FileSystemService.copyNode({
      workspaceId,
      id,
      targetParentId
    });
    res.json(node);
  } catch (error: any) {
    handleError(res, error);
  }
};

// 9. Upload Files
export const uploadFiles = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    // When using multer, files are in req.files
    const files = (req as any).files as any[];
    const { parentId, parentPath } = req.body;
    
    validateWorkspaceId(workspaceId);

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    
    const results = [];
    for (const file of files) {
      try {
        const created = await FileSystemService.handleUploadedFile(
          workspaceId,
          file,
          parentId,
          parentPath
        );
        results.push({ success: true, file: created });
      } catch (err: any) {
        results.push({ success: false, name: file.originalname, error: err.message });
      }
    }
    res.json(results);
  } catch (error: any) {
    handleError(res, error);
  }
};

// 10. Download File
export const downloadFile = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const id = getSingleParam(req.query.id);
    
    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    // we need to query db to get storageKey
    const { prisma } = require('../config/db');
    
    const file = await prisma.fileSystemObject.findFirst({
      where: { id, workspaceId }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (file.nodeType !== 'file') {
      return res.status(400).json({ error: 'Cannot download a folder' });
    }

    if (!file.storageKey) {
      // It's a text file stored directly in DB content field
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
      res.setHeader('Content-Type', file.mimeType || 'text/plain');
      return res.send(file.content || '');
    }

    // It's a real file stored on disk
    const { LocalStorageService } = require('../services/storage/localStorageService');
    const filePath = LocalStorageService.getFilePath(file.storageKey);
    
    res.download(filePath, file.name, (err) => {
      if (err) {
        console.error('Download error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to download file' });
        }
      }
    });

  } catch (error: any) {
    handleError(res, error);
  }
};

// 11. Get File Content
export const getFileContent = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const id = getSingleParam(req.query.id);
    
    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    const content = await FileSystemService.getFileContent(workspaceId, id);
    res.json({ content });
  } catch (error: any) {
    handleError(res, error);
  }
};

// 12. Save File Content
export const saveFileContent = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { id, content } = req.body;
    
    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    const file = await FileSystemService.saveFileContent(workspaceId, id, content);
    res.json(file);
  } catch (error: any) {
    handleError(res, error);
  }
};

// 13. Save Generated Content
export const saveGeneratedContent = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { targetDir, filename, content, category } = req.body;
    
    validateWorkspaceId(workspaceId);
    if (!targetDir) throw new FileSystemError(400, 'Target directory is required');
    if (!filename) throw new FileSystemError(400, 'Filename is required');

    const file = await FileSystemService.saveGeneratedContent({
      workspaceId,
      targetDir,
      filename,
      content,
      category
    });
    res.json(file);
  } catch (error: any) {
    handleError(res, error);
  }
};

// Legacy endpoints for compatibility - pointing to new services where possible
export const createFileObject = async (req: Request, res: Response) => {
  try {
    const { name, type, path, content, mimeType, workspaceId, parentId } = req.body;
    validateWorkspaceId(workspaceId);
    validateName(name);

    if (type === 'folder') {
      const folder = await FileSystemService.createFolder({ workspaceId, name, parentId });
      res.json({ fileObject: folder });
    } else {
      const file = await FileSystemService.createFile({ workspaceId, name, content, parentId, fileCategory: type });
      res.json({ fileObject: file });
    }
  } catch (error: any) {
    handleError(res, error);
  }
};

export const updateFileObject = async (req: Request, res: Response) => {
  try {
    const id = getSingleParam(req.params.id);
    const { name, content, path } = req.body;
    // this is a bit messy in legacy, ignoring path updates here, just handle rename and content save
    if (content !== undefined) {
      // Try to find workspaceId... this is why legacy is bad
      // Assuming we can't easily get workspaceId here without extra query. Just fallback to simple prisma
      // Actually we'll just mock a 500 if we can't find it to force migration
      throw new FileSystemError(400, 'Please use new file system endpoints for updating');
    }
  } catch (error: any) {
    handleError(res, error);
  }
};

export const deleteFileObject = async (req: Request, res: Response) => {
  try {
    throw new FileSystemError(400, 'Please use new file system endpoints for deletion');
  } catch (error: any) {
    handleError(res, error);
  }
};

export const getFileObject = async (req: Request, res: Response) => {
  try {
    throw new FileSystemError(400, 'Please use new file system endpoints to get objects');
  } catch (error: any) {
    handleError(res, error);
  }
};
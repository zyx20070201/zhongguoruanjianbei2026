import prisma from '../config/db';
import { 
  CreateFolderDTO, 
  CreateFileDTO, 
  RenameNodeDTO, 
  MoveNodeDTO, 
  CopyNodeDTO, 
  SaveGeneratedContentDTO,
  FileSystemError 
} from '../types/fileSystem';
import { 
  generateNewPath, 
  getExtension, 
  replacePathPrefix, 
  isDescendant, 
  generateUniqueFilename 
} from '../utils/path';
import { LocalStorageService } from './storage/localStorageService';

export class FileSystemService {
  // 1. Get File Tree
  static async getFileTree(workspaceId: string) {
    return await prisma.fileSystemObject.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' }
    });
  }

  // 2. Initialize Default File System
  static async initFileSystem(workspaceId: string) {
    const existingFiles = await prisma.fileSystemObject.findMany({
      where: { workspaceId },
    });

    if (existingFiles.length > 0) {
      return existingFiles;
    }

    const defaultFolders = ['materials', 'notes', 'code', 'resources', 'prompts'];
    const createdFolders = [];

    for (const folderName of defaultFolders) {
      const folder = await prisma.fileSystemObject.create({
        data: {
          name: folderName,
          nodeType: 'folder',
          fileCategory: 'other',
          path: `/${folderName}`,
          workspaceId,
        },
      });
      createdFolders.push(folder);
    }

    return createdFolders;
  }

  // 3. Create Folder
  static async createFolder(dto: CreateFolderDTO) {
    const { workspaceId, name, parentId, parentPath } = dto;
    
    const path = generateNewPath(parentPath, name);

    // Check for conflict
    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path } }
    });
    if (existing) throw new FileSystemError(409, 'Folder already exists at this path');

    return await prisma.fileSystemObject.create({
      data: {
        name,
        nodeType: 'folder',
        fileCategory: 'other',
        path,
        workspaceId,
        parentId,
      },
    });
  }

  // 4. Create File
  static async createFile(dto: CreateFileDTO) {
    const { workspaceId, name, content, parentId, parentPath, fileCategory } = dto;
    
    const path = generateNewPath(parentPath, name);
    const extension = getExtension(name);

    // Check for conflict
    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path } }
    });
    if (existing) throw new FileSystemError(409, 'File already exists at this path');

    let storageKey: string | undefined;
    let size: number | undefined;

    if (content !== undefined) {
      const storage = await LocalStorageService.saveTextFile(content);
      storageKey = storage.storageKey;
      size = storage.size;
    }

    return await prisma.fileSystemObject.create({
      data: {
        name,
        nodeType: 'file',
        fileCategory: fileCategory || 'document',
        extension,
        path,
        content, // Keep content in DB for small text files if needed, but we have storage now
        storageKey,
        size,
        workspaceId,
        parentId,
      },
    });
  }

  // 4b. Handle Uploaded File
  static async handleUploadedFile(workspaceId: string, file: any, parentId?: string, parentPath?: string) {
    const path = generateNewPath(parentPath, file.originalname);
    const extension = getExtension(file.originalname);

    // Check for conflict
    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path } }
    });
    if (existing) throw new FileSystemError(409, `File ${file.originalname} already exists at this path`);

    const { storageKey, size } = await LocalStorageService.saveUploadedFile(file.path);
    
    const isBinary = !file.mimetype.startsWith('text/') && file.mimetype !== 'application/json';

    return await prisma.fileSystemObject.create({
      data: {
        name: file.originalname,
        nodeType: 'file',
        fileCategory: 'document',
        extension,
        path,
        mimeType: file.mimetype,
        storageKey,
        size,
        isBinary,
        workspaceId,
        parentId,
      },
    });
  }

  // 5. Rename Node
  static async renameNode(dto: RenameNodeDTO) {
    const { workspaceId, id, newName } = dto;

    const node = await prisma.fileSystemObject.findUnique({ where: { id } });
    if (!node) throw new FileSystemError(404, 'Node not found');

    const oldPath = node.path;
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = generateNewPath(parentPath, newName);

    if (newPath === oldPath) return node;

    // Check for conflict
    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path: newPath } }
    });
    if (existing) throw new FileSystemError(409, 'A node with this name already exists in the target directory');

    return await prisma.$transaction(async (tx: any) => {
      const updatedNode = await tx.fileSystemObject.update({
        where: { id },
        data: { name: newName, path: newPath },
      });

      if (node.nodeType === 'folder') {
        const children = await tx.fileSystemObject.findMany({
          where: {
            workspaceId,
            path: { startsWith: `${oldPath}/` }
          }
        });

        for (const child of children) {
          const childNewPath = replacePathPrefix(child.path, newPath, oldPath);
          await tx.fileSystemObject.update({
            where: { id: child.id },
            data: { path: childNewPath }
          });
        }
      }
      return updatedNode;
    });
  }

  // 6. Move Node
  static async moveNode(dto: MoveNodeDTO) {
    const { workspaceId, id, targetParentId } = dto;

    const node = await prisma.fileSystemObject.findUnique({ where: { id } });
    if (!node) throw new FileSystemError(404, 'Node not found');

    let newParentPath = '';
    if (targetParentId) {
      const targetParent = await prisma.fileSystemObject.findUnique({ where: { id: targetParentId } });
      if (!targetParent) throw new FileSystemError(404, 'Target parent not found');
      if (targetParent.nodeType !== 'folder') throw new FileSystemError(400, 'Target is not a folder');
      
      if (isDescendant(targetParent.path, node.path) || targetParent.id === node.id) {
        throw new FileSystemError(400, 'Cannot move a folder into itself or its children');
      }
      
      newParentPath = targetParent.path;
    }

    const oldPath = node.path;
    const newPath = generateNewPath(newParentPath, node.name);

    if (newPath === oldPath) return node;

    // Check for conflict
    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path: newPath } }
    });
    if (existing) throw new FileSystemError(409, 'A node with this name already exists in the target directory');

    return await prisma.$transaction(async (tx: any) => {
      const updatedNode = await tx.fileSystemObject.update({
        where: { id },
        data: { parentId: targetParentId || null, path: newPath },
      });

      if (node.nodeType === 'folder') {
        const children = await tx.fileSystemObject.findMany({
          where: {
            workspaceId,
            path: { startsWith: `${oldPath}/` }
          }
        });

        for (const child of children) {
          const childNewPath = replacePathPrefix(child.path, newPath, oldPath);
          await tx.fileSystemObject.update({
            where: { id: child.id },
            data: { path: childNewPath }
          });
        }
      }
      return updatedNode;
    });
  }

  // 7. Delete Node
  static async deleteNode(workspaceId: string, id: string) {
    const node = await prisma.fileSystemObject.findUnique({ 
      where: { id },
      include: { children: true } 
    });
    if (!node) throw new FileSystemError(404, 'Node not found');

    const objectsToDelete = [];
    if (node.nodeType === 'folder') {
      const descendants = await prisma.fileSystemObject.findMany({
        where: { workspaceId, path: { startsWith: `${node.path}/` } }
      });
      objectsToDelete.push(node, ...descendants);
    } else {
      objectsToDelete.push(node);
    }

    const result = await prisma.$transaction(async (tx: any) => {
      if (node.nodeType === 'folder') {
        await tx.fileSystemObject.deleteMany({
          where: {
            workspaceId,
            path: { startsWith: `${node.path}/` }
          }
        });
      }
      return await tx.fileSystemObject.delete({ where: { id } });
    });

    // Cleanup storage after successful DB deletion
    for (const obj of objectsToDelete) {
      if (obj.storageKey) {
        await LocalStorageService.deleteFile(obj.storageKey);
      }
    }

    return result;
  }

  // 8. Copy Node
  static async copyNode(dto: CopyNodeDTO) {
    const { workspaceId, id, targetParentId } = dto;

    const node = await prisma.fileSystemObject.findUnique({ where: { id } });
    if (!node) throw new FileSystemError(404, 'Node not found');

    let targetParentPath = '';
    if (targetParentId) {
      const targetParent = await prisma.fileSystemObject.findUnique({ where: { id: targetParentId } });
      if (!targetParent) throw new FileSystemError(404, 'Target parent not found');
      if (targetParent.nodeType !== 'folder') throw new FileSystemError(400, 'Target is not a folder');
      targetParentPath = targetParent.path;
    }

    // Get existing names in target directory to avoid conflict
    const siblings = await prisma.fileSystemObject.findMany({
      where: { workspaceId, parentId: targetParentId || null },
      select: { name: true }
    });
    const existingNames = new Set<string>(siblings.map((s: { name: string }) => s.name));
    
    const newName = generateUniqueFilename(node.name, existingNames);
    const newPath = generateNewPath(targetParentPath, newName);

    if (node.nodeType === 'file') {
      return await prisma.fileSystemObject.create({
        data: {
          name: newName,
          nodeType: 'file',
          fileCategory: node.fileCategory,
          extension: node.extension,
          path: newPath,
          content: node.content,
          workspaceId,
          parentId: targetParentId || null,
        },
      });
    } else {
      // Folder copy
      return await prisma.$transaction(async (tx: any) => {
        const newFolder = await tx.fileSystemObject.create({
          data: {
            name: newName,
            nodeType: 'folder',
            fileCategory: node.fileCategory,
            path: newPath,
            workspaceId,
            parentId: targetParentId || null,
          },
        });

        const children = await tx.fileSystemObject.findMany({
          where: {
            workspaceId,
            path: { startsWith: `${node.path}/` }
          },
          orderBy: { path: 'asc' }
        });

        // Map old parentId to new parentId for recursive copy
        const idMap: Record<string, string> = { [node.id]: newFolder.id };

        for (const child of children) {
          const childNewPath = replacePathPrefix(child.path, newPath, node.path);
          const newChild = await tx.fileSystemObject.create({
            data: {
              name: child.name,
              nodeType: child.nodeType,
              fileCategory: child.fileCategory,
              extension: child.extension,
              path: childNewPath,
              content: child.content,
              workspaceId,
              parentId: idMap[child.parentId!] || newFolder.id,
            }
          });
          if (child.nodeType === 'folder') {
            idMap[child.id] = newChild.id;
          }
        }
        return newFolder;
      });
    }
  }

  // 9. Get File Content
  static async getFileContent(workspaceId: string, id: string) {
    const file = await prisma.fileSystemObject.findUnique({ where: { id, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');
    
    if (file.isBinary) throw new FileSystemError(400, 'Cannot read content of a binary file as text');

    if (file.storageKey) {
      try {
        return await LocalStorageService.readTextFile(file.storageKey);
      } catch (e) {
        return file.content || '';
      }
    }
    return file.content || '';
  }

  // 10. Save File Content
  static async saveFileContent(workspaceId: string, id: string, content: string) {
    const file = await prisma.fileSystemObject.findUnique({ where: { id, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Cannot save content to a folder');
    if (file.isBinary) throw new FileSystemError(400, 'Cannot save text content to a binary file');

    const { storageKey, size } = await LocalStorageService.saveTextFile(content, file.storageKey || undefined);

    return await prisma.fileSystemObject.update({
      where: { id, workspaceId },
      data: { content, storageKey, size },
    });
  }

  // 11. Save Generated Content
  static async saveGeneratedContent(dto: SaveGeneratedContentDTO) {
    const { workspaceId, targetDir, filename, content, category } = dto;

    // Find or create target directory
    let folder = await prisma.fileSystemObject.findFirst({
      where: { workspaceId, path: targetDir, nodeType: 'folder' }
    });

    if (!folder) {
      // Recursively create folders if needed? 
      // For now, just create the last one as per existing logic, but better
      const parts = targetDir.split('/').filter(p => p);
      let currentParentId: string | undefined = undefined;
      let currentPath = '';

      for (const part of parts) {
        currentPath += `/${part}`;
        let currentFolder = await prisma.fileSystemObject.findUnique({
          where: { workspaceId_path: { workspaceId, path: currentPath } }
        });

        if (!currentFolder) {
          currentFolder = await prisma.fileSystemObject.create({
            data: {
              name: part,
              nodeType: 'folder',
              fileCategory: 'other',
              path: currentPath,
              workspaceId,
              parentId: currentParentId
            }
          });
        }
        currentParentId = currentFolder.id;
        folder = currentFolder;
      }
    }

    if (!folder) throw new FileSystemError(500, 'Failed to ensure target directory');

    // Handle duplicate filenames
    const siblings = await prisma.fileSystemObject.findMany({
      where: { workspaceId, parentId: folder.id },
      select: { name: true }
    });
    const existingNames = new Set<string>(siblings.map((s: { name: string }) => s.name));
    const finalFilename = generateUniqueFilename(filename, existingNames);
    
    const extension = getExtension(finalFilename);
    const newPath = generateNewPath(folder.path, finalFilename);

    const { storageKey, size } = await LocalStorageService.saveTextFile(content);

    return await prisma.fileSystemObject.create({
      data: {
        name: finalFilename,
        nodeType: 'file',
        fileCategory: category || 'generated',
        extension,
        path: newPath,
        content,
        storageKey,
        size,
        workspaceId,
        parentId: folder.id,
      }
    });
  }
}

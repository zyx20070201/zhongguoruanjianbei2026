import prisma from '../config/db';
import {
  CopyNodeDTO,
  CreateFileDTO,
  CreateFolderDTO,
  FileSystemError,
  MoveNodeDTO,
  RenameNodeDTO,
  SaveGeneratedContentDTO,
  UpdateNodeTagsDTO
} from '../types/fileSystem';
import {
  generateNewPath,
  generateUniqueFilename,
  getExtension,
  isDescendant,
  replacePathPrefix
} from '../utils/path';
import { LocalStorageService } from './storage/localStorageService';
import { inferFileCategory, isTextLikeFile } from './fileTypeService';

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/;
const SUSPICIOUS_LATIN1_PATTERN = /[À-ÿ]/;

const normalizePossiblyMojibakeName = (value: string) => {
  if (!value || CJK_PATTERN.test(value) || !SUSPICIOUS_LATIN1_PATTERN.test(value)) {
    return value;
  }

  try {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (!decoded || decoded.includes('\uFFFD')) {
      return value;
    }

    return CJK_PATTERN.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
};

const normalizeTags = (value: unknown): string[] => {
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];

  const unique = new Set<string>();
  for (const tag of rawTags) {
    const normalized = String(tag).trim();
    if (!normalized) continue;
    unique.add(normalized);
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
};

const parseStoredTags = (value: string | null | undefined) => {
  if (!value) return [];

  try {
    return normalizeTags(JSON.parse(value));
  } catch {
    return normalizeTags(value);
  }
};

const serializeTags = (tags: unknown) => JSON.stringify(normalizeTags(tags));

const mapFileSystemObject = (node: any) => ({
  ...node,
  tags: parseStoredTags(node.tags)
});

export class FileSystemService {
  private static async repairNormalizedNames(workspaceId: string) {
    const nodes = await prisma.fileSystemObject.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' }
    });

    for (const node of nodes) {
      const normalizedName = normalizePossiblyMojibakeName(node.name);
      if (normalizedName === node.name) {
        continue;
      }

      const parentPath = node.path.slice(0, node.path.lastIndexOf('/'));
      const normalizedPath = generateNewPath(parentPath, normalizedName);
      const existing = await prisma.fileSystemObject.findUnique({
        where: { workspaceId_path: { workspaceId, path: normalizedPath } }
      });

      if (existing && existing.id !== node.id) {
        continue;
      }

      await prisma.$transaction(async (tx: any) => {
        await tx.fileSystemObject.update({
          where: { id: node.id },
          data: {
            name: normalizedName,
            path: normalizedPath,
            extension: node.nodeType === 'file' ? getExtension(normalizedName) : node.extension
          }
        });

        if (node.nodeType === 'folder') {
          const children = await tx.fileSystemObject.findMany({
            where: {
              workspaceId,
              path: { startsWith: `${node.path}/` }
            }
          });

          for (const child of children) {
            await tx.fileSystemObject.update({
              where: { id: child.id },
              data: { path: replacePathPrefix(child.path, normalizedPath, node.path) }
            });
          }
        }
      });
    }
  }

  static async getFileTree(workspaceId: string) {
    await FileSystemService.repairNormalizedNames(workspaceId);
    const nodes = await prisma.fileSystemObject.findMany({
      where: { workspaceId },
      orderBy: [{ nodeType: 'asc' }, { name: 'asc' }]
    });

    return nodes.map((node) => mapFileSystemObject(node));
  }

  static async initFileSystem(workspaceId: string) {
    const existingFiles = await prisma.fileSystemObject.findMany({
      where: { workspaceId }
    });

    return existingFiles.map((node) => mapFileSystemObject(node));
  }

  static async createFolder(dto: CreateFolderDTO) {
    const { workspaceId, name, parentId, parentPath } = dto;
    const path = generateNewPath(parentPath, name);

    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path } }
    });
    if (existing) throw new FileSystemError(409, 'Folder already exists at this path');

    return prisma.fileSystemObject.create({
      data: {
        name,
        nodeType: 'folder',
        fileCategory: 'other',
        tags: '[]',
        path,
        workspaceId,
        parentId
      }
    }).then((node) => mapFileSystemObject(node));
  }

  static async createFile(dto: CreateFileDTO) {
    const { workspaceId, name, content, parentId, parentPath, fileCategory, tags } = dto;
    const path = generateNewPath(parentPath, name);
    const extension = getExtension(name);

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

    return prisma.fileSystemObject.create({
      data: {
        name,
        nodeType: 'file',
        fileCategory: fileCategory || 'document',
        tags: serializeTags(tags),
        extension,
        path,
        content,
        storageKey,
        size,
        workspaceId,
        parentId
      }
    }).then((node) => mapFileSystemObject(node));
  }

  static async handleUploadedFile(
    workspaceId: string,
    file: any,
    parentId?: string,
    parentPath?: string
  ) {
    const normalizedName = normalizePossiblyMojibakeName(file.originalname);
    const path = generateNewPath(parentPath, normalizedName);
    const extension = getExtension(normalizedName);

    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path } }
    });
    if (existing) throw new FileSystemError(409, `File ${normalizedName} already exists at this path`);

    const { storageKey, size } = await LocalStorageService.saveUploadedFile(file.path);
    const inferredCategory = inferFileCategory(normalizedName, file.mimetype);
    const isBinary = !isTextLikeFile({
      name: normalizedName,
      extension,
      mimeType: file.mimetype,
      fileCategory: inferredCategory
    });

    return prisma.fileSystemObject.create({
      data: {
        name: normalizedName,
        nodeType: 'file',
        fileCategory: inferredCategory,
        tags: '[]',
        extension,
        path,
        mimeType: file.mimetype,
        storageKey,
        size,
        isBinary,
        workspaceId,
        parentId
      }
    }).then((node) => mapFileSystemObject(node));
  }

  static async renameNode(dto: RenameNodeDTO) {
    const { workspaceId, id, newName } = dto;

    const node = await prisma.fileSystemObject.findUnique({ where: { id } });
    if (!node) throw new FileSystemError(404, 'Node not found');

    const oldPath = node.path;
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = generateNewPath(parentPath, newName);

    if (newPath === oldPath) return mapFileSystemObject(node as any);

    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path: newPath } }
    });
    if (existing) throw new FileSystemError(409, 'A node with this name already exists in the target directory');

    return prisma.$transaction(async (tx: any) => {
      const updatedNode = await tx.fileSystemObject.update({
        where: { id },
        data: { name: newName, path: newPath }
      });

      if (node.nodeType === 'folder') {
        const children = await tx.fileSystemObject.findMany({
          where: {
            workspaceId,
            path: { startsWith: `${oldPath}/` }
          }
        });

        for (const child of children) {
          await tx.fileSystemObject.update({
            where: { id: child.id },
            data: { path: replacePathPrefix(child.path, newPath, oldPath) }
          });
        }
      }

      return updatedNode;
    }).then((node) => mapFileSystemObject(node));
  }

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

    if (newPath === oldPath) return mapFileSystemObject(node as any);

    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path: newPath } }
    });
    if (existing) throw new FileSystemError(409, 'A node with this name already exists in the target directory');

    return prisma.$transaction(async (tx: any) => {
      const updatedNode = await tx.fileSystemObject.update({
        where: { id },
        data: { parentId: targetParentId || null, path: newPath }
      });

      if (node.nodeType === 'folder') {
        const children = await tx.fileSystemObject.findMany({
          where: {
            workspaceId,
            path: { startsWith: `${oldPath}/` }
          }
        });

        for (const child of children) {
          await tx.fileSystemObject.update({
            where: { id: child.id },
            data: { path: replacePathPrefix(child.path, newPath, oldPath) }
          });
        }
      }

      return updatedNode;
    }).then((node) => mapFileSystemObject(node));
  }

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
      return tx.fileSystemObject.delete({ where: { id } });
    });

    for (const obj of objectsToDelete) {
      if (obj.storageKey) {
        await LocalStorageService.deleteFile(obj.storageKey);
      }
    }

    return mapFileSystemObject(result as any);
  }

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

    const siblings = await prisma.fileSystemObject.findMany({
      where: { workspaceId, parentId: targetParentId || null },
      select: { name: true }
    });
    const existingNames = new Set<string>(siblings.map((s: { name: string }) => s.name));

    const newName = generateUniqueFilename(node.name, existingNames);
    const newPath = generateNewPath(targetParentPath, newName);

    if (node.nodeType === 'file') {
      const copiedStorage = node.storageKey
        ? await LocalStorageService.copyStoredFile(node.storageKey)
        : null;

      return prisma.fileSystemObject.create({
        data: {
          name: newName,
          nodeType: 'file',
          fileCategory: node.fileCategory,
          tags: (node as any).tags,
          extension: node.extension,
          path: newPath,
          content: node.content,
          mimeType: node.mimeType,
          storageKey: copiedStorage?.storageKey,
          size: copiedStorage?.size ?? node.size,
          isBinary: node.isBinary,
          workspaceId,
          parentId: targetParentId || null
        }
      }).then((created) => mapFileSystemObject(created));
    }

    return prisma.$transaction(async (tx: any) => {
      const newFolder = await tx.fileSystemObject.create({
        data: {
          name: newName,
          nodeType: 'folder',
          fileCategory: node.fileCategory,
          tags: (node as any).tags,
          path: newPath,
          workspaceId,
          parentId: targetParentId || null
        }
      });

      const children = await tx.fileSystemObject.findMany({
        where: {
          workspaceId,
          path: { startsWith: `${node.path}/` }
        },
        orderBy: { path: 'asc' }
      });

      const idMap: Record<string, string> = { [node.id]: newFolder.id };

      for (const child of children) {
        const childNewPath = replacePathPrefix(child.path, newPath, node.path);
        const copiedStorage = child.storageKey
          ? await LocalStorageService.copyStoredFile(child.storageKey)
          : null;

        const newChild = await tx.fileSystemObject.create({
          data: {
            name: child.name,
            nodeType: child.nodeType,
            fileCategory: child.fileCategory,
            tags: (child as any).tags,
            extension: child.extension,
            path: childNewPath,
            content: child.content,
            mimeType: child.mimeType,
            storageKey: copiedStorage?.storageKey,
            size: copiedStorage?.size ?? child.size,
            isBinary: child.isBinary,
            workspaceId,
            parentId: idMap[child.parentId!] || newFolder.id
          }
        });

        if (child.nodeType === 'folder') {
          idMap[child.id] = newChild.id;
        }
      }

      return newFolder;
    }).then((created) => mapFileSystemObject(created));
  }

  static async getFileContent(workspaceId: string, id: string) {
    const file = await prisma.fileSystemObject.findFirst({ where: { id, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');

    if (!isTextLikeFile(file)) throw new FileSystemError(400, 'Cannot read content of a binary file as text');

    if (file.storageKey) {
      try {
        return await LocalStorageService.readTextFile(file.storageKey);
      } catch {
        return file.content || '';
      }
    }

    return file.content || '';
  }

  static async saveFileContent(workspaceId: string, id: string, content: string) {
    const file = await prisma.fileSystemObject.findFirst({ where: { id, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Cannot save content to a folder');
    if (!isTextLikeFile(file)) throw new FileSystemError(400, 'Cannot save text content to a binary file');

    const { storageKey, size } = await LocalStorageService.saveTextFile(content, file.storageKey || undefined);

    return prisma.fileSystemObject.update({
      where: { id },
      data: { content, storageKey, size, isBinary: false }
    }).then((node) => mapFileSystemObject(node));
  }

  static async saveGeneratedContent(dto: SaveGeneratedContentDTO) {
    const { workspaceId, targetDir, filename, content, category } = dto;

    let folder = await prisma.fileSystemObject.findFirst({
      where: { workspaceId, path: targetDir, nodeType: 'folder' }
    });

    if (!folder) {
      const parts = targetDir.split('/').filter((part) => part);
      let currentParentId: string | undefined;
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
              tags: '[]',
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

    const siblings = await prisma.fileSystemObject.findMany({
      where: { workspaceId, parentId: folder.id },
      select: { name: true }
    });
    const existingNames = new Set<string>(siblings.map((s: { name: string }) => s.name));
    const finalFilename = generateUniqueFilename(filename, existingNames);
    const extension = getExtension(finalFilename);
    const newPath = generateNewPath(folder.path, finalFilename);

    const { storageKey, size } = await LocalStorageService.saveTextFile(content);

    return prisma.fileSystemObject.create({
      data: {
        name: finalFilename,
        nodeType: 'file',
        fileCategory: category || 'generated',
        tags: '[]',
        extension,
        path: newPath,
        content,
        storageKey,
        size,
        workspaceId,
        parentId: folder.id
      }
    }).then((node) => mapFileSystemObject(node));
  }

  static async updateNodeTags(dto: UpdateNodeTagsDTO) {
    const { workspaceId, id, tags } = dto;

    const node = await prisma.fileSystemObject.findFirst({
      where: { id, workspaceId }
    });
    if (!node) throw new FileSystemError(404, 'Node not found');

    return prisma.fileSystemObject.update({
      where: { id },
      data: { tags: serializeTags(tags) } as any
    }).then((node) => mapFileSystemObject(node));
  }
}

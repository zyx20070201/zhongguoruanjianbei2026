import prisma from '../config/db';
import crypto from 'crypto';
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
import { knowledgeIndexingService } from './knowledgeIndexingService';
import { knowledgeIndexQueueService } from './knowledgeIndexQueueService';
import {
  buildWorkbenchResourceWhere,
  buildWorkspaceResourceWhere,
  workbenchResourceTypeFilter
} from './workbenchResourceScope';
import { isHiddenFromWorkspaceKnowledge, isInternalDerivedFileObject, visibleWorkspaceKnowledgeWhere } from './fileObjectVisibility';

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

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'string') return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const serializeMetadata = (value?: Record<string, unknown>) => JSON.stringify(value || {});
const sha256Hex = (value: string) => crypto.createHash('sha256').update(value || '').digest('hex');

const mapFileSystemObject = (node: any) => ({
  ...node,
  tags: parseStoredTags(node.tags),
  metadata: parseJsonObject(node.metadataJson)
});

const SYSTEM_RESOURCE_ROOTS = new Set(['Sources', 'Files', 'Generated', 'Artifacts']);
const LEGACY_WRAPPER_ROOTS = new Set(['Global']);

const normalizeResourceRole = (value?: string | null) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'resource';
  if (normalized === 'workspace') return 'file';
  if (normalized === 'sources') return 'source';
  if (normalized === 'generates') return 'generated';
  return normalized;
};

const inferResourceRole = (input: {
  nodeType?: string;
  fileCategory?: string | null;
  extension?: string | null;
  explicitRole?: string | null;
  explicitType?: string | null;
}) => {
  if (input.nodeType === 'folder') return 'folder';
  if (input.explicitRole) return normalizeResourceRole(input.explicitRole);
  if (input.explicitType) return normalizeResourceRole(input.explicitType);

  const category = (input.fileCategory || '').toLowerCase();
  const extension = (input.extension || '').toLowerCase().replace(/^\./, '');

  if (category.includes('generated')) return 'generated';
  if (category.includes('web') || category.includes('source') || extension === 'source') return 'source';
  if (category.includes('note') || ['md', 'markdown', 'txt'].includes(extension)) return 'note';
  return 'resource';
};

const normalizeScope = (scope?: string | null, workbenchId?: string | null) => {
  const normalized = String(scope || '').trim().toLowerCase();
  if (normalized === 'chat') return 'chat';
  return normalized === 'workbench' || workbenchId ? 'workbench' : 'workspace';
};

const chatAttachmentPathSegment = (value: unknown) =>
  String(value || 'chat')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'chat';

const sanitizeRelativePathSegments = (value: unknown) =>
  String(value || '')
    .split(/[\\/]+/)
    .map((segment) =>
      normalizePossiblyMojibakeName(segment)
        .trim()
        .replace(/[\\/:*?"<>|#{}[\]`]/g, '-')
        .replace(/\s+/g, ' ')
        .slice(0, 120)
        .trim()
    )
    .filter((segment) => segment && segment !== '.' && segment !== '..');

const normalizeFolderPath = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  const segments = sanitizeRelativePathSegments(raw);
  if (segments.length && SYSTEM_RESOURCE_ROOTS.has(segments[0])) {
    segments.shift();
  }
  return segments.length ? `/${segments.join('/')}` : '';
};

const dirnameOfPath = (path: string) => {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : '';
};

const basenameOfPath = (path: string) => path.split('/').filter(Boolean).pop() || path.replace(/^\/+/, '');

const legacyResourcePathMatch = (path: string) => {
  const segments = path.split('/').filter(Boolean);
  const resourceIndex = segments.findIndex((segment) => SYSTEM_RESOURCE_ROOTS.has(segment));
  if (resourceIndex >= 0 && segments[resourceIndex + 1]) {
    return `/${[...segments.slice(0, resourceIndex), ...segments.slice(resourceIndex + 1)].join('/')}`;
  }

  if (segments[0] && LEGACY_WRAPPER_ROOTS.has(segments[0]) && segments[1]) {
    return `/${segments.slice(1).join('/')}`;
  }

  return null;
};

const INDEXABLE_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'md',
  'markdown',
  'txt',
  'csv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'java',
  'cpp',
  'c',
  'go',
  'rs',
  'sql'
]);

const assertUserWorkbenchNote = (file: any) => {
  const fileCategory = String(file?.fileCategory || '').toLowerCase();
  const resourceType = String(file?.resourceType || '').toLowerCase();
  const extension = String(file?.extension || getExtension(file?.name || '')).toLowerCase();
  if (
    file?.scope !== 'workbench' ||
    file?.origin !== 'user' ||
    !(fileCategory.includes('note') || resourceType === 'note' || ['md', 'markdown'].includes(extension))
  ) {
    throw new FileSystemError(403, 'Only user-created Workbench notes can be edited with AI revisions');
  }
};

export class FileSystemService {
  private static async bindResourceToWorkbench(node: any, input: {
    workbenchId?: string | null;
    role?: string | null;
    source?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    if (!input.workbenchId || node?.nodeType !== 'file') return;

    const role = normalizeResourceRole(input.role || node.resourceType || node.fileCategory || 'resource');

    await (prisma as any).workbenchResource.upsert({
      where: {
        workbenchId_fileObjectId_role: {
          workbenchId: input.workbenchId,
          fileObjectId: node.id,
          role
        }
      },
      create: {
        workbenchId: input.workbenchId,
        fileObjectId: node.id,
        role,
        source: input.source || (role === 'generated' ? 'generated' : 'local'),
        metadataJson: serializeMetadata(input.metadata)
      },
      update: {
        source: input.source || undefined,
        metadataJson: serializeMetadata(input.metadata)
      }
    });
  }

  private static async ensureFolderPath(workspaceId: string, targetDir: string) {
    const normalizedPath = normalizeFolderPath(targetDir);
    if (!normalizedPath) return null;
    const parts = normalizedPath.split('/').filter((part) => part);
    let folder: any = null;
    let currentParentId: string | undefined;
    let currentPath = '';

    for (const part of parts) {
      currentPath += `/${part}`;
      let currentFolder = await prisma.fileSystemObject.findUnique({
        where: { workspaceId_path: { workspaceId, path: currentPath } }
      });

      if (currentFolder && currentFolder.nodeType !== 'folder') {
        throw new FileSystemError(409, `A file already exists at folder path ${currentPath}`);
      }

      if (!currentFolder) {
        currentFolder = await prisma.fileSystemObject.create({
          data: {
            name: part,
            nodeType: 'folder',
            fileCategory: 'other',
            resourceType: 'folder',
            scope: 'workspace',
            origin: 'system',
            metadataJson: '{}',
            tags: '[]',
            path: currentPath,
            workspaceId,
            parentId: currentParentId
          } as any
        });
      }

      currentParentId = currentFolder.id;
      folder = currentFolder;
    }

    return folder;
  }

  private static async resolveDefaultParent(input: {
    workspaceId: string;
    parentId?: string | null;
    parentPath?: string | null;
    workbenchId?: string | null;
    role?: string | null;
    scope?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    if (input.parentId) {
      const parent = await prisma.fileSystemObject.findFirst({
        where: { id: input.parentId, workspaceId: input.workspaceId, nodeType: 'folder' }
      });
      if (!parent) throw new FileSystemError(404, 'Parent folder not found');
      return {
        parentId: parent.id,
        parentPath: parent.path
      };
    }

    if (input.parentPath) {
      const folder = await FileSystemService.ensureFolderPath(input.workspaceId, input.parentPath);
      return {
        parentId: folder?.id,
        parentPath: folder?.path || ''
      };
    }

    const scope = normalizeScope(input.scope, input.workbenchId);

    if (scope === 'chat') {
      return {
        parentId: undefined,
        parentPath: `/Chat Attachments/${chatAttachmentPathSegment(input.metadata?.chatId || input.metadata?.sessionId)}`
      };
    }

    if (scope === 'workbench' && input.workbenchId) {
      const workbench = await prisma.workbench.findFirst({
        where: { id: input.workbenchId, workspaceId: input.workspaceId },
        select: { rootPath: true, title: true }
      });
      const rootPath = workbench?.rootPath || `/${workbench?.title || input.workbenchId}`;
      const folder = await FileSystemService.ensureFolderPath(input.workspaceId, rootPath);
      return { parentId: folder?.id, parentPath: folder?.path || '' };
    }

    return { parentId: undefined, parentPath: '' };
  }

  private static async indexFileForKnowledge(node: any) {
    const extension = (node.extension || getExtension(node.name)).toLowerCase();
    const shouldIndex =
      node?.nodeType === 'file' &&
      (isTextLikeFile(node) || INDEXABLE_EXTENSIONS.has(extension) || node.fileCategory === 'generated');

    if (!shouldIndex) return;

    await knowledgeIndexingService.indexFile({
      workspaceId: node.workspaceId,
      fileObjectId: node.id,
      reason: node.fileCategory === 'generated' ? 'generated-resource' : 'workspace-file'
    });
  }

  private static scheduleKnowledgeIndexing(node: any) {
    setImmediate(() => {
      knowledgeIndexQueueService.enqueueFile({
        workspaceId: node.workspaceId,
        fileObjectId: node.id,
        reason: node.fileCategory === 'generated' ? 'generated-resource' : 'workspace-file'
      }).catch((error) => {
        console.warn(
          `Knowledge indexing failed for ${node?.id || node?.name || 'file'}:`,
          error instanceof Error ? error.message : error
        );
      });
    });
  }

  private static async repairLegacyResourceFolders(workspaceId: string) {
    const nodes = await prisma.fileSystemObject.findMany({
      where: { workspaceId },
      orderBy: { path: 'asc' }
    });
    const nodesById = new Map(nodes.map((node: any) => [node.id, node]));
    const foldersByPath = new Map(
      nodes
        .filter((node: any) => node.nodeType === 'folder')
        .map((node: any) => [node.path, node])
    );
    const rootPaths = new Set(nodes.map((node: any) => node.path));

    for (const node of nodes) {
      if (node.nodeType !== 'file') continue;

      const metadata = parseJsonObject(node.metadataJson);
      const legacyPath = legacyResourcePathMatch(node.path);
      if (metadata.folderTreeNormalizedAt && !legacyPath) continue;

      let nextPath = node.path;
      let nextParentId: string | null = node.parentId || null;

      if (legacyPath) {
        nextPath = legacyPath;
        nextParentId = null;
      } else {
        const parent = node.parentId ? nodesById.get(node.parentId) : null;
        if (parent && parent.nodeType === 'folder') continue;

        const parentPath = dirnameOfPath(node.path);
        if (!parentPath) {
          nextParentId = null;
        } else {
          const parentFolder = foldersByPath.get(parentPath);
          if (parentFolder) {
            nextParentId = parentFolder.id;
          } else {
            nextParentId = null;
          }
        }
      }

      if (nextPath !== node.path) {
        const nextParentPath = dirnameOfPath(nextPath);
        const folder = nextParentPath ? await FileSystemService.ensureFolderPath(workspaceId, nextParentPath) : null;
        nextParentId = folder?.id || null;
        const targetName = basenameOfPath(nextPath);
        nextPath = generateNewPath(folder?.path || '', targetName);
        const siblingNames = await prisma.fileSystemObject.findMany({
          where: {
            workspaceId,
            parentId: nextParentId
          },
          select: { name: true, id: true }
        });
        const existingNames = new Set(
          siblingNames
            .filter((sibling: { id: string; name: string }) => sibling.id !== node.id)
            .map((sibling: { id: string; name: string }) => sibling.name)
        );
        const finalName = generateUniqueFilename(targetName, existingNames);
        nextPath = generateNewPath(folder?.path || '', finalName);
      }

      if (rootPaths.has(nextPath) && nextPath !== node.path) continue;

      if (nextPath !== node.path || nextParentId !== (node.parentId || null)) {
        await prisma.fileSystemObject.update({
          where: { id: node.id },
          data: {
            name: nextPath !== node.path ? basenameOfPath(nextPath) : node.name,
            path: nextPath,
            parentId: nextParentId,
            metadataJson: serializeMetadata({
              ...metadata,
              folderTreeNormalizedAt: new Date().toISOString()
            })
          }
        });
        rootPaths.delete(node.path);
        rootPaths.add(nextPath);
      }
    }

    await FileSystemService.unwrapLegacyFolders(workspaceId);
  }

  private static async unwrapLegacyFolders(workspaceId: string) {
    const legacyFolders = await prisma.fileSystemObject.findMany({
      where: {
        workspaceId,
        nodeType: 'folder',
        OR: [
          { path: '/Global' },
          { path: { startsWith: '/Global/' } },
          ...Array.from(SYSTEM_RESOURCE_ROOTS).map((root) => ({ path: `/${root}` })),
          ...Array.from(SYSTEM_RESOURCE_ROOTS).map((root) => ({ path: { startsWith: `/${root}/` } }))
        ]
      },
      orderBy: { path: 'desc' }
    });

    for (const folder of legacyFolders) {
      const shouldUnwrap =
        SYSTEM_RESOURCE_ROOTS.has(folder.name) ||
        (LEGACY_WRAPPER_ROOTS.has(folder.name) && (folder.parentId == null || folder.path === `/${folder.name}`));
      const targetParent = shouldUnwrap && folder.parentId
        ? await prisma.fileSystemObject.findFirst({
            where: { id: folder.parentId, workspaceId, nodeType: 'folder' },
            select: { id: true, path: true }
          })
        : null;
      const targetParentId = shouldUnwrap ? targetParent?.id || null : folder.parentId || null;
      const targetParentPath = shouldUnwrap ? targetParent?.path || '' : dirnameOfPath(folder.path);
      const children = await prisma.fileSystemObject.findMany({
        where: {
          workspaceId,
          parentId: folder.id
        }
      });

      if (shouldUnwrap && children.length) {
        const siblings = await prisma.fileSystemObject.findMany({
          where: {
            workspaceId,
            parentId: targetParentId
          },
          select: { id: true, name: true }
        });
        const existingNames = new Set(
          siblings
            .filter((sibling) => sibling.id !== folder.id)
            .map((sibling) => sibling.name)
        );

        for (const child of children) {
          const nextName = generateUniqueFilename(child.name, existingNames);
          existingNames.add(nextName);
          const oldChildPath = child.path;
          const nextPath = generateNewPath(targetParentPath, nextName);

          await prisma.$transaction(async (tx: any) => {
            await tx.fileSystemObject.update({
              where: { id: child.id },
              data: {
                name: nextName,
                path: nextPath,
                parentId: targetParentId
              }
            });

            if (child.nodeType === 'folder') {
              const descendants = await tx.fileSystemObject.findMany({
                where: {
                  workspaceId,
                  path: { startsWith: `${oldChildPath}/` }
                }
              });

              for (const descendant of descendants) {
                await tx.fileSystemObject.update({
                  where: { id: descendant.id },
                  data: { path: replacePathPrefix(descendant.path, nextPath, oldChildPath) }
                });
              }
            }
          });
        }
      }

      const remainingChildren = await prisma.fileSystemObject.count({
        where: {
          workspaceId,
          parentId: folder.id
        }
      });
      if (remainingChildren === 0) {
        await prisma.fileSystemObject.delete({ where: { id: folder.id } }).catch(() => undefined);
      }
    }
  }

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

  static async getFileTree(workspaceId: string, options: { visibleWorkspaceKnowledgeOnly?: boolean } = {}) {
    await FileSystemService.repairLegacyResourceFolders(workspaceId);
    await FileSystemService.repairNormalizedNames(workspaceId);
    const nodes = await prisma.fileSystemObject.findMany({
      where: {
        workspaceId,
        ...(options.visibleWorkspaceKnowledgeOnly ? { scope: { not: 'chat' }, ...visibleWorkspaceKnowledgeWhere } : {})
      },
      orderBy: [{ nodeType: 'asc' }, { name: 'asc' }]
    });

    return nodes
      .map((node) => mapFileSystemObject(node))
      .filter((node) => !options.visibleWorkspaceKnowledgeOnly || !isHiddenFromWorkspaceKnowledge(node));
  }

  static async initFileSystem(workspaceId: string) {
    await FileSystemService.repairLegacyResourceFolders(workspaceId);
    await FileSystemService.repairNormalizedNames(workspaceId);
    const existingFiles = await prisma.fileSystemObject.findMany({
      where: { workspaceId }
    });

    return existingFiles.map((node) => mapFileSystemObject(node));
  }

  static async createFolder(dto: CreateFolderDTO) {
    const { workspaceId, name } = dto;
    const target = await FileSystemService.resolveDefaultParent({
      workspaceId,
      parentId: dto.parentId,
      parentPath: dto.parentPath,
      workbenchId: dto.workbenchId,
      role: dto.resourceRole,
      scope: dto.scope
    });
    const path = generateNewPath(target.parentPath, name);

    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path } }
    });
    if (existing) throw new FileSystemError(409, 'Folder already exists at this path');

    return prisma.fileSystemObject.create({
      data: {
        name,
        nodeType: 'folder',
        fileCategory: 'other',
        resourceType: 'folder',
        scope: normalizeScope(dto.scope, dto.workbenchId),
        origin: 'user',
        metadataJson: '{}',
        tags: '[]',
        path,
        workspaceId,
        parentId: target.parentId
      } as any
    }).then((node) => mapFileSystemObject(node));
  }

  static async createFile(dto: CreateFileDTO) {
    const { workspaceId, name, content, fileCategory, mimeType, tags } = dto;
    const extension = getExtension(name);
    const resourceType = inferResourceRole({
      nodeType: 'file',
      fileCategory,
      extension,
      explicitRole: dto.resourceRole,
      explicitType: dto.resourceType
    });
    const target = await FileSystemService.resolveDefaultParent({
      workspaceId,
      parentId: dto.parentId,
      parentPath: dto.parentPath,
      workbenchId: dto.workbenchId,
      role: resourceType,
      scope: dto.scope,
      metadata: dto.metadata
    });
    const path = generateNewPath(target.parentPath, name);

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

    const created = await prisma.fileSystemObject.create({
      data: {
        name,
        nodeType: 'file',
        fileCategory: fileCategory || 'document',
        resourceType,
        scope: normalizeScope(dto.scope, dto.workbenchId),
        origin: dto.origin || 'user',
        metadataJson: serializeMetadata(dto.metadata),
        tags: serializeTags(tags),
        extension,
        path,
        content,
        mimeType,
        storageKey,
        size,
        workspaceId,
        parentId: target.parentId,
        ownerWorkbenchId: dto.workbenchId || undefined
      } as any
    });
    await FileSystemService.bindResourceToWorkbench(created, {
      workbenchId: dto.workbenchId,
      role: resourceType,
      source: dto.origin || 'local',
      metadata: dto.metadata
    });
    if (dto.indexInBackground !== false) {
      FileSystemService.scheduleKnowledgeIndexing(created);
    } else {
      await FileSystemService.indexFileForKnowledge(created);
    }
    return mapFileSystemObject(created);
  }

  static async createFileWithUniqueName(dto: CreateFileDTO) {
    const siblings = await prisma.fileSystemObject.findMany({
      where: {
        workspaceId: dto.workspaceId,
        parentId: dto.parentId || null
      },
      select: { name: true }
    });
    const name = generateUniqueFilename(dto.name, new Set(siblings.map((sibling) => sibling.name)));
    return FileSystemService.createFile({ ...dto, name });
  }

  static async createFileOrReturnExisting(dto: CreateFileDTO) {
    const { workspaceId, name, fileCategory } = dto;
    const extension = getExtension(name);
    const resourceType = inferResourceRole({
      nodeType: 'file',
      fileCategory,
      extension,
      explicitRole: dto.resourceRole,
      explicitType: dto.resourceType
    });
    const target = await FileSystemService.resolveDefaultParent({
      workspaceId,
      parentId: dto.parentId,
      parentPath: dto.parentPath,
      workbenchId: dto.workbenchId,
      role: resourceType,
      scope: dto.scope
    });
    const path = generateNewPath(target.parentPath, name);

    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path } }
    });

    if (existing) {
      await FileSystemService.bindResourceToWorkbench(existing, {
        workbenchId: dto.workbenchId,
        role: resourceType,
        source: dto.origin || 'local',
        metadata: dto.metadata
      });
      return mapFileSystemObject(existing as any);
    }

    return FileSystemService.createFile({ ...dto, parentId: target.parentId, parentPath: target.parentPath });
  }

  static async handleUploadedFile(
    workspaceId: string,
    file: any,
    parentId?: string,
    parentPath?: string,
    options: {
      workbenchId?: string;
      resourceRole?: string;
      resourceType?: string;
      scope?: string;
      origin?: string;
      metadata?: Record<string, unknown>;
      indexInBackground?: boolean;
    } = {}
  ) {
    const normalizedName = normalizePossiblyMojibakeName(file.originalname);
    const extension = getExtension(normalizedName);
    const inferredCategory = inferFileCategory(normalizedName, file.mimetype);
    const resourceType = inferResourceRole({
      nodeType: 'file',
      fileCategory: inferredCategory,
      extension,
      explicitRole: options.resourceRole,
      explicitType: options.resourceType
    });
    const target = await FileSystemService.resolveDefaultParent({
      workspaceId,
      parentId,
      parentPath,
      workbenchId: options.workbenchId,
      role: resourceType,
      scope: options.scope,
      metadata: options.metadata
    });
    const relativeSegments = sanitizeRelativePathSegments(file.relativePath);
    const relativeDirSegments = relativeSegments.length > 1 ? relativeSegments.slice(0, -1) : [];
    let targetParentId = target.parentId;
    let targetParentPath = target.parentPath;

    if (!targetParentPath && targetParentId) {
      const parent = await prisma.fileSystemObject.findFirst({
        where: { id: targetParentId, workspaceId, nodeType: 'folder' }
      });
      targetParentPath = parent?.path;
    }

    if (targetParentPath && relativeDirSegments.length) {
      const folder = await FileSystemService.ensureFolderPath(
        workspaceId,
        generateNewPath(targetParentPath, relativeDirSegments.join('/'))
      );
      targetParentId = folder?.id;
      targetParentPath = folder?.path || targetParentPath;
    }

    const path = generateNewPath(targetParentPath, normalizedName);

    const existing = await prisma.fileSystemObject.findUnique({
      where: { workspaceId_path: { workspaceId, path } }
    });
    if (existing) throw new FileSystemError(409, `File ${normalizedName} already exists at this path`);

    const { storageKey, size } = await LocalStorageService.saveUploadedFile(file.path);
    const isBinary = !isTextLikeFile({
      name: normalizedName,
      extension,
      mimeType: file.mimetype,
      fileCategory: inferredCategory
    });

    const created = await prisma.fileSystemObject.create({
      data: {
        name: normalizedName,
        nodeType: 'file',
        fileCategory: inferredCategory,
        resourceType,
        scope: normalizeScope(options.scope, options.workbenchId),
        origin: options.origin || 'upload',
        metadataJson: serializeMetadata(options.metadata),
        tags: '[]',
        extension,
        path,
        mimeType: file.mimetype,
        storageKey,
        size,
        isBinary,
        workspaceId,
        parentId: targetParentId,
        ownerWorkbenchId: options.workbenchId || undefined
      } as any
    });
    if (normalizeScope(options.scope, options.workbenchId) !== 'chat') {
      await FileSystemService.bindResourceToWorkbench(created, {
        workbenchId: options.workbenchId,
        role: resourceType,
        source: 'uploaded',
        metadata: options.metadata
      });
    }
    if (options.indexInBackground ?? true) {
      FileSystemService.scheduleKnowledgeIndexing(created);
    } else {
      await FileSystemService.indexFileForKnowledge(created);
    }
    return mapFileSystemObject(created);
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

    const objectsToDelete: any[] = [];
    if (node.nodeType === 'folder') {
      const descendants = await prisma.fileSystemObject.findMany({
        where: { workspaceId, path: { startsWith: `${node.path}/` } }
      });
      objectsToDelete.push(node, ...descendants);
    } else {
      objectsToDelete.push(node);
    }

    const result = await prisma.$transaction(async (tx: any) => {
      await tx.knowledgeChunk.deleteMany({
        where: {
          workspaceId,
          fileObjectId: { in: objectsToDelete.map((object: any) => object.id) }
        }
      });
      await tx.knowledgeIndexJob.deleteMany({
        where: {
          workspaceId,
          fileObjectId: { in: objectsToDelete.map((object: any) => object.id) }
        }
      });
      await (tx as any).workbenchResource.deleteMany({
        where: {
          fileObjectId: { in: objectsToDelete.map((object: any) => object.id) }
        }
      });
      await tx.generatedResource.deleteMany({
        where: {
          fileObjectId: { in: objectsToDelete.map((object: any) => object.id) }
        }
      });

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

    const updated = await prisma.fileSystemObject.update({
      where: { id },
      data: { content, storageKey, size, isBinary: false }
    });
    await FileSystemService.indexFileForKnowledge(updated);
    return mapFileSystemObject(updated);
  }

  static async listWorkbenchNoteRevisions(workspaceId: string, fileObjectId: string, limit = 20) {
    const file = await prisma.fileSystemObject.findFirst({ where: { id: fileObjectId, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');
    assertUserWorkbenchNote(file);

    const revisions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "WorkbenchNoteRevision"
       WHERE "workspaceId" = ? AND "fileObjectId" = ?
       ORDER BY "revisionNumber" DESC, "createdAt" DESC
       LIMIT ?`,
      workspaceId,
      fileObjectId,
      Math.max(1, Math.min(Number(limit) || 20, 100))
    );

    return revisions;
  }

  static async applyWorkbenchNoteRevision(input: {
    workspaceId: string;
    fileObjectId: string;
    content: string;
    baseContentHash?: string | null;
    actor?: string | null;
    summary?: string | null;
    actionType?: string | null;
  }) {
    const file = await prisma.fileSystemObject.findFirst({
      where: { id: input.fileObjectId, workspaceId: input.workspaceId }
    });
    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Cannot save content to a folder');
    if (!isTextLikeFile(file)) throw new FileSystemError(400, 'Cannot save text content to a binary file');
    assertUserWorkbenchNote(file);

    const currentContent = await FileSystemService.getFileContent(input.workspaceId, input.fileObjectId);
    const currentContentHash = sha256Hex(currentContent);
    const baseContentHash = input.baseContentHash || null;
    if (baseContentHash && currentContentHash !== baseContentHash) {
      throw new FileSystemError(
        409,
        JSON.stringify({
          message: 'Note content changed since the AI proposal was generated',
          currentContentHash,
          baseContentHash,
          currentContent
        })
      );
    }

    const nextContent = String(input.content ?? '');
    const nextContentHash = sha256Hex(nextContent);
    const revisionRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX("revisionNumber"), 0) AS "maxRevision"
       FROM "WorkbenchNoteRevision"
       WHERE "workspaceId" = ? AND "fileObjectId" = ?`,
      input.workspaceId,
      input.fileObjectId
    );
    const revisionNumber = Number(revisionRows[0]?.maxRevision || 0) + 1;

    const { storageKey, size } = await LocalStorageService.saveTextFile(nextContent, file.storageKey || undefined);
    const updated = await prisma.fileSystemObject.update({
      where: { id: file.id },
      data: { content: nextContent, storageKey, size, isBinary: false }
    });

    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkbenchNoteRevision" (
        "id", "workspaceId", "workbenchId", "fileObjectId", "revisionNumber",
        "actionType", "actor", "summary", "baseContentHash",
        "beforeContent", "beforeContentHash", "afterContent", "afterContentHash", "createdAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      crypto.randomUUID(),
      input.workspaceId,
      file.ownerWorkbenchId || null,
      file.id,
      revisionNumber,
      input.actionType || 'ai_note_edit',
      input.actor || 'ai',
      input.summary || null,
      baseContentHash,
      currentContent,
      currentContentHash,
      nextContent,
      nextContentHash
    );

    await FileSystemService.indexFileForKnowledge(updated);
    return {
      file: mapFileSystemObject(updated),
      revisionNumber,
      beforeContent: currentContent,
      afterContent: nextContent,
      baseContentHash,
      currentContentHash: nextContentHash
    };
  }

  static async revertWorkbenchNoteRevision(input: {
    workspaceId: string;
    fileObjectId: string;
    revisionId?: string | null;
    actor?: string | null;
  }) {
    const file = await prisma.fileSystemObject.findFirst({
      where: { id: input.fileObjectId, workspaceId: input.workspaceId }
    });
    if (!file) throw new FileSystemError(404, 'File not found');
    assertUserWorkbenchNote(file);

    const rows = input.revisionId
      ? await prisma.$queryRawUnsafe<any[]>(
          `SELECT * FROM "WorkbenchNoteRevision"
           WHERE "workspaceId" = ? AND "fileObjectId" = ? AND "id" = ?
           LIMIT 1`,
          input.workspaceId,
          input.fileObjectId,
          input.revisionId
        )
      : await prisma.$queryRawUnsafe<any[]>(
          `SELECT * FROM "WorkbenchNoteRevision"
           WHERE "workspaceId" = ? AND "fileObjectId" = ?
           ORDER BY "revisionNumber" DESC, "createdAt" DESC
           LIMIT 1`,
          input.workspaceId,
          input.fileObjectId
        );

    const revision = rows[0];
    if (!revision) throw new FileSystemError(404, 'Revision not found');

    const currentContent = await FileSystemService.getFileContent(input.workspaceId, input.fileObjectId);
    const revertContent = String(revision.beforeContent ?? '');
    const currentContentHash = sha256Hex(currentContent);
    const revertContentHash = sha256Hex(revertContent);
    const revisionRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX("revisionNumber"), 0) AS "maxRevision"
       FROM "WorkbenchNoteRevision"
       WHERE "workspaceId" = ? AND "fileObjectId" = ?`,
      input.workspaceId,
      input.fileObjectId
    );
    const revisionNumber = Number(revisionRows[0]?.maxRevision || 0) + 1;

    const { storageKey, size } = await LocalStorageService.saveTextFile(revertContent, file.storageKey || undefined);
    const updated = await prisma.fileSystemObject.update({
      where: { id: file.id },
      data: { content: revertContent, storageKey, size, isBinary: false }
    });

    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkbenchNoteRevision" (
        "id", "workspaceId", "workbenchId", "fileObjectId", "revisionNumber",
        "actionType", "actor", "summary", "baseContentHash",
        "beforeContent", "beforeContentHash", "afterContent", "afterContentHash", "createdAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      crypto.randomUUID(),
      input.workspaceId,
      file.ownerWorkbenchId || null,
      file.id,
      revisionNumber,
      'revert',
      input.actor || 'user',
      `Reverted revision ${revision.revisionNumber}`,
      currentContentHash,
      currentContent,
      currentContentHash,
      revertContent,
      revertContentHash
    );

    await FileSystemService.indexFileForKnowledge(updated);
    return {
      file: mapFileSystemObject(updated),
      revisionNumber,
      revertedFromRevisionNumber: revision.revisionNumber,
      beforeContent: currentContent,
      afterContent: revertContent,
      currentContentHash: revertContentHash
    };
  }

  static async saveGeneratedContent(dto: SaveGeneratedContentDTO) {
    const { workspaceId, targetDir, filename, content, category } = dto;

    const target = await FileSystemService.resolveDefaultParent({
      workspaceId,
      parentPath: targetDir,
      workbenchId: dto.workbenchId,
      role: dto.resourceRole || dto.resourceType || category || 'generated',
      scope: dto.scope || (dto.workbenchId ? 'workbench' : 'workspace')
    });

    const siblings = await prisma.fileSystemObject.findMany({
      where: { workspaceId, parentId: target.parentId || null },
      select: { name: true }
    });
    const existingNames = new Set<string>(siblings.map((s: { name: string }) => s.name));
    const finalFilename = generateUniqueFilename(filename, existingNames);
    const extension = getExtension(finalFilename);
    const newPath = generateNewPath(target.parentPath, finalFilename);
    const resourceType = inferResourceRole({
      nodeType: 'file',
      fileCategory: category || 'generated',
      extension,
      explicitRole: dto.resourceRole,
      explicitType: dto.resourceType || 'generated'
    });

    const isBinary = dto.isBinary || Buffer.isBuffer(content);
    const { storageKey, size } = isBinary
      ? await LocalStorageService.saveBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content))
      : await LocalStorageService.saveTextFile(String(content));

    const created = await prisma.fileSystemObject.create({
      data: {
        name: finalFilename,
        nodeType: 'file',
        fileCategory: category || 'generated',
        resourceType,
        scope: normalizeScope(dto.scope || 'workbench', dto.workbenchId),
        origin: dto.origin || 'ai',
        metadataJson: serializeMetadata(dto.metadata),
        tags: '[]',
        extension,
        path: newPath,
        content: isBinary ? undefined : String(content),
        mimeType: dto.mimeType,
        storageKey,
        size,
        isBinary,
        workspaceId,
        parentId: target.parentId,
        ownerWorkbenchId: dto.workbenchId || undefined
      } as any
    });
    await FileSystemService.bindResourceToWorkbench(created, {
      workbenchId: dto.workbenchId,
      role: resourceType,
      source: 'generated',
      metadata: dto.metadata
    });
    if (dto.indexInBackground ?? true) {
      FileSystemService.scheduleKnowledgeIndexing(created);
    } else {
      await FileSystemService.indexFileForKnowledge(created);
    }
    return mapFileSystemObject(created);
  }

  static async listResources(workspaceId: string, options: {
    workbenchId?: string;
    scope?: 'all' | 'workspace' | 'workbench' | string;
    role?: string;
  } = {}) {
    const scope = options.scope || 'all';
    const resourceTypeFilter = workbenchResourceTypeFilter(options.role);

    const baseWhere: any = {
      workspaceId,
      nodeType: 'file',
      ...(resourceTypeFilter ? { resourceType: resourceTypeFilter } : {})
    };

    const workbenchRoot = options.workbenchId
      ? await prisma.workbench.findUnique({
          where: { id: options.workbenchId },
          select: { rootPath: true }
        })
      : null;

    const workbenchWhere = options.workbenchId
      ? buildWorkbenchResourceWhere({
          workspaceId,
          workbenchId: options.workbenchId,
          role: options.role,
          rootPath: workbenchRoot?.rootPath
        })
      : {};

    const workspaceWhere = buildWorkspaceResourceWhere({
      workspaceId,
      role: options.role
    });

    const where =
      scope === 'workbench'
        ? workbenchWhere
        : scope === 'workspace'
          ? workspaceWhere
          : options.workbenchId
            ? { ...baseWhere, OR: [...(workbenchWhere as any).OR, ...(workspaceWhere as any).OR] }
            : baseWhere;

    const resources = await prisma.fileSystemObject.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      include: {
        workbenchBindings: options.workbenchId
          ? { where: { workbenchId: options.workbenchId } }
          : false
      } as any
    });

    return resources
      .filter((node) => !isInternalDerivedFileObject(node))
      .map((node) => mapFileSystemObject(node));
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

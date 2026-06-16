import prisma from '../../config/db';
import { documentTextExtractionService } from '../documentTextExtractionService';
import { FileSystemService } from '../fileSystemService';
import { LocalStorageService } from '../storage/localStorageService';
import type { ChatSessionAttachmentContext } from '../../types/contextSystem';
import type { WorkspaceAgentToolContext } from './toolRegistry';
import { clip } from './utils';
import fs from 'fs/promises';

type AttachmentFileRecord = {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  content?: string | null;
  storageKey?: string | null;
  isBinary?: boolean | null;
  extension?: string | null;
  mimeType?: string | null;
  size?: number | null;
  scope?: string | null;
  fileCategory?: string | null;
  resourceType?: string | null;
  metadataJson?: string | null;
  createdAt: Date;
  updatedAt?: Date;
};

export const attachmentKind = (file: { name?: string | null; mimeType?: string | null; extension?: string | null }): ChatSessionAttachmentContext['kind'] => {
  const mimeType = (file.mimeType || '').toLowerCase();
  const extension = (file.extension || file.name?.split('.').pop() || '').toLowerCase();
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return 'image';
  if (mimeType.includes('pdf') || extension === 'pdf') return 'pdf';
  if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(extension)) return 'document';
  if (mimeType.startsWith('text/') || ['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sql'].includes(extension)) return 'text';
  return 'file';
};

export const imageDataUrlFromStoredFile = async (file: { storageKey?: string | null; mimeType?: string | null }) => {
  if (!file.storageKey || !file.mimeType?.startsWith('image/')) return '';
  const buffer = await fs.readFile(LocalStorageService.getFilePath(file.storageKey));
  return `data:${file.mimeType};base64,${buffer.toString('base64')}`;
};

export const loadChatAttachmentFiles = async (context: Pick<WorkspaceAgentToolContext, 'workspaceId' | 'contextSources'>, fileIds: string[]) => {
  if (!fileIds.length) return [];
  const allowed = new Set((context.contextSources?.chatAttachments || []).map((item) => item.id).filter(Boolean));
  const requested = allowed.size ? fileIds.filter((id) => allowed.has(id)) : fileIds;
  if (!requested.length) return [];
  const rows = await prisma.fileSystemObject.findMany({
    where: {
      workspaceId: context.workspaceId,
      nodeType: 'file',
      scope: 'chat',
      id: { in: requested }
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      path: true,
      content: true,
      storageKey: true,
      isBinary: true,
      extension: true,
      mimeType: true,
      size: true,
      scope: true,
      fileCategory: true,
      resourceType: true,
      metadataJson: true,
      createdAt: true,
      updatedAt: true
    }
  });
  const byId = new Map(rows.map((row) => [row.id, row as AttachmentFileRecord]));
  return requested.map((id) => byId.get(id)).filter((row): row is AttachmentFileRecord => Boolean(row));
};

export const readAttachmentText = async (file: AttachmentFileRecord) => {
  if (file.content && String(file.content).trim()) return String(file.content);
  try {
    return await FileSystemService.getFileContent(file.workspaceId, file.id);
  } catch {
    const extracted = await documentTextExtractionService.extract({
      id: file.id,
      name: file.name,
      path: file.path,
      storageKey: file.storageKey || undefined,
      content: file.content || undefined,
      isBinary: Boolean(file.isBinary),
      extension: file.extension || undefined,
      mimeType: file.mimeType || undefined
    } as any);
    return extracted.text || '';
  }
};

export const chatAttachmentContextFromFile = async (file: AttachmentFileRecord): Promise<ChatSessionAttachmentContext> => {
  const kind = attachmentKind(file);
  const text = kind === 'image' ? '' : await readAttachmentText(file).catch(() => '');
  const dataUrl = kind === 'image' ? await imageDataUrlFromStoredFile(file).catch(() => '') : '';
  return {
    id: file.id,
    fileObjectId: file.id,
    name: file.name,
    mimeType: file.mimeType || (kind === 'image' ? 'image/*' : 'application/octet-stream'),
    size: file.size || 0,
    kind,
    createdAt: file.createdAt instanceof Date ? file.createdAt.toISOString() : undefined,
    textContent: text ? clip(text, 12000) : undefined,
    dataUrl: dataUrl || undefined,
    status: text || dataUrl ? 'ready' : 'metadata_only',
    extractionStatus: text ? 'ready' : dataUrl ? 'metadata_only' : 'metadata_only',
    savedToWorkbench: false
  };
};

export const buildChatAttachmentContexts = async (
  context: Pick<WorkspaceAgentToolContext, 'workspaceId' | 'contextSources'>,
  fileIds?: string[]
) => {
  const ids = fileIds?.length
    ? fileIds
    : (context.contextSources?.chatAttachments || []).map((item) => item.id).filter(Boolean);
  const files = await loadChatAttachmentFiles(context, ids);
  return Promise.all(files.map((file) => chatAttachmentContextFromFile(file)));
};

import { Request, Response } from 'express';
import { FileSystemService } from '../services/fileSystemService';
import { DocumentPreviewService } from '../services/documentPreviewService';
import { documentTextExtractionService } from '../services/documentTextExtractionService';
import { webSourceExtractionService } from '../services/webSourceExtractionService';
import { resourceDiscoveryService } from '../services/resourceDiscoveryService';
import { videoAnalysisService } from '../services/videoAnalysisService';
import { resourceIntelligenceService } from '../services/resourceIntelligenceService';
import prisma from '../config/db';
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

const sourceFilename = (title: string, fallback: string) => {
  const safeBase = (title || fallback)
    .trim()
    .replace(/\.[^./]+$/, '')
    .replace(/[\\/:*?"<>|#{}[\]`]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim() || fallback;
  return `${safeBase}.md`;
};

const buildCrawledSourceMarkdown = (source: {
  title: string;
  url: string;
  siteName?: string;
  pages: Array<{ title: string; url: string; contentMarkdown: string; depth: number }>;
}) => {
  const tableOfContents = source.pages
    .map((page, index) => {
      const indent = '  '.repeat(Math.max(0, page.depth));
      return `${indent}- ${index + 1}. [${page.title}](${page.url})`;
    })
    .join('\n');

  const pages = source.pages
    .map((page, index) => {
      const content = page.contentMarkdown
        .replace(/^#\s+.+$/m, '')
        .replace(/^Source type:\s*.+$/gim, '')
        .replace(/^URL:\s*.+$/gim, '')
        .replace(/^Site:\s*.+$/gim, '')
        .replace(/^Byline:\s*.+$/gim, '')
        .replace(/^Excerpt:\s*.+$/gim, '')
        .trim();
      return [
        `## ${index + 1}. ${page.title}`,
        '',
        `URL: ${page.url}`,
        `Depth: ${page.depth}`,
        '',
        content
      ].join('\n');
    })
    .join('\n\n---\n\n');

  return [
    `# ${source.title}`,
    '',
    'Source type: website',
    `URL: ${source.url}`,
    source.siteName ? `Site: ${source.siteName}` : '',
    `Pages indexed: ${source.pages.length}`,
    '',
    '## Site map',
    '',
    tableOfContents,
    '',
    '---',
    '',
    pages
  ].filter((line) => line !== '').join('\n');
};

const buildSourceManifest = (source: {
  title: string;
  url: string;
  siteName?: string;
  pages: Array<{ title: string; url: string; depth: number; excerpt?: string; links?: Array<{ href: string; text: string; internal: boolean }> }>;
}) => ({
  title: source.title,
  url: source.url,
  siteName: source.siteName,
  pageCount: source.pages.length,
  pages: source.pages.map((page, index) => ({
    id: `P${index + 1}`,
    title: page.title,
    url: page.url,
    depth: page.depth,
    excerpt: page.excerpt || '',
    linkCount: page.links?.length || 0
  }))
});

const parsePositiveInteger = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

const handleError = (res: Response, error: any) => {
  if (error instanceof FileSystemError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({ error: error.message || 'Internal server error' });
};

const parseMetadataInput = (value: unknown): Record<string, unknown> | undefined => {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return undefined;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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

export const getResources = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const workbenchId = getSingleParam(req.query.workbenchId);
    const scope = getSingleParam(req.query.scope);
    const role = getSingleParam(req.query.role);

    validateWorkspaceId(workspaceId);

    const resources = await FileSystemService.listResources(workspaceId, {
      workbenchId: workbenchId || undefined,
      scope: scope || 'all',
      role: role || undefined
    });
    res.json(resources);
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
    const { name, parentId, parentPath, workbenchId, resourceRole, scope } = req.body;
    
    validateWorkspaceId(workspaceId);
    validateName(name);

    const folder = await FileSystemService.createFolder({
      workspaceId,
      name,
      parentId,
      parentPath,
      workbenchId,
      resourceRole,
      scope
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
    const { name, content, parentId, parentPath, fileCategory, workbenchId, resourceRole, resourceType, scope, origin, metadata } = req.body;
    
    validateWorkspaceId(workspaceId);
    validateName(name);

    const file = await FileSystemService.createFile({
      workspaceId,
      name,
      content,
      parentId,
      parentPath,
      fileCategory,
      workbenchId,
      resourceRole,
      resourceType,
      scope,
      origin,
      metadata
    });
    res.json(file);
  } catch (error: any) {
    handleError(res, error);
  }
};

export const importWebSource = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { url, title, parentId, parentPath, workbenchId, scope, maxPages, maxDepth } = req.body;

    validateWorkspaceId(workspaceId);
    if (!url || typeof url !== 'string') throw new FileSystemError(400, 'URL is required');

    const extracted = await webSourceExtractionService.crawl({
      url,
      title: typeof title === 'string' ? title : undefined,
      maxPages: parsePositiveInteger(maxPages) || 1,
      maxDepth: parsePositiveInteger(maxDepth) ?? 0
    });
    const name = sourceFilename(extracted.title, 'web-source');
    validateName(name);
    const manifest = buildSourceManifest(extracted);

    const file = await FileSystemService.createFileOrReturnExisting({
      workspaceId,
      name,
      content: buildCrawledSourceMarkdown(extracted),
      parentId,
      parentPath,
      fileCategory: 'web',
      mimeType: 'text/markdown; charset=utf-8',
      tags: ['source', 'web', 'site'],
      workbenchId,
      resourceRole: 'source',
      resourceType: 'source',
      scope,
      origin: 'web',
      metadata: {
        sourceUrl: extracted.url,
        siteName: extracted.siteName,
        pageCount: extracted.pages.length,
        coverImageUrl: extracted.images?.[0]?.src
      },
      indexInBackground: true
    });

    res.json({
      file,
      source: {
        url: extracted.url,
        title: extracted.title,
        siteName: extracted.siteName,
        pageCount: extracted.pages.length
      },
      manifest
    });
  } catch (error: any) {
    handleError(res, error);
  }
};

export const extractWebSourcePreview = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { url, title } = req.body;

    validateWorkspaceId(workspaceId);
    if (!url || typeof url !== 'string') throw new FileSystemError(400, 'URL is required');

    const extracted = await webSourceExtractionService.extract({
      url,
      title: typeof title === 'string' ? title : undefined
    });

    res.json({
      ...extracted,
      manifest: buildSourceManifest({ ...extracted, pages: [{ ...extracted, depth: 0 }] })
    });
  } catch (error: any) {
    handleError(res, error);
  }
};

export const discoverWebSources = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { query, maxResults, provider } = req.body;

    validateWorkspaceId(workspaceId);
    if (!query || typeof query !== 'string') throw new FileSystemError(400, 'Search query is required');

    const discovery = await resourceDiscoveryService.discover({
      query,
      maxResults: typeof maxResults === 'number' ? maxResults : undefined,
      provider: provider === 'exa' || provider === 'tavily' || provider === 'auto' ? provider : 'auto'
    });

    res.json(discovery);
  } catch (error: any) {
    handleError(res, error);
  }
};

export const getVideoAnalysis = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId || req.query.id);

    validateWorkspaceId(workspaceId);
    validateNodeId(fileObjectId);

    const analysis = await videoAnalysisService.getAnalysis(workspaceId, fileObjectId);
    res.json(analysis);
  } catch (error: any) {
    handleError(res, error);
  }
};

export const startVideoAnalysis = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId || req.body.id);

    validateWorkspaceId(workspaceId);
    validateNodeId(fileObjectId);

    const analysis = await videoAnalysisService.enqueueAnalysis(workspaceId, fileObjectId, {
      force: Boolean(req.body?.force),
      preserveManualEdits: Boolean(req.body?.preserveManualEdits)
    });
    res.json(analysis);
  } catch (error: any) {
    handleError(res, error);
  }
};

export const cancelVideoAnalysis = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId || req.body.id);

    validateWorkspaceId(workspaceId);
    validateNodeId(fileObjectId);

    const analysis = await videoAnalysisService.cancelAnalysis(workspaceId, fileObjectId);
    res.json(analysis);
  } catch (error: any) {
    handleError(res, error);
  }
};

export const updateVideoAnalysis = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId || req.body.id);

    validateWorkspaceId(workspaceId);
    validateNodeId(fileObjectId);

    const analysis = await videoAnalysisService.saveManualRevision(workspaceId, fileObjectId, {
      summary: typeof req.body?.summary === 'string' ? req.body.summary : undefined,
      chapters: Array.isArray(req.body?.chapters) ? req.body.chapters : undefined,
      keyPoints: Array.isArray(req.body?.keyPoints) ? req.body.keyPoints : undefined,
      review: req.body?.review && typeof req.body.review === 'object' ? req.body.review : undefined
    });
    res.json(analysis);
  } catch (error: any) {
    handleError(res, error);
  }
};

export const getResourceIntelligence = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId || req.query.id);

    validateWorkspaceId(workspaceId);
    validateNodeId(fileObjectId);

    const analysis = await resourceIntelligenceService.getAnalysis(workspaceId, fileObjectId);
    res.json(analysis);
  } catch (error: any) {
    handleError(res, error);
  }
};

export const startResourceIntelligence = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId || req.body.id);

    validateWorkspaceId(workspaceId);
    validateNodeId(fileObjectId);

    const analysis = await resourceIntelligenceService.enqueueAnalysis(workspaceId, fileObjectId, {
      force: Boolean(req.body?.force)
    });
    res.json(analysis);
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

export const updateNodeTags = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { id, tags } = req.body;

    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    const node = await FileSystemService.updateNodeTags({
      workspaceId,
      id,
      tags: Array.isArray(tags) ? tags : []
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
    const { parentId, parentPath, workbenchId, resourceRole, scope, metadata } = req.body;
    
    validateWorkspaceId(workspaceId);

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    
    const results = [];
    for (const file of files) {
      const normalizedName = normalizePossiblyMojibakeName(file.originalname);
      try {
        const created = await FileSystemService.handleUploadedFile(
          workspaceId,
          { ...file, originalname: normalizedName },
          parentId,
          parentPath,
          {
            workbenchId,
            resourceRole,
            scope,
            metadata: parseMetadataInput(metadata),
            indexInBackground: Boolean(workbenchId)
          }
        );
        results.push({ success: true, file: created });
      } catch (err: any) {
        results.push({ success: false, name: normalizedName, error: err.message });
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

    const file = await prisma.fileSystemObject.findFirst({
      where: { id, workspaceId }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (file.nodeType !== 'file') {
      return res.status(400).json({ error: 'Cannot download a folder' });
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const isInlineHtml = extension === 'html';

    if (!file.storageKey) {
      // It's a text file stored directly in DB content field
      res.setHeader(
        'Content-Disposition',
        `${isInlineHtml ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`
      );
      res.setHeader('Content-Type', isInlineHtml ? 'text/html; charset=utf-8' : file.mimeType || 'text/plain; charset=utf-8');
      return res.send(file.content || '');
    }

    // It's a real file stored on disk
    const { LocalStorageService } = require('../services/storage/localStorageService');
    const filePath = LocalStorageService.getFilePath(file.storageKey);

    if (isInlineHtml) {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(filePath);
    }

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
    const { id, content, baseContentHash, createRevision, revisionSummary, actionType, actor } = req.body;
    
    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    if (createRevision) {
      const result = await FileSystemService.applyWorkbenchNoteRevision({
        workspaceId,
        fileObjectId: id,
        content,
        baseContentHash,
        summary: revisionSummary,
        actionType,
        actor
      });
      return res.json(result);
    }

    const file = await FileSystemService.saveFileContent(workspaceId, id, content);
    res.json(file);
  } catch (error: any) {
    handleError(res, error);
  }
};

export const listWorkbenchNoteRevisions = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId);
    validateWorkspaceId(workspaceId);
    validateNodeId(fileObjectId);

    const revisions = await FileSystemService.listWorkbenchNoteRevisions(
      workspaceId,
      fileObjectId,
      Number(req.query.limit || 20)
    );
    res.json({ revisions });
  } catch (error: any) {
    handleError(res, error);
  }
};

export const revertWorkbenchNoteRevision = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId);
    const { revisionId, actor } = req.body ?? {};
    validateWorkspaceId(workspaceId);
    validateNodeId(fileObjectId);
    if (revisionId) validateNodeId(revisionId);

    const result = await FileSystemService.revertWorkbenchNoteRevision({
      workspaceId,
      fileObjectId,
      revisionId,
      actor
    });
    res.json(result);
  } catch (error: any) {
    handleError(res, error);
  }
};

// 13. Save Generated Content
export const saveGeneratedContent = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { targetDir, filename, content, category, workbenchId, resourceRole, resourceType, scope, origin, metadata } = req.body;
    
    validateWorkspaceId(workspaceId);
    if (!targetDir && !workbenchId) throw new FileSystemError(400, 'Target directory or workbenchId is required');
    if (!filename) throw new FileSystemError(400, 'Filename is required');

    const file = await FileSystemService.saveGeneratedContent({
      workspaceId,
      targetDir,
      filename,
      content,
      category,
      workbenchId,
      resourceRole,
      resourceType,
      scope,
      origin,
      metadata
    });
    res.json(file);
  } catch (error: any) {
    handleError(res, error);
  }
};

export const getFilePreviewInfo = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const id = getSingleParam(req.query.id);

    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    const previewInfo = await DocumentPreviewService.getPreviewInfo(workspaceId, id);
    res.json(previewInfo);
  } catch (error: any) {
    handleError(res, error);
  }
};

export const streamFilePreview = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const id = getSingleParam(req.query.id);

    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    const preview = await DocumentPreviewService.resolvePreviewPath(workspaceId, id);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(preview.downloadName)}"`
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(preview.filePath, { dotfiles: 'allow' }, (error) => {
      if (!error) return;
      console.error('Preview stream error:', error);
      if (!res.headersSent) {
        handleError(res, new FileSystemError(404, 'Preview file is unavailable'));
      }
    });
  } catch (error: any) {
    handleError(res, error);
  }
};

export const getDocumentStructure = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const id = getSingleParam(req.query.id);

    validateWorkspaceId(workspaceId);
    validateNodeId(id);

    const file = await prisma.fileSystemObject.findFirst({
      where: { id, workspaceId }
    });

    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Cannot render a folder');

    const structure = await documentTextExtractionService.renderable(file);
    res.json(structure);
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

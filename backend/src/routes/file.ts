import express, { NextFunction, Request, Response } from 'express';
import { 
  createFileObject, updateFileObject, deleteFileObject, getFileObject,
  getFileTree, getResources, initFileSystem, createFolder, createFile, renameNode,
  moveNode, deleteNode, copyNode, uploadFiles, downloadFile,
  getFileContent, saveFileContent, saveGeneratedContent, getFilePreviewInfo, streamFilePreview,
  listWorkbenchNoteRevisions, revertWorkbenchNoteRevision,
  updateNodeTags, getDocumentStructure, importWebSource, extractWebSourcePreview, discoverWebSources,
  getVideoAnalysis, startVideoAnalysis, cancelVideoAnalysis, updateVideoAnalysis,
  getResourceIntelligence, startResourceIntelligence
} from '../controllers/fileController';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { requireAuth, requireWorkspaceAccess } from '../middleware/auth';

const router = express.Router();

const isLocalPreviewRequest = (req: Request) => {
  if (process.env.ALLOW_LOCAL_FILE_PREVIEW === 'false') return false;
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_FILE_PREVIEW !== 'true') return false;
  const host = String(req.hostname || '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
};

const allowLocalPreview = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!isLocalPreviewRequest(req)) {
      next();
      return;
    }
    void handler(req, res);
  };

// Configure multer for temporary storage
const tempStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // We can use the system temp dir or our uploads dir
    cb(null, path.resolve(__dirname, '../../uploads')); // same base dir as our permanent storage for easier moves
  },
  filename: (req, file, cb) => {
    // Generate a temporary random name to avoid conflicts during upload
    const tempName = `temp_${crypto.randomBytes(8).toString('hex')}`;
    cb(null, tempName);
  }
});

const upload = multer({ storage: tempStorage });

router.post('/discover-sources', requireAuth, discoverWebSources);

router.get('/workspace/:workspaceId/download', allowLocalPreview(downloadFile));
router.get('/workspace/:workspaceId/preview', allowLocalPreview(streamFilePreview));

router.use('/workspace/:workspaceId', requireAuth, requireWorkspaceAccess);

// New File System API
router.get('/workspace/:workspaceId/tree', getFileTree);
router.get('/workspace/:workspaceId/resources', getResources);
router.post('/workspace/:workspaceId/init', initFileSystem);
router.post('/workspace/:workspaceId/folder', createFolder);
router.post('/workspace/:workspaceId/file', createFile);
router.post('/workspace/:workspaceId/import-url', importWebSource);
router.post('/workspace/:workspaceId/extract-url-preview', extractWebSourcePreview);
router.post('/workspace/:workspaceId/discover-sources', discoverWebSources);
router.get('/workspace/:workspaceId/:fileObjectId/video-analysis', getVideoAnalysis);
router.post('/workspace/:workspaceId/:fileObjectId/video-analysis', startVideoAnalysis);
router.post('/workspace/:workspaceId/:fileObjectId/video-analysis/retry', startVideoAnalysis);
router.post('/workspace/:workspaceId/:fileObjectId/video-analysis/cancel', cancelVideoAnalysis);
router.patch('/workspace/:workspaceId/:fileObjectId/video-analysis', updateVideoAnalysis);
router.get('/workspace/:workspaceId/:fileObjectId/resource-intelligence', getResourceIntelligence);
router.post('/workspace/:workspaceId/:fileObjectId/resource-intelligence', startResourceIntelligence);
router.post('/workspace/:workspaceId/:fileObjectId/resource-intelligence/retry', startResourceIntelligence);
router.patch('/workspace/:workspaceId/rename', renameNode);
router.patch('/workspace/:workspaceId/move', moveNode);
router.patch('/workspace/:workspaceId/tags', updateNodeTags);
router.delete('/workspace/:workspaceId', deleteNode);
router.post('/workspace/:workspaceId/copy', copyNode);
router.post('/workspace/:workspaceId/upload', upload.array('files'), uploadFiles);
router.get('/workspace/:workspaceId/download', downloadFile);
router.get('/workspace/:workspaceId/preview-info', getFilePreviewInfo);
router.get('/workspace/:workspaceId/preview', streamFilePreview);
router.get('/workspace/:workspaceId/document-structure', getDocumentStructure);
router.get('/workspace/:workspaceId/content', getFileContent);
router.put('/workspace/:workspaceId/content', saveFileContent);
router.get('/workspace/:workspaceId/:fileObjectId/revisions', listWorkbenchNoteRevisions);
router.post('/workspace/:workspaceId/:fileObjectId/revisions/revert', revertWorkbenchNoteRevision);
router.post('/workspace/:workspaceId/generated', saveGeneratedContent);

// Legacy endpoints (Deprecated - please use /workspace/:workspaceId/... endpoints)
/** @deprecated */
router.post('/', createFileObject);
/** @deprecated */
router.put('/:id', updateFileObject);
/** @deprecated */
router.delete('/:id', deleteFileObject);
/** @deprecated */
router.get('/:id', getFileObject);

export default router;

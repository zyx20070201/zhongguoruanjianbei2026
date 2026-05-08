import express from 'express';
import { 
  createFileObject, updateFileObject, deleteFileObject, getFileObject,
  getFileTree, getResources, initFileSystem, createFolder, createFile, renameNode,
  moveNode, deleteNode, copyNode, uploadFiles, downloadFile,
  getFileContent, saveFileContent, saveGeneratedContent, getFilePreviewInfo, streamFilePreview,
  updateNodeTags, getDocumentStructure, importWebSource, extractWebSourcePreview, discoverWebSources
} from '../controllers/fileController';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';

const router = express.Router();

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

// New File System API
router.get('/workspace/:workspaceId/tree', getFileTree);
router.get('/workspace/:workspaceId/resources', getResources);
router.post('/workspace/:workspaceId/init', initFileSystem);
router.post('/workspace/:workspaceId/folder', createFolder);
router.post('/workspace/:workspaceId/file', createFile);
router.post('/workspace/:workspaceId/import-url', importWebSource);
router.post('/workspace/:workspaceId/extract-url-preview', extractWebSourcePreview);
router.post('/workspace/:workspaceId/discover-sources', discoverWebSources);
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

import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import {
  appendAudioChunk,
  createAudioRecording,
  finishAudioRecording,
  getAudioNoteAnalysis,
  startUploadedAudioAnalysis
} from '../controllers/audioNoteController';
import { requireAuth, requireWorkspaceAccess } from '../middleware/auth';

const router = express.Router();

const tempStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.resolve(__dirname, '../../uploads'));
  },
  filename: (_req, _file, cb) => {
    cb(null, `audio_chunk_${crypto.randomBytes(8).toString('hex')}`);
  }
});

const upload = multer({ storage: tempStorage });

router.use('/workspace/:workspaceId', requireAuth, requireWorkspaceAccess);

router.post('/workspace/:workspaceId/recordings', createAudioRecording);
router.post('/workspace/:workspaceId/:fileObjectId/chunks', upload.single('chunk'), appendAudioChunk);
router.post('/workspace/:workspaceId/:fileObjectId/finish', finishAudioRecording);
router.post('/workspace/:workspaceId/:fileObjectId/analyze', startUploadedAudioAnalysis);
router.get('/workspace/:workspaceId/:fileObjectId', getAudioNoteAnalysis);

export default router;

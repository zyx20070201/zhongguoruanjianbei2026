import { Router } from 'express';
import authRoutes from './auth';
import workspaceRoutes from './workspace';
import workbenchRoutes from './workbenches';
import fileRoutes from './file';
import aiRoutes from './ai';
import learningRoutes from './learning';
import studioRoutes from './studio';
import flashcardRoutes from './flashcards';
import mclRoutes from './mcl';

const router = Router();

router.use('/auth', authRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/workbenches', workbenchRoutes);
router.use('/files', fileRoutes);
router.use('/ai', aiRoutes);
router.use('/learning', learningRoutes);
router.use('/mcl', mclRoutes);
router.use('/studio', studioRoutes);
router.use('/flashcards', flashcardRoutes);

export default router;

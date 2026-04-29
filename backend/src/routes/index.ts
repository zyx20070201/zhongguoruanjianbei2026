import { Router } from 'express';
import authRoutes from './auth';
import workspaceRoutes from './workspace';
import workbenchRoutes from './workbenches';
import fileRoutes from './file';
import aiRoutes from './ai';

const router = Router();

router.use('/auth', authRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/workbenches', workbenchRoutes);
router.use('/files', fileRoutes);
router.use('/ai', aiRoutes);

export default router;

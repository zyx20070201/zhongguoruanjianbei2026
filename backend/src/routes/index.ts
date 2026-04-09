import { Router } from 'express';
import authRoutes from './auth';
import workspaceRoutes from './workspace';
import workbenchRoutes from './workbench';
import fileRoutes from './file';

const router = Router();

router.use('/auth', authRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/workbenches', workbenchRoutes);
router.use('/files', fileRoutes);

export default router;

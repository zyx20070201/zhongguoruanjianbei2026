import { Router } from 'express';
import { createWorkspace, getWorkspaces, getWorkspace, updateWorkspace, deleteWorkspace, duplicateWorkspace } from '../controllers/workspaceController';
import { requireAuth } from '../middleware/auth';
import { ensureWorkspaceOwnership } from '../middleware/ownership';

const router = Router();

router.use(requireAuth);
router.post('/', createWorkspace);
router.get('/', getWorkspaces);
router.get('/:id', ensureWorkspaceOwnership, getWorkspace);
router.put('/:id', ensureWorkspaceOwnership, updateWorkspace);
router.delete('/:id', ensureWorkspaceOwnership, deleteWorkspace);
router.post('/:id/duplicate', ensureWorkspaceOwnership, duplicateWorkspace);

export default router;

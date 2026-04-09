import { Router } from 'express';
import { createWorkspace, getWorkspaces, getWorkspace, updateWorkspace, deleteWorkspace, duplicateWorkspace } from '../controllers/workspaceController';

const router = Router();

router.post('/', createWorkspace);
router.get('/', getWorkspaces);
router.get('/:id', getWorkspace);
router.put('/:id', updateWorkspace);
router.delete('/:id', deleteWorkspace);
router.post('/:id/duplicate', duplicateWorkspace);

export default router;

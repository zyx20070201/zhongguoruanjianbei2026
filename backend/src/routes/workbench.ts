import { Router } from 'express';
import { createWorkbench, getWorkbenches, getWorkbench, updateWorkbench, deleteWorkbench, createPanel, updatePanel, deletePanel } from '../controllers/workbenchController';

const router = Router();

router.post('/', createWorkbench);
router.get('/', getWorkbenches);
router.get('/:id', getWorkbench);
router.put('/:id', updateWorkbench);
router.delete('/:id', deleteWorkbench);

router.post('/panels', createPanel);
router.put('/panels/:id', updatePanel);
router.delete('/panels/:id', deletePanel);

export default router;

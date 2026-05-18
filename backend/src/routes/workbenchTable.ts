import { Router, Request, Response } from 'express';
import { workbenchTableService } from '../services/workbenchTableService';

const router = Router();
const getSingleValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const ALLOWED_TYPES = new Set([
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'person',
  'file',
  'url',
  'email',
  'phone',
  'ai_summary'
]);

router.get('/:workspaceId', async (req: Request, res: Response) => {
  const workspaceId = getSingleValue(req.params.workspaceId);
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const config = await workbenchTableService.getConfig(workspaceId);
    return res.json(config);
  } catch (error) {
    console.error('Failed to load workbench table config:', error);
    return res.status(500).json({ error: 'Failed to load workbench table config' });
  }
});

router.post('/:workspaceId/properties', async (req: Request, res: Response) => {
  const workspaceId = getSingleValue(req.params.workspaceId);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const type = typeof req.body?.type === 'string' ? req.body.type : 'text';
  const options = Array.isArray(req.body?.options)
    ? req.body.options.filter((option: unknown): option is string => typeof option === 'string')
    : [];
  const widthPx = typeof req.body?.widthPx === 'number' ? req.body.widthPx : undefined;

  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  if (!name) return res.status(400).json({ error: 'Property name is required' });
  if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ error: 'Unsupported property type' });

  try {
    const property = await workbenchTableService.createProperty({ workspaceId, name, type, options, widthPx });
    return res.status(201).json({ property });
  } catch (error) {
    console.error('Failed to create workbench table property:', error);
    return res.status(500).json({ error: 'Failed to create property' });
  }
});

router.patch('/:workspaceId/properties/:propertyId', async (req: Request, res: Response) => {
  const workspaceId = getSingleValue(req.params.workspaceId);
  const propertyId = getSingleValue(req.params.propertyId);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
  const type = typeof req.body?.type === 'string' ? req.body.type : undefined;
  const visible = typeof req.body?.visible === 'boolean' ? req.body.visible : undefined;
  const orderIndex = typeof req.body?.orderIndex === 'number' ? req.body.orderIndex : undefined;
  const widthPx = typeof req.body?.widthPx === 'number' ? req.body.widthPx : undefined;
  const options = Array.isArray(req.body?.options)
    ? req.body.options.filter((option: unknown): option is string => typeof option === 'string')
    : undefined;

  if (!workspaceId || !propertyId) return res.status(400).json({ error: 'Invalid property target' });
  if (type && !ALLOWED_TYPES.has(type)) return res.status(400).json({ error: 'Unsupported property type' });

  try {
    const property = await workbenchTableService.updateProperty({ workspaceId, propertyId, name, type, visible, orderIndex, widthPx, options });
    if (!property) return res.status(404).json({ error: 'Property not found' });
    return res.json({ property });
  } catch (error) {
    console.error('Failed to update workbench table property:', error);
    return res.status(500).json({ error: 'Failed to update property' });
  }
});

router.delete('/:workspaceId/properties/:propertyId', async (req: Request, res: Response) => {
  const workspaceId = getSingleValue(req.params.workspaceId);
  const propertyId = getSingleValue(req.params.propertyId);
  if (!workspaceId || !propertyId) return res.status(400).json({ error: 'Invalid property target' });

  try {
    const deleted = await workbenchTableService.deleteProperty({ workspaceId, propertyId });
    if (!deleted) return res.status(404).json({ error: 'Property not found' });
    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete property';
    const status = message.includes('System properties') ? 400 : 500;
    console.error('Failed to delete workbench table property:', error);
    return res.status(status).json({ error: message });
  }
});

router.put('/:workspaceId/workbenches/:workbenchId/values/:propertyId', async (req: Request, res: Response) => {
  const workspaceId = getSingleValue(req.params.workspaceId);
  const workbenchId = getSingleValue(req.params.workbenchId);
  const propertyId = getSingleValue(req.params.propertyId);
  const value = req.body?.value ?? null;
  if (!workspaceId || !workbenchId || !propertyId) return res.status(400).json({ error: 'Invalid property value target' });
  try {
    const saved = await workbenchTableService.setValue({ workspaceId, workbenchId, propertyId, value });
    return res.json({ value: saved });
  } catch (error) {
    console.error('Failed to save workbench table value:', error);
    return res.status(500).json({ error: 'Failed to save value' });
  }
});

router.post('/:workspaceId/workbenches/:workbenchId/values/:propertyId/ai-summary', async (req: Request, res: Response) => {
  const workspaceId = getSingleValue(req.params.workspaceId);
  const workbenchId = getSingleValue(req.params.workbenchId);
  const propertyId = getSingleValue(req.params.propertyId);
  if (!workspaceId || !workbenchId || !propertyId) return res.status(400).json({ error: 'Invalid AI summary target' });

  try {
    const result = await workbenchTableService.generateSummary({ workspaceId, workbenchId, propertyId });
    return res.json(result);
  } catch (error) {
    console.error('Failed to generate workbench table AI summary:', error);
    return res.status(500).json({ error: 'Failed to generate summary' });
  }
});

export default router;

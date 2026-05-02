import { Router } from 'express';
import { Request, Response } from 'express';
import { learningOrchestrationService } from '../services/learningOrchestrationService';
import { knowledgeIndexingService } from '../services/knowledgeIndexingService';
import { knowledgeSearchService } from '../services/knowledgeSearchService';
import { learningContextBuilder } from '../services/learningContextBuilder';
import { capabilityRegistry } from '../services/capabilityRegistry';
import { registerLearningCapabilities } from '../services/learningCapabilities';
import { learningRunService } from '../services/learningRunService';
import prisma from '../config/db';

const router = Router();
registerLearningCapabilities();

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Learning request failed');

router.post('/terminal/chat', async (req: Request, res: Response) => {
  const { workspaceId, messages } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  try {
    const result = await learningOrchestrationService.chat({ workspaceId, messages });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/workbenches/guided', async (req: Request, res: Response) => {
  const { workspaceId, goalText, title, mode, goalDraft } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!goalText || typeof goalText !== 'string') {
    return res.status(400).json({ error: 'goalText is required' });
  }

  try {
    const result = await learningOrchestrationService.createGuidedWorkbench({
      workspaceId,
      goalText,
      title,
      mode,
      goalDraft
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/index', async (req: Request, res: Response) => {
  const { workspaceId, fileObjectId } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!fileObjectId || typeof fileObjectId !== 'string') {
    return res.status(400).json({ error: 'fileObjectId is required' });
  }

  try {
    const job = await knowledgeIndexingService.indexFile({
      workspaceId,
      fileObjectId,
      reason: 'manual-index'
    });
    return res.json({ job });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/reindex-workspace', async (req: Request, res: Response) => {
  const { workspaceId } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const jobs = await knowledgeIndexingService.indexWorkspace(workspaceId);
    return res.json({
      indexed: jobs.length,
      completed: jobs.filter((job) => job.status === 'completed').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
      jobs
    });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/status', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const fileObjectId = typeof req.query.fileObjectId === 'string' ? req.query.fileObjectId : '';

  if (!workspaceId || !fileObjectId) {
    return res.status(400).json({ error: 'workspaceId and fileObjectId are required' });
  }

  try {
    const job = await knowledgeIndexingService.getLatestStatus(workspaceId, fileObjectId);
    return res.json({ job });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/jobs', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const jobs = await knowledgeIndexingService.listJobs(workspaceId, Number.isFinite(limit) ? limit : 50);
    return res.json({ jobs });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/search', async (req: Request, res: Response) => {
  const { workspaceId, query, fileIds, limit } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  try {
    const results = await knowledgeSearchService.search({
      workspaceId,
      query,
      fileIds: Array.isArray(fileIds) ? fileIds : undefined,
      limit: typeof limit === 'number' ? limit : undefined
    });
    return res.json({ results });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/context', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goalId, activeFileId, query } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const context = await learningContextBuilder.build({
      workspaceId,
      workbenchId,
      goalId,
      activeFileId,
      query
    });
    return res.json({ context });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/capabilities', (_req: Request, res: Response) => {
  return res.json({ capabilities: capabilityRegistry.list() });
});

router.get('/readiness', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const [
      fileCount,
      indexedFileCount,
      chunkCount,
      failedJobCount,
      runningJobCount,
      goalCount,
      traceCount,
      runCount
    ] = await Promise.all([
      prisma.fileSystemObject.count({ where: { workspaceId, nodeType: 'file' } }),
      prisma.knowledgeIndexJob.groupBy({
        by: ['fileObjectId'],
        where: { workspaceId, status: 'completed' }
      }),
      prisma.knowledgeChunk.count({ where: { workspaceId } }),
      prisma.knowledgeIndexJob.count({ where: { workspaceId, status: 'failed' } }),
      prisma.knowledgeIndexJob.count({ where: { workspaceId, status: 'running' } }),
      prisma.learningGoal.count({ where: { workspaceId } }),
      prisma.learningTrace.count({ where: { workspaceId } }),
      prisma.learningRun.count({ where: { workspaceId } })
    ]);

    const checks = [
      {
        id: 'knowledge-index',
        ok: chunkCount > 0,
        message: chunkCount > 0 ? '知识块已建立' : '还没有可检索知识块，建议先上传或重新索引资料'
      },
      {
        id: 'index-failures',
        ok: failedJobCount === 0,
        message: failedJobCount === 0 ? '没有索引失败任务' : `${failedJobCount} 个索引任务失败，需要查看文件类型或抽取错误`
      },
      {
        id: 'learning-goals',
        ok: goalCount > 0,
        message: goalCount > 0 ? '已有结构化学习目标' : '还没有 LearningGoal，建议先通过 AI Terminal 创建学习现场'
      },
      {
        id: 'learning-traces',
        ok: traceCount > 0,
        message: traceCount > 0 ? '已有学习记忆 trace' : '还没有学习 trace，agent 个性化依据较少'
      }
    ];

    return res.json({
      workspaceId,
      ready: checks.every((check) => check.ok),
      checks,
      stats: {
        fileCount,
        indexedFileCount: indexedFileCount.length,
        chunkCount,
        failedJobCount,
        runningJobCount,
        goalCount,
        traceCount,
        runCount
      }
    });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/capabilities/:name/execute', async (req: Request, res: Response) => {
  const name = req.params.name as any;
  const { workspaceId, workbenchId, goalId, input } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const run = await learningRunService.startRun({
      workspaceId,
      workbenchId,
      goalId,
      intent: `manual:${name}`,
      input: input || {}
    });
    const output = await capabilityRegistry.execute(name, input || {}, {
      runId: run.id,
      workspaceId,
      workbenchId,
      goalId
    });
    await learningRunService.completeRun(run.id, { output });
    return res.json({ runId: run.id, output });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/runs', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const runs = await learningRunService.listRuns(workspaceId, Number.isFinite(limit) ? limit : 20);
    return res.json({ runs });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/runs/:id', async (req: Request, res: Response) => {
  const runId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const run = await learningRunService.getRun(runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json({ run });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

export default router;

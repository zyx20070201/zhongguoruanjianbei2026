import { Router } from 'express';
import { Request, Response } from 'express';
import { learningOrchestrationService } from '../services/learningOrchestrationService';
import { knowledgeIndexingService } from '../services/knowledgeIndexingService';
import { knowledgeSearchService } from '../services/knowledgeSearchService';
import { learningContextBuilder } from '../services/learningContextBuilder';
import { capabilityRegistry } from '../services/capabilityRegistry';
import { registerLearningCapabilities } from '../services/learningCapabilities';
import { learningRunService } from '../services/learningRunService';
import { learnerStateService } from '../services/learnerStateService';
import { learnerStateAnalyzer } from '../services/learnerStateAnalyzer';
import { learnerStateContextAdapter, LearnerContextAudience } from '../services/learnerStateContextAdapter';
import { learnerMemoryControlService } from '../services/learnerMemoryControlService';
import { savedMemoryService } from '../services/savedMemoryService';
import { conversationHistoryService } from '../services/conversationHistoryService';
import { memoryGovernanceService } from '../services/memoryGovernanceService';
import { systemHealthService } from '../services/systemHealthService';
import prisma from '../config/db';

const router = Router();
registerLearningCapabilities();

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Learning request failed');

router.post('/terminal/chat', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, sessionId, messages } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  try {
    const result = await learningOrchestrationService.chat({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      sessionId: typeof sessionId === 'string' ? sessionId : null,
      messages
    });
    await learnerStateAnalyzer.analyzeChat({
      workspaceId,
      messages,
      answer: result.reply,
      taskType: 'terminal_goal_draft',
      sourceId: 'learning_terminal'
    }).catch((error) => console.warn('LearnerStateAnalyzer terminal chat failed:', error));
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

router.get('/memory/health', async (_req: Request, res: Response) => {
  try {
    const health = await systemHealthService.check();
    return res.status(health.ok ? 200 : 207).json(health);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/learner-state', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const goalId = typeof req.query.goalId === 'string' ? req.query.goalId : null;

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const state = await learnerStateService.ensureState({ workspaceId, workbenchId, goalId });
    return res.json({ state });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/learner-state/refresh', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goalId } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const state = await learnerStateService.refreshFromExistingEvidence({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      goalId: typeof goalId === 'string' ? goalId : null
    });
    return res.json({ state });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/learner-state/context', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const goalId = typeof req.query.goalId === 'string' ? req.query.goalId : null;
  const audience = typeof req.query.audience === 'string' ? req.query.audience as LearnerContextAudience : 'general';

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const context = await learnerStateContextAdapter.build({ workspaceId, workbenchId, goalId, audience });
    return res.json({ context });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/learner-state/memories', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 12;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const result = await learnerMemoryControlService.listKeyMemories({ workspaceId, workbenchId, limit });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/learner-state/memories/explain', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const memoryKey = typeof req.query.memoryKey === 'string' ? req.query.memoryKey : '';
  if (!workspaceId || !memoryKey) return res.status(400).json({ error: 'workspaceId and memoryKey are required' });

  try {
    const result = await learnerMemoryControlService.explain({ workspaceId, memoryKey });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/learner-state/memories/control', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, memoryKey, dimension, action, correctedText, originalText, reason, weightMultiplier } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!memoryKey || typeof memoryKey !== 'string') return res.status(400).json({ error: 'memoryKey is required' });
  if (!dimension || typeof dimension !== 'string') return res.status(400).json({ error: 'dimension is required' });
  if (!['correct', 'delete', 'freeze', 'downrank', 'restore'].includes(action)) {
    return res.status(400).json({ error: 'action is invalid' });
  }

  try {
    const control = await learnerMemoryControlService.control({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      memoryKey,
      dimension,
      action,
      correctedText: typeof correctedText === 'string' ? correctedText : undefined,
      originalText: typeof originalText === 'string' ? originalText : undefined,
      reason: typeof reason === 'string' ? reason : undefined,
      weightMultiplier: typeof weightMultiplier === 'number' ? weightMultiplier : undefined
    });
    return res.json({ control });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/learner-state/lifecycle', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await learnerMemoryControlService.lifecycle({ workspaceId });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/learner-state/evaluate', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await learnerMemoryControlService.evaluate({ workspaceId });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/learner-state/govern', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await memoryGovernanceService.runLifecycle({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/memory/candidates', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 8;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await memoryGovernanceService.listSaveCandidates({ workspaceId, limit });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/memory/candidates/:candidateId/decision', async (req: Request, res: Response) => {
  const candidateId = Array.isArray(req.params.candidateId) ? req.params.candidateId[0] : req.params.candidateId;
  const { workspaceId, workbenchId, decision, text, category } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!candidateId) return res.status(400).json({ error: 'candidateId is required' });
  if (decision !== 'save' && decision !== 'dismiss') return res.status(400).json({ error: 'decision must be save or dismiss' });
  try {
    const result = await memoryGovernanceService.decideSaveCandidate({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      candidateId,
      decision,
      text: typeof text === 'string' ? text : undefined,
      category: typeof category === 'string' ? category : undefined
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/memory/debug', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const query = typeof req.query.query === 'string' ? req.query.query : undefined;
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : null;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await memoryGovernanceService.debugOverview({ workspaceId, workbenchId, query, sessionId });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/saved-memories', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
  const includeDeleted = req.query.includeDeleted === 'true';
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const memories = await savedMemoryService.list({ workspaceId, limit, includeDeleted });
    return res.json({ memories });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/saved-memories', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, text, category } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text is required' });
  try {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    const memory = await savedMemoryService.upsert({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      userId: workspace.userId,
      text,
      category: typeof category === 'string' ? category : undefined,
      source: 'manual_user_entry',
      confidence: 1
    });
    return res.json({ memory });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.patch('/saved-memories/:memoryKey', async (req: Request, res: Response) => {
  const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
  const memoryKey = Array.isArray(req.params.memoryKey) ? req.params.memoryKey[0] : req.params.memoryKey;
  const { text, category, action } = req.body ?? {};
  if (!workspaceId || !memoryKey) return res.status(400).json({ error: 'workspaceId and memoryKey are required' });
  try {
    if (action === 'restore') {
      const memory = await savedMemoryService.restore({ workspaceId, memoryKey });
      return res.json({ memory });
    }
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text is required' });
    const memory = await savedMemoryService.update({
      workspaceId,
      memoryKey,
      text,
      category: typeof category === 'string' ? category : undefined
    });
    return res.json({ memory });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.delete('/saved-memories/:memoryKey', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const memoryKey = Array.isArray(req.params.memoryKey) ? req.params.memoryKey[0] : req.params.memoryKey;
  if (!workspaceId || !memoryKey) return res.status(400).json({ error: 'workspaceId and memoryKey are required' });
  try {
    await savedMemoryService.delete({ workspaceId, memoryKey });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/conversation-history/search', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const query = typeof req.query.query === 'string' ? req.query.query : '';
  const currentSessionId = typeof req.query.currentSessionId === 'string' ? req.query.currentSessionId : null;
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
  const source = typeof req.query.source === 'string' ? req.query.source : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 8;
  if (!workspaceId || !query) return res.status(400).json({ error: 'workspaceId and query are required' });
  try {
    const items = await conversationHistoryService.retrieve({ workspaceId, workbenchId, userId, source, query, currentSessionId, limit });
    return res.json({ items, promptContext: conversationHistoryService.formatRetrieved(items) });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/conversation-history/backfill-embeddings', async (req: Request, res: Response) => {
  const { workspaceId, limit, enqueue } = req.body ?? {};
  try {
    const result = await conversationHistoryService.backfillEmbeddings({
      workspaceId: typeof workspaceId === 'string' ? workspaceId : undefined,
      limit: typeof limit === 'number' ? limit : undefined,
      enqueue: typeof enqueue === 'boolean' ? enqueue : true
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/conversation-history/sessions', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const source = typeof req.query.source === 'string' ? req.query.source : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
  const includeMessages = req.query.includeMessages === 'true';
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const sessions = await conversationHistoryService.listSessions({
      workspaceId,
      workbenchId,
      source,
      limit,
      includeMessages
    });
    return res.json({ sessions });
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

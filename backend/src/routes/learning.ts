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
import { learnerProfileViewService } from '../services/learnerProfileViewService';
import { learnerMemoryControlService } from '../services/learnerMemoryControlService';
import { savedMemoryService } from '../services/savedMemoryService';
import { conversationHistoryService } from '../services/conversationHistoryService';
import { memoryGovernanceService } from '../services/memoryGovernanceService';
import { systemHealthService } from '../services/systemHealthService';
import { learningMemoryService } from '../services/learningMemoryService';
import { courseHomeService } from '../services/courseHomeService';
import { learningEventCollectionService } from '../services/learningEventCollectionService';
import { learningEventDiagnosticsService } from '../services/learningEventDiagnosticsService';
import { learningEventSequenceService } from '../services/learningEventSequenceService';
import { learningEventSchemaRegistryService } from '../services/learningEventSchemaRegistryService';
import { courseKnowledgeGraphService } from '../services/courseKnowledgeGraphService';
import { courseKnowledgeReasoningService } from '../services/courseKnowledgeReasoningService';
import { courseKnowledgeEvolutionService } from '../services/courseKnowledgeEvolutionService';
import { courseGraphBuildService } from '../services/courseGraphBuildService';
import { courseGraphBuildJobService } from '../services/courseGraphBuildJobService';
import { learningDiagnosisEngine } from '../services/learningDiagnosisEngine';
import { learnerDiagnosisStateUpdateService } from '../services/learnerDiagnosisStateUpdateService';
import { knowledgeTracingModelService } from '../services/knowledgeTracingModelService';
import { graphConstrainedPlannerService } from '../services/graphConstrainedPlannerService';
import { knowledgeGraphPlanningAgentService } from '../services/knowledgeGraphPlanningAgentService';
import { learnerStateGovernanceService } from '../services/learnerStateGovernanceService';
import { courseKnowledgeExtractionValidationService } from '../services/courseKnowledgeExtractionValidationService';
import { courseKnowledgeQualityEnhancementService } from '../services/courseKnowledgeQualityEnhancementService';
import { learningSystemEvaluationService } from '../services/learningSystemEvaluationService';
import { personalizedWorkspaceIntegrationService } from '../services/personalizedWorkspaceIntegrationService';
import { targetKnowledgeStructureService } from '../services/targetKnowledgeStructureService';
import { knowledgeGapAnalysisService } from '../services/knowledgeGapAnalysisService';
import { workspaceFileIndexService } from '../services/workspaceFileIndexService';
import { workspaceAgentRuntime } from '../services/workspaceAgent/workspaceAgentRuntime';
import { workspaceTerminalChatService } from '../services/workspaceTerminalChatService';
import { planGovernanceService } from '../services/planning/planGovernanceService';
import prisma from '../config/db';

const router = Router();
registerLearningCapabilities();

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Learning request failed');

const terminalMode = (value: unknown): 'chat' | 'agentic' =>
  value === 'chat' ? 'chat' : 'agentic';

const selectedSourceIds = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item)).slice(0, 12)
    : [];

const selectedSources = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item: any) => ({
          fileId: typeof item?.fileId === 'string' ? item.fileId : typeof item?.id === 'string' ? item.id : '',
          mode: item?.mode === 'full_context' ? 'full_context' as const : 'focused' as const
        }))
        .filter((item) => item.fileId)
        .slice(0, 12)
    : [];

const chatFiles = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item: any) => ({
          id: typeof item?.id === 'string' ? item.id : '',
          name: typeof item?.name === 'string' ? item.name : undefined,
          mimeType: typeof item?.mimeType === 'string' ? item.mimeType : undefined,
          size: typeof item?.size === 'number' ? item.size : undefined
        }))
        .filter((item) => item.id)
        .slice(0, 24)
    : [];

const latestTerminalUserText = (messages: any[]) =>
  [...(messages || [])].reverse().find((message) => message?.role === 'user' && String(message?.content || '').trim())?.content || '';

const terminalAssistantMessage = (result: any, mode: 'chat' | 'agentic') => ({
  role: 'assistant' as const,
  content: String(result?.reply || ''),
  mode,
  goalDraft: result?.goalDraft,
  proposedActions: result?.proposedActions,
  executedActions: result?.executedActions,
  agentTrace: result?.agentTrace,
  evidence: result?.evidence,
  followUps: result?.followUps,
  askUserToSave: result?.memoryContext?.askUserToSave || null
});

const replaceOrAppendAssistant = (messages: any[], assistant: ReturnType<typeof terminalAssistantMessage>) => {
  const normalized = Array.isArray(messages) ? messages : [];
  if (normalized[normalized.length - 1]?.role === 'assistant') {
    return [...normalized.slice(0, -1), assistant];
  }
  return [...normalized, assistant];
};

const persistTerminalConversation = async (input: {
  workspaceId: string;
  workbenchId?: string | null;
  sessionId?: string | null;
  checkpointThreadId?: string | null;
  mode: 'chat' | 'agentic';
  messages: any[];
  result: any;
  selectedSources?: Array<{ fileId: string; mode: 'focused' | 'full_context' }>;
  chatFiles?: ReturnType<typeof chatFiles>;
}) => {
  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { userId: true }
  }).catch(() => null);
  if (!workspace?.userId) return null;
  const assistant = terminalAssistantMessage(input.result, input.mode);
  const sessionId = input.result?.sessionId || input.sessionId || null;
  const checkpointThreadId = input.result?.checkpointThreadId || input.checkpointThreadId || null;
  return conversationHistoryService.saveTerminalConversation({
    workspaceId: input.workspaceId,
    workbenchId: input.workbenchId || null,
    userId: workspace.userId,
    sessionId,
    title: String(latestTerminalUserText(input.messages)).slice(0, 80),
    source: input.mode === 'chat' ? 'terminal_chat' : 'terminal',
    messages: replaceOrAppendAssistant(input.messages, assistant),
    sessionMetadata: {
      mode: input.mode,
      checkpointThreadId,
      selectedSources: input.selectedSources || [],
      chatFiles: input.chatFiles || [],
      status: input.result?.status || 'completed'
    }
  }).catch((error) => {
    console.warn('Terminal conversation persistence failed:', error);
    return null;
  });
};

router.post('/terminal/chat', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, sessionId, messages } = req.body ?? {};
  const mode = terminalMode(req.body?.mode);

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  try {
    const commonInput = {
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      sessionId: typeof sessionId === 'string' ? sessionId : null,
      messages
    };
    const normalizedChatFiles = chatFiles(req.body?.chatFiles);
    const normalizedSelectedSources = selectedSources(req.body?.selectedSources);
    const result = mode === 'chat'
      ? await workspaceTerminalChatService.chat({
          ...commonInput,
          selectedSources: normalizedSelectedSources,
          selectedSourceIds: selectedSourceIds(req.body?.selectedSourceIds),
          chatFiles: normalizedChatFiles
        })
      : await workspaceAgentRuntime.run({ ...commonInput, chatFiles: normalizedChatFiles });
    await persistTerminalConversation({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      sessionId: typeof sessionId === 'string' ? sessionId : null,
      checkpointThreadId: typeof req.body?.checkpointThreadId === 'string' ? req.body.checkpointThreadId : null,
      mode,
      messages,
      result,
      selectedSources: normalizedSelectedSources,
      chatFiles: normalizedChatFiles
    });
    const latestUserMessage = [...messages].reverse().find((message: any) => message?.role === 'user' && message?.content)?.content || '';
    await learningEventCollectionService.collect({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      eventType: 'ai.chat_turn',
      actor: 'user',
      interaction: {
        sessionId: result.sessionId || (typeof sessionId === 'string' ? sessionId : null),
        userText: String(latestUserMessage),
        assistantText: result.reply,
        repeatedQuestion: /还是|再说|没懂|不懂|换个说法|again|still/i.test(String(latestUserMessage))
      },
      source: { component: mode === 'chat' ? 'learning_terminal_chat' : 'learning_terminal' },
      confidence: 0.62
    }).catch((error) => console.warn('Learning event collection chat_turn failed:', error));
    await learnerStateAnalyzer.analyzeChat({
      workspaceId,
      messages,
      answer: result.reply,
      taskType: mode === 'chat' ? 'workspace_terminal_chat' : 'workspace_agent_terminal',
      sourceId: mode === 'chat' ? 'learning_terminal_chat' : 'learning_terminal'
    }).catch((error) => console.warn('LearnerStateAnalyzer terminal chat failed:', error));
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/terminal/chat/stream', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, sessionId, checkpointThreadId, messages } = req.body ?? {};
  const mode = terminalMode(req.body?.mode);

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const normalizedChatFiles = chatFiles(req.body?.chatFiles);
    const normalizedSelectedSources = selectedSources(req.body?.selectedSources);
    if (mode === 'chat') {
      let finalResult: Awaited<ReturnType<typeof workspaceTerminalChatService.chat>> | null = null;
      for await (const item of workspaceTerminalChatService.chatStream({
        workspaceId,
        workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
        sessionId: typeof sessionId === 'string' ? sessionId : null,
        messages,
        selectedSources: normalizedSelectedSources,
        selectedSourceIds: selectedSourceIds(req.body?.selectedSourceIds),
        chatFiles: normalizedChatFiles
      })) {
        if (item.type === 'status') send('status', { type: 'status', node: 'WorkspaceChat', status: item.status });
        if (item.type === 'delta') send('delta', { type: 'delta', node: 'WorkspaceChat', delta: item.delta });
        if (item.type === 'final') finalResult = item.result;
      }
      if (!finalResult) throw new Error('Workspace chat stream ended before final result');
      await persistTerminalConversation({
        workspaceId,
        workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
        sessionId: typeof sessionId === 'string' ? sessionId : null,
        checkpointThreadId: typeof checkpointThreadId === 'string' ? checkpointThreadId : null,
        mode,
        messages,
        result: finalResult,
        selectedSources: normalizedSelectedSources,
        chatFiles: normalizedChatFiles
      });
      send('final', { type: 'final', node: 'WorkspaceChat', result: finalResult });
    } else {
      for await (const item of workspaceAgentRuntime.streamRun({
        workspaceId,
        workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
        sessionId: typeof sessionId === 'string' ? sessionId : null,
        checkpointThreadId: typeof checkpointThreadId === 'string' ? checkpointThreadId : null,
        messages,
        chatFiles: normalizedChatFiles
      })) {
        if ((item.type === 'final' || item.type === 'approval_required') && item.result) {
          await persistTerminalConversation({
            workspaceId,
            workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
            sessionId: typeof sessionId === 'string' ? sessionId : null,
            checkpointThreadId: typeof checkpointThreadId === 'string' ? checkpointThreadId : null,
            mode,
            messages,
            result: item.result,
            selectedSources: normalizedSelectedSources,
            chatFiles: normalizedChatFiles
          });
        }
        send(item.type, item);
      }
    }
    send('done', { ok: true });
  } catch (error) {
    send('error', { error: getErrorMessage(error) });
  } finally {
    res.end();
  }
});

router.post('/terminal/approval', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, sessionId, checkpointThreadId, messages, decision } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (!decision || typeof decision !== 'object') {
    return res.status(400).json({ error: 'decision is required' });
  }

  try {
    const result = await workspaceAgentRuntime.resumeApproval(
      {
        workspaceId,
        workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
        sessionId: typeof sessionId === 'string' ? sessionId : null,
        checkpointThreadId: typeof checkpointThreadId === 'string' ? checkpointThreadId : null,
        messages: Array.isArray(messages) ? messages : []
      },
      decision
    );
    await persistTerminalConversation({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      sessionId: typeof sessionId === 'string' ? sessionId : null,
      checkpointThreadId: typeof checkpointThreadId === 'string' ? checkpointThreadId : null,
      mode: 'agentic',
      messages: Array.isArray(messages) ? messages : [],
      result
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/terminal/chats', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const sessions = await conversationHistoryService.listTerminalSessions({ workspaceId, workbenchId, limit });
    return res.json({ sessions });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/terminal/chats/:sessionId/messages', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : '';
  const before = typeof req.query.before === 'string' ? req.query.before : null;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
  try {
    const result = await conversationHistoryService.getTerminalMessages({
      workspaceId,
      sessionId,
      before,
      limit
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/events', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goalId, eventType, actor, payload, object, interaction, source, confidence } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!eventType || typeof eventType !== 'string') return res.status(400).json({ error: 'eventType is required' });
  try {
    const event = await learningEventCollectionService.collect({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      goalId: typeof goalId === 'string' ? goalId : null,
      eventType,
      actor: ['user', 'assistant', 'system', 'agent'].includes(actor) ? actor : 'user',
      payload: payload && typeof payload === 'object' ? payload : {},
      object: object && typeof object === 'object' ? object : undefined,
      interaction: interaction && typeof interaction === 'object' ? interaction : undefined,
      source: source && typeof source === 'object' ? source : undefined,
      confidence: typeof confidence === 'number' ? confidence : undefined
    });
    return res.status(201).json({ event });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/events', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : undefined;
  const actor = typeof req.query.actor === 'string' ? req.query.actor : undefined;
  const objectType = typeof req.query.objectType === 'string' ? req.query.objectType : undefined;
  const objectId = typeof req.query.objectId === 'string' ? req.query.objectId : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const events = await learningEventCollectionService.list({ workspaceId, workbenchId, eventType, actor, objectType, objectId, limit });
    return res.json({ events });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.patch('/events/:eventId', async (req: Request, res: Response) => {
  const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
  const eventId = Array.isArray(req.params.eventId) ? req.params.eventId[0] : req.params.eventId;
  const { eventType, summary, confidence } = req.body ?? {};
  if (!workspaceId || !eventId) return res.status(400).json({ error: 'workspaceId and eventId are required' });
  try {
    const existing = await prisma.learningEvent.findFirst({ where: { id: eventId, workspaceId } });
    if (!existing) return res.status(404).json({ error: 'Learning event not found' });
    const payload = JSON.parse(existing.payloadJson || '{}');
    const nextPayload = typeof summary === 'string'
      ? { ...payload, summary, interaction: { ...(payload.interaction || {}), userText: summary } }
      : payload;
    const event = await prisma.learningEvent.update({
      where: { id: eventId },
      data: {
        ...(typeof eventType === 'string' && eventType.trim() ? { eventType: eventType.trim() } : {}),
        ...(typeof confidence === 'number' ? { confidence } : {}),
        payloadJson: JSON.stringify(nextPayload)
      }
    });
    return res.json({
      event: {
        id: event.id,
        eventType: event.eventType,
        actor: event.actor,
        schemaVersion: event.schemaVersion,
        eventFamily: event.eventFamily,
        workspaceId: event.workspaceId,
        workbenchId: event.workbenchId,
        goalId: event.goalId,
        objectType: event.objectType,
        objectId: event.objectId,
        sessionId: event.sessionId,
        confidence: event.confidence,
        payload: JSON.parse(event.payloadJson || '{}'),
        metadata: JSON.parse(event.metadataJson || '{}'),
        cognitiveSignals: JSON.parse(event.cognitiveSignalsJson || '[]'),
        diagnosticFeatures: JSON.parse(event.diagnosticFeaturesJson || '{}'),
        quality: JSON.parse(event.qualityJson || '{}'),
        observedAt: event.observedAt.toISOString(),
        createdAt: event.createdAt.toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.delete('/events/:eventId', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const eventId = Array.isArray(req.params.eventId) ? req.params.eventId[0] : req.params.eventId;
  if (!workspaceId || !eventId) return res.status(400).json({ error: 'workspaceId and eventId are required' });
  try {
    const existing = await prisma.learningEvent.findFirst({ where: { id: eventId, workspaceId } });
    if (!existing) return res.status(404).json({ error: 'Learning event not found' });
    await prisma.learningEvent.delete({ where: { id: eventId } });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/events/diagnostics', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const goalId = typeof req.query.goalId === 'string' ? req.query.goalId : null;
  const days = typeof req.query.days === 'string' ? Number(req.query.days) : 30;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const diagnostics = await learningEventDiagnosticsService.summarize({
      workspaceId,
      workbenchId,
      goalId,
      days: Number.isFinite(days) ? days : 30
    });
    return res.json({ diagnostics });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/events/sequences', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const patternType = typeof req.query.patternType === 'string' ? req.query.patternType : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const patterns = await learningEventSequenceService.list({ workspaceId, workbenchId, patternType, limit });
    return res.json({ patterns });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/events/schemas', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : null;
  const status = typeof req.query.status === 'string' ? req.query.status : 'active';
  try {
    const schemas = await learningEventSchemaRegistryService.list({ workspaceId, status });
    return res.json({ schemas });
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
  const { workspaceId, fileObjectId, force } = req.body ?? {};

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
      reason: force ? 'manual-reindex' : 'manual-index',
      force: Boolean(force)
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
    const report = await courseGraphBuildService.build({
      workspaceId,
      reindex: true,
      includeWorkspaceResources: true,
      validate: true
    });
    return res.json({ report });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/build', async (req: Request, res: Response) => {
  const {
    workspaceId,
    workbenchId,
    resourceRole,
    reindex,
    validate,
    includeWorkspaceResources,
    maxFilesPerWorkbench,
    maxWorkspaceFiles,
    graphLimit
  } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const report = await courseGraphBuildService.build({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      resourceRole: typeof resourceRole === 'string' ? resourceRole : null,
      reindex: Boolean(reindex),
      validate: validate !== false,
      includeWorkspaceResources: includeWorkspaceResources !== false,
      maxFilesPerWorkbench: typeof maxFilesPerWorkbench === 'number' ? maxFilesPerWorkbench : undefined,
      maxWorkspaceFiles: typeof maxWorkspaceFiles === 'number' ? maxWorkspaceFiles : undefined,
      graphLimit: typeof graphLimit === 'number' ? graphLimit : undefined
    });
    return res.json({ report });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/build-job', async (req: Request, res: Response) => {
  const {
    workspaceId,
    workbenchId,
    resourceRole,
    reindex,
    validate,
    includeWorkspaceResources,
    maxFilesPerWorkbench,
    maxWorkspaceFiles,
    graphLimit
  } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const job = courseGraphBuildJobService.start({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      resourceRole: typeof resourceRole === 'string' ? resourceRole : null,
      reindex: Boolean(reindex),
      validate: validate !== false,
      includeWorkspaceResources: includeWorkspaceResources !== false,
      maxFilesPerWorkbench: typeof maxFilesPerWorkbench === 'number' ? maxFilesPerWorkbench : undefined,
      maxWorkspaceFiles: typeof maxWorkspaceFiles === 'number' ? maxWorkspaceFiles : undefined,
      graphLimit: typeof graphLimit === 'number' ? graphLimit : undefined
    });
    return res.status(202).json({ job });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/graph/build-jobs', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 10;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const jobs = courseGraphBuildJobService.list(workspaceId, Number.isFinite(limit) ? limit : 10);
    return res.json({ jobs });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/graph/build-jobs/:jobId', async (req: Request, res: Response) => {
  const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });
  try {
    const job = courseGraphBuildJobService.get(jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    return res.json({ job });
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

router.get('/workspace/files/cards', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const query = typeof req.query.query === 'string' ? req.query.query : '';
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 80;

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const files = await workspaceFileIndexService.listFileCards({
      workspaceId,
      query,
      limit: Number.isFinite(limit) ? limit : 80
    });
    return res.json({ files });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/workspace/files/index', async (req: Request, res: Response) => {
  const { workspaceId, force, maxFiles, fileIds } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const report = await workspaceFileIndexService.ensureWorkspaceIndexed({
      workspaceId,
      force: Boolean(force),
      maxFiles: typeof maxFiles === 'number' ? maxFiles : undefined,
      fileIds: Array.isArray(fileIds) ? fileIds.filter((value): value is string => typeof value === 'string') : undefined
    });
    return res.json({ report });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/workspace/files/search', async (req: Request, res: Response) => {
  const { workspaceId, query, fileLimit, chunkLimit, ensureIndexed } = req.body ?? {};

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  try {
    const result = await workspaceFileIndexService.search({
      workspaceId,
      query,
      fileLimit: typeof fileLimit === 'number' ? fileLimit : undefined,
      chunkLimit: typeof chunkLimit === 'number' ? chunkLimit : undefined,
      ensureIndexed: Boolean(ensureIndexed)
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/graph', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 80;
  const tagQuery = typeof req.query.tagQuery === 'string' ? req.query.tagQuery : '';
  const sourceIds = typeof req.query.sourceIds === 'string'
    ? req.query.sourceIds.split(',').map((item) => item.trim()).filter(Boolean)
    : Array.isArray(req.query.sourceIds)
      ? req.query.sourceIds.map((item) => String(item).trim()).filter(Boolean)
      : [];
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const graph = await courseKnowledgeGraphService.getGraph({
      workspaceId,
      limit: Number.isFinite(limit) ? limit : 80,
      sourceIds,
      tagQuery
    });
    return res.json({ graph });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/graph/concepts/:conceptId/tags', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const conceptId = typeof req.params.conceptId === 'string' ? req.params.conceptId : '';
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  if (!conceptId) return res.status(400).json({ error: 'conceptId is required' });
  try {
    const tags = await courseKnowledgeGraphService.listConceptTags({ workspaceId, conceptId });
    return res.json({ tags });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/concepts/:conceptId/tags', async (req: Request, res: Response) => {
  const conceptId = typeof req.params.conceptId === 'string' ? req.params.conceptId : '';
  const { workspaceId, label, source, state, rationale } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!conceptId) return res.status(400).json({ error: 'conceptId is required' });
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'label is required' });
  try {
    const tag = await courseKnowledgeGraphService.upsertConceptTag({
      workspaceId,
      conceptId,
      label,
      source,
      state,
      rationale
    });
    return res.status(201).json({ tag });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.delete('/knowledge/graph/concepts/:conceptId/tags/:tagId', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const conceptId = typeof req.params.conceptId === 'string' ? req.params.conceptId : '';
  const tagId = typeof req.params.tagId === 'string' ? req.params.tagId : '';
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  if (!conceptId) return res.status(400).json({ error: 'conceptId is required' });
  if (!tagId) return res.status(400).json({ error: 'tagId is required' });
  try {
    const result = await courseKnowledgeGraphService.deleteConceptTag({ workspaceId, conceptId, tagId });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/concepts/:conceptId/tag-suggestions', async (req: Request, res: Response) => {
  const conceptId = typeof req.params.conceptId === 'string' ? req.params.conceptId : '';
  const { workspaceId, question, history } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!conceptId) return res.status(400).json({ error: 'conceptId is required' });
  try {
    const result = await courseKnowledgeGraphService.chatAboutConceptForTags({
      workspaceId,
      conceptId,
      question: typeof question === 'string' ? question : undefined,
      history: Array.isArray(history)
        ? history.filter((item: any) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
        : undefined
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/concepts/:conceptId/explain-stream', async (req: Request, res: Response) => {
  const conceptId = typeof req.params.conceptId === 'string' ? req.params.conceptId : '';
  const { workspaceId, question, history } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!conceptId) return res.status(400).json({ error: 'conceptId is required' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let reply = '';
  try {
    const stream = courseKnowledgeGraphService.streamConceptExplanation({
      workspaceId,
      conceptId,
      question: typeof question === 'string' ? question : undefined,
      history: Array.isArray(history)
        ? history.filter((item: any) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
        : undefined
    });
    for await (const delta of stream) {
      reply += delta;
      send('delta', delta);
    }
    send('done', { reply });
  } catch (error) {
    send('error', { error: getErrorMessage(error) });
  } finally {
    res.end();
  }
});

router.get('/knowledge/graph/concepts/:conceptId/exercises', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const conceptId = typeof req.params.conceptId === 'string' ? req.params.conceptId : '';
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 12;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  if (!conceptId) return res.status(400).json({ error: 'conceptId is required' });
  try {
    const exercises = await courseKnowledgeGraphService.getConceptExercises({
      workspaceId,
      conceptId,
      limit: Number.isFinite(limit) ? limit : 12
    });
    return res.json({ exercises });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/concepts', async (req: Request, res: Response) => {
  const { workspaceId, title, description, aliases, category, difficulty, source, evidence } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!title || typeof title !== 'string') return res.status(400).json({ error: 'title is required' });
  try {
    const concept = await courseKnowledgeGraphService.upsertConcept({
      workspaceId,
      title,
      description,
      aliases: Array.isArray(aliases) ? aliases : [],
      category,
      difficulty,
      source,
      evidence
    });
    return res.status(201).json({ concept });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/relations', async (req: Request, res: Response) => {
  const { workspaceId, fromConceptId, toConceptId, relationType, weight, confidence, source, evidence } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!fromConceptId || !toConceptId || !relationType) return res.status(400).json({ error: 'fromConceptId, toConceptId and relationType are required' });
  try {
    const relation = await courseKnowledgeGraphService.upsertRelation({
      workspaceId,
      fromConceptId,
      toConceptId,
      relationType,
      weight,
      confidence,
      source,
      evidence
    });
    return res.status(201).json({ relation });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/bind-resource', async (req: Request, res: Response) => {
  const { workspaceId, fileObjectId } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!fileObjectId || typeof fileObjectId !== 'string') return res.status(400).json({ error: 'fileObjectId is required' });
  try {
    const result = await courseKnowledgeGraphService.ingestResourceFile({ workspaceId, fileObjectId, source: 'manual_kg_resource_binding' });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/rebuild-workspace', async (req: Request, res: Response) => {
  const { workspaceId, reindex, validate, graphLimit } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const report = await courseGraphBuildService.build({
      workspaceId,
      reindex: Boolean(reindex),
      includeWorkspaceResources: true,
      validate: validate !== false,
      graphLimit: typeof graphLimit === 'number' ? graphLimit : undefined
    });
    return res.json({ report });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/graph/prerequisite-gaps', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const conceptIds = typeof req.query.conceptIds === 'string' ? req.query.conceptIds.split(',').filter(Boolean) : undefined;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const gaps = await courseKnowledgeReasoningService.getPrerequisiteGaps({ workspaceId, conceptIds });
    return res.json({ gaps });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/graph/weak-neighborhood', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const conceptIds = typeof req.query.conceptIds === 'string' ? req.query.conceptIds.split(',').filter(Boolean) : undefined;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const neighborhood = await courseKnowledgeReasoningService.expandWeakNeighborhood({ workspaceId, conceptIds });
    return res.json({ neighborhood });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/graph/remediation-path', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const targetConceptId = typeof req.query.targetConceptId === 'string' ? req.query.targetConceptId : '';
  if (!workspaceId || !targetConceptId) return res.status(400).json({ error: 'workspaceId and targetConceptId are required' });
  try {
    const path = await courseKnowledgeReasoningService.recommendRemediationPath({ workspaceId, targetConceptId });
    return res.json({ path });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/graph/readiness', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const conceptId = typeof req.query.conceptId === 'string' ? req.query.conceptId : '';
  if (!workspaceId || !conceptId) return res.status(400).json({ error: 'workspaceId and conceptId are required' });
  try {
    const readiness = await courseKnowledgeReasoningService.estimateConceptReadiness({ workspaceId, conceptId });
    return res.json({ readiness });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/knowledge/graph/validate', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const validation = await courseKnowledgeExtractionValidationService.validate({ workspaceId });
    return res.json({ validation });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/validate', async (req: Request, res: Response) => {
  const { workspaceId } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const validation = await courseKnowledgeExtractionValidationService.validateAndLog({ workspaceId });
    return res.json({ validation });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/govern', async (req: Request, res: Response) => {
  const { workspaceId } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await courseKnowledgeEvolutionService.govern({ workspaceId });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/cleanup-pollution', async (req: Request, res: Response) => {
  const { workspaceId, dryRun, rebuildResourceGraph } = req.body ?? {};
  if (workspaceId !== undefined && typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId must be a string' });
  try {
    const result = await courseKnowledgeGraphService.cleanupPollutedKnowledgeData({
      workspaceId,
      dryRun: dryRun !== undefined ? Boolean(dryRun) : true,
      rebuildResourceGraph: Boolean(rebuildResourceGraph)
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/graph/enhance-quality', async (req: Request, res: Response) => {
  const { workspaceId, apply, minConfidence } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await courseKnowledgeQualityEnhancementService.enhance({
      workspaceId,
      apply: Boolean(apply),
      minConfidence: typeof minConfidence === 'number' ? minConfidence : undefined
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/target-structure', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goalId, objective, targetConcepts, persist } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await targetKnowledgeStructureService.build({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      goalId: typeof goalId === 'string' ? goalId : null,
      objective: typeof objective === 'string' ? objective : undefined,
      targetConcepts: Array.isArray(targetConcepts) ? targetConcepts.map(String).filter(Boolean) : undefined,
      persist: persist !== false
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/knowledge/gap-analysis', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goalId, objective, targetStructure, persist } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await knowledgeGapAnalysisService.analyze({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      goalId: typeof goalId === 'string' ? goalId : null,
      objective: typeof objective === 'string' ? objective : undefined,
      targetStructure: targetStructure && typeof targetStructure === 'object' ? targetStructure : undefined,
      persist: persist !== false
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/diagnosis', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const conceptIds = typeof req.query.conceptIds === 'string' ? req.query.conceptIds.split(',').filter(Boolean) : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 80;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const diagnosis = await learningDiagnosisEngine.diagnose({ workspaceId, conceptIds, limit: Number.isFinite(limit) ? limit : 80 });
    return res.json({ diagnosis });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/diagnosis', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goalId, conceptIds, limit, applyStatePatches } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await learningDiagnosisEngine.diagnoseAndPersist({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      goalId: typeof goalId === 'string' ? goalId : null,
      conceptIds: Array.isArray(conceptIds) ? conceptIds.map(String).filter(Boolean) : undefined,
      limit: typeof limit === 'number' ? limit : undefined,
      applyStatePatches: Boolean(applyStatePatches)
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/diagnosis/state-update', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goalId, since, limit, minConfidence, apply } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await learnerDiagnosisStateUpdateService.run({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      goalId: typeof goalId === 'string' ? goalId : null,
      since: typeof since === 'string' ? new Date(since) : undefined,
      limit: typeof limit === 'number' ? limit : undefined,
      minConfidence: typeof minConfidence === 'number' ? minConfidence : undefined,
      apply: apply !== false
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/diagnosis/knowledge-tracing', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const conceptId = typeof req.query.conceptId === 'string' ? req.query.conceptId : '';
  const since = typeof req.query.since === 'string' ? new Date(req.query.since) : undefined;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  if (!conceptId) return res.status(400).json({ error: 'conceptId is required' });
  try {
    const report = await knowledgeTracingModelService.traceConcept({
      workspaceId,
      conceptId,
      since: since && !Number.isNaN(since.getTime()) ? since : undefined,
      apply: false
    });
    return res.json({ report });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/diagnosis/knowledge-tracing', async (req: Request, res: Response) => {
  const { workspaceId, conceptId, conceptIds, since, apply, limit } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const sinceDate = typeof since === 'string' ? new Date(since) : undefined;
    if (typeof conceptId === 'string' && conceptId) {
      const report = await knowledgeTracingModelService.traceConcept({
        workspaceId,
        conceptId,
        since: sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : undefined,
        apply: Boolean(apply)
      });
      return res.json({ report });
    }
    const result = await knowledgeTracingModelService.traceWorkspace({
      workspaceId,
      conceptIds: Array.isArray(conceptIds) ? conceptIds.map(String).filter(Boolean) : undefined,
      since: sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : undefined,
      apply: Boolean(apply),
      limit: typeof limit === 'number' ? limit : undefined
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/planning/graph-candidates', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const objective = typeof req.query.objective === 'string' ? req.query.objective : undefined;
  const conceptIds = typeof req.query.conceptIds === 'string' ? req.query.conceptIds.split(',').filter(Boolean) : undefined;
  const maxConcepts = typeof req.query.maxConcepts === 'string' ? Number(req.query.maxConcepts) : 6;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const candidates = await graphConstrainedPlannerService.buildCandidatePath({
      workspaceId,
      objective,
      conceptIds,
      maxConcepts: Number.isFinite(maxConcepts) ? maxConcepts : 6
    });
    return res.json({ candidates });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/planning/plans', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const goalId = typeof req.query.goalId === 'string' ? req.query.goalId : null;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const plans = await learningMemoryService.listLearningPlans({
      workspaceId,
      workbenchId,
      goalId,
      limit: Number.isFinite(limit) ? limit : 30
    });
    return res.json({ plans });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/planning/kg-plan', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, goalId, objective, targetConcepts, maxConcepts, persist } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const plan = await knowledgeGraphPlanningAgentService.plan({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      goalId: typeof goalId === 'string' ? goalId : null,
      objective: typeof objective === 'string' ? objective : undefined,
      targetConcepts: Array.isArray(targetConcepts) ? targetConcepts.map(String).filter(Boolean) : undefined,
      maxConcepts: typeof maxConcepts === 'number' ? maxConcepts : undefined
    });
    if (persist) {
      const savedPlan = await learningMemoryService.saveLearningPlan({
        workspaceId,
        workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
        goalId: plan.goalId || (typeof goalId === 'string' ? goalId : null),
        scope: plan.scope,
        plan
      });
      return res.json({ plan, savedPlan });
    }
    return res.json({ plan });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/planning/plans/:planId/apply', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const { workspaceId, workbenchId, createWorkbench, workbenchTitle } = req.body ?? {};

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const result = await learningMemoryService.applyLearningPlanToWorkbench({
      workspaceId,
      planId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      createWorkbench: Boolean(createWorkbench),
      workbenchTitle: typeof workbenchTitle === 'string' ? workbenchTitle : undefined
    });

    if (!result) {
      return res.status(404).json({ error: 'Learning plan not found' });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.delete('/planning/plans/:planId', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const { workspaceId } = req.body ?? {};

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const plan = await learningMemoryService.deleteLearningPlan({
      workspaceId,
      planId
    });

    if (!plan) {
      return res.status(404).json({ error: 'Learning plan not found' });
    }

    return res.json({ plan });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/planning/plans/:planId/actions', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const { workspaceId, action, targetPlanId, title, note } = req.body ?? {};
  const allowedActions = ['start', 'pause', 'resume', 'complete', 'archive', 'restore', 'supersede', 'set_primary', 'reopen', 'duplicate', 'replan'];

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!allowedActions.includes(action)) return res.status(400).json({ error: 'action is invalid' });

  try {
    const plan = await learningMemoryService.performLearningPlanAction({
      workspaceId,
      planId,
      action,
      targetPlanId: typeof targetPlanId === 'string' ? targetPlanId : null,
      title: typeof title === 'string' ? title : undefined,
      note: typeof note === 'string' ? note : undefined
    });

    if (!plan) return res.status(404).json({ error: 'Learning plan not found' });
    return res.json({ plan });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.patch('/planning/plans/:planId/steps/:stepId', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const stepId = typeof req.params.stepId === 'string' ? req.params.stepId : '';
  const { workspaceId, status } = req.body ?? {};

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!stepId) return res.status(400).json({ error: 'stepId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!['pending', 'active', 'done', 'skipped', 'blocked'].includes(status)) {
    return res.status(400).json({ error: 'status is invalid' });
  }

  try {
    const plan = await learningMemoryService.updateLearningPlanStepStatus({
      workspaceId,
      planId,
      stepId,
      status
    });

    if (!plan) {
      return res.status(404).json({ error: 'Learning plan not found' });
    }

    return res.json({ plan });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.patch('/planning/plans/:planId/steps/:stepId/details', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const stepId = typeof req.params.stepId === 'string' ? req.params.stepId : '';
  const { workspaceId, title, description, note, estimateMinutes, dueDate, tags, artifactBindings } = req.body ?? {};

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!stepId) return res.status(400).json({ error: 'stepId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const plan = await learningMemoryService.updateLearningPlanStep({
      workspaceId,
      planId,
      stepId,
      title: typeof title === 'string' ? title : undefined,
      description: typeof description === 'string' ? description : undefined,
      note: typeof note === 'string' ? note : undefined,
      estimateMinutes: typeof estimateMinutes === 'number' ? estimateMinutes : null,
      dueDate: typeof dueDate === 'string' ? dueDate : null,
      tags: Array.isArray(tags) ? tags.map(String) : undefined,
      artifactBindings: Array.isArray(artifactBindings) ? artifactBindings : undefined
    });

    if (!plan) return res.status(404).json({ error: 'Learning plan not found' });
    return res.json({ plan });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.patch('/planning/plans/:planId/stages/:stageId', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const stageId = typeof req.params.stageId === 'string' ? req.params.stageId : '';
  const { workspaceId, title, content, changeSource, note, proposalId } = req.body ?? {};

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!stageId) return res.status(400).json({ error: 'stageId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'content is required' });

  try {
    const plan = await learningMemoryService.updateStructuredPlanStage({
      workspaceId,
      planId,
      stageId,
      title: typeof title === 'string' ? title : '',
      content,
      changeSource: changeSource === 'llm_patch' ? 'llm_patch' : 'manual',
      note: typeof note === 'string' ? note : undefined,
      proposalId: typeof proposalId === 'string' ? proposalId : null
    });
    if (!plan) return res.status(404).json({ error: 'Learning plan not found' });
    return res.json({ plan });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/planning/plans/:planId/stages/:stageId/patch-proposal', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const stageId = typeof req.params.stageId === 'string' ? req.params.stageId : '';
  const { workspaceId, instruction } = req.body ?? {};

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!stageId) return res.status(400).json({ error: 'stageId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const result = await planGovernanceService.proposeStagePatch({
      workspaceId,
      planId,
      stageId,
      instruction: typeof instruction === 'string' ? instruction : undefined
    });
    if (!result) return res.status(404).json({ error: 'Learning plan not found' });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/planning/plans/:planId/stages/:stageId/explain', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const stageId = typeof req.params.stageId === 'string' ? req.params.stageId : '';
  const { workspaceId, question, history } = req.body ?? {};

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!stageId) return res.status(400).json({ error: 'stageId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const result = await planGovernanceService.explainStage({
      workspaceId,
      planId,
      stageId,
      question: typeof question === 'string' ? question : undefined,
      history: Array.isArray(history)
        ? history
            .map((item: any) => ({
              role: item?.role === 'assistant' ? 'assistant' as const : 'user' as const,
              content: typeof item?.content === 'string' ? item.content : ''
            }))
            .filter((item) => item.content)
        : undefined
    });
    if (!result) return res.status(404).json({ error: 'Learning plan not found' });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/planning/plans/:planId/explain', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const { workspaceId, question, history } = req.body ?? {};

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const result = await planGovernanceService.explainPlan({
      workspaceId,
      planId,
      question: typeof question === 'string' ? question : undefined,
      history: Array.isArray(history)
        ? history
            .map((item: any) => ({
              role: item?.role === 'assistant' ? 'assistant' as const : 'user' as const,
              content: typeof item?.content === 'string' ? item.content : ''
            }))
            .filter((item) => item.content)
        : undefined
    });
    if (!result) return res.status(404).json({ error: 'Learning plan not found' });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/planning/plans/:planId/review', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const { workspaceId, instruction } = req.body ?? {};

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const result = await planGovernanceService.reviewPlan({
      workspaceId,
      planId,
      instruction: typeof instruction === 'string' ? instruction : undefined
    });
    if (!result) return res.status(404).json({ error: 'Learning plan not found' });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/planning/plans/:planId/feedback', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const { workspaceId, stepId, category, note, rating } = req.body ?? {};
  const allowedCategories = ['too_hard', 'too_easy', 'blocked', 'resource_mismatch', 'replan', 'other'];

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!allowedCategories.includes(category)) return res.status(400).json({ error: 'category is invalid' });

  try {
    const plan = await learningMemoryService.recordLearningPlanFeedback({
      workspaceId,
      planId,
      stepId: typeof stepId === 'string' ? stepId : null,
      category,
      note: typeof note === 'string' ? note : undefined,
      rating: typeof rating === 'number' ? rating : null
    });

    if (!plan) return res.status(404).json({ error: 'Learning plan not found' });
    return res.json({ plan });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/planning/plans/:planId/rollback', async (req: Request, res: Response) => {
  const planId = typeof req.params.planId === 'string' ? req.params.planId : '';
  const { workspaceId, targetPlanId } = req.body ?? {};

  if (!planId) return res.status(400).json({ error: 'planId is required' });
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  if (!targetPlanId || typeof targetPlanId !== 'string') return res.status(400).json({ error: 'targetPlanId is required' });

  try {
    const plan = await learningMemoryService.rollbackLearningPlanToVersion({ workspaceId, planId, targetPlanId });
    if (!plan) return res.status(404).json({ error: 'Target learning plan not found' });
    return res.json({ plan });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/workspace-integration', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const goalId = typeof req.query.goalId === 'string' ? req.query.goalId : null;
  const query = typeof req.query.query === 'string' ? req.query.query : undefined;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const integration = await personalizedWorkspaceIntegrationService.build({
      workspaceId,
      workbenchId,
      goalId,
      query
    });
    return res.json({ integration });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get('/evaluation', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const evaluation = await learningSystemEvaluationService.evaluate({ workspaceId });
    return res.json({ evaluation });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post('/evaluation', async (req: Request, res: Response) => {
  const { workspaceId } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const evaluation = await learningSystemEvaluationService.evaluate({ workspaceId, persist: true });
    return res.json({ evaluation });
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

router.get('/course-home', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const summary = await courseHomeService.build({ workspaceId, workbenchId });
    return res.json({ summary });
  } catch (error) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
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

router.get('/learner-state/profile-view', async (req: Request, res: Response) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 24;
  const forcePortrait = req.query.force === 'true' || req.query.forcePortrait === 'true';

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const profileView = await learnerProfileViewService.build({
      workspaceId,
      workbenchId,
      limit: Number.isFinite(limit) ? limit : 24,
      forcePortrait
    });
    return res.json({ profileView });
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

router.post('/learner-state/govern-advanced', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, minEvidenceCount, promotionConfidence } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const result = await learnerStateGovernanceService.govern({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' ? workbenchId : null,
      minEvidenceCount: typeof minEvidenceCount === 'number' ? minEvidenceCount : undefined,
      promotionConfidence: typeof promotionConfidence === 'number' ? promotionConfidence : undefined
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
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
  const includeDeleted = req.query.includeDeleted === 'true';
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  try {
    const memories = await savedMemoryService.list({ workspaceId, workbenchId, limit, includeDeleted });
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

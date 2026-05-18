import crypto from 'crypto';
import prisma from '../config/db';
import { FileSystemService } from './fileSystemService';
import { knowledgeSearchService } from './knowledgeSearchService';
import { learningRunService } from './learningRunService';
import { learnerStateAnalyzer } from './learnerStateAnalyzer';
import { LearnerStateAgentContext, learnerStateContextAdapter } from './learnerStateContextAdapter';
import { conversationHistoryService, RetrievedConversationMemory } from './conversationHistoryService';
import { savedMemoryService } from './savedMemoryService';
import { memoryExtractorService } from './memoryExtractorService';
import { findWorkbenchResourceFiles } from './workbenchResourceScope';
import { aiModelProviderService } from './aiModelProviderService';
import {
  ClientPanelContext,
  ClientWorkbenchContext,
  workbenchContextService
} from './contextSystemService';
import { ChatSessionAttachmentContext, ContextCapsule, ContextPolicyDecision } from '../types/contextSystem';

type TaskType =
  | 'panel_qa'
  | 'workspace_qa'
  | 'summarize_current_file'
  | 'explain_code'
  | 'profile_init'
  | 'profile_update';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

interface LearningProfile {
  knowledgeLevel: string;
  learningGoal: string;
  learningPreference: string;
  cognitiveStyle: string;
  weakPoints: string[];
  resourcePreference: string;
  recentFocus: string[];
}

interface BuiltContext {
  userId: string;
  workspaceId: string;
  workbenchId?: string | null;
  activePanelId?: string | null;
  activeFileId?: string | null;
  selectedText?: string;
  openPanels: ClientPanelContext[];
  activePanel?: ClientPanelContext | null;
  workbenchFiles: Array<{ id: string; name: string; path: string; content?: string | null }>;
  workspace: { id: string; name: string; description?: string | null; major?: string | null };
  workbench?: { id: string; title: string; description: string } | null;
  recentMessages: ChatMessage[];
  profileSummary: string;
  learnerAgentContext: LearnerStateAgentContext;
  profile: LearningProfile;
  savedMemoryContext: string;
  referenceHistoryContext: string;
  retrievedHistory: RetrievedConversationMemory[];
  chatSessionAttachments: ChatSessionAttachmentContext[];
  capsule: ContextCapsule;
  contextPolicy: ContextPolicyDecision;
  promptPreview: string;
}

export interface RetrievedChunk {
  fileId: string;
  fileName: string;
  page?: number;
  line?: { start: number; end: number };
  block?: string;
  content: string;
  score: number;
  retrievalReason?: string;
  matchedTerms?: string[];
  scoreBreakdown?: Record<string, number>;
  source: 'selectedText' | 'activePanel' | 'openPanel' | 'workbenchFile' | 'workspaceRag' | 'profile' | 'recentMessages';
}

interface AgentTimelineItem {
  taskId: string;
  agentName: string;
  inputSummary: string;
  outputSummary: string;
  status: 'completed' | 'failed';
  durationMs: number;
}

const DEFAULT_PROFILE: LearningProfile = {
  knowledgeLevel: 'unknown',
  learningGoal: '未明确',
  learningPreference: '偏好结合当前材料、分步骤解释',
  cognitiveStyle: '先给直觉，再给结构化拆解',
  weakPoints: [],
  resourcePreference: '当前文件与课程资料优先',
  recentFocus: []
};

const clip = (value: string | null | undefined, maxLength = 500) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return { ...fallback, ...JSON.parse(value) } as T;
  } catch {
    return fallback;
  }
};

const stringify = (value: unknown) => {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
};

const latestUserMessage = (messages: ChatMessage[]) =>
  [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() || '';

const formatChunkLocator = (chunk: RetrievedChunk) => {
  if (chunk.line) return `lines ${chunk.line.start}-${chunk.line.end}`;
  if (chunk.page) return `page ${chunk.page}`;
  if (chunk.block) return `block ${chunk.block}`;
  return 'visible context';
};

const formatCitationLabels = (context: BuiltContext) =>
  context.capsule.citations.map((citation) => citation.label).join('；') || '无';

const sourceConfidenceSummary = (context: BuiltContext) =>
  (context.capsule.sourceMap || []).reduce(
    (summary, source) => {
      summary[source.confidence] += 1;
      return summary;
    },
    { high: 0, medium: 0, low: 0 }
  );

const inferTaskType = (query: string, context: BuiltContext): TaskType => {
  const text = query.toLowerCase();
  const activeType = context.activePanel?.panelType || '';
  if (/画像|profile|学习偏好|学习目标/.test(query)) return text.includes('初始化') || text.includes('init') ? 'profile_init' : 'profile_update';
  if (/总结|summarize|概括/.test(query)) return 'summarize_current_file';
  if (/代码|code|bug|复杂度|函数|class|方法|报错/.test(query) || activeType === 'code') return 'explain_code';
  if (/workspace|工作区|课程|所有资料|知识库|全局/.test(query)) return 'workspace_qa';
  return 'panel_qa';
};

const profileSummary = (profile: LearningProfile) =>
  [
    `知识水平: ${profile.knowledgeLevel}`,
    `学习目标: ${profile.learningGoal}`,
    `学习偏好: ${profile.learningPreference}`,
    `认知风格: ${profile.cognitiveStyle}`,
    `薄弱点: ${profile.weakPoints.join('、') || '暂无'}`,
    `资源偏好: ${profile.resourcePreference}`,
    `近期关注: ${profile.recentFocus.join('、') || '暂无'}`
  ].join('\n');

const contentTerms = (value: string) =>
  value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 30);

class AgentRunLogger {
  private timeline: AgentTimelineItem[] = [];

  constructor(private runId: string) {}

  async step<T>(agentName: string, inputSummary: string, action: () => Promise<T>, summarize: (output: T) => string) {
    const startedAt = Date.now();
    const step = await learningRunService.startStep(this.runId, agentName, { summary: inputSummary });
    try {
      const output = await action();
      const outputSummary = summarize(output);
      const durationMs = Date.now() - startedAt;
      await learningRunService.completeStep(step.id, { summary: outputSummary, durationMs });
      this.timeline.push({
        taskId: this.runId,
        agentName,
        inputSummary,
        outputSummary,
        status: 'completed',
        durationMs
      });
      return output;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const outputSummary = error instanceof Error ? error.message : String(error);
      await learningRunService.failStep(step.id, error);
      this.timeline.push({
        taskId: this.runId,
        agentName,
        inputSummary,
        outputSummary,
        status: 'failed',
        durationMs
      });
      throw error;
    }
  }

  getTimeline() {
    return this.timeline;
  }
}

class ContextService {
  async build(input: { context: ClientWorkbenchContext; messages: ChatMessage[] }): Promise<BuiltContext> {
    const workspace = await prisma.workspace.findUnique({ where: { id: input.context.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const workbench = input.context.workbenchId
      ? await prisma.workbench.findFirst({
          where: { id: input.context.workbenchId, workspaceId: input.context.workspaceId }
        })
      : null;

    const userId = input.context.userId || workspace.userId;
    const activePanelId = input.context.activePanelId || null;
    const openPanels = input.context.openPanels || [];
    const activePanel = openPanels.find((panel) => panel.panelId === activePanelId) || null;
    const activeFileId = input.context.activeFileId || activePanel?.fileId || input.context.activeFile?.id || null;
    const selectedText = clip(input.context.selectedText || activePanel?.selectedText || '', 4000);
    const profile = await new ProfileAgent().loadOrCreate(userId, input.context.workspaceId);
    const workbenchFileIds = [
      ...new Set(
        openPanels
          .map((panel) => panel.fileId)
          .concat(activeFileId)
          .filter((value): value is string => Boolean(value))
      )
    ];

    const fileRecords = input.context.workbenchId
      ? await findWorkbenchResourceFiles({
          workspaceId: input.context.workspaceId,
          workbenchId: input.context.workbenchId,
          take: 12,
          orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }]
        })
      : workbenchFileIds.length
        ? await prisma.fileSystemObject.findMany({
            where: { workspaceId: input.context.workspaceId, id: { in: workbenchFileIds }, nodeType: 'file' }
          })
        : [];

    const clientActiveContent = input.context.activeFile?.content;
    const workbenchFiles = await Promise.all(
      fileRecords.map(async (file) => ({
        id: file.id,
        name: file.name,
        path: file.path,
        content:
          file.id === activeFileId && typeof clientActiveContent === 'string'
            ? clientActiveContent
            : await FileSystemService.getFileContent(input.context.workspaceId, file.id).catch(() => null)
      }))
    );
    const capsuleResult = await workbenchContextService.buildCapsule({
      context: input.context,
      messages: input.messages,
      profileSummary: profileSummary(profile)
    });
    const learnerAgentContext = await learnerStateContextAdapter.build({
      workspaceId: input.context.workspaceId,
      workbenchId: input.context.workbenchId || null,
      audience: 'tutor'
    });
    const query = latestUserMessage(input.messages);
    const [savedMemoryContext, retrievedHistory] = await Promise.all([
      savedMemoryService.promptContext({ workspaceId: input.context.workspaceId, limit: 8 }),
      conversationHistoryService.retrieve({
        workspaceId: input.context.workspaceId,
        workbenchId: input.context.workbenchId || null,
        userId,
        currentSessionId: input.context.sessionId || null,
        query,
        limit: 6
      })
    ]);

    return {
      userId,
      workspaceId: input.context.workspaceId,
      workbenchId: input.context.workbenchId || null,
      activePanelId,
      activeFileId,
      selectedText,
      openPanels,
      activePanel,
      workbenchFiles,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        major: workspace.major
      },
      workbench: workbench
        ? { id: workbench.id, title: workbench.title || workbench.name, description: workbench.description || '' }
        : input.context.workbenchId
          ? { id: input.context.workbenchId, title: input.context.workbenchTitle || '', description: input.context.workbenchDescription || '' }
          : null,
      recentMessages: input.context.recentMessages || input.messages.slice(-8),
      profile,
      profileSummary: profileSummary(profile),
      learnerAgentContext,
      savedMemoryContext,
      referenceHistoryContext: conversationHistoryService.formatRetrieved(retrievedHistory),
      retrievedHistory,
      chatSessionAttachments: (input.context.chatSessionAttachments || []) as ChatSessionAttachmentContext[],
      capsule: capsuleResult.capsule,
      contextPolicy: capsuleResult.policy,
      promptPreview: capsuleResult.promptPreview
    };
  }
}

class ProfileAgent {
  async loadOrCreate(userId: string, workspaceId: string): Promise<LearningProfile> {
    const profile = await prisma.profile.findFirst({ where: { userId, workspaceId } });
    if (profile) return parseJson<LearningProfile>(profile.preferences, DEFAULT_PROFILE);

    await prisma.profile.create({
      data: {
        userId,
        workspaceId,
        name: 'Learning Profile',
        preferences: stringify(DEFAULT_PROFILE)
      }
    });

    return DEFAULT_PROFILE;
  }

  async update(input: {
    userId: string;
    workspaceId: string;
    currentProfile: LearningProfile;
    query: string;
    answer: string;
    context: BuiltContext;
  }): Promise<LearningProfile> {
    const focus = [
      ...input.currentProfile.recentFocus,
      ...contentTerms(`${input.query} ${input.context.activePanel?.title || ''} ${input.context.workbench?.title || ''}`).slice(0, 3)
    ]
      .filter(Boolean)
      .slice(-8);
    const weakPoints = [...input.currentProfile.weakPoints];

    if (/不懂|不会|问题|bug|错|error|为什么|怎么/.test(input.query)) {
      const point = clip(input.query, 48);
      if (point && !weakPoints.includes(point)) weakPoints.push(point);
    }

    const nextProfile = {
      ...input.currentProfile,
      recentFocus: [...new Set(focus)].slice(-8),
      weakPoints: [...new Set(weakPoints)].slice(-8)
    };

    await prisma.profile.upsert({
      where: {
        id:
          (
            await prisma.profile.findFirst({
              where: { userId: input.userId, workspaceId: input.workspaceId },
              select: { id: true }
            })
          )?.id || crypto.randomUUID()
      },
      create: {
        userId: input.userId,
        workspaceId: input.workspaceId,
        name: 'Learning Profile',
        preferences: stringify(nextProfile)
      },
      update: {
        preferences: stringify(nextProfile)
      }
    });

    return nextProfile;
  }
}

class RetrievalAgent {
  async retrieve(input: { query: string; context: BuiltContext }): Promise<RetrievedChunk[]> {
    if (input.context.capsule.retrievedChunks?.length || input.context.capsule.selection || input.context.capsule.viewport) {
      const chunks: RetrievedChunk[] = [];
      const pushCapsuleChunk = (
        fileId: string,
        fileName: string,
        content: string | undefined,
        score: number,
        source: RetrievedChunk['source'],
        locator?: { page?: number; primaryPage?: number; lineStart?: number; lineEnd?: number; startLine?: number; endLine?: number; blockId?: string; blockIds?: string[] }
      ) => {
        const clipped = clip(content, 1800);
        if (!clipped) return;
        chunks.push({
          fileId,
          fileName,
          content: clipped,
          page: locator?.page || locator?.primaryPage,
          line:
            locator?.lineStart || locator?.startLine
              ? {
                  start: locator.lineStart || locator.startLine || 1,
                  end: locator.lineEnd || locator.endLine || locator.lineStart || locator.startLine || 1
                }
              : undefined,
          block: locator?.blockId || locator?.blockIds?.[0],
          score,
          retrievalReason:
            source === 'workspaceRag'
              ? '来自 Context Capsule 检索片段'
              : source === 'selectedText'
                ? '用户显式选区，最高优先级上下文'
                : source === 'activePanel'
                  ? '当前可视区域上下文'
                  : '当前工作台上下文',
          source
        });
      };

      if (input.context.capsule.selection) {
        pushCapsuleChunk(
          input.context.capsule.selection.fileId,
          input.context.capsule.selection.fileName,
          input.context.capsule.selection.content,
          100,
          'selectedText',
          input.context.capsule.selection.locator
        );
      }

      if (input.context.capsule.viewport) {
        pushCapsuleChunk(
          input.context.capsule.viewport.fileId,
          input.context.capsule.viewport.fileName,
          input.context.capsule.viewport.content,
          90,
          'activePanel',
          input.context.capsule.viewport.locator
        );
      }

      if (input.context.capsule.activeFile?.content) {
        pushCapsuleChunk(
          input.context.capsule.activeFile.fileId,
          input.context.capsule.activeFile.fileName,
          input.context.capsule.activeFile.content,
          82,
          'workbenchFile'
        );
      } else if (input.context.capsule.activeFile?.summary) {
        pushCapsuleChunk(
          input.context.capsule.activeFile.fileId,
          input.context.capsule.activeFile.fileName,
          input.context.capsule.activeFile.summary,
          76,
          'workbenchFile'
        );
      }

      input.context.capsule.retrievedChunks?.forEach((chunk) => {
        pushCapsuleChunk(chunk.fileId, chunk.fileName, chunk.content, chunk.score, 'workspaceRag', chunk.locator);
        const latest = chunks[chunks.length - 1];
        if (latest) {
          latest.retrievalReason = chunk.retrievalReason;
          latest.matchedTerms = chunk.matchedTerms;
          latest.scoreBreakdown = chunk.scoreBreakdown;
        }
      });

      return chunks.sort((left, right) => right.score - left.score).slice(0, 8);
    }

    const chunks: RetrievedChunk[] = [];
    const pushPanelChunk = (panel: ClientPanelContext, source: RetrievedChunk['source'], score: number) => {
      const content = clip(panel.selectedText || panel.visibleContent, 1800);
      if (!content) return;
      chunks.push({
        fileId: panel.fileId || panel.panelId,
        fileName: panel.fileName || panel.title || panel.panelId,
        page: panel.visiblePages?.[0],
        line: panel.visibleLineRange || undefined,
        block: panel.visibleBlockIds?.[0],
        content,
        score,
        source
      });
    };

    if (input.context.selectedText) {
      chunks.push({
        fileId: input.context.activeFileId || input.context.activePanelId || 'selection',
        fileName: input.context.activePanel?.fileName || input.context.activePanel?.title || 'Selected text',
        content: clip(input.context.selectedText, 1800),
        page: input.context.activePanel?.visiblePages?.[0],
        line: input.context.activePanel?.visibleLineRange || undefined,
        score: 100,
        source: 'selectedText'
      });
    }

    if (input.context.activePanel) pushPanelChunk(input.context.activePanel, 'activePanel', 90);
    input.context.openPanels
      .filter((panel) => panel.panelId !== input.context.activePanelId)
      .slice(0, 4)
      .forEach((panel, index) => pushPanelChunk(panel, 'openPanel', 70 - index * 5));

    if (chunks.length < 3) {
      input.context.workbenchFiles.slice(0, 5).forEach((file, index) => {
        const content = clip(file.content, 1800);
        if (!content) return;
        chunks.push({
          fileId: file.id,
          fileName: file.name,
          content,
          score: 55 - index * 4,
          source: 'workbenchFile'
        });
      });
    }

    if (chunks.length < 6) {
      const fileIds = input.context.workbenchFiles.map((file) => file.id);
      const scoped = fileIds.length
        ? await knowledgeSearchService.search({
            workspaceId: input.context.workspaceId,
            query: input.query || chunks.map((chunk) => chunk.content).join('\n').slice(0, 300),
            fileIds,
            limit: 4
          })
        : [];
      const workspace = await knowledgeSearchService.search({
        workspaceId: input.context.workspaceId,
        query: input.query,
        limit: 6
      });

      [...scoped, ...workspace].forEach((item) => {
        if (chunks.some((chunk) => chunk.content === item.chunkText)) return;
        const page = typeof item.metadata.page === 'number' ? item.metadata.page : undefined;
        const startLine = typeof item.metadata.startLine === 'number' ? item.metadata.startLine : undefined;
        const endLine = typeof item.metadata.endLine === 'number' ? item.metadata.endLine : startLine;
        chunks.push({
          fileId: item.fileObjectId,
          fileName: item.fileName,
          content: clip(item.chunkText, 1800),
          page,
          line: startLine ? { start: startLine, end: endLine || startLine } : undefined,
          score: item.score,
          retrievalReason: item.retrievalReason,
          matchedTerms: item.matchedTerms,
          scoreBreakdown: item.scoreBreakdown,
          source: 'workspaceRag'
        });
      });
    }

    return chunks.sort((left, right) => right.score - left.score).slice(0, 8);
  }
}

class ExplainAgent {
  async answer(input: {
    query: string;
    taskType: TaskType;
    context: BuiltContext;
    retrievedChunks: RetrievedChunk[];
  }): Promise<string> {
    const sourceText = input.retrievedChunks
      .map((chunk, index) => {
        const loc = formatChunkLocator(chunk);
        const sourceId = (chunk as any).sourceId || `S${index + 1}`;
        return `[${sourceId}] ${chunk.fileName}, ${loc}\n${chunk.content}`;
      })
      .join('\n\n');

    if (!aiModelProviderService.isConfigured({ useCase: 'chat' })) {
      return [
        '当前后端未配置可用的 AI 模型服务，我先基于已采集到的上下文给出资料型回答：',
        '',
        input.retrievedChunks.length
          ? clip(input.retrievedChunks[0].content, 900)
          : '当前资料依据不足。请先选中文本，或打开/滚动到需要解释的文件区域。',
        '',
        input.retrievedChunks.length ? `来源：${this.formatSources(input.retrievedChunks)}` : ''
      ].join('\n');
    }

    const prompt = [
      `任务类型: ${input.taskType}`,
      `用户问题: ${input.query}`,
      '',
      `Context Capsule: ${input.context.capsule.capsuleId}`,
      `Context Mode: ${input.context.capsule.mode}`,
      `Policy: ragScope=${input.context.contextPolicy.ragScope}, selection=${input.context.contextPolicy.includeSelection}, viewport=${input.context.contextPolicy.includeViewport}, activeFileFull=${input.context.contextPolicy.includeActiveFileFullText}`,
      '',
      `学习画像:\n${input.context.profileSummary}`,
      '',
      `${input.context.savedMemoryContext}`,
      '',
      `${input.context.referenceHistoryContext}`,
      '',
      `个性化上下文:\n${input.context.learnerAgentContext.promptContext}`,
      '',
      `当前 Workspace: ${input.context.workspace.name}`,
      input.context.workbench ? `当前 Workbench: ${input.context.workbench.title}` : '',
      input.context.activePanel ? `当前 Panel: ${input.context.activePanel.title || input.context.activePanel.panelId}` : '',
      '',
      `最终上下文预览:\n${input.context.promptPreview || '无'}`,
      '',
      '请只基于下面的资料片段和当前上下文回答；如果依据不足，要明确说不足。',
      '回答要求：简体中文；贴合用户画像与个性化上下文；解释要围绕当前 Panel/文件；关键事实句后使用 inline citation，格式必须是 [S1]、[S2]，并在结尾给出“来源”。',
      'Memory policy：Saved memories 是长期偏好/事实，优先遵守；Reference chat history 只用于找回历史对话事实，不要自动当成长期偏好；Learner State 是候选学习状态，不要当成固定标签。',
      '个性化上下文只用于调整讲解方式和下一步建议，不要把其中的候选信号当作用户固定特质。',
      '如果像练习题或作业题，不要直接泄露完整答案，先给思路、检查点和提示。',
      '',
      `Capsule Citations:\n${input.context.capsule.citations.map((citation) => `- [${citation.sourceId || '?'}] ${citation.label}`).join('\n') || '无'}`,
      `Fallback Reasons:\n${input.context.capsule.fallbackReasons?.map((reason) => `- ${reason}`).join('\n') || '无'}`,
      '',
      `资料片段:\n${sourceText || '无可用资料片段'}`
    ].join('\n');

    const response = await aiModelProviderService.chat([{ role: 'user', content: prompt }], {
      useCase: 'chat',
      attachments: input.context.chatSessionAttachments
    });
    return response.reply;
  }

  async *answerStream(input: {
    query: string;
    taskType: TaskType;
    context: BuiltContext;
    retrievedChunks: RetrievedChunk[];
  }): AsyncGenerator<string> {
    if (!aiModelProviderService.isConfigured({ useCase: 'chat' })) {
      yield await this.answer(input);
      return;
    }

    const sourceText = input.retrievedChunks
      .map((chunk, index) => {
        const loc = formatChunkLocator(chunk);
        const sourceId = (chunk as any).sourceId || `S${index + 1}`;
        return `[${sourceId}] ${chunk.fileName}, ${loc}\n${chunk.content}`;
      })
      .join('\n\n');

    const prompt = [
      `任务类型: ${input.taskType}`,
      `用户问题: ${input.query}`,
      '',
      `Context Capsule: ${input.context.capsule.capsuleId}`,
      `Context Mode: ${input.context.capsule.mode}`,
      `Policy: ragScope=${input.context.contextPolicy.ragScope}, selection=${input.context.contextPolicy.includeSelection}, viewport=${input.context.contextPolicy.includeViewport}, activeFileFull=${input.context.contextPolicy.includeActiveFileFullText}`,
      '',
      `学习画像:\n${input.context.profileSummary}`,
      '',
      `${input.context.savedMemoryContext}`,
      '',
      `${input.context.referenceHistoryContext}`,
      '',
      `个性化上下文:\n${input.context.learnerAgentContext.promptContext}`,
      '',
      `当前 Workspace: ${input.context.workspace.name}`,
      input.context.workbench ? `当前 Workbench: ${input.context.workbench.title}` : '',
      input.context.activePanel ? `当前 Panel: ${input.context.activePanel.title || input.context.activePanel.panelId}` : '',
      '',
      `最终上下文预览:\n${input.context.promptPreview || '无'}`,
      '',
      '请只基于下面的资料片段和当前上下文回答；如果依据不足，要明确说不足。',
      '回答要求：简体中文；贴合用户画像与个性化上下文；解释要围绕当前 Panel/文件；关键事实句后使用 inline citation，格式必须是 [S1]、[S2]，并在结尾给出“来源”。',
      'Memory policy：Saved memories 是长期偏好/事实，优先遵守；Reference chat history 只用于找回历史对话事实，不要自动当成长期偏好；Learner State 是候选学习状态，不要当成固定标签。',
      '个性化上下文只用于调整讲解方式和下一步建议，不要把其中的候选信号当作用户固定特质。',
      '如果像练习题或作业题，不要直接泄露完整答案，先给思路、检查点和提示。',
      '',
      `Capsule Citations:\n${input.context.capsule.citations.map((citation) => `- [${citation.sourceId || '?'}] ${citation.label}`).join('\n') || '无'}`,
      `Fallback Reasons:\n${input.context.capsule.fallbackReasons?.map((reason) => `- ${reason}`).join('\n') || '无'}`,
      '',
      `资料片段:\n${sourceText || '无可用资料片段'}`
    ].join('\n');

    for await (const delta of aiModelProviderService.chatStream([{ role: 'user', content: prompt }], {
      useCase: 'chat',
      attachments: input.context.chatSessionAttachments
    })) {
      yield delta;
    }
  }

  private formatSources(chunks: RetrievedChunk[]) {
    return chunks
      .slice(0, 3)
      .map((chunk) => {
        if (chunk.line) return `${chunk.fileName} 行 ${chunk.line.start}-${chunk.line.end}`;
        if (chunk.page) return `${chunk.fileName} 第 ${chunk.page} 页`;
        return chunk.fileName;
      })
      .join('；');
  }
}

class QualityAgent {
  async check(input: { query: string; answer: string; retrievedChunks: RetrievedChunk[]; context: BuiltContext }) {
    const issues: string[] = [];
    const answer = input.answer.trim();
    const hasSources = /来源|source|文件|第\s*\d+\s*页|行\s*\d+/i.test(answer);
    const hasGrounding = input.retrievedChunks.length > 0;
    const hasViewportIntent = /这里|这段|这一页|这页|这个表格|这段代码|当前可见/i.test(input.query);
    const viewportContent = input.context.capsule.viewport?.content?.trim() || '';
    const selectionContent = input.context.capsule.selection?.content?.trim() || '';
    const hasPriorityContext = Boolean(selectionContent || viewportContent);
    const materialTerms = new Set(contentTerms(input.retrievedChunks.map((chunk) => chunk.content).join('\n')));
    const answerTerms = contentTerms(answer);
    const overlap = answerTerms.filter((term) => materialTerms.has(term)).length;

    if (!hasGrounding) issues.push('当前资料依据不足');
    if (!hasSources) issues.push('缺少来源引用');
    if (hasViewportIntent && !hasPriorityContext) issues.push('问题指向当前位置，但 selection/viewport 正文为空');
    if (hasViewportIntent && viewportContent && !input.retrievedChunks.some((chunk) => chunk.source === 'activePanel' || chunk.source === 'selectedText')) {
      issues.push('回答未优先使用 selection/viewport');
    }
    if (hasGrounding && overlap === 0 && answer.length > 120) issues.push('回答与当前资料重合度过低，存在跑题或幻觉风险');
    if (/答案|直接给|完整代码|作业/.test(input.query) && /```[\s\S]{120,}```/.test(answer)) {
      issues.push('可能对练习直接泄露完整答案');
    }

    const pass = issues.length === 0 || (issues.length === 1 && issues[0] === '缺少来源引用' && hasGrounding);
    const riskLevel = issues.length === 0 ? 'low' : issues.length <= 2 ? 'medium' : 'high';
    const revisedAnswer =
      !hasGrounding && !pass
        ? '当前资料依据不足。请先选中需要解释的内容，或打开/滚动到相关 PDF、代码、文档区域后再提问。'
        : hasViewportIntent && !hasPriorityContext
          ? `当前可见范围没有提取到真实正文，暂时无法可靠解释“这里”。请选中具体内容，或切换/滚动到可提取文本的区域后再问。\n\n来源：${formatCitationLabels(input.context)}`
        : hasSources
          ? answer
          : `${answer}\n\n来源：${formatCitationLabels(input.context)}`;

    return { pass, riskLevel, issues, revisedAnswer };
  }
}

export class MultiAgentOrchestrator {
  private contextService = new ContextService();
  private profileAgent = new ProfileAgent();
  private retrievalAgent = new RetrievalAgent();
  private explainAgent = new ExplainAgent();
  private qualityAgent = new QualityAgent();

  async chat(input: { messages: ChatMessage[]; context: ClientWorkbenchContext }) {
    const query = latestUserMessage(input.messages);
    if (!query) throw new Error('At least one user message is required');

    const run = await learningRunService.startRun({
      workspaceId: input.context.workspaceId,
      workbenchId: input.context.workbenchId || null,
      intent: 'multi_agent_chat',
      input: { query, activePanelId: input.context.activePanelId }
    });
    const logger = new AgentRunLogger(run.id);

    try {
      const context = await logger.step(
        'ContextService',
        `workspace=${input.context.workspaceId}, workbench=${input.context.workbenchId || 'none'}`,
        () => this.contextService.build(input),
        (output) => `activePanel=${output.activePanelId || 'none'}, openPanels=${output.openPanels.length}`
      );

      const taskType = inferTaskType(query, context);

      const profile = await logger.step(
        'ProfileAgent',
        '读取或初始化学习画像',
        () => this.profileAgent.loadOrCreate(context.userId, context.workspaceId),
        (output) => `recentFocus=${output.recentFocus.length}, weakPoints=${output.weakPoints.length}`
      );
      context.profile = profile;
      context.profileSummary = profileSummary(profile);

      const retrievedChunks = await logger.step(
        'RetrievalAgent',
        `task=${taskType}, query=${clip(query, 80)}`,
        () => this.retrievalAgent.retrieve({ query, context }),
        (output) => `retrievedChunks=${output.length}`
      );

      let answer = await logger.step(
        'ExplainAgent',
        `chunks=${retrievedChunks.length}`,
        () => this.explainAgent.answer({ query, taskType, context, retrievedChunks }),
        (output) => clip(output, 120)
      );

      const quality = await logger.step(
        'QualityAgent',
        '检查依据、跑题、来源、幻觉与练习泄露风险',
        () => this.qualityAgent.check({ query, answer, retrievedChunks, context }),
        (output) => `pass=${output.pass}, risk=${output.riskLevel}, issues=${output.issues.length}`
      );
      answer = quality.revisedAnswer;

      const updatedProfile = await logger.step(
        'ProfileAgent.update',
        '根据问题与回答轻量更新 recentFocus/weakPoints',
        () =>
          this.profileAgent.update({
            userId: context.userId,
            workspaceId: context.workspaceId,
            currentProfile: profile,
            query,
            answer,
            context
          }),
        (output) => `recentFocus=${output.recentFocus.join('、') || 'none'}`
      );
      await logger.step(
        'LearnerStateAnalyzer.chat',
        '抽取低置信度聊天画像信号',
        () =>
          learnerStateAnalyzer.analyzeChat({
            workspaceId: input.context.workspaceId,
            workbenchId: input.context.workbenchId || null,
            messages: input.messages,
            answer,
            taskType,
            sourceId: run.id
          }),
        (output) => `patches=${output.patches.length}`
      );
      const savedTurn = await logger.step(
        'ConversationHistory.saveTurn',
        '保存 workbench AI 对话并运行 memory extractor',
        async () => {
          const saved = await conversationHistoryService.saveTurn({
            workspaceId: context.workspaceId,
            workbenchId: context.workbenchId || null,
            userId: context.userId,
            sessionId: input.context.sessionId || null,
            title: query,
            source: 'workbench_ai',
            messages: input.messages,
            assistantReply: answer
          });
          const memoryExtraction = await memoryExtractorService.apply({
            workspaceId: context.workspaceId,
            workbenchId: context.workbenchId || null,
            userId: context.userId,
            messages: input.messages,
            answer,
            sourceId: run.id
          });
          return { saved, memoryExtraction };
        },
        (output) => `session=${output.saved.sessionId}, savedMemory=${output.memoryExtraction.savedMemory ? 'yes' : 'no'}, signals=${output.memoryExtraction.extraction.learnerStateSignals.length}`
      );

      await learningRunService.completeRun(run.id, {
        taskType,
        quality,
        retrievedChunks,
        profile: updatedProfile,
        answer,
        conversationSessionId: savedTurn.saved.sessionId
      });

      return {
        reply: answer,
        taskType,
        runId: run.id,
        timeline: logger.getTimeline(),
        retrievedChunks,
        contextCapsule: context.capsule,
        contextPolicy: context.contextPolicy,
        usedContextSummary: {
          intent: context.contextPolicy.intent,
          mode: context.capsule.mode,
          selection: Boolean(context.capsule.selection),
          viewport: Boolean(context.capsule.viewport),
          activeFile: context.capsule.activeFile?.fileName || null,
          resources: context.capsule.resources?.length || 0,
          retrievedChunks: context.capsule.retrievedChunks?.length || 0,
          estimatedTokens: context.capsule.estimatedTokens,
          estimatedTokensByLayer: context.capsule.estimatedTokensByLayer,
          layerScores: context.contextPolicy.layerScores,
          requiredLayers: context.contextPolicy.requiredLayers || [],
          activeFileStrategy: context.capsule.activeFile?.strategy || null,
          viewportLocator: context.capsule.viewport?.locator || null,
          fallbackReasons: context.capsule.fallbackReasons || [],
          clippedItems: context.capsule.clippedItems || [],
          citations: context.capsule.citations.map((citation) => citation.label),
          sources: context.capsule.sourceMap?.length || 0,
          sourceConfidence: sourceConfidenceSummary(context)
        },
        memoryContext: {
          savedMemoryContext: context.savedMemoryContext,
          referenceHistory: context.retrievedHistory,
          learnerStateSummary: context.learnerAgentContext.summary,
          extraction: savedTurn.memoryExtraction.extraction,
          askUserToSave: savedTurn.memoryExtraction.extraction.shouldAskUserToSave
            ? {
                text: savedTurn.memoryExtraction.extraction.askUserToSaveText || savedTurn.memoryExtraction.extraction.savedMemoryCandidate?.text || '',
                candidate: savedTurn.memoryExtraction.extraction.savedMemoryCandidate
              }
            : null
        },
        memoryDebug: {
          input: { query, sessionId: input.context.sessionId || null, source: 'workbench_ai' },
          matchedSavedMemories: context.savedMemoryContext,
          retrievedConversationHistory: context.retrievedHistory,
          injectedLearnerState: context.learnerAgentContext.promptContext,
          finalPromptMemorySection: [
            context.savedMemoryContext,
            context.referenceHistoryContext,
            context.learnerAgentContext.promptContext
          ].join('\n\n'),
          extraction: savedTurn.memoryExtraction.extraction,
          savedMemory: savedTurn.memoryExtraction.savedMemory,
          learnerStatePatches: savedTurn.memoryExtraction.patches.map((patch: any) => ({
            id: patch.id,
            targetDimension: patch.targetDimension,
            confidence: patch.confidence,
            rationale: patch.rationale
          }))
        },
        quality,
        profile: updatedProfile,
        model: aiModelProviderService.isConfigured({ useCase: 'chat' })
          ? aiModelProviderService.model(aiModelProviderService.provider({ useCase: 'chat' }), undefined, 'chat')
          : 'local-context-fallback',
        usage: null
      };
    } catch (error) {
      await learningRunService.failRun(run.id, error);
      throw error;
    }
  }

  async chatStream(
    input: { messages: ChatMessage[]; context: ClientWorkbenchContext },
    emit: (event: string, data: unknown) => void
  ) {
    const query = latestUserMessage(input.messages);
    if (!query) throw new Error('At least one user message is required');

    const run = await learningRunService.startRun({
      workspaceId: input.context.workspaceId,
      workbenchId: input.context.workbenchId || null,
      intent: 'multi_agent_chat_stream',
      input: { query, activePanelId: input.context.activePanelId }
    });
    const logger = new AgentRunLogger(run.id);

    try {
      const context = await logger.step(
        'ContextService',
        `workspace=${input.context.workspaceId}, workbench=${input.context.workbenchId || 'none'}`,
        () => this.contextService.build(input),
        (output) => `activePanel=${output.activePanelId || 'none'}, openPanels=${output.openPanels.length}`
      );
      emit('timeline', logger.getTimeline());

      const taskType = inferTaskType(query, context);

      const profile = await logger.step(
        'ProfileAgent',
        '读取或初始化学习画像',
        () => this.profileAgent.loadOrCreate(context.userId, context.workspaceId),
        (output) => `recentFocus=${output.recentFocus.length}, weakPoints=${output.weakPoints.length}`
      );
      context.profile = profile;
      context.profileSummary = profileSummary(profile);
      emit('timeline', logger.getTimeline());

      const retrievedChunks = await logger.step(
        'RetrievalAgent',
        `task=${taskType}, query=${clip(query, 80)}`,
        () => this.retrievalAgent.retrieve({ query, context }),
        (output) => `retrievedChunks=${output.length}`
      );
      emit('meta', {
        taskType,
        runId: run.id,
        retrievedChunks,
        contextCapsule: context.capsule,
        contextPolicy: context.contextPolicy,
        usedContextSummary: {
          intent: context.contextPolicy.intent,
          mode: context.capsule.mode,
          selection: Boolean(context.capsule.selection),
          viewport: Boolean(context.capsule.viewport),
          activeFile: context.capsule.activeFile?.fileName || null,
          resources: context.capsule.resources?.length || 0,
          retrievedChunks: context.capsule.retrievedChunks?.length || 0,
          estimatedTokens: context.capsule.estimatedTokens,
          estimatedTokensByLayer: context.capsule.estimatedTokensByLayer,
          layerScores: context.contextPolicy.layerScores,
          requiredLayers: context.contextPolicy.requiredLayers || [],
          activeFileStrategy: context.capsule.activeFile?.strategy || null,
          viewportLocator: context.capsule.viewport?.locator || null,
          fallbackReasons: context.capsule.fallbackReasons || [],
          clippedItems: context.capsule.clippedItems || [],
          citations: context.capsule.citations.map((citation) => citation.label),
          sources: context.capsule.sourceMap?.length || 0,
          sourceConfidence: sourceConfidenceSummary(context)
        },
        model: aiModelProviderService.isConfigured({ useCase: 'chat' })
          ? aiModelProviderService.model(aiModelProviderService.provider({ useCase: 'chat' }), undefined, 'chat')
          : 'local-context-fallback',
        usage: null
      });
      emit('timeline', logger.getTimeline());

      const startedAt = Date.now();
      const explainStep = await learningRunService.startStep(run.id, 'ExplainAgent', {
        summary: `chunks=${retrievedChunks.length}`
      });
      let answer = '';
      try {
        for await (const delta of this.explainAgent.answerStream({ query, taskType, context, retrievedChunks })) {
          answer += delta;
          emit('delta', delta);
        }
        const durationMs = Date.now() - startedAt;
        await learningRunService.completeStep(explainStep.id, { summary: clip(answer, 120), durationMs });
        logger.getTimeline().push({
          taskId: run.id,
          agentName: 'ExplainAgent',
          inputSummary: `chunks=${retrievedChunks.length}`,
          outputSummary: clip(answer, 120),
          status: 'completed',
          durationMs
        });
      } catch (error) {
        await learningRunService.failStep(explainStep.id, error);
        throw error;
      }
      emit('timeline', logger.getTimeline());

      const quality = await logger.step(
        'QualityAgent',
        '检查依据、跑题、来源、幻觉与练习泄露风险',
        () => this.qualityAgent.check({ query, answer, retrievedChunks, context }),
        (output) => `pass=${output.pass}, risk=${output.riskLevel}, issues=${output.issues.length}`
      );
      const revisedAnswer = quality.revisedAnswer;
      if (revisedAnswer !== answer) {
        if (revisedAnswer.startsWith(answer)) {
          const suffix = revisedAnswer.slice(answer.length);
          if (suffix) emit('delta', suffix);
        } else {
          emit('replace', revisedAnswer);
        }
        answer = revisedAnswer;
      }
      emit('timeline', logger.getTimeline());

      const updatedProfile = await logger.step(
        'ProfileAgent.update',
        '根据问题与回答轻量更新 recentFocus/weakPoints',
        () =>
          this.profileAgent.update({
            userId: context.userId,
            workspaceId: context.workspaceId,
            currentProfile: profile,
            query,
            answer,
            context
          }),
        (output) => `recentFocus=${output.recentFocus.join('、') || 'none'}`
      );
      await logger.step(
        'LearnerStateAnalyzer.chat',
        '抽取低置信度聊天画像信号',
        () =>
          learnerStateAnalyzer.analyzeChat({
            workspaceId: input.context.workspaceId,
            workbenchId: input.context.workbenchId || null,
            messages: input.messages,
            answer,
            taskType,
            sourceId: run.id
          }),
        (output) => `patches=${output.patches.length}`
      );
      const savedTurn = await logger.step(
        'ConversationHistory.saveTurn',
        '保存 workbench AI 对话并运行 memory extractor',
        async () => {
          const saved = await conversationHistoryService.saveTurn({
            workspaceId: context.workspaceId,
            workbenchId: context.workbenchId || null,
            userId: context.userId,
            sessionId: input.context.sessionId || null,
            title: query,
            source: 'workbench_ai',
            messages: input.messages,
            assistantReply: answer
          });
          const memoryExtraction = await memoryExtractorService.apply({
            workspaceId: context.workspaceId,
            workbenchId: context.workbenchId || null,
            userId: context.userId,
            messages: input.messages,
            answer,
            sourceId: run.id
          });
          return { saved, memoryExtraction };
        },
        (output) => `session=${output.saved.sessionId}, savedMemory=${output.memoryExtraction.savedMemory ? 'yes' : 'no'}, signals=${output.memoryExtraction.extraction.learnerStateSignals.length}`
      );

      await learningRunService.completeRun(run.id, {
        taskType,
        quality,
        retrievedChunks,
        profile: updatedProfile,
        answer,
        conversationSessionId: savedTurn.saved.sessionId
      });

      const result = {
        reply: answer,
        taskType,
        runId: run.id,
        timeline: logger.getTimeline(),
        retrievedChunks,
        contextCapsule: context.capsule,
        contextPolicy: context.contextPolicy,
        usedContextSummary: {
          intent: context.contextPolicy.intent,
          mode: context.capsule.mode,
          selection: Boolean(context.capsule.selection),
          viewport: Boolean(context.capsule.viewport),
          activeFile: context.capsule.activeFile?.fileName || null,
          resources: context.capsule.resources?.length || 0,
          retrievedChunks: context.capsule.retrievedChunks?.length || 0,
          estimatedTokens: context.capsule.estimatedTokens,
          estimatedTokensByLayer: context.capsule.estimatedTokensByLayer,
          layerScores: context.contextPolicy.layerScores,
          requiredLayers: context.contextPolicy.requiredLayers || [],
          activeFileStrategy: context.capsule.activeFile?.strategy || null,
          viewportLocator: context.capsule.viewport?.locator || null,
          fallbackReasons: context.capsule.fallbackReasons || [],
          clippedItems: context.capsule.clippedItems || [],
          citations: context.capsule.citations.map((citation) => citation.label),
          sources: context.capsule.sourceMap?.length || 0,
          sourceConfidence: sourceConfidenceSummary(context)
        },
        memoryContext: {
          savedMemoryContext: context.savedMemoryContext,
          referenceHistory: context.retrievedHistory,
          learnerStateSummary: context.learnerAgentContext.summary,
          extraction: savedTurn.memoryExtraction.extraction,
          askUserToSave: savedTurn.memoryExtraction.extraction.shouldAskUserToSave
            ? {
                text: savedTurn.memoryExtraction.extraction.askUserToSaveText || savedTurn.memoryExtraction.extraction.savedMemoryCandidate?.text || '',
                candidate: savedTurn.memoryExtraction.extraction.savedMemoryCandidate
              }
            : null
        },
        memoryDebug: {
          input: { query, sessionId: input.context.sessionId || null, source: 'workbench_ai' },
          matchedSavedMemories: context.savedMemoryContext,
          retrievedConversationHistory: context.retrievedHistory,
          injectedLearnerState: context.learnerAgentContext.promptContext,
          finalPromptMemorySection: [
            context.savedMemoryContext,
            context.referenceHistoryContext,
            context.learnerAgentContext.promptContext
          ].join('\n\n'),
          extraction: savedTurn.memoryExtraction.extraction,
          savedMemory: savedTurn.memoryExtraction.savedMemory,
          learnerStatePatches: savedTurn.memoryExtraction.patches.map((patch: any) => ({
            id: patch.id,
            targetDimension: patch.targetDimension,
            confidence: patch.confidence,
            rationale: patch.rationale
          }))
        },
        quality,
        profile: updatedProfile,
        model: aiModelProviderService.isConfigured({ useCase: 'chat' })
          ? aiModelProviderService.model(aiModelProviderService.provider({ useCase: 'chat' }), undefined, 'chat')
          : 'local-context-fallback',
        usage: null
      };

      emit('done', result);
      return result;
    } catch (error) {
      await learningRunService.failRun(run.id, error);
      throw error;
    }
  }
}

export const multiAgentOrchestrator = new MultiAgentOrchestrator();

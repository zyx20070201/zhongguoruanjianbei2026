import { aiModelProviderService } from '../aiModelProviderService';
import { summarizeAgentHistory } from './agentMessageHistory';
import { buildChatAttachmentContexts } from './attachmentContext';
import { buildWorkspaceAgentModelContext } from './contextBuilder';
import { deliveryPlannerDecision } from './deliveryPlanner';
import { createId, nowIso, compactJson, clip } from './utils';
import type { WorkspaceAgentDecision, WorkspaceAgentSourceScope, WorkspaceAgentTraceEntry, WorkspaceAgentV2State } from './types';

const decisionSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['tool_call', 'ask_user', 'final'] },
    tool: { type: 'string' },
    input: { type: 'object' },
    question: { type: 'string' },
    answer: { type: 'string' },
    visibleMessage: { type: 'string' },
    reason: { type: 'string' }
  },
  required: ['type', 'reason']
};

const systemPrompt = [
  '你是 Workspace Agent V2，一个遵循 Cline/Codex 风格控制回路的学习工作台 agent。',
  '你每一轮只决定下一步：调用一个工具、询问用户、或者最终回答。',
  '不要假装工具已经执行。需要上下文时主动调用 available tools 中的 read/search/list 工具；已有足够 evidence 时 final。',
  '用户显式提供的 selected resources / attachments / mentions 是高优先级线索，但除非 constraints 写明 only/deny，不要把它们当成唯一可用来源。',
  '联网搜索遵循 Cline 式工具策略：如果用户要最新信息、网上资料、官方文档、论文、教程、外部资源或明确说联网/网上搜索，且 available tools 允许，应优先调用 web.search 探索候选来源。',
  '如果用户提供明确 URL，应优先调用 web.fetch 读取该 URL；如果 web.search 找到候选 URL，重要结论或引用前应继续调用 web.fetch 读取关键页面正文。',
  'web.search 的结果只是候选线索，不等于已完整阅读网页；不要把搜索摘要伪装成最终网页证据。',
  '如果用户询问当前 workspace、选中文件、聊天附件或已上传资料内容，优先使用 workspace/attachment/knowledge 工具；除非用户要求联网或本地证据不足且 constraints 允许，否则不要默认联网。',
  '像 Cline 一样，当前 turn 的 modelContext 会包含一份 workspace 递归文件树概览；先利用其中的真实路径定位资料。探索 workspace 文件结构时，用 workspace.fs.list 按真实 folderId/path 浏览目录；需要找未知文件、用户只给模糊文件名/子目录线索、或浅层未命中时，应调用 workspace.fs.list recursive=true 做 breadth-first 递归列表，而不是过早说没找到。',
  '当用户直接提供图片附件时，这些图片会像 Cline 的 image blocks 一样进入你的多模态上下文；请直接用视觉能力理解图片，不要用 workspace 搜索结果替代图片内容。',
  '当用户询问文本、代码或文档附件内容时，优先使用 attachment.read 读取附件正文。',
  '如果 constraints 禁止某类上下文或工具，必须遵守；不要尝试绕过。',
  '如果用户明确要求创建学习现场、保存文件、生成可落地资源，可以选择 sideEffect/requiresApproval 工具；系统会在执行前请求用户确认。',
  '如果用户明确要求把刚才搜索/读取到的网页、视频、文档链接保存、导入、加入 workspace 或当前 workbench，应使用 resource.import_web；不要用 file.write 伪造网页资源，也不要让 web.search/web.fetch 自动入库。',
  '如果用户要求生成 AI Studio 学习产物，或 contextControl.artifactHints 提示 studio_artifact 适合当前目标，应优先考虑 studio.generate_artifact；但 artifactHints 只是软提示，不是强制路由，你仍需根据用户意图、证据和工具状态决定下一步。',
  '选择 studio.generate_artifact 时，根据用户目标和 observations 选择 templateId：custom_practice 用于可交互练习/quiz/选择题/判分解析，mind_map 用于思维导图/概念图，flashcards 用于复习卡片，react_chat_visual 用于可执行 REACT_VIZ/HTML_VIZ 自由可视化讲解，code_lab 用于代码实操题/Starter Code/测试用例/题解，light_visual_lesson 用于基于显式资料生成教师课件式 slide + timeline 轻量可视化讲解。',
  '调用 studio.generate_artifact 前，若需要基于 workspace/附件资料生成，必须先通过 read/search 工具获得 evidence，再把 contextRefs/evidenceIds/sourceFileIds 传给工具；不要让 Studio 工具承担隐藏检索。',
  '只有在用户明确要通用知识产物，或没有可读资料且用户接受通用生成时，才使用 sourceMode=model_knowledge。',
  '文件夹树是 workspace 的组织结构；source/generated/note/file 只是资源属性。除非用户指定目录或多文件项目需要目录，不要因为资源类型自动创建 Generated/Sources/Files 文件夹。',
  '不要把 Sources/Generated/Files/Artifacts 当作系统目录；如果它们出现在文件元数据里，也只表示历史或资源属性，不代表需要继续沿用。',
  '通用文件交付使用 file.write，像 Cline write_to_file 一样在 input.content 中提供完整最终文件内容；如果是代码文件，content 必须是原始代码，不要包 Markdown 代码块。',
  '多文件或小项目交付使用 file.write_many，在 files 中逐个提供 filename 和完整 content；不要把多个请求文件合并成一个 Markdown，除非用户明确要求单文件汇总。',
  '当调用 Markdown 写入工具时，必须像 Cline write_to_file 一样在工具 input.content 中提供完整最终 Markdown 内容；不要只给生成指令。',
  '如果 contextControl.deliveryContract.required=true 且 target 是 workspace/workbench 文件，聊天区 final answer 不能满足该交付要求；必须先调用对应写入工具，直到 observations/artifactRefs 显示文件已创建。',
  '对于 Markdown 文件交付，可以使用 markdown_note.create 或 file.write；对于非 Markdown 文件必须优先使用 file.write 或 file.write_many。',
  '如果 observations 显示某个写入工具已经成功执行，通常应 final，总结已创建的对象和下一步建议，不要重复调用同一个写入工具。',
  '默认用简体中文。工具输入必须简洁、结构化，并严格基于当前目标和 observations。',
  '可以返回 visibleMessage，作为展示给用户的简短 Markdown 进度说明，例如“我先看一下当前资料里和 X 相关的内容。”。visibleMessage 会像 Cline 的 say(text) 一样显示在主回答区；不要在里面泄露隐藏推理或 JSON。',
  '不要输出 Markdown；本接口必须只返回 JSON。'
].join('\n');

const MODEL_DECISION_MAX_ATTEMPTS = Math.max(1, Number(process.env.WORKSPACE_AGENT_V2_MODEL_DECISION_MAX_ATTEMPTS || 3));
const MODEL_DECISION_RETRY_BASE_DELAY_MS = Math.max(0, Number(process.env.WORKSPACE_AGENT_V2_MODEL_DECISION_RETRY_BASE_DELAY_MS || 800));
const MODEL_DECISION_TIMEOUT_MS = Math.max(1000, Number(process.env.WORKSPACE_AGENT_V2_MODEL_DECISION_TIMEOUT_MS || 45000));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const modelDecisionTrace = (
  message: string,
  data?: Record<string, unknown>
): WorkspaceAgentTraceEntry => ({
  id: createId('trace'),
  node: 'ModelDecision',
  message,
  at: nowIso(),
  data
});

const isNonRetryableModelDecisionError = (error: unknown) => {
  const message = errorMessage(error);
  return /api key|not configured|unauthorized|forbidden|invalid api key|authentication|auth|insufficient_quota|quota|billing|balance|permission|model .*not found|unsupported model|invalid_request_error/i.test(message);
};

const shouldRetryModelDecisionError = (error: unknown) =>
  !isNonRetryableModelDecisionError(error);

const retryDelayMs = (attempt: number) =>
  MODEL_DECISION_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1));

const normalizeDecision = (value: any, state: WorkspaceAgentV2State): WorkspaceAgentDecision => {
  const type = value?.type === 'tool_call' || value?.type === 'ask_user' || value?.type === 'final'
    ? value.type
    : 'final';
  const availableNames = new Set(state.availableTools.map((tool) => tool.name));
  const tool = typeof value?.tool === 'string' && availableNames.has(value.tool) ? value.tool : undefined;
  if (type === 'tool_call' && !tool) {
    return {
      id: createId('decision'),
      type: 'final',
      answer: '我需要的工具暂不可用，因此先基于已有上下文回答。',
      reason: 'Model selected an unavailable tool.',
      at: nowIso()
    };
  }
  return {
    id: createId('decision'),
    type,
    tool,
    input: value?.input && typeof value.input === 'object' && !Array.isArray(value.input) ? value.input : {},
    question: typeof value?.question === 'string' ? value.question : undefined,
    answer: typeof value?.answer === 'string' ? value.answer : undefined,
    visibleMessage: typeof value?.visibleMessage === 'string' ? clip(value.visibleMessage, 800) : undefined,
    reason: clip(value?.reason || 'No reason provided.', 500),
    at: nowIso()
  };
};

const explicitIdsForScope = (state: WorkspaceAgentV2State, scope: WorkspaceAgentSourceScope) => {
  if (scope === 'explicit_sources') {
    return (state.contextControl?.contextSources.selectedResources || []).map((item) => item.id).filter(Boolean).slice(0, 24);
  }
  if (scope === 'chat_attachments') {
    return (state.contextControl?.contextSources.chatAttachments || []).map((item) => item.id).filter(Boolean).slice(0, 24);
  }
  return [];
};

const fallbackScope = (state: WorkspaceAgentV2State): WorkspaceAgentSourceScope => {
  const constraints = state.contextControl?.acquisitionConstraints;
  const usable = (scope?: WorkspaceAgentSourceScope) => {
    if (!scope) return undefined;
    if (scope === 'explicit_sources' && !explicitIdsForScope(state, scope).length) return undefined;
    if (scope === 'chat_attachments' && !explicitIdsForScope(state, scope).length) return undefined;
    if (scope === 'workbench' && !(state.workbenchId || state.contextControl?.contextSources.workbench?.id)) return undefined;
    return scope;
  };
  for (const scope of constraints?.onlyScopes || []) {
    const usableScope = usable(scope);
    if (usableScope) return usableScope;
  }
  for (const scope of constraints?.preferredScopes || []) {
    const usableScope = usable(scope);
    if (usableScope) return usableScope;
  }
  return 'workspace';
};

const fallbackSearchInput = (state: WorkspaceAgentV2State, limit: number, includeMode = false) => {
  const scope = fallbackScope(state);
  const input: Record<string, unknown> = { query: state.userInput, scope, limit };
  if (includeMode) input.mode = 'targeted_search';
  if (scope === 'workbench') input.workbenchId = state.workbenchId || state.contextControl?.contextSources.workbench?.id || '';
  const fileIds = explicitIdsForScope(state, scope);
  if (fileIds.length) input.fileIds = fileIds;
  return input;
};

const attachmentIdsForKind = (state: WorkspaceAgentV2State, kind: 'image' | 'text') => {
  const attachments = state.contextControl?.contextSources.chatAttachments || [];
  return attachments
    .filter((item) => {
      const mimeType = String(item.mimeType || '').toLowerCase();
      const title = String(item.title || item.id || '').toLowerCase();
      const extension = title.split('.').pop() || '';
      const isImage = mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension);
      return kind === 'image' ? isImage : !isImage;
    })
    .map((item) => item.id)
    .filter(Boolean)
    .slice(0, 8);
};

const firstUrlFromText = (value: string) => {
  const match = value.match(/https?:\/\/[^\s<>"'）)]+/i);
  return match?.[0];
};

const hasWebSearchIntent = (state: WorkspaceAgentV2State) => {
  const text = state.userInput.toLowerCase();
  const constraints = state.contextControl?.acquisitionConstraints;
  if (constraints?.onlyScopes?.length || constraints?.deniedTools.includes('web.search')) return false;
  if (constraints?.preferredTools.includes('web.search')) return true;
  return [
    /联网/,
    /网上/,
    /互联网/,
    /外部资料/,
    /外部资源/,
    /官方文档/,
    /官网/,
    /论文/,
    /教程/,
    /最新/,
    /recent|latest|online|web search|search the web|internet|official docs|paper|tutorial/i
  ].some((pattern) => pattern.test(text));
};

const hasWorkspaceFileFindIntent = (state: WorkspaceAgentV2State) =>
  /(文件|资料|pdf|docx|pptx|md|markdown|sql|代码|子文件夹|文件夹|目录|folder|directory|file|read|找|定位|里面)/i.test(state.userInput);

export const fallbackDecision = (state: WorkspaceAgentV2State): WorkspaceAgentDecision => {
  const deliveryDecision = deliveryPlannerDecision(state);
  if (deliveryDecision) return deliveryDecision;
  const usedTools = new Set(state.toolCalls.map((call) => call.tool));
  const hasEvidence = state.evidence.length > 0;
  const hasReadEvidence = state.evidence.some((item) => Boolean(item.content) && /content|attachment|web_page|chunk/.test(item.kind));
  const pick = (name: string) => state.availableTools.some((tool) => tool.name === name) && !usedTools.has(name);
  const textAttachmentIds = attachmentIdsForKind(state, 'text');
  const url = firstUrlFromText(state.userInput);
  if (!hasEvidence && url && pick('web.fetch')) {
    return {
      id: createId('decision'),
      type: 'tool_call',
      tool: 'web.fetch',
      input: { url, maxChars: 7000, includeLinks: true },
      reason: 'Fallback: fetch the explicit URL through the normal tool policy path.',
      at: nowIso()
    };
  }
  if (!hasEvidence && hasWebSearchIntent(state) && pick('web.search')) {
    return {
      id: createId('decision'),
      type: 'tool_call',
      tool: 'web.search',
      input: { query: state.userInput, maxResults: 6, provider: 'auto' },
      reason: 'Fallback: perform external web discovery because the user requested online or current resources.',
      at: nowIso()
    };
  }
  if (!hasReadEvidence && textAttachmentIds.length && pick('attachment.read')) {
    return {
      id: createId('decision'),
      type: 'tool_call',
      tool: 'attachment.read',
      input: {
        scope: 'chat_attachments',
        fileIds: textAttachmentIds,
        limit: Math.min(6, textAttachmentIds.length),
        maxCharsPerFile: 4000
      },
      reason: 'Fallback: read explicit chat attachments before using workspace search.',
      at: nowIso()
    };
  }
  const fileCards = state.evidence.filter((item) => item.kind === 'workspace_file_card' || item.kind === 'workspace_file');
  const likelyRequestedCard = fileCards.find((item) => {
    const text = `${state.userInput} ${item.title} ${item.source || ''}`.toLowerCase();
    return /pdf|docx|md|markdown|文件|资料|里面|这个/.test(state.userInput.toLowerCase()) && /(06|sql|pdf|docx|md|markdown)/.test(text);
  });
  if (!hasReadEvidence && likelyRequestedCard?.metadata?.fileObjectId && pick('workspace.file.read')) {
    return {
      id: createId('decision'),
      type: 'tool_call',
      tool: 'workspace.file.read',
      input: {
        scope: 'workspace',
        fileIds: [likelyRequestedCard.metadata.fileObjectId],
        limit: 1,
        maxCharsPerFile: 8000
      },
      reason: 'Fallback: continue from discovered file card and read the likely requested source before answering.',
      at: nowIso()
    };
  }
  if (!hasEvidence && pick('workspace.file.search')) {
    return {
      id: createId('decision'),
      type: 'tool_call',
      tool: 'workspace.file.search',
      input: fallbackSearchInput(state, 8, true),
      reason: 'Fallback: request ordinary workspace search through the normal tool policy path.',
      at: nowIso()
    };
  }
  if (!hasEvidence && pick('workspace.files.search')) {
    return {
      id: createId('decision'),
      type: 'tool_call',
      tool: 'workspace.files.search',
      input: fallbackSearchInput(state, 8, true),
      reason: 'Fallback: request legacy-compatible workspace search through the normal tool policy path.',
      at: nowIso()
    };
  }
  if (hasWorkspaceFileFindIntent(state) && !usedTools.has('workspace.fs.list') && state.availableTools.some((tool) => tool.name === 'workspace.fs.list')) {
    return {
      id: createId('decision'),
      type: 'tool_call',
      tool: 'workspace.fs.list',
      input: {
        scope: fallbackScope(state),
        path: '/',
        recursive: true,
        limit: 120
      },
      reason: 'Fallback: perform Cline-style breadth-first recursive workspace file listing before concluding a requested file is missing.',
      at: nowIso()
    };
  }
  if (!hasEvidence && pick('knowledge.search')) {
    return {
      id: createId('decision'),
      type: 'tool_call',
      tool: 'knowledge.search',
      input: fallbackSearchInput(state, 6),
      reason: 'Fallback: search indexed knowledge before answering.',
      at: nowIso()
    };
  }
  return {
    id: createId('decision'),
    type: 'final',
    answer: '',
    reason: 'Fallback: enough loop context or no additional read tools are available.',
    at: nowIso()
  };
};

export const decideNextStep = async (state: WorkspaceAgentV2State): Promise<WorkspaceAgentDecision> => {
  if (!aiModelProviderService.isConfigured({ useCase: 'learning' })) {
    const decision = fallbackDecision(state);
    decision.reason = `Fallback: learning model is not configured. ${decision.reason}`;
    return decision;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MODEL_DECISION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const attachments = await buildChatAttachmentContexts(state.context);
      const hasImages = attachments.some((attachment) => attachment.kind === 'image' && (attachment.dataUrl || attachment.base64Data));
      const provider = hasImages ? aiModelProviderService.configuredVisionProvider({ useCase: 'learning' }) : undefined;
      if (hasImages && !provider) {
        return {
          id: createId('decision'),
          type: 'final',
          answer: '当前模型不支持图片输入，且没有配置可用的多模态模型，因此我不能可靠读取这张图片。',
          reason: 'No configured multimodal provider is available for image attachments.',
          at: nowIso()
        };
      }
      const modelContext = buildWorkspaceAgentModelContext(state, { phase: 'decision' });
      const result = await aiModelProviderService.json<any>({
        useCase: 'learning',
        provider,
        timeoutMs: MODEL_DECISION_TIMEOUT_MS,
        systemPrompt,
        attachments,
        instruction: '根据当前目标、可用工具和 observations，选择下一步。只输出 JSON。',
        schema: decisionSchema,
        input: {
          userInput: state.userInput,
          stepCount: state.stepCount,
          maxSteps: state.maxSteps,
          contextControl: {
            agentMode: state.contextControl?.agentMode,
            contextSources: state.contextControl?.contextSources,
            acquisitionConstraints: state.contextControl?.acquisitionConstraints,
            contextLedger: state.contextControl?.contextLedger?.slice(-12),
            contextBudget: state.contextControl?.contextBudget,
            deliveryContract: state.contextControl?.deliveryContract,
            artifactHints: state.contextControl?.artifactHints
          },
          availableTools: state.availableTools,
          observations: state.observations.slice(-8),
          evidence: state.evidence.slice(-10).map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            summary: item.summary,
            source: item.source
          })),
          modelContext,
          agentHistory: summarizeAgentHistory(state.agentMessages || [], 10),
          recentMessages: state.messages.slice(-6).map((message) => ({ role: message.role, content: clip(message.content, 900) }))
        }
      });
      if (attempt > 1) {
        state.trace.push(modelDecisionTrace(`Model decision recovered on attempt ${attempt}.`, {
          attempt,
          provider: result.provider,
          model: result.model
        }));
      }
      const decision = normalizeDecision(result.data, state);
      const deliveryDecision = deliveryPlannerDecision(state);
      if (deliveryDecision && (decision.type === 'final' || decision.type === 'ask_user')) {
        deliveryDecision.model = result.model;
        deliveryDecision.provider = result.provider;
        return deliveryDecision;
      }
      decision.model = result.model;
      decision.provider = result.provider;
      return decision;
    } catch (error) {
      lastError = error;
      const message = clip(errorMessage(error), 500);
      const shouldRetry = attempt < MODEL_DECISION_MAX_ATTEMPTS && shouldRetryModelDecisionError(error);
      state.trace.push(modelDecisionTrace(
        shouldRetry
          ? `Model decision attempt ${attempt} failed; retrying.`
          : `Model decision attempt ${attempt} failed; falling back.`,
        {
          attempt,
          maxAttempts: MODEL_DECISION_MAX_ATTEMPTS,
          retry: shouldRetry,
          error: message
        }
      ));
      if (!shouldRetry) break;
      const delayMs = retryDelayMs(attempt);
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  const decision = fallbackDecision(state);
  decision.reason = `Fallback after model decision failure: ${clip(errorMessage(lastError), 240)}. ${decision.reason}`;
  return decision;
};

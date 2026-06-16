import prisma from '../../config/db';
import type {
  TerminalChatFileRefV2,
  TerminalMessageV2,
  WorkspaceAgentAcquisitionConstraints,
  WorkspaceAgentArtifactHints,
  WorkspaceAgentContextBudget,
  WorkspaceAgentContextLedgerEntry,
  WorkspaceAgentContextSourceCard,
  WorkspaceAgentContextSources,
  WorkspaceAgentDeliveryContract,
  WorkspaceAgentDeliveryFormat,
  WorkspaceAgentDeliverySatisfiedArtifact,
  WorkspaceAgentRequiredFile,
  WorkspaceAgentObservation,
  WorkspaceAgentRuntimeContextControl,
  WorkspaceAgentSourceScope,
  WorkspaceAgentToolAvailability,
  WorkspaceAgentToolPolicy,
  WorkspaceAgentV2AgentMode,
  WorkspaceAgentV2RunInput,
  WorkspaceAgentV2State
} from './types';
import { clip, createId, normalizeChatFiles, nowIso, unique } from './utils';

const ORDINARY_READ_TOOLS = [
  'workspace.fs.list',
  'workspace.file.search',
  'workspace.file.read',
  'workspace.files.search',
  'knowledge.search',
  'attachment.list',
  'attachment.read',
  'attachment.image.inspect',
  'web.search',
  'web.fetch'
];

const SENSITIVE_READ_TOOLS = [
  'course_graph.query',
  'learner_context.read',
  'saved_memory.read',
  'conversation_history.search',
  'external_resources.discover'
];

const DEFAULT_WRITE_TOOLS = [
  'workbench.create',
  'folder.create',
  'file.write',
  'file.write_many',
  'file.replace',
  'markdown_note.create',
  'resource.import_web',
  'studio.generate_artifact',
  'studio.recommend',
  'memory.save',
  'resource.bind_to_workbench',
  'course_graph.build',
  'code_lab.run'
];

const DEFAULT_KNOWN_TOOLS = [
  ...ORDINARY_READ_TOOLS,
  ...SENSITIVE_READ_TOOLS,
  ...DEFAULT_WRITE_TOOLS
];

const DEFAULT_BUDGET: WorkspaceAgentContextBudget = {
  maxInitialEnvironmentChars: 6000,
  maxToolResultChars: 6000,
  maxDecisionContextChars: 18000,
  maxFinalContextChars: 32000,
  maxEvidenceItemsPerTool: 8,
  maxEvidenceCharsPerItem: 1400,
  maxTotalEvidenceChars: 14000,
  maxObservationHistory: 8,
  compactThresholdRatio: 0.72
};

const normalizeText = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

const hasAny = (text: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));

const CODE_EXTENSIONS = new Set(['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'py', 'js', 'jsx', 'ts', 'tsx', 'java', 'go', 'rs', 'sql', 'html', 'css', 'sh', 'rb', 'php']);
const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'yaml', 'yml', 'xml', 'ini', 'conf', 'toml', 'log']);
const FILE_EXTENSION_PATTERN = /[\w\u4e00-\u9fa5][\w.\-\u4e00-\u9fa5 ]{0,80}\.([a-zA-Z0-9]{1,12})/g;

const inlineDeliveryContract = (userInput: string): WorkspaceAgentDeliveryContract => ({
  required: false,
  target: 'inline_answer',
  action: 'answer',
  format: 'unknown',
  rawUserText: clip(userInput, 500),
  confidence: 0.5,
  status: 'satisfied'
});

const filenameHintFromText = (userInput: string) => {
  const quoted = userInput.match(/[「『"']([^「」『』"']+\.[a-zA-Z0-9]{1,12})[\s」』"']/)?.[1];
  if (quoted) return quoted.trim();
  const bare = userInput.match(/([\w\u4e00-\u9fa5][\w.\-\u4e00-\u9fa5 ]{0,80}\.[a-zA-Z0-9]{1,12})/)?.[1];
  return bare?.trim();
};

const filenamesFromText = (userInput: string): string[] => {
  const matches = new Set<string>();
  for (const match of userInput.matchAll(FILE_EXTENSION_PATTERN)) {
    const raw = match[0]?.trim().replace(/[，。；;、,.!?！？）)\]]+$/g, '');
    if (!raw) continue;
    const parts = raw.split(/\s+/);
    const filename = parts[parts.length - 1]?.trim();
    if (filename && filename.includes('.')) matches.add(filename);
  }
  return Array.from(matches).slice(0, 12);
};

const extensionOf = (filename?: string) => {
  const match = String(filename || '').match(/\.([a-zA-Z0-9]{1,12})$/);
  return match?.[1]?.toLowerCase();
};

const deliveryFormatFromExtension = (extension?: string): WorkspaceAgentDeliveryFormat => {
  if (!extension) return 'unknown';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'json') return 'json';
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  return 'unknown';
};

const extensionFromFormatText = (text: string) => {
  if (hasAny(text, [/\.md\b/i, /\.markdown\b/i, /\bmd\s*(文件|文档|笔记)/, /markdown\s*(file|文件|文档|笔记)/i, /md笔记/, /markdown笔记/i])) return 'md';
  if (hasAny(text, [/\.json\b/i, /json\s*(文件|文档)/i])) return 'json';
  if (hasAny(text, [/\.txt\b/i, /txt\s*(文件|文档)/i, /文本文件/])) return 'txt';
  if (hasAny(text, [/\.c\b/i, /\bc\s*(文件|代码文件)/i])) return 'c';
  if (hasAny(text, [/\.py\b/i, /python\s*(文件|脚本|代码)/i])) return 'py';
  return undefined;
};

const countFromText = (text: string) => {
  const arabic = text.match(/(?:生成|创建|新建|写|保存|输出|做成|制作).{0,8}(\d{1,2})\s*(?:个|份|篇|组)?\s*(?:md|markdown|json|txt|c|python|py)?\s*(?:文件|文档|代码文件|脚本)/i)?.[1];
  if (arabic) return Math.max(1, Math.min(Number(arabic), 8));
  const chineseDigits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 };
  const chinese = text.match(/(?:生成|创建|新建|写|保存|输出|做成|制作).{0,8}([一二两三四五六七八])\s*(?:个|份|篇|组)?\s*(?:md|markdown|json|txt|c|python|py)?\s*(?:文件|文档|代码文件|脚本)/i)?.[1];
  return chinese ? chineseDigits[chinese] : undefined;
};

const hasExplicitFileDeliveryIntent = (text: string) =>
  hasAny(text, [
    /(保存|存成|另存为|生成|创建|新建|写入|落库|落地).{0,18}(文件|文档|md|markdown)/,
    /(文件|文档|md|markdown).{0,18}(保存|生成|创建|新建|写入|落库|落地)/,
    /(整理|输出|做|做成|制作).{0,18}(md|markdown).{0,8}(文件|文档)/,
    /(放进|放到|放入|存到|写到|保存到).{0,18}(workspace|工作区|当前学习现场|workbench|现场)/,
    /save (as|to)/i,
    /(create|write|generate).{0,30}(file|markdown|\.md|\.c|\.py|\.json|\.txt)/i,
    /(put|save).{0,30}(workspace|workbench)/i
  ]);

const dominantFormat = (files: WorkspaceAgentRequiredFile[], markdownIntent: boolean): WorkspaceAgentDeliveryFormat => {
  if (markdownIntent) return 'markdown';
  const formats = files.map((file) => deliveryFormatFromExtension(file.extension)).filter((format) => format !== 'unknown');
  if (!formats.length) return 'unknown';
  const uniqueFormats = new Set(formats);
  return uniqueFormats.size === 1 ? formats[0] : 'code';
};

const requiredFilesFromUserInput = (userInput: string, options: { allowExplicitFilenames?: boolean } = {}): WorkspaceAgentRequiredFile[] => {
  const filenames = options.allowExplicitFilenames ? filenamesFromText(userInput) : [];
  const explicitFiles = filenames.map((filename, index) => {
    const extension = extensionOf(filename);
    return {
      filename,
      extension,
      role: index === 0 ? 'main' as const : 'supporting' as const,
      status: 'pending' as const
    };
  });
  if (explicitFiles.length) return explicitFiles;
  const text = normalizeText(userInput);
  const count = countFromText(text);
  if (!count || count <= 1) return [];
  const extension = extensionFromFormatText(text);
  return Array.from({ length: count }, (_, index) => ({
    extension,
    role: index === 0 ? 'main' as const : 'supporting' as const,
    status: 'pending' as const
  }));
};

const buildDeliveryContractFromUserInput = (userInput: string): WorkspaceAgentDeliveryContract => {
  const text = normalizeText(userInput);
  const fileIntent = hasExplicitFileDeliveryIntent(text);
  const requiredFiles = requiredFilesFromUserInput(userInput, { allowExplicitFilenames: fileIntent });
  const markdownIntent = hasAny(text, [/\.md\b/i, /\.markdown\b/i, /markdown/i, /\bmd\s*(文件|文档|笔记)/, /md文件/, /md文档/, /md笔记/, /markdown笔记/i, /马克?down/]);
  const explicitMarkdownFileIntent = hasAny(text, [
    /\bmd\s*(文件|文档|笔记)/,
    /md文件/,
    /md文档/,
    /md笔记/,
    /markdown\s*(file|文件|文档|笔记)/i
  ]);
  if (!fileIntent && !explicitMarkdownFileIntent && !requiredFiles.length) return inlineDeliveryContract(userInput);

  const workbenchTarget = hasAny(text, [/当前(学习现场|workbench|现场)/, /workbench/i]);
  const workspaceTarget = hasAny(text, [/workspace|工作区/]);
  const target = workbenchTarget && !workspaceTarget ? 'workbench_file' : 'workspace_file';
  const format = dominantFormat(requiredFiles, markdownIntent);
  return {
    required: true,
    target,
    action: 'create',
    format,
    filenameHint: filenameHintFromText(userInput),
    requiredFiles: requiredFiles.length ? requiredFiles : undefined,
    scope: target === 'workbench_file' ? 'workbench' : 'workspace',
    rawUserText: clip(userInput, 500),
    confidence: requiredFiles.length ? 0.94 : fileIntent && markdownIntent ? 0.94 : markdownIntent ? 0.82 : 0.76,
    status: 'pending'
  };
};

const buildArtifactHints = (userInput: string): WorkspaceAgentArtifactHints | undefined => {
  const text = normalizeText(userInput);
  const reasons: string[] = [];
  const possibleKinds = new Set<WorkspaceAgentArtifactHints['possibleKinds'][number]>();
  const possibleTargets = new Set<WorkspaceAgentArtifactHints['possibleTargets'][number]>();
  const possibleInteractivity = new Set<WorkspaceAgentArtifactHints['possibleInteractivity'][number]>();

  if (hasAny(text, [/选择题|练习题|测试题|测验|quiz|practice|刷题|出题|题目|判分|解析|辨析概念/])) {
    possibleKinds.add('practice');
    possibleTargets.add('inline_answer');
    possibleTargets.add('studio_artifact');
    possibleInteractivity.add('chat');
    possibleInteractivity.add('studio_renderer');
    reasons.push('用户请求练习/测验/题目类产物。');
  }
  if (hasAny(text, [/思维导图|mind\s*map|脑图|概念图|知识图谱/])) {
    possibleKinds.add('mind_map');
    possibleTargets.add('studio_artifact');
    reasons.push('用户请求图谱/导图类学习产物。');
  }
  if (hasAny(text, [/flashcard|闪卡|卡片|复习卡|记忆卡|主动回忆/])) {
    possibleKinds.add('flashcards');
    possibleTargets.add('studio_artifact');
    possibleInteractivity.add('studio_renderer');
    reasons.push('用户请求卡片/主动回忆类产物。');
  }
  if (hasAny(text, [/可视化|动画|交互演示|逐步演示|react|html|图表|流程演示|状态变化|算法过程/])) {
    possibleKinds.add('visual_explainer');
    possibleTargets.add('studio_artifact');
    possibleInteractivity.add('executable_visual');
    reasons.push('用户请求可视化/动画/可执行演示。');
  }
  if (hasAny(text, [/可交互|互动|点选|可以点|交互式|interactive/])) {
    possibleTargets.add('studio_artifact');
    possibleInteractivity.add('studio_renderer');
    if (possibleKinds.has('visual_explainer')) possibleInteractivity.add('executable_visual');
    if (possibleKinds.has('practice')) possibleInteractivity.add('chat');
    reasons.push('用户使用了交互式表达，可能适合 Studio renderer，也可能只是聊天交互。');
  }
  if (hasAny(text, [/ai\s*studio|studio|生成.*资源|创建.*资源|做成.*资源|发布|可打开|打开的|产物/])) {
    possibleTargets.add('studio_artifact');
    reasons.push('用户表达了可落地学习资源/Studio 产物倾向。');
  }

  if (!possibleKinds.size && !possibleTargets.size) return undefined;
  if (!possibleTargets.size) possibleTargets.add('inline_answer');
  const explicitStudioSignal = hasAny(text, [/ai\s*studio|studio|生成.*资源|创建.*资源|做成.*资源|发布|可打开|打开的|产物/]);
  const interactiveSignal = hasAny(text, [/可交互|互动|点选|可以点|交互式|interactive/]);
  const confidence = Math.min(
    0.86,
    0.42
      + (possibleKinds.size ? 0.12 : 0)
      + (interactiveSignal ? 0.12 : 0)
      + (explicitStudioSignal ? 0.16 : 0)
      + (possibleKinds.size > 1 ? 0.04 : 0)
  );
  return {
    possibleTargets: Array.from(possibleTargets),
    possibleKinds: Array.from(possibleKinds),
    possibleInteractivity: Array.from(possibleInteractivity),
    confidence,
    reasons: reasons.slice(0, 6)
  };
};

const artifactEvidenceFor = (
  artifact: NonNullable<WorkspaceAgentObservation['artifactRefs']>[number],
  state: Pick<WorkspaceAgentV2State, 'evidence'>
) =>
  [...state.evidence].reverse().find((item) =>
    (typeof item.metadata?.fileObjectId === 'string' && item.metadata.fileObjectId === artifact.id) ||
    item.title === artifact.title
  );

const artifactToSatisfiedBy = (
  tool: string,
  artifact: NonNullable<WorkspaceAgentObservation['artifactRefs']>[number],
  state: Pick<WorkspaceAgentV2State, 'evidence'>
): WorkspaceAgentDeliverySatisfiedArtifact => {
  const evidence = artifactEvidenceFor(artifact, state);
  return {
    tool,
    artifactKind: artifact.kind === 'workbench' ? 'workbench' : artifact.kind === 'preview' ? 'preview' : 'file',
    id: artifact.id,
    title: artifact.title,
    path: typeof evidence?.source === 'string' ? evidence.source : undefined
  };
};

const fileArtifactsFromState = (state: Pick<WorkspaceAgentV2State, 'observations' | 'evidence'>) =>
  state.observations
    .filter((observation) => observation.status === 'success')
    .flatMap((observation) => (observation.artifactRefs || [])
      .filter((artifact) => artifact.kind === 'file')
      .map((artifact) => ({
        artifact,
        satisfiedBy: artifactToSatisfiedBy(observation.tool, artifact, state)
      })));

const satisfyRequiredFiles = (
  requiredFiles: WorkspaceAgentRequiredFile[],
  state: Pick<WorkspaceAgentV2State, 'observations' | 'evidence'>
): WorkspaceAgentRequiredFile[] => {
  const candidates = fileArtifactsFromState(state);
  const used = new Set<string>();
  return requiredFiles.map((required) => {
    if (required.status === 'satisfied' && required.satisfiedBy) return required;
    const wantedName = required.filename?.toLowerCase();
    const wantedExtension = required.extension?.toLowerCase();
    const candidate = candidates.find((item) => {
      if (used.has(item.artifact.id)) return false;
      const title = String(item.artifact.title || item.satisfiedBy.path || '').toLowerCase();
      if (wantedName) return title.endsWith(wantedName);
      if (wantedExtension) return title.endsWith(`.${wantedExtension}`);
      return true;
    });
    if (!candidate) return { ...required, status: 'pending' as const, satisfiedBy: undefined };
    used.add(candidate.artifact.id);
    return {
      ...required,
      status: 'satisfied' as const,
      satisfiedBy: candidate.satisfiedBy
    };
  });
};

const deliveryContractSatisfiedByState = (
  contract: WorkspaceAgentDeliveryContract,
  state?: Pick<WorkspaceAgentV2State, 'observations' | 'evidence'> | null
): WorkspaceAgentDeliveryContract => {
  if (!contract.required || !state) return contract;
  if (contract.status === 'satisfied' && contract.satisfiedBy) return contract;

  if (contract.requiredFiles?.length) {
    const requiredFiles = satisfyRequiredFiles(contract.requiredFiles, state);
    const required = requiredFiles.filter((file) => !file.optional);
    const satisfied = required.length > 0 && required.every((file) => file.status === 'satisfied' && file.satisfiedBy);
    return {
      ...contract,
      requiredFiles,
      status: satisfied ? 'satisfied' : 'pending',
      satisfiedBy: satisfied ? required[required.length - 1].satisfiedBy : undefined
    };
  }

  const successfulFileWrite = [...state.observations].reverse().find((observation) =>
    observation.status === 'success' &&
    ['markdown_note.create', 'file.write', 'file.write_many', 'file.replace'].includes(observation.tool) &&
    observation.artifactRefs?.some((artifact) => artifact.kind === 'file')
  );
  const artifact = successfulFileWrite?.artifactRefs?.find((item) => item.kind === 'file');
  if (successfulFileWrite && artifact) {
    return {
      ...contract,
      status: 'satisfied',
      satisfiedBy: artifactToSatisfiedBy(successfulFileWrite.tool, artifact, state)
    };
  }

  const successfulWorkbench = [...state.observations].reverse().find((observation) =>
    observation.status === 'success' &&
    observation.tool === 'workbench.create' &&
    observation.artifactRefs?.some((artifact) => artifact.kind === 'workbench')
  );
  const workbenchArtifact = successfulWorkbench?.artifactRefs?.find((item) => item.kind === 'workbench');
  if (contract.target === 'workbench' && successfulWorkbench && workbenchArtifact) {
    return {
      ...contract,
      status: 'satisfied',
      satisfiedBy: {
        tool: successfulWorkbench.tool,
        artifactKind: 'workbench',
        id: workbenchArtifact.id,
        title: workbenchArtifact.title
      }
    };
  }

  return contract;
};

export const buildWorkspaceAgentDeliveryContract = (input: {
  userInput: string;
  previousState?: Pick<WorkspaceAgentV2State, 'observations' | 'evidence' | 'contextControl'> | null;
  allowPreviousDeliveryArtifacts?: boolean;
}): WorkspaceAgentDeliveryContract => {
  const base = buildDeliveryContractFromUserInput(input.userInput);
  return input.allowPreviousDeliveryArtifacts
    ? deliveryContractSatisfiedByState(base, input.previousState || undefined)
    : base;
};

const selectedCardsFromInput = (input: WorkspaceAgentV2RunInput): WorkspaceAgentContextSourceCard[] => {
  const selected = [
    ...(input.selectedSources || []).map((item) => ({
      id: item.fileId,
      mode: item.mode || 'focused',
      kind: 'selected_resource'
    })),
    ...(input.selectedSourceIds || []).map((id) => ({
      id,
      kind: 'selected_resource'
    }))
  ];
  const seen = new Set<string>();
  return selected.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 36);
};

const chatAttachmentCards = (chatFiles: TerminalChatFileRefV2[]): WorkspaceAgentContextSourceCard[] => {
  const seen = new Set<string>();
  return chatFiles.filter((file) => {
    if (!file.id || seen.has(file.id)) return false;
    seen.add(file.id);
    return true;
  }).map((file) => ({
    id: file.id,
    title: file.name,
    mimeType: file.mimeType,
    size: file.size,
    kind: 'chat_attachment'
  })).slice(0, 36);
};

const chatFilesFromMessages = (messages: TerminalMessageV2[]): TerminalChatFileRefV2[] =>
  messages.slice(-12).flatMap((message) => normalizeChatFiles(message.files));

const inferChatAttachmentCardsFromIds = async (
  workspaceId: string,
  ids: string[]
): Promise<WorkspaceAgentContextSourceCard[]> => {
  const uniqueIds = unique(ids, 48);
  if (!uniqueIds.length) return [];
  const rows = await prisma.fileSystemObject.findMany({
    where: {
      workspaceId,
      nodeType: 'file',
      scope: 'chat',
      id: { in: uniqueIds }
    },
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true
    }
  }).catch(() => []);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const cards: WorkspaceAgentContextSourceCard[] = [];
  for (const id of uniqueIds) {
    const row = byId.get(id);
    if (!row) continue;
    cards.push({
      id: row.id,
      title: row.name,
      mimeType: row.mimeType || undefined,
      size: row.size || undefined,
      kind: 'chat_attachment'
    });
  }
  return cards;
};

const mergeSourceCards = (groups: WorkspaceAgentContextSourceCard[][], limit: number) => {
  const seen = new Set<string>();
  const result: WorkspaceAgentContextSourceCard[] = [];
  for (const group of groups) {
    for (const card of group) {
      if (!card.id || seen.has(card.id)) continue;
      seen.add(card.id);
      result.push(card);
      if (result.length >= limit) return result;
    }
  }
  return result;
};

const mentionCardsFromMessages = (messages: TerminalMessageV2[]): WorkspaceAgentContextSourceCard[] => {
  const cards: WorkspaceAgentContextSourceCard[] = [];
  const mentionPattern = /@([\w.\-/:一-龥]+)/g;
  for (const message of messages.slice(-6)) {
    for (const match of message.content.matchAll(mentionPattern)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      cards.push({
        id: raw,
        title: raw,
        kind: raw.includes('/') || raw.includes('.') ? 'mention_path' : 'mention'
      });
    }
  }
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  }).slice(0, 16);
};

const detectAgentMode = (userInput: string): WorkspaceAgentV2AgentMode => {
  const text = normalizeText(userInput);
  if (hasAny(text, [/只搜索/, /仅搜索/, /先找资料/, /先检索/, /搜索模式/, /search only/i])) return 'search';
  if (hasAny(text, [/只规划/, /先计划/, /不要执行/, /plan only/i])) return 'plan';
  if (hasAny(text, [/只回答/, /直接回答/, /不用工具/, /只用模型知识/])) return 'minimal';
  return 'act';
};

const steeringFromText = (userInput: string, sourceIds: { selectedResourceIds: string[]; attachmentIds: string[] }): WorkspaceAgentAcquisitionConstraints => {
  const text = normalizeText(userInput);
  const preferredScopes: WorkspaceAgentSourceScope[] = [];
  const deniedScopes: WorkspaceAgentSourceScope[] = [];
  const deniedTools: string[] = [];
  const preferredTools: string[] = [];
  const userSteering: WorkspaceAgentAcquisitionConstraints['userSteering'] = [];
  let onlyScopes: WorkspaceAgentSourceScope[] | undefined;

  const addSteering = (kind: 'prefer' | 'only' | 'deny', target: string, confidence: number) => {
    userSteering.push({ kind, target, rawText: clip(userInput, 240), confidence });
  };

  if (hasAny(text, [/^(只用|仅用).*(模型知识|通用知识)$/, /^(不用|不要用|无需).*(工具|任何工具)$/, /^直接回答$/, /model knowledge only/i])) {
    deniedTools.push(...ORDINARY_READ_TOOLS, ...SENSITIVE_READ_TOOLS);
    addSteering('deny', 'all_read_search_tools', 0.96);
  }

  if (hasAny(text, [/(不要|别|无需).*(读|读取|查看).*(正文|全文|内容)/, /do not read.*(body|content|full file)/i])) {
    deniedTools.push('workspace.file.read', 'attachment.read');
    addSteering('deny', 'body_read_tools', 0.82);
  }

  if (hasAny(text, [/(不要|别|无需).*(搜索|检索|查).*(workspace|工作区)/, /(不要|别|无需).*(workspace|工作区).*(搜索|检索|查)/, /do not search (the )?workspace/i])) {
    deniedTools.push('workspace.file.search', 'workspace.files.search', 'knowledge.search');
    deniedScopes.push('workspace');
    addSteering('deny', 'workspace_search', 0.88);
  }

  if (hasAny(text, [/(不要|别|无需|不需要).*(联网|网上|互联网|外部资料|外部资源|网页|官网|官方文档)/, /(不要|别|无需|不需要).*(web|internet|online|external)/i, /offline only/i])) {
    deniedTools.push('web.search', 'web.fetch');
    addSteering('deny', 'web_access', 0.92);
  }

  if (hasAny(text, [/(联网|网上|互联网|外部资料|外部资源|网页|官网|官方文档|最新|论文|教程).*(搜索|检索|查|找|资料)?/, /(web search|search the web|internet|online|external|official docs|latest|recent|paper|tutorial)/i])) {
    preferredTools.push('web.search');
    addSteering('prefer', 'web_search', 0.8);
  }

  const explicitSourceRefs = /(上传|选中|附件|这个|这些|当前给的|刚才给的|这份|这几份).*(文件|资料|文档|pdf|附件)|((文件|资料|文档|pdf|附件).*(上传|选中|附件|这个|这些|当前给的|刚才给的|这份|这几份))/;
  if (hasAny(text, [new RegExp(`(只|仅|不要查别的|不要搜索别的).*(?:${explicitSourceRefs.source})`), /only.*(uploaded|selected|attached|explicit)/i])) {
    onlyScopes = ['explicit_sources', 'chat_attachments'];
    addSteering('only', 'explicit_sources', 0.9);
  } else if (hasAny(text, [new RegExp(`(根据|基于).*(?:${explicitSourceRefs.source})`), /(uploaded|selected|attached)/i])) {
    preferredScopes.push('explicit_sources');
    addSteering('prefer', 'explicit_sources', 0.78);
  }

  if (hasAny(text, [/当前(学习现场|workbench|现场)/, /current workbench/i])) {
    preferredScopes.push('workbench');
    addSteering('prefer', 'workbench', 0.8);
  }

  if (hasAny(text, [/(整个|全部).*(课程空间|workspace|工作区)/, /whole workspace/i])) {
    preferredScopes.push('workspace');
    addSteering('prefer', 'workspace', 0.8);
  }

  if (hasAny(text, [/不要.*(学习画像|个人画像|记忆|偏好|我的学习情况)/])) {
    deniedTools.push('learner_context.read', 'saved_memory.read', 'conversation_history.search');
    addSteering('deny', 'learner_context', 0.92);
  }

  if (hasAny(text, [/不要.*(课程图谱|知识图谱|前置关系|概念关系)/])) {
    deniedTools.push('course_graph.query');
    addSteering('deny', 'course_graph', 0.9);
  }

  if (hasAny(text, [/(我的学习情况|薄弱点|偏好|记忆|个性化|适合我)/])) {
    preferredTools.push('learner_context.read');
    addSteering('prefer', 'learner_context', 0.74);
  }

  if (hasAny(text, [/(课程图谱|知识图谱|概念关系|前置知识|前置关系)/])) {
    preferredTools.push('course_graph.query');
    addSteering('prefer', 'course_graph', 0.74);
  }

  return {
    preferredScopes: unique(preferredScopes, 4) as WorkspaceAgentSourceScope[],
    onlyScopes,
    deniedScopes,
    allowedFileIds: onlyScopes ? sourceIds.selectedResourceIds : undefined,
    allowedAttachmentIds: onlyScopes ? sourceIds.attachmentIds : undefined,
    deniedTools: unique(deniedTools, 64),
    preferredTools: unique(preferredTools, 24),
    userSteering
  };
};

const sensitiveToolEnabled = (tool: string, constraints: WorkspaceAgentAcquisitionConstraints, userInput: string) => {
  if (constraints.deniedTools.includes(tool)) return false;
  if (constraints.preferredTools.includes(tool)) return true;
  const text = normalizeText(userInput);
  if (tool === 'course_graph.query') {
    return hasAny(text, [/(课程图谱|知识图谱|概念关系|前置知识|前置关系|学习路径|诊断)/]);
  }
  if (tool === 'learner_context.read' || tool === 'saved_memory.read' || tool === 'conversation_history.search') {
    return hasAny(text, [/(我的学习情况|薄弱点|偏好|记忆|个性化|适合我|历史对话)/]);
  }
  return false;
};

const buildToolAvailability = (
  agentMode: WorkspaceAgentV2AgentMode,
  constraints: WorkspaceAgentAcquisitionConstraints,
  userInput: string
): WorkspaceAgentToolAvailability => {
  const enabled = new Set<string>();
  const disabled: WorkspaceAgentToolAvailability['disabledTools'] = [];
  const disable = (tool: string, reason: WorkspaceAgentToolAvailability['disabledTools'][number]['reason']) => {
    disabled.push({ tool, reason });
  };

  for (const tool of ORDINARY_READ_TOOLS) {
    if (agentMode === 'minimal' || constraints.deniedTools.includes(tool)) disable(tool, agentMode === 'minimal' ? 'mode' : 'user_steering');
    else enabled.add(tool);
  }

  for (const tool of SENSITIVE_READ_TOOLS) {
    if (sensitiveToolEnabled(tool, constraints, userInput)) enabled.add(tool);
    else disable(tool, constraints.deniedTools.includes(tool) ? 'user_steering' : 'sensitive_tool_not_enabled');
  }

  for (const tool of DEFAULT_WRITE_TOOLS) {
    if (agentMode === 'search' || agentMode === 'minimal') disable(tool, 'mode');
    else if (constraints.deniedTools.includes(tool)) disable(tool, 'user_steering');
    else enabled.add(tool);
  }

  return {
    enabledTools: Array.from(enabled),
    disabledTools: disabled
  };
};

const policyForTool = (tool: string, availability: WorkspaceAgentToolAvailability): WorkspaceAgentToolPolicy => {
  const enabled = availability.enabledTools.includes(tool);
  const isRead = ORDINARY_READ_TOOLS.includes(tool) || SENSITIVE_READ_TOOLS.includes(tool);
  const isSensitive = SENSITIVE_READ_TOOLS.includes(tool);
  const maxWriteCalls = tool === 'file.write' || tool === 'file.replace' ? 6 : 2;
  return {
    tool,
    enabled,
    autoApprove: isRead && !isSensitive,
    requiresApproval: !isRead || isSensitive,
    risk: isSensitive ? 'medium' : isRead ? 'low' : 'medium',
    maxCallsPerRun: isRead ? 6 : maxWriteCalls,
    maxResultChars: isRead ? DEFAULT_BUDGET.maxToolResultChars : undefined
  };
};

const buildToolPolicy = (availability: WorkspaceAgentToolAvailability) => {
  const policies: Record<string, WorkspaceAgentToolPolicy> = {};
  for (const tool of DEFAULT_KNOWN_TOOLS) {
    policies[tool] = policyForTool(tool, availability);
  }
  return policies;
};

const sourceTypeForEvidence = (kind: string): WorkspaceAgentContextLedgerEntry['sourceType'] => {
  if (/knowledge|chunk/.test(kind)) return 'knowledge_chunk';
  if (/course_graph/.test(kind)) return 'course_graph';
  if (/learner/.test(kind)) return 'learner_context';
  if (/markdown|generated/.test(kind)) return 'generated_file';
  if (/attachment/.test(kind)) return 'chat_attachment';
  if (/workspace|file/.test(kind)) return 'workspace_file';
  return 'unknown';
};

export const buildContextLedger = (state?: Pick<WorkspaceAgentV2State, 'observations' | 'evidence' | 'toolCalls'>): WorkspaceAgentContextLedgerEntry[] => {
  if (!state) return [];
  const entries: WorkspaceAgentContextLedgerEntry[] = [];
  for (const observation of state.observations.slice(-8)) {
    entries.push({
      id: observation.id,
      kind: 'tool_observation',
      sourceType: 'unknown',
      toolCallId: state.toolCalls.find((call) => call.observationId === observation.id)?.id,
      title: observation.tool,
      summary: observation.summary,
      createdAt: observation.at
    });
  }
  for (const evidence of state.evidence.slice(-16)) {
    entries.push({
      id: evidence.id,
      kind: 'evidence',
      sourceType: sourceTypeForEvidence(evidence.kind),
      sourceId: typeof evidence.metadata?.fileObjectId === 'string' ? evidence.metadata.fileObjectId : undefined,
      locator: evidence.metadata,
      title: evidence.title,
      summary: evidence.summary,
      contentHash: evidence.content ? String(evidence.content.length) : undefined,
      tokenEstimate: Math.ceil((evidence.content || evidence.summary || '').length / 4),
      createdAt: nowIso()
    });
  }
  return entries;
};

export const buildWorkspaceAgentV2ContextControl = async (input: {
  runInput: WorkspaceAgentV2RunInput;
  messages: TerminalMessageV2[];
  userInput: string;
  chatFiles: TerminalChatFileRefV2[];
  previousState?: WorkspaceAgentV2State | null;
  allowPreviousDeliveryArtifacts?: boolean;
}): Promise<WorkspaceAgentRuntimeContextControl> => {
  const workspace = await prisma.workspace.findUnique({
    where: { id: input.runInput.workspaceId },
    select: { id: true, name: true }
  }).catch(() => null);
  const workbench = input.runInput.workbenchId
    ? await prisma.workbench.findUnique({
        where: { id: input.runInput.workbenchId },
        select: { id: true, title: true }
      }).catch(() => null)
    : null;

  let selectedResources = selectedCardsFromInput(input.runInput);
  const messageChatFiles = chatFilesFromMessages(input.messages);
  const previousAttachmentCards = input.previousState?.contextControl?.contextSources?.chatAttachments || [];
  const selectedIds = unique([
    ...(input.runInput.selectedSourceIds || []),
    ...(input.runInput.selectedSources || []).map((item) => item.fileId),
    ...messageChatFiles.map((file) => file.id),
    ...input.chatFiles.map((file) => file.id),
    ...(input.previousState?.selectedFileIds || [])
  ], 48);
  const inferredChatAttachmentCards = await inferChatAttachmentCardsFromIds(input.runInput.workspaceId, selectedIds);
  const chatAttachments = mergeSourceCards([
    chatAttachmentCards(input.chatFiles),
    chatAttachmentCards(messageChatFiles),
    previousAttachmentCards,
    inferredChatAttachmentCards
  ], 36);
  const chatAttachmentIdSet = new Set(chatAttachments.map((item) => item.id));
  selectedResources = selectedResources.filter((item) => !chatAttachmentIdSet.has(item.id));
  const mentions = mentionCardsFromMessages(input.messages);
  const selectedResourceIds = unique(selectedResources.map((item) => item.id), 36);
  const attachmentIds = unique(chatAttachments.map((item) => item.id), 24);
  const acquisitionConstraints = steeringFromText(input.userInput, { selectedResourceIds, attachmentIds });
  const agentMode = detectAgentMode(input.userInput);
  const toolAvailability = buildToolAvailability(agentMode, acquisitionConstraints, input.userInput);
  const toolPolicy = buildToolPolicy(toolAvailability);
  const contextLedger = buildContextLedger(input.previousState || undefined);
  const deliveryContract = buildWorkspaceAgentDeliveryContract({
    userInput: input.userInput,
    previousState: input.previousState || null,
    allowPreviousDeliveryArtifacts: input.allowPreviousDeliveryArtifacts
  });
  const artifactHints = buildArtifactHints(input.userInput);

  const contextSources: WorkspaceAgentContextSources = {
    workspace: {
      id: input.runInput.workspaceId,
      title: workspace?.name || undefined
    },
    workbench: workbench ? { id: workbench.id, title: workbench.title, isCurrent: true } : input.runInput.workbenchId ? {
      id: input.runInput.workbenchId,
      isCurrent: true
    } : null,
    selectedResources,
    chatAttachments,
    mentions,
    recentObservations: (input.previousState?.observations || []).slice(-8).map((observation) => ({
      id: observation.id,
      tool: observation.tool,
      status: observation.status,
      summary: observation.summary
    })),
    ignoreSummary: 'workspace ignore rules apply to automatic list/search/read; explicit mentions may be handled by product policy'
  };

  return {
    agentMode,
    toolAvailability,
    toolPolicy,
    contextSources,
    acquisitionConstraints,
    contextBudget: DEFAULT_BUDGET,
    contextLedger,
    deliveryContract,
    artifactHints
  };
};

export const refreshWorkspaceAgentV2ContextControl = async (state: WorkspaceAgentV2State): Promise<WorkspaceAgentRuntimeContextControl> =>
  buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: state.workspaceId,
      workbenchId: state.workbenchId || null,
      sessionId: state.sessionId || null,
      checkpointThreadId: state.checkpointThreadId,
      messages: state.messages,
      selectedSourceIds: state.contextControl?.contextSources?.selectedResources?.map((item) => item.id),
      chatFiles: state.chatFiles
    } as WorkspaceAgentV2RunInput,
    messages: state.messages,
    userInput: state.userInput,
    chatFiles: normalizeChatFiles(state.chatFiles),
    previousState: state,
    allowPreviousDeliveryArtifacts: true
  });

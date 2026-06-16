import { buildAgentHistoryForModel } from './agentMessageHistory';
import { buildWorkspaceAgentModelContext } from './contextBuilder';
import { clip, clipPreserveWhitespace, createId, nowIso, unique } from './utils';
import type { WorkspaceAgentDecision, WorkspaceAgentHistoryMessage, WorkspaceAgentV2State } from './types';

const MAX_MARKDOWN_CONTENT_CHARS = 45000;

const hasTool = (state: WorkspaceAgentV2State, name: string) =>
  state.availableTools.some((tool) => tool.name === name);

const alreadyCalledTool = (state: WorkspaceAgentV2State, name: string) =>
  state.toolCalls.some((call) => call.tool === name);

const slug = (value: string, fallback = 'workspace-agent-summary') => {
  const cleaned = value
    .trim()
    .replace(/[#*_`~[\](){}<>]/g, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 72)
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
};

const markdownFilename = (state: WorkspaceAgentV2State) => {
  const hinted = state.contextControl?.deliveryContract?.filenameHint;
  if (hinted) return /\.(md|markdown)$/i.test(hinted) ? hinted : `${hinted}.md`;
  const base = state.userInput
    .replace(/(很好|请你|帮我|把|上面|刚才|这份|深度|整理|变成|生成|保存|放入|放进|放到|课程空间|workspace|工作区|md|markdown|文件|文档)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${slug(base, 'workspace-agent-summary')}.md`;
};

const titleFromFilename = (filename: string) =>
  filename.replace(/\.(md|markdown)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Workspace Agent Summary';

const isMarkdownFilename = (filename?: string) => /\.(md|markdown)$/i.test(String(filename || ''));
const hasMarkdownDeliveryText = (value: string) =>
  /\.md\b|\.markdown\b|markdown|md\s*(文件|文档|笔记)|md文件|md文档|md笔记|markdown笔记|马克?down/i.test(value);

const recentAssistantText = (history: WorkspaceAgentHistoryMessage[], currentTurnId: string) => {
  const items: string[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.turnId === currentTurnId) continue;
    if (message.role !== 'assistant' || typeof message.content !== 'string') continue;
    const text = message.content.trim();
    if (!text || text.length < 80) continue;
    items.unshift(text);
    if (items.join('\n\n').length > MAX_MARKDOWN_CONTENT_CHARS) break;
    if (items.length >= 3) break;
  }
  return items;
};

const extractEvidenceMarkdown = (state: WorkspaceAgentV2State) => {
  const blocks = buildWorkspaceAgentModelContext(state, { phase: 'final', maxChars: 26000 })
    .filter((item) => item.kind === 'read_result' || item.kind === 'tool_result')
    .filter((item) => item.content || item.summary)
    .slice(0, 8);
  if (!blocks.length) return '';
  return [
    '## 参考资料摘录',
    '',
    ...blocks.map((item, index) => [
      `### ${index + 1}. ${item.title}`,
      '',
      item.content ? clipPreserveWhitespace(item.content, 2800) : item.summary,
      ''
    ].join('\n'))
  ].join('\n');
};

const sourceFileIds = (state: WorkspaceAgentV2State) =>
  unique([
    ...state.selectedFileIds,
    ...state.evidence.map((item) => item.metadata?.fileObjectId).filter((item): item is string => typeof item === 'string'),
    ...state.contextControl.contextSources.selectedResources.map((item) => item.id)
  ], 12);

const composeMarkdownFromHistory = (state: WorkspaceAgentV2State) => {
  const history = buildAgentHistoryForModel(state.agentMessages || [], {
    maxToolResultChars: 9000,
    maxTotalChars: 70000
  });
  const assistantTexts = recentAssistantText(history, state.currentTurnId);
  const evidenceMarkdown = extractEvidenceMarkdown(state);
  const filename = markdownFilename(state);
  const title = titleFromFilename(filename);

  const sections = [
    `# ${title}`,
    '',
    `> 用户请求：${state.userInput}`,
    '',
    assistantTexts.length
      ? assistantTexts.join('\n\n---\n\n')
      : [
          '## 整理内容',
          '',
          evidenceMarkdown || '当前没有足够的历史整理内容可直接保存。'
        ].join('\n')
  ];
  if (assistantTexts.length && evidenceMarkdown) {
    sections.push('', '---', '', evidenceMarkdown);
  }
  return clipPreserveWhitespace(sections.join('\n'), MAX_MARKDOWN_CONTENT_CHARS);
};

export const deliveryPlannerDecision = (state: WorkspaceAgentV2State): WorkspaceAgentDecision | null => {
  const contract = state.contextControl?.deliveryContract;
  if (!contract?.required || contract.status === 'satisfied') return null;
  if (!['workspace_file', 'workbench_file', 'existing_workspace_file'].includes(contract.target)) return null;
  const requiredFiles = contract.requiredFiles || [];
  const allRequiredMarkdown = requiredFiles.length > 0 && requiredFiles.every((file) =>
    isMarkdownFilename(file.filename) || file.extension === 'md' || file.extension === 'markdown'
  );
  const shouldAutoComposeMarkdown =
    (contract.format === 'markdown' || hasMarkdownDeliveryText(state.userInput)) &&
    (!requiredFiles.length || allRequiredMarkdown || contract.format === 'unknown');
  if (!shouldAutoComposeMarkdown) return null;
  const tool = 'markdown_note.create';
  if (!hasTool(state, tool)) return null;
  if (alreadyCalledTool(state, tool)) return null;
  const filename = requiredFiles.find((file) => file.filename)?.filename || markdownFilename(state);
  const content = composeMarkdownFromHistory(state);
  if (!content.trim()) return null;
  return {
    id: createId('decision'),
    type: 'tool_call',
    tool,
    input: {
      title: titleFromFilename(filename),
      filename,
      content,
      sourceFileIds: sourceFileIds(state)
    },
    visibleMessage: `我把刚才的整理整理成 Markdown 文件，并准备保存到${contract.target === 'workbench_file' ? '当前学习现场' : '课程空间'}。`,
    reason: 'DeliveryPlanner: pending Markdown delivery must be satisfied through markdown_note.create before final response.',
    at: nowIso()
  };
};

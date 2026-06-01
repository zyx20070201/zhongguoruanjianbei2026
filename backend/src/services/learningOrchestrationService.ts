import crypto from 'crypto';
import prisma from '../config/db';
import { FileSystemService } from './fileSystemService';
import { workbenchService } from './workbenchService';
import { aiModelProviderService } from './aiModelProviderService';
import { learningMemoryService } from './learningMemoryService';
import { knowledgeChunkingService } from './knowledgeChunkingService';
import { learningResourceAllocatorService } from './learningResourceAllocatorService';
import { learningRunService } from './learningRunService';
import { capabilityRegistry } from './capabilityRegistry';
import { registerLearningCapabilities } from './learningCapabilities';
import { conversationHistoryService } from './conversationHistoryService';
import { savedMemoryService } from './savedMemoryService';
import { memoryExtractorService } from './memoryExtractorService';
import { learnerStateContextAdapter } from './learnerStateContextAdapter';
import { personalizedWorkspaceIntegrationService } from './personalizedWorkspaceIntegrationService';
import { EditorLayoutNode, EditorState, WorkbenchState } from '../types/workbench';

registerLearningCapabilities();

type TerminalMessage = {
  role: 'user' | 'assistant';
  content: string;
};

interface TerminalChatInput {
  workspaceId: string;
  sessionId?: string | null;
  workbenchId?: string | null;
  messages: TerminalMessage[];
}

interface GuidedWorkbenchInput {
  workspaceId: string;
  goalText: string;
  title?: string;
  mode?: 'quick-start' | 'project' | 'review';
  goalDraft?: Partial<GoalDraft>;
}

interface GoalDraft {
  title: string;
  goalText: string;
  skills: string[];
  weaknesses: string[];
  suggestedMode: 'quick-start' | 'project' | 'review';
}

interface TerminalDraft {
  reply: string;
  goalDraft: GoalDraft;
}

interface GeneratedWorkbenchContent {
  brief: string;
  practice: string;
  plan: string;
  notes: string;
}

const WORKBENCH_CONTENT_TIMEOUT_MS = Number(process.env.AI_WORKBENCH_CONTENT_TIMEOUT_MS || 12000);

const clampTitle = (value: string, fallback: string) => {
  const normalized = value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (normalized || fallback).slice(0, 48);
};

const inferGoalTitle = (goalText: string) => {
  const cleaned = goalText
    .replace(/^(我想|我需要|帮我|请你|想要|希望|学习|学会|掌握)/, '')
    .replace(/[。！？!?]/g, '')
    .trim();

  if (!cleaned) return '新的学习目标';
  return clampTitle(cleaned, '新的学习目标');
};

const getLatestUserMessage = (messages: TerminalMessage[]) =>
  [...messages]
    .reverse()
    .find((message) => message.role === 'user' && message.content.trim().length > 0)
    ?.content.trim() || '';

const extractJsonObject = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || value;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('No JSON object found');
  }

  return JSON.parse(raw.slice(start, end + 1));
};

const normalizeStringArray = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;

  const normalized = value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);

  return normalized.length > 0 ? normalized : fallback;
};

const normalizeMode = (value: unknown, fallback: GoalDraft['suggestedMode']): GoalDraft['suggestedMode'] =>
  value === 'project' || value === 'review' || value === 'quick-start' ? value : fallback;

const buildSkillDraft = (goalText: string, major?: string | null) => {
  const lower = goalText.toLowerCase();
  const isCodeGoal = /代码|编程|项目|实现|python|java|react|pytorch|算法|code/.test(lower);
  const isReviewGoal = /复习|考试|测验|刷题|巩固|review/.test(lower);
  const isPaperGoal = /论文|paper|文献|阅读|综述/.test(lower);

  const skills = isPaperGoal
    ? ['核心概念识别', '论文结构阅读', '关键方法复述', '相关工作对比', '批判性总结']
    : isCodeGoal
      ? ['概念理解', '关键流程拆解', '代码阅读', '动手实现', '调试与复盘']
      : isReviewGoal
        ? ['知识点梳理', '易错点定位', '典型题训练', '错题复盘', '阶段测验']
        : ['先修知识补齐', '核心概念理解', '例题推演', '练习巩固', '迁移应用'];

  const weaknesses = [
    '当前目标还没有足够的学习证据，建议先通过 3-5 个诊断问题建立初始画像',
    major ? `可以优先结合「${major}」方向选择案例和实践材料` : '可以补充你的专业方向，让资源更贴近真实课程',
    '建议把大目标拆成 1-3 个可完成的学习现场，避免一次生成过多资源'
  ];

  return { skills, weaknesses, isCodeGoal, isReviewGoal, isPaperGoal };
};

const buildFallbackGoalDraft = (goalText: string, major?: string | null): GoalDraft => {
  const draft = buildSkillDraft(goalText, major);
  return {
    title: inferGoalTitle(goalText),
    goalText,
    skills: draft.skills,
    weaknesses: draft.weaknesses,
    suggestedMode: draft.isCodeGoal ? 'project' : draft.isReviewGoal ? 'review' : 'quick-start'
  };
};

const buildTerminalPrompt = (params: {
  workspaceName: string;
  major?: string | null;
  fileCount: number;
  workbenchCount: number;
  messages: TerminalMessage[];
  goalText: string;
  savedMemoryContext?: string;
  referenceHistoryContext?: string;
  learnerStateContext?: string;
}) => `你是一个高权限的课程级 AI Terminal，类似 Codex，但服务于启发式学习和 goal-oriented 学习现场搭建。

请基于用户最近输入、Saved memories、可检索历史对话和 Learner State，生成一个可编辑的学习目标草案。你必须只输出 JSON，不要输出 Markdown。

Memory policy:
- Saved memories 是用户明确要求记住或长期稳定的信息，优先遵守。
- Reference chat history 只用于找回以前聊过的相关内容，不要把它当成长期用户偏好。
- Learner State 是短期/中期学习状态，只用于个性化讲解和规划，不要给用户贴固定标签。
- 单次“请用例子解释”只影响当前回复；只有用户明确说“请记住/以后都/我偏好”时，才视为长期记忆。

Workspace:
- 名称: ${params.workspaceName}
- 专业方向: ${params.major || '未指定'}
- 已有资源数: ${params.fileCount}
- 已有学习现场 Workbench 数: ${params.workbenchCount}

${params.savedMemoryContext || 'Saved memories: none.'}

${params.referenceHistoryContext || 'Reference chat history: none.'}

Learner State:
${params.learnerStateContext || 'none'}

最近对话:
${params.messages.slice(-8).map((message) => `${message.role}: ${message.content}`).join('\n')}

用户当前目标:
${params.goalText}

JSON schema:
{
  "reply": "用简体中文给用户的导师式回复，说明你理解了什么、建议下一步怎么创建学习现场。不要超过 220 字。",
  "goalDraft": {
    "title": "48 字以内的学习现场标题",
    "goalText": "整理后的目标描述",
    "skills": ["4 到 6 个目标技能"],
    "weaknesses": ["3 到 5 个初始短板或需要确认的信息"],
    "suggestedMode": "quick-start | project | review"
  }
}`;

const buildWorkbenchContentPrompt = (params: {
  workspaceName: string;
  major?: string | null;
  goalDraft: GoalDraft;
}) => `你是一个多智能体学习资源生成器，需要为新的 Workbench 学习现场生成初始资源。

请只输出 JSON，不要输出 Markdown 代码围栏。所有字段内容本身可以是 Markdown。

Workspace:
- 名称: ${params.workspaceName}
- 专业方向: ${params.major || '未指定'}

目标草案:
${JSON.stringify(params.goalDraft, null, 2)}

JSON schema:
{
  "brief": "# 学习目标蓝图\\n... 包含目标、技能拆解、初始画像、推荐路径",
  "practice": "# 诊断与练习\\n... 包含诊断问题、基础练习、复盘提示",
  "plan": "# 资源生成计划\\n... 包含立即生成、按需生成、资源沉淀位置",
  "notes": "# 学习笔记\\n... 空白但有结构的用户笔记模板"
}`;

const generateTerminalDraftWithModel = async (params: {
  workspaceName: string;
  major?: string | null;
  fileCount: number;
  workbenchCount: number;
  messages: TerminalMessage[];
  goalText: string;
  savedMemoryContext?: string;
  referenceHistoryContext?: string;
  learnerStateContext?: string;
}): Promise<TerminalDraft | null> => {
  if (!aiModelProviderService.isConfigured({ useCase: 'learning' })) return null;

  try {
    const response = await aiModelProviderService.chat([
      {
        role: 'user',
        content: buildTerminalPrompt(params)
      }
    ], { useCase: 'learning' });
    const parsed = extractJsonObject(response.reply);
    const fallback = buildFallbackGoalDraft(params.goalText, params.major);
    const parsedDraft = parsed.goalDraft || {};
    const goalDraft: GoalDraft = {
      title: clampTitle(String(parsedDraft.title || fallback.title), fallback.title),
      goalText: String(parsedDraft.goalText || params.goalText).trim() || params.goalText,
      skills: normalizeStringArray(parsedDraft.skills, fallback.skills),
      weaknesses: normalizeStringArray(parsedDraft.weaknesses, fallback.weaknesses),
      suggestedMode: normalizeMode(parsedDraft.suggestedMode, fallback.suggestedMode)
    };

    return {
      reply: String(parsed.reply || '').trim() || buildFallbackTerminalReply(goalDraft.title, params.workbenchCount, params.fileCount),
      goalDraft
    };
  } catch (error) {
    console.warn('AI terminal draft failed, using fallback:', error);
    return null;
  }
};

const generateWorkbenchContentWithModel = async (params: {
  workspaceName: string;
  major?: string | null;
  goalDraft: GoalDraft;
}): Promise<GeneratedWorkbenchContent | null> => {
  if (!aiModelProviderService.isConfigured({ useCase: 'learning' })) return null;

  try {
    const response = await aiModelProviderService.chat([
      {
        role: 'user',
        content: buildWorkbenchContentPrompt(params)
      }
    ], { useCase: 'learning', timeoutMs: WORKBENCH_CONTENT_TIMEOUT_MS });
    const parsed = extractJsonObject(response.reply);
    const fallback = buildFallbackWorkbenchContent(params.goalDraft, params.workspaceName);

    return {
      brief: String(parsed.brief || fallback.brief),
      practice: String(parsed.practice || fallback.practice),
      plan: String(parsed.plan || fallback.plan),
      notes: String(parsed.notes || fallback.notes)
    };
  } catch (error) {
    console.warn('AI workbench content failed, using fallback:', error);
    return null;
  }
};

const buildFallbackTerminalReply = (title: string, workbenchCount: number, fileCount: number) =>
  [
    `我会把「${title}」当作一个可调整的学习目标草案。`,
    `当前 Workspace 里已有 ${workbenchCount} 个学习现场和 ${fileCount} 份资源。`,
    '我建议先用“蓝图先行、按需生成”的方式：先确认目标与短板，再创建一个带讲解、练习、资源计划和现场助教的 Workbench。',
    '你可以直接创建学习现场，也可以继续告诉我你的时间、基础、想要的产出物。'
  ].join('\n\n');

const buildLearningBrief = (goalText: string, workspaceName: string, skills: string[], weaknesses: string[]) => `# 学习目标蓝图

## 当前目标
${goalText}

## 所属学习空间
${workspaceName}

## 建议拆解的目标技能
${skills.map((skill, index) => `${index + 1}. ${skill}`).join('\n')}

## 初始画像与可能短板
${weaknesses.map((item) => `- ${item}`).join('\n')}

## 推荐学习路径
1. 先用 5 分钟确认目标产出物：理解、考试、项目、论文阅读或面试准备。
2. 完成一轮轻量诊断，标记已掌握、模糊、未知的知识点。
3. 先生成最小必要资源：一份讲解文档、一组练习、一个可操作案例。
4. 在学习现场中边学边记录问题，AI 助教会把问题回流到画像。
5. 完成阶段复盘，再决定是否进入下一个学习现场。

## AI Terminal 的后续建议
- 如果你已经有课件、PDF 或代码，请上传到 Workspace，我会把它们纳入知识库。
- 如果你想快速开始，可以先使用本现场的讲解、练习和资源计划。
- 目标可以随时调整，后续 Workbench 会根据新目标重新组织。
`;

const buildPractice = (goalText: string, skills: string[]) => `# 诊断与练习

## 诊断问题
1. 你能用自己的话解释「${skills[0]}」吗？
2. 在这个目标里，你最不确定的是概念、公式、代码还是应用场景？
3. 如果要做一个小成果，你希望最后产出文档、题目、代码还是演示？

## 基础练习
${skills
  .slice(0, 4)
  .map(
    (skill, index) => `${index + 1}. 围绕「${skill}」写出一个你已经知道的点、一个疑问、一个想看的例子。`
  )
  .join('\n')}

## 复盘提示
- 哪个问题回答最慢？
- 哪个概念需要图解？
- 哪个知识点适合生成代码案例或项目任务？

> 当前练习由 AI 学习总管基于目标「${goalText}」生成，后续可由现场助教继续细化。
`;

const buildResourcePlan = (goalText: string, skills: string[], mode: string) => `# 资源生成计划

## 目标
${goalText}

## 建议立即生成
- 课程讲解文档：围绕 ${skills[0]} 与 ${skills[1] || '核心概念'} 展开。
- 练习题：3 道诊断题 + 3 道基础巩固题。
- 学习笔记模板：记录概念、误区、例子、待追问问题。

## 建议按需生成
- 思维导图：当你需要建立全局结构时生成。
- 代码实操案例：当目标偏实践或项目时生成。
- PPT / 视频脚本：当你需要展示、复述或提交材料时生成。
- 阶段测验：当本 Workbench 完成后生成。

## 当前生成策略
${mode === 'project' ? '项目导向：优先生成代码案例、任务拆解和验收标准。' : mode === 'review' ? '复习导向：优先生成题库、错题复盘和阶段测验。' : '快速入门：先生成讲解、练习和最小案例。'}

## 资源沉淀位置
本现场生成的资源会保存到当前 Workbench 根目录下的 Generated 文件夹，并自动打开在学习现场中。
`;

const buildFallbackWorkbenchContent = (
  goalDraft: Pick<GoalDraft, 'goalText' | 'title' | 'skills' | 'weaknesses' | 'suggestedMode'>,
  workspaceName: string
): GeneratedWorkbenchContent => ({
  brief: buildLearningBrief(goalDraft.goalText, workspaceName, goalDraft.skills, goalDraft.weaknesses),
  practice: buildPractice(goalDraft.goalText, goalDraft.skills),
  plan: buildResourcePlan(goalDraft.goalText, goalDraft.skills, goalDraft.suggestedMode),
  notes: `# ${goalDraft.title} 学习笔记\n\n## 我的目标\n${goalDraft.goalText}\n\n## 我已经理解的内容\n\n## 我还不确定的问题\n\n## 下一步行动\n`
});

const makeEditor = (
  id: string,
  type: EditorState['type'],
  title: string,
  zIndex: number,
  resource?: { id: string; path: string; name: string; fileCategory?: string | null; extension?: string | null }
): EditorState => ({
  id,
  type,
  title,
  resourceId: resource?.id,
  resourcePath: resource?.path,
  x: 48,
  y: 48,
  w: type === 'ai' || type === 'notes' ? 420 : 460,
  h: 320,
  zIndex,
  minimized: false,
  viewState:
    type === 'ai'
      ? {
          messages: [
            {
              role: 'assistant',
              content:
                '我已经接入这个学习现场。你可以让我解释当前资源、继续生成练习、整理笔记，或根据你的反馈调整目标。'
            }
          ],
          scope: 'guided-workbench'
        }
      : resource
        ? {
            resourceName: resource.name,
            resourceType: resource.fileCategory || resource.extension || 'generated',
            generatedBy: 'AI Terminal',
            mode: type === 'notes' ? 'preview' : undefined,
            blocksuiteMode: type === 'notes' ? 'page' : undefined,
            blocksuiteSnapshot: null
          }
        : {
            content: '',
            placeholder: '记录你的理解、疑问和下一步行动...',
            blocksuiteMode: 'page',
            blocksuiteSnapshot: null
          }
});

const buildWorkbenchLayout = (
  briefEditorId: string,
  practiceEditorId: string,
  planEditorId: string,
  notesEditorId: string,
  aiEditorId: string
): EditorLayoutNode => ({
  id: 'guided-root',
  type: 'split',
  direction: 'row',
  ratio: 0.62,
  children: [
    {
      id: 'guided-left',
      type: 'split',
      direction: 'column',
      ratio: 0.55,
      children: [
        {
          id: 'guided-brief-pane',
          type: 'leaf',
          editorIds: [briefEditorId, planEditorId],
          activeEditorId: briefEditorId
        },
        {
          id: 'guided-practice-pane',
          type: 'leaf',
          editorIds: [practiceEditorId],
          activeEditorId: practiceEditorId
        }
      ]
    },
    {
      id: 'guided-right',
      type: 'split',
      direction: 'column',
      ratio: 0.5,
      children: [
        {
          id: 'guided-notes-pane',
          type: 'leaf',
          editorIds: [notesEditorId],
          activeEditorId: notesEditorId
        },
        {
          id: 'guided-ai-pane',
          type: 'leaf',
          editorIds: [aiEditorId],
          activeEditorId: aiEditorId
        }
      ]
    }
  ]
});

class LearningOrchestrationService {
  async chat(input: TerminalChatInput) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      include: {
        fileObjects: true
      }
    });

    if (!workspace) {
      throw new Error('Workspace not found');
    }

    const workbenches = await workbenchService.listByWorkspace(input.workspaceId);
    const goalText = getLatestUserMessage(input.messages) || `学习 ${workspace.name}`;
    const fileCount = workspace.fileObjects.filter((file) => file.nodeType === 'file').length;
    const [savedMemoryContext, learnerAgentContext, retrievedHistory, workspaceIntegration] = await Promise.all([
      savedMemoryService.promptContext({ workspaceId: input.workspaceId, limit: 8 }),
      learnerStateContextAdapter.build({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        audience: 'tutor',
        tokenBudget: 900
      }),
      conversationHistoryService.retrieve({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        userId: workspace.userId,
        currentSessionId: input.sessionId || null,
        query: goalText,
        limit: 6
      }),
      personalizedWorkspaceIntegrationService.build({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        query: goalText
      }).catch(() => null)
    ]);
    const referenceHistoryContext = conversationHistoryService.formatRetrieved(retrievedHistory);
    const modelDraft = await generateTerminalDraftWithModel({
      workspaceName: workspace.name,
      major: workspace.major,
      fileCount,
      workbenchCount: workbenches.length,
      messages: input.messages,
      goalText,
      savedMemoryContext,
      referenceHistoryContext,
      learnerStateContext: learnerAgentContext.promptContext
    });
    const fallbackDraft = buildFallbackGoalDraft(goalText, workspace.major);
    const terminalDraft: TerminalDraft = modelDraft || {
      reply: buildFallbackTerminalReply(fallbackDraft.title, workbenches.length, fileCount),
      goalDraft: fallbackDraft
    };

    const savedTurn = await conversationHistoryService.saveTurn({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      userId: workspace.userId,
      sessionId: input.sessionId || null,
      title: goalText,
      source: 'terminal',
      messages: input.messages,
      assistantReply: terminalDraft.reply
    });
    const memoryExtraction = await memoryExtractorService.apply({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      userId: workspace.userId,
      messages: input.messages,
      answer: terminalDraft.reply,
      sourceId: savedTurn.sessionId
    });

    await learningMemoryService.recordEvent({
      workspaceId: input.workspaceId,
      eventType: 'terminal.goal_draft_created',
      actor: 'assistant',
      payload: {
        goalText,
        goalDraft: terminalDraft.goalDraft,
        source: modelDraft ? 'model' : 'fallback',
        sessionId: savedTurn.sessionId,
        retrievedHistoryCount: retrievedHistory.length,
        memoryExtraction: {
          savedMemory: Boolean(memoryExtraction.savedMemory),
          signals: memoryExtraction.extraction.learnerStateSignals.length,
          shouldAskUserToSave: memoryExtraction.extraction.shouldAskUserToSave
        }
      }
    });

    return {
      sessionId: savedTurn.sessionId,
      reply: terminalDraft.reply,
      goalDraft: terminalDraft.goalDraft,
      memoryContext: {
        savedMemoryContext,
        referenceHistory: retrievedHistory,
        learnerStateSummary: learnerAgentContext.summary,
        workspaceIntegration
      },
      suggestedActions: [
        ...(workspaceIntegration?.taskRecommendations?.slice(0, 2).map((task: any) => ({
          id: `next-task-${task.id}`,
          label: task.title,
          description: task.reason
        })) || []),
        {
          id: 'create-guided-workbench',
          label: '创建学习现场',
          description: '生成目标蓝图、练习、资源计划，并自动打开 Workbench'
        },
        {
          id: 'summarize-workspace',
          label: '总结当前进度',
          description: '查看已有学习现场和资源状态'
        }
      ]
    };
  }

  async createGuidedWorkbench(input: GuidedWorkbenchInput) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId }
    });

    if (!workspace) {
      throw new Error('Workspace not found');
    }

    const fallbackDraft = buildFallbackGoalDraft(input.goalText, workspace.major);
    const goalDraft: GoalDraft = {
      ...fallbackDraft,
      title: clampTitle(input.title || input.goalDraft?.title || fallbackDraft.title, '课程学习整理'),
      goalText: String(input.goalDraft?.goalText || input.goalText).trim() || input.goalText,
      skills: normalizeStringArray(input.goalDraft?.skills, fallbackDraft.skills),
      weaknesses: normalizeStringArray(input.goalDraft?.weaknesses, fallbackDraft.weaknesses),
      suggestedMode: input.mode || normalizeMode(input.goalDraft?.suggestedMode, fallbackDraft.suggestedMode)
    };
    const generatedContent =
      (await generateWorkbenchContentWithModel({
        workspaceName: workspace.name,
        major: workspace.major,
        goalDraft
      })) || buildFallbackWorkbenchContent(goalDraft, workspace.name);
    const resourceAllocation = learningResourceAllocatorService.allocate({
      mode: goalDraft.suggestedMode,
      skills: goalDraft.skills
    });

    const learningGoal = await learningMemoryService.createGoal({
      workspaceId: input.workspaceId,
      title: goalDraft.title,
      goalText: goalDraft.goalText,
      skills: goalDraft.skills,
      weaknesses: goalDraft.weaknesses,
      mode: goalDraft.suggestedMode,
      plan: {
        resourceAllocation
      }
    });

    const workbench = await workbenchService.create(input.workspaceId, {
      title: goalDraft.title,
      description: goalDraft.goalText
    });
    await learningMemoryService.attachGoalToWorkbench(learningGoal.id, workbench.id);
    const run = await learningRunService.startRun({
      workspaceId: input.workspaceId,
      workbenchId: workbench.id,
      goalId: learningGoal.id,
      intent: 'create-guided-workbench',
      input: { goalDraft, resourceAllocation }
    });
    await capabilityRegistry.execute(
      'diagnosis',
      { skills: goalDraft.skills },
      { runId: run.id, workspaceId: input.workspaceId, workbenchId: workbench.id, goalId: learningGoal.id }
    );

    const brief = await FileSystemService.saveGeneratedContent({
      workspaceId: input.workspaceId,
      targetDir: 'Generated',
      filename: '01-learning-brief.md',
      category: 'generated',
      workbenchId: workbench.id,
      resourceRole: 'generated',
      resourceType: 'generated',
      scope: 'workbench',
      origin: 'ai',
      indexInBackground: true,
      content: generatedContent.brief
    });
    const practice = await FileSystemService.saveGeneratedContent({
      workspaceId: input.workspaceId,
      targetDir: 'Generated',
      filename: '02-diagnostic-practice.md',
      category: 'generated',
      workbenchId: workbench.id,
      resourceRole: 'generated',
      resourceType: 'generated',
      scope: 'workbench',
      origin: 'ai',
      indexInBackground: true,
      content: generatedContent.practice
    });
    const plan = await FileSystemService.saveGeneratedContent({
      workspaceId: input.workspaceId,
      targetDir: 'Generated',
      filename: '03-resource-plan.md',
      category: 'generated',
      workbenchId: workbench.id,
      resourceRole: 'generated',
      resourceType: 'generated',
      scope: 'workbench',
      origin: 'ai',
      indexInBackground: true,
      content: generatedContent.plan
    });
    const notes = await FileSystemService.saveGeneratedContent({
      workspaceId: input.workspaceId,
      targetDir: 'Files',
      filename: 'learning-notes.md',
      category: 'note',
      workbenchId: workbench.id,
      resourceRole: 'note',
      resourceType: 'note',
      scope: 'workbench',
      origin: 'ai',
      indexInBackground: true,
      content: generatedContent.notes
    });

    const briefEditorId = `editor-${crypto.randomUUID()}`;
    const practiceEditorId = `editor-${crypto.randomUUID()}`;
    const planEditorId = `editor-${crypto.randomUUID()}`;
    const notesEditorId = `editor-${crypto.randomUUID()}`;
    const aiEditorId = `editor-${crypto.randomUUID()}`;

    const editors = [
      makeEditor(briefEditorId, 'notes', brief.name, 1, brief),
      makeEditor(practiceEditorId, 'notes', practice.name, 2, practice),
      makeEditor(planEditorId, 'notes', plan.name, 3, plan),
      makeEditor(notesEditorId, 'notes', notes.name, 4, notes),
      makeEditor(aiEditorId, 'ai', 'AI 现场助教', 5)
    ];

    const state: WorkbenchState = {
      workbenchId: workbench.id,
      editors,
      layoutMode: 'freeform',
      activeEditorId: briefEditorId,
      activeEditorPaneId: 'guided-brief-pane',
      editorLayout: buildWorkbenchLayout(briefEditorId, practiceEditorId, planEditorId, notesEditorId, aiEditorId),
      version: 1
    };

    const savedWorkbench = await workbenchService.saveState(workbench.id, state);
    const generatedResources = [brief, practice, plan, notes];
    const knowledgeChunks = await knowledgeChunkingService.indexGeneratedResources(generatedResources);
    await capabilityRegistry.execute(
      'knowledge_retrieval',
      { query: goalDraft.goalText, limit: 6 },
      { runId: run.id, workspaceId: input.workspaceId, workbenchId: workbench.id, goalId: learningGoal.id }
    );

    await learningMemoryService.recordEvent({
      workspaceId: input.workspaceId,
      workbenchId: workbench.id,
      goalId: learningGoal.id,
      eventType: 'workbench.guided_created',
      actor: 'assistant',
      payload: {
        goalDraft,
        generatedResourceIds: generatedResources.map((resource) => resource.id),
        knowledgeChunkCount: knowledgeChunks.length
      }
    });

    await learningMemoryService.createTrace({
      workspaceId: input.workspaceId,
      workbenchId: workbench.id,
      goalId: learningGoal.id,
      summary: `创建学习现场「${goalDraft.title}」，初始目标为：${goalDraft.goalText}`,
      mastery: {
        status: 'initial',
        skills: goalDraft.skills.map((skill) => ({ skill, evidence: 'pending_diagnosis' }))
      },
      nextActions: [
        '完成诊断与练习中的 3 个问题',
        '在学习笔记中记录已理解内容和疑问',
        '根据资源生成计划决定是否继续生成案例、测验或讲解'
      ]
    });
    await learningRunService.completeRun(run.id, {
      workbenchId: workbench.id,
      generatedResourceIds: generatedResources.map((resource) => resource.id),
      knowledgeChunkCount: knowledgeChunks.length
    });

    return {
      workbench: savedWorkbench || workbench,
      generatedResources,
      goalDraft
    };
  }
}

export const learningOrchestrationService = new LearningOrchestrationService();

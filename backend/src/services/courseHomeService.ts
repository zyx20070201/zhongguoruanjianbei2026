import prisma from '../config/db';

export interface CourseHomeSummary {
  latestTopic: string;
  latestActivitySummary: string;
  coursePosition: string[];
  reinforcementReminders: Array<{
    label: string;
    prompt: string;
  }>;
  aiActions: Array<{
    label: string;
    prompt: string;
  }>;
  generatedBy: 'context-fallback';
}

const cleanList = (value: unknown, limit: number) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => !/signals?|confidence|candidate weak|debug|embedding|reranker/i.test(item))
    .slice(0, limit);
};

const stripInternalText = (value: string) =>
  value
    .replace(/MCL\s*Planner\s*输出\s*v?\d*\s*计划[:：]?/gi, '')
    .replace(/agent|signals?|confidence|candidate weak|debug|embedding|reranker/gi, '')
    .replace(/计划[:：]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const inferTopic = (value: string, fallback: string) => {
  const text = stripInternalText(value).replace(/\s+/g, '');
  if (/软件项目管理.*计划过程|计划过程|持续策划|滚动计划|WBS|网络计划/.test(text)) return '软件项目计划过程';
  if (/软件项目.*风险/.test(text)) return '软件项目风险管理';
  if (/软件项目.*特点|软件项目.*特性/.test(text)) return '软件项目特性概览';
  const match = text.match(/[\u4e00-\u9fa5A-Za-z0-9]{4,16}/);
  return match?.[0] || fallback;
};

const summaryFrom = (topic: string, raw: string) => {
  const text = stripInternalText(raw);
  if (/软件项目计划|计划过程|持续策划|滚动计划|WBS|网络计划/.test(text)) {
    return '你上次主要在整理软件项目管理中“计划过程”的核心概念，包括持续策划、滚动计划、WBS 和网络计划。';
  }
  if (/软件项目.*特点|软件项目.*特性/.test(text)) {
    return '你上次主要在梳理软件项目的基本特点，并尝试把概念和课程例子对应起来。';
  }
  if (/软件项目.*风险/.test(text)) {
    return '你上次主要在梳理软件项目风险的来源、表现和应对思路。';
  }
  return text ? `你上次主要在整理「${topic}」相关内容：${text.slice(0, 72)}。` : `你上次主要在推进「${topic}」相关学习。`;
};

const fallbackActions = (topic: string): CourseHomeSummary['aiActions'] => [
  { label: topic.includes('计划') ? '解释 WBS' : `解释${topic.slice(0, 8)}`, prompt: `请结合当前课程资料，用一个例子解释「${topic}」中的关键概念。` },
  { label: topic.includes('计划') ? '生成项目计划复习题' : `生成${topic.slice(0, 8)}练习题`, prompt: `请基于当前 workspace 的资料，为「${topic}」设计 5 道循序渐进的练习题，并给出答案解析。` },
  { label: topic.includes('计划') ? '整理计划过程思维导图' : `整理${topic.slice(0, 8)}思维导图`, prompt: `请把「${topic}」整理成一份层次清楚的思维导图大纲。` }
];

const microTasks = (topic: string, actions: string[]): CourseHomeSummary['reinforcementReminders'] => {
  if (topic.includes('计划')) {
    return [
      { label: '用一个例子解释持续策划', prompt: '请用一个软件项目例子解释持续策划和滚动计划的区别。' },
      { label: '做 3 道计划过程辨析题', prompt: '请围绕软件项目计划过程、WBS、网络计划生成 3 道辨析题，并在我回答后批改。' },
      { label: '整理 WBS 与网络计划对比表', prompt: '请整理 WBS 与网络计划的用途、输入输出和适用场景对比表。' }
    ];
  }

  const fromActions = actions.slice(0, 3).map((action) => ({
    label: action.length > 18 ? action.slice(0, 18) : action,
    prompt: `请带我完成这个微任务：${action}`
  }));

  return fromActions.length ? fromActions : [
    { label: `复述${topic.slice(0, 8)}核心概念`, prompt: `请用提问方式帮我复述「${topic}」的核心概念。` },
    { label: `做 3 道${topic.slice(0, 6)}小题`, prompt: `请围绕「${topic}」出 3 道小题并逐题反馈。` }
  ];
};

export class CourseHomeService {
  async build(input: { workspaceId: string; workbenchId?: string | null }): Promise<CourseHomeSummary> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      include: {
        workbenches: { orderBy: { updatedAt: 'desc' }, take: 5 },
        fileObjects: { where: { nodeType: 'file' }, orderBy: { updatedAt: 'desc' }, take: 5 },
        learningGoals: { orderBy: { updatedAt: 'desc' }, take: 3 }
      }
    });

    if (!workspace) throw new Error('Workspace not found');

    const latestWorkbench = input.workbenchId
      ? workspace.workbenches.find((item) => item.id === input.workbenchId) || workspace.workbenches[0]
      : workspace.workbenches[0];

    const [traces, events] = await Promise.all([
      prisma.learningTrace.findMany({
        where: {
          workspaceId: workspace.id,
          ...(latestWorkbench?.id ? { workbenchId: latestWorkbench.id } : {})
        },
        orderBy: { updatedAt: 'desc' },
        take: 4
      }),
      prisma.learningEvent.findMany({
        where: {
          workspaceId: workspace.id,
          ...(latestWorkbench?.id ? { workbenchId: latestWorkbench.id } : {})
        },
        orderBy: { createdAt: 'desc' },
        take: 4
      })
    ]);

    const goal = workspace.learningGoals[0] || null;
    const latestTrace = traces[0];
    const seed = `${latestWorkbench?.title || ''} ${latestWorkbench?.description || ''} ${goal?.goalText || ''} ${latestTrace?.summary || ''}`;
    const topic = inferTopic(seed, latestWorkbench?.title || goal?.title || workspace.name);
    const parseNextActions = (value?: string | null) => {
      if (!value) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
      } catch {
        return [];
      }
    };
    const nextActions = traces.flatMap((trace) => parseNextActions(trace.nextActionsJson)).slice(0, 3);
    const rawLatestSummary =
      latestTrace?.summary ||
      latestWorkbench?.description ||
      (events[0] ? `最近活动来自「${latestWorkbench?.title || workspace.name}」，可以从上次保存的位置继续。` : '当前课程资料和学习现场已经同步。');

    const fileNames = workspace.fileObjects.map((file) => file.name).slice(0, 3);
    const summary: CourseHomeSummary = {
      latestTopic: topic,
      latestActivitySummary: summaryFrom(topic, rawLatestSummary),
      coursePosition: [
        `最近主题：${topic}`,
        goal?.goalText ? `当前目标是：${goal.goalText}` : `已有 ${workspace.fileObjects.length} 份课程资料可用于继续学习。`,
        nextActions[0] ? `下一步可以先做：${nextActions[0]}` : '可以从最近打开的学习现场继续。'
      ],
      reinforcementReminders: microTasks(topic, [
        ...nextActions,
        ...fileNames.map((name) => `回看「${name}」里和「${topic}」相关的部分。`)
      ]),
      aiActions: fallbackActions(topic),
      generatedBy: 'context-fallback'
    };

    return {
      ...summary,
      coursePosition: cleanList(summary.coursePosition, 3),
      reinforcementReminders: summary.reinforcementReminders.slice(0, 3),
      aiActions: summary.aiActions.slice(0, 4)
    };
  }
}

export const courseHomeService = new CourseHomeService();

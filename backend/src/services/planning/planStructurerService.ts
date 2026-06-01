import { aiModelProviderService } from '../aiModelProviderService';
import {
  StructuredLearningPlan,
  StructuredLearningPlanStage,
  StructuredLearningPlanType
} from '../planningTypes';

const PLAN_STRUCTURER_TIMEOUT_MS = Number(process.env.MCL_PLAN_STRUCTURER_TIMEOUT_MS || 90000);

type MarkdownSlice = {
  title: string;
  content: string;
};

type SliceModelResponse = {
  title?: string;
  slices?: MarkdownSlice[];
};

const cleanString = (value: unknown, fallback = '') => String(value ?? fallback).replace(/\s+/g, ' ').trim();

const inferPlanType = (objective: string, markdown: string): StructuredLearningPlanType => {
  const text = `${objective}\n${markdown}`;
  const hasTime = /每天|每周|分钟|小时|两周|一周|一个月|天内|周内/.test(text);
  const hasExam = /考试|备考|复习|期末|考研|四级|测验/.test(text);
  const hasProject = /项目|系统|开发|博客|App|应用|模块|交付/.test(text);
  const hasWeakness = /已经会|但.*差|薄弱|不会|不懂|补弱|弱/.test(text);
  const count = [hasTime, hasExam, hasProject, hasWeakness].filter(Boolean).length;
  if (count > 1) return 'mixed';
  if (hasExam) return 'exam';
  if (hasProject) return 'project';
  if (hasWeakness) return 'weakness_focused';
  if (hasTime) return 'time_limited';
  return 'normal';
};

const sliceSchema = {
  type: 'object',
  required: ['title', 'slices'],
  properties: {
    title: { type: 'string' },
    slices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title: { type: 'string' },
          content: { type: 'string' }
        }
      }
    }
  }
};

const buildSlicePrompt = () => [
  '你只负责把一份 Markdown 学习计划切成若干段。',
  '不要重写计划，不要总结，不要压缩，不要润色，不要新增学习内容。',
  '每一段只包含两个字段：title 和 content。',
  'title 是这一段的标题；content 是这一段对应的完整正文，尽量保留原文措辞、列表、顺序和细节。',
  '如果原文有逐天安排，按天切片；如果原文有阶段标题，按阶段切片；如果两者都有，优先保留更细的逐天或逐步切片。',
  '不要输出 overview、tasks、doneWhen、标签、过关标准等额外字段。',
  '只输出 JSON。'
].join('\n');

const titleFromMarkdown = (markdown: string, fallback: string) => {
  const heading = markdown.match(/^\s*#{1,3}\s+(.+)$/m)?.[1]?.trim();
  return cleanString(heading || fallback || '学习计划');
};

const emptyPlan = (objective: string, planMarkdown: string, error?: unknown): StructuredLearningPlan => ({
  title: cleanString(objective, '学习计划'),
  objective,
  overview: {
    goalUnderstanding: '',
    learnerContext: '',
    overallPath: '',
    planType: 'normal'
  },
  stages: [],
  actionPlan: [],
  commonProblems: [],
  masteryCriteria: [],
  rawMarkdown: planMarkdown,
  parseFailed: true,
  parseError: error instanceof Error ? error.message : error ? String(error) : 'planMarkdown is empty'
});

const sliceToStage = (slice: MarkdownSlice, index: number): StructuredLearningPlanStage => ({
  order: index + 1,
  title: cleanString(slice.title, `片段 ${index + 1}`),
  display: {
    narrative: cleanString(slice.content || slice.title),
    tags: [],
    summary: cleanString(slice.content || slice.title),
    focusTags: []
  },
  detail: {
    narrative: cleanString(slice.content || slice.title),
    practiceTasks: [],
    completionCriteria: [],
    rawFields: {
      learningGoal: '',
      coreContent: [],
      howToLearn: '',
      practiceTasks: [],
      completionCriteria: []
    },
    learningGoal: '',
    coreContent: [],
    howToLearn: ''
  }
});

export class PlanStructurerService {
  async structure(input: { objective: string; planMarkdown: string }): Promise<StructuredLearningPlan> {
    const objective = cleanString(input.objective);
    const planMarkdown = String(input.planMarkdown || '');
    if (!planMarkdown.trim()) {
      return emptyPlan(objective, planMarkdown);
    }

    if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
      return emptyPlan(objective, planMarkdown, new Error('AI planner provider is not configured; PlanStructurer cannot run.'));
    }

    let response: { data?: SliceModelResponse };
    try {
      response = await aiModelProviderService.json<SliceModelResponse>({
        instruction: buildSlicePrompt(),
        schema: sliceSchema,
        input: {
          objective,
          planMarkdown
        },
        useCase: 'planner',
        timeoutMs: PLAN_STRUCTURER_TIMEOUT_MS
      });
    } catch (error) {
      return emptyPlan(objective, planMarkdown, error);
    }

    const rawSlices = Array.isArray(response.data?.slices) ? response.data.slices : [];
    const slices = rawSlices
      .map((slice) => ({
        title: cleanString(slice?.title),
        content: cleanString(slice?.content)
      }))
      .filter((slice) => slice.title || slice.content);

    if (!slices.length) {
      return emptyPlan(objective, planMarkdown, new Error('Model returned no slices'));
    }

    const title = cleanString(response.data?.title, titleFromMarkdown(planMarkdown, objective));
    return {
      title,
      objective,
      overview: {
        goalUnderstanding: title,
        learnerContext: '',
        overallPath: '',
        planType: inferPlanType(objective, planMarkdown)
      },
      stages: slices.map(sliceToStage),
      actionPlan: [],
      commonProblems: [],
      masteryCriteria: [],
      rawMarkdown: planMarkdown
    };
  }
}

export const planStructurerService = new PlanStructurerService();

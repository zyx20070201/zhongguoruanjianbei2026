import prisma from '../../config/db';
import { aiModelProviderService } from '../aiModelProviderService';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const cleanString = (value: unknown, fallback = '') => String(value ?? fallback).replace(/\s+/g, ' ').trim();
const stageIdFor = (stage: Record<string, any>, index: number) => String(stage.id || `structured-${stage.order || index + 1}`);
const stageContent = (stage: Record<string, any>) =>
  String(stage.detail?.narrative || stage.display?.narrative || stage.display?.summary || '').trim();

const supportForStage = (snapshot: Record<string, any>, index: number) => {
  const compiler = snapshot.planningQueryCompiler || {};
  const enhancements = snapshot.planningEnhancements || {};
  const signal = Array.isArray(compiler.stageSignals) ? compiler.stageSignals[index] : null;
  const grounding = Array.isArray(enhancements.resourceGrounding?.grounding?.stageGroundings)
    ? enhancements.resourceGrounding.grounding.stageGroundings[index]
    : null;
  const kg = enhancements.kgAlignment || {};
  return {
    concepts: Array.isArray(signal?.concepts) ? signal.concepts.slice(0, 8) : Array.isArray(kg.matchedConcepts) ? kg.matchedConcepts.slice(0, 8) : [],
    resources: Array.isArray(grounding?.matches)
      ? grounding.matches.slice(0, 4).map((item: any) => ({
          title: cleanString(item.resourceTitle || item.title),
          unit: cleanString(item.resourceUnitTitle || item.unit),
          reason: cleanString(item.reason)
        }))
      : [],
    resourceGap: cleanString(grounding?.gapReason || grounding?.neededResource),
    missingConcepts: Array.isArray(kg.missingConcepts) ? kg.missingConcepts.slice(0, 8) : []
  };
};

const patchSchema = {
  type: 'object',
  required: ['summary', 'title', 'content', 'rationale', 'risks'],
  properties: {
    summary: { type: 'string' },
    title: { type: 'string' },
    content: { type: 'string' },
    rationale: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } }
  }
};

const reviewSchema = {
  type: 'object',
  required: ['summary', 'suggestions'],
  properties: {
    summary: { type: 'string' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['stageId', 'stageTitle', 'issue', 'recommendation', 'priority'],
        properties: {
          stageId: { type: 'string' },
          stageTitle: { type: 'string' },
          issue: { type: 'string' },
          recommendation: { type: 'string' },
          priority: { type: 'string' }
        }
      }
    }
  }
};

type StageChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type PlanChatMessage = StageChatMessage;

export class PlanGovernanceService {
  private async loadPlan(workspaceId: string, planId: string) {
    const plan = await prisma.learningPlan.findFirst({
      where: { id: planId, workspaceId }
    });
    if (!plan) return null;
    const snapshot = parseJson<Record<string, any>>(plan.knowledgeGraphSnapshotJson, {});
    const structuredPlan = snapshot.structuredPlan && typeof snapshot.structuredPlan === 'object'
      ? snapshot.structuredPlan as Record<string, any>
      : null;
    return { plan, snapshot, structuredPlan };
  }

  async proposeStagePatch(input: {
    workspaceId: string;
    planId: string;
    stageId: string;
    instruction?: string;
  }) {
    const loaded = await this.loadPlan(input.workspaceId, input.planId);
    if (!loaded?.structuredPlan || !Array.isArray(loaded.structuredPlan.stages)) return null;
    const stages = loaded.structuredPlan.stages as Array<Record<string, any>>;
    const stageIndex = stages.findIndex((stage, index) => stageIdFor(stage, index) === input.stageId);
    if (stageIndex < 0) throw new Error(`Structured plan stage not found: ${input.stageId}`);
    const stage = stages[stageIndex];
    const support = supportForStage(loaded.snapshot, stageIndex);

    if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
      return {
        proposal: {
          id: crypto.randomUUID(),
          type: 'stage_patch',
          stageId: input.stageId,
          summary: 'AI planner provider is not configured.',
          title: cleanString(stage.title, `Stage ${stageIndex + 1}`),
          content: stageContent(stage),
          rationale: 'No model was available, so the original stage is preserved.',
          risks: ['未接入 planner provider，无法生成局部优化建议。'],
          createdAt: new Date().toISOString()
        }
      };
    }

    const response = await aiModelProviderService.json<{
      summary?: string;
      title?: string;
      content?: string;
      rationale?: string;
      risks?: string[];
    }>({
      instruction: [
        '你是学习计划治理助手，只做局部 stage patch。',
        '保留原计划的目标和阶段边界，不要重新规划整份计划。',
        '字段要少：只返回 title、content、summary、rationale、risks。',
        'content 用自然 Markdown 写，保持可读；不要输出表格；不要暴露 KG、grounding、compiler 等内部术语。',
        '如果资料或知识点有缺口，要自然写成“需要补充资料/练习”的行动建议。'
      ].join('\n'),
      schema: patchSchema,
      input: {
        objective: loaded.plan.objective,
        planTitle: loaded.structuredPlan.title,
        stage: {
          id: input.stageId,
          title: stage.title,
          content: stageContent(stage)
        },
        support,
        userInstruction: input.instruction || '让这个阶段更清晰、更可执行。'
      },
      useCase: 'planner',
      timeoutMs: 90000
    });

    const data = response.data || {};
    return {
      proposal: {
        id: crypto.randomUUID(),
        type: 'stage_patch',
        stageId: input.stageId,
        summary: cleanString(data.summary, '已生成局部优化建议。'),
        title: cleanString(data.title, stage.title || `Stage ${stageIndex + 1}`),
        content: String(data.content || stageContent(stage)).trim(),
        rationale: cleanString(data.rationale),
        risks: Array.isArray(data.risks) ? data.risks.map((item) => cleanString(item)).filter(Boolean).slice(0, 5) : [],
        createdAt: new Date().toISOString()
      }
    };
  }

  async explainStage(input: {
    workspaceId: string;
    planId: string;
    stageId: string;
    question?: string;
    history?: StageChatMessage[];
  }) {
    const loaded = await this.loadPlan(input.workspaceId, input.planId);
    if (!loaded?.structuredPlan || !Array.isArray(loaded.structuredPlan.stages)) return null;
    const stages = loaded.structuredPlan.stages as Array<Record<string, any>>;
    const stageIndex = stages.findIndex((stage, index) => stageIdFor(stage, index) === input.stageId);
    if (stageIndex < 0) throw new Error(`Structured plan stage not found: ${input.stageId}`);
    const stage = stages[stageIndex];
    const support = supportForStage(loaded.snapshot, stageIndex);
    const compactStages = stages.map((item, index) => ({
      order: item.order || index + 1,
      title: cleanString(item.title, `Stage ${index + 1}`),
      summary: cleanString(item.display?.summary || item.display?.narrative || stageContent(item)).slice(0, 280)
    }));
    const recentHistory = Array.isArray(input.history)
      ? input.history
          .filter((message) => message?.role === 'user' || message?.role === 'assistant')
          .slice(-4)
          .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${cleanString(message.content).slice(0, 500)}`)
      : [];

    if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
      return {
        reply: 'AI planner provider is not configured. 当前阶段主要围绕该阶段标题和内容推进，建议先按阶段描述完成核心概念理解，再检查是否满足完成标准。',
        model: null,
        provider: null,
        usage: null
      };
    }

    const prompt = [
      '你是学习计划解释助手。只解释当前学习计划中的一个阶段。',
      '回答要简洁，面向学习者，不要暴露 KG、grounding、compiler、内部字段等系统术语。',
      '优先回答用户问题；如果问题为空，解释该阶段主要做什么、为什么放在这里、如何完成。',
      '不要重新规划整份计划，不要输出表格，不要添加无关自测题。',
      '',
      `学习目标：${cleanString(loaded.plan.objective, '未命名目标')}`,
      `计划标题：${cleanString(loaded.structuredPlan.title || loaded.plan.objective, '学习计划')}`,
      '',
      '整体路线：',
      compactStages.map((item) => `${item.order}. ${item.title}${item.summary ? `：${item.summary}` : ''}`).join('\n'),
      '',
      '当前阶段：',
      `序号：${stage.order || stageIndex + 1}`,
      `标题：${cleanString(stage.title, `Stage ${stageIndex + 1}`)}`,
      `内容：${stageContent(stage).slice(0, 1800) || cleanString(stage.display?.summary)}`,
      Array.isArray(stage.detail?.completionCriteria) && stage.detail.completionCriteria.length
        ? `完成标准：${stage.detail.completionCriteria.map((item: unknown) => cleanString(item)).filter(Boolean).slice(0, 5).join('；')}`
        : '',
      '',
      '计划依据摘要：',
      support.concepts.length ? `相关知识点：${support.concepts.map(cleanString).filter(Boolean).slice(0, 8).join('、')}` : '相关知识点：未明确',
      support.missingConcepts.length ? `可能缺口：${support.missingConcepts.map(cleanString).filter(Boolean).slice(0, 6).join('、')}` : '',
      support.resourceGap ? `资料缺口：${support.resourceGap}` : '',
      '',
      recentHistory.length ? `最近对话：\n${recentHistory.join('\n')}` : '',
      `用户问题：${cleanString(input.question) || '请解释这个阶段主要要做什么。'}`
    ].filter(Boolean).join('\n');

    const response = await aiModelProviderService.chat([{ role: 'user', content: prompt }], {
      useCase: 'planner',
      timeoutMs: 45000
    });

    return {
      reply: response.reply,
      model: response.model,
      provider: response.provider,
      usage: response.usage || null
    };
  }

  async explainPlan(input: {
    workspaceId: string;
    planId: string;
    question?: string;
    history?: PlanChatMessage[];
  }) {
    const loaded = await this.loadPlan(input.workspaceId, input.planId);
    if (!loaded?.structuredPlan || !Array.isArray(loaded.structuredPlan.stages)) return null;
    const stages = loaded.structuredPlan.stages as Array<Record<string, any>>;
    const compactStages = stages.map((stage, index) => ({
      order: stage.order || index + 1,
      title: cleanString(stage.title, `Stage ${index + 1}`),
      summary: cleanString(stage.display?.summary || stage.display?.narrative || stageContent(stage)).slice(0, 220)
    }));
    const recentHistory = Array.isArray(input.history)
      ? input.history
          .filter((message) => message?.role === 'user' || message?.role === 'assistant')
          .slice(-4)
          .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${cleanString(message.content).slice(0, 400)}`)
      : [];

    if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
      return {
        reply: 'AI planner provider is not configured. 这条路线一般会先搭基础，再推进核心任务，最后用练习或产出收束。',
        model: null,
        provider: null,
        usage: null
      };
    }

    const prompt = [
      '你是学习计划解释助手。只解释这整条学习路线为什么这样安排。',
      '回答要简洁、直接、面向学习者。',
      '不要暴露 KG、grounding、compiler、内部字段等系统术语。',
      '优先回答用户问题；如果问题为空，就说明路线顺序、每阶段衔接关系、以及整体完成方式。',
      '不要重写计划，不要输出表格。',
      '',
      `学习目标：${cleanString(loaded.plan.objective, '未命名目标')}`,
      `计划标题：${cleanString(loaded.structuredPlan.title || loaded.plan.objective, '学习计划')}`,
      '',
      '学习路线：',
      compactStages.map((item) => `${item.order}. ${item.title}${item.summary ? `：${item.summary}` : ''}`).join('\n'),
      '',
      recentHistory.length ? `最近对话：\n${recentHistory.join('\n')}` : '',
      `用户问题：${cleanString(input.question) || '请解释这条学习路线为什么这样安排。'}`
    ].filter(Boolean).join('\n');

    const response = await aiModelProviderService.chat([{ role: 'user', content: prompt }], {
      useCase: 'planner',
      timeoutMs: 45000
    });

    return {
      reply: response.reply,
      model: response.model,
      provider: response.provider,
      usage: response.usage || null
    };
  }

  async reviewPlan(input: {
    workspaceId: string;
    planId: string;
    instruction?: string;
  }) {
    const loaded = await this.loadPlan(input.workspaceId, input.planId);
    if (!loaded?.structuredPlan || !Array.isArray(loaded.structuredPlan.stages)) return null;
    const stages = loaded.structuredPlan.stages as Array<Record<string, any>>;
    const compactStages = stages.map((stage, index) => ({
      id: stageIdFor(stage, index),
      title: cleanString(stage.title, `Stage ${index + 1}`),
      content: stageContent(stage).slice(0, 1200),
      support: supportForStage(loaded.snapshot, index)
    }));

    if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) {
      return {
        review: {
          id: crypto.randomUUID(),
          summary: 'AI planner provider is not configured.',
          suggestions: compactStages.slice(0, 3).map((stage) => ({
            stageId: stage.id,
            stageTitle: stage.title,
            issue: '无法运行 AI review。',
            recommendation: '接入 planner provider 后再生成全局审阅。',
            priority: 'medium'
          })),
          createdAt: new Date().toISOString()
        }
      };
    }

    const response = await aiModelProviderService.json<{
      summary?: string;
      suggestions?: Array<{
        stageId?: string;
        stageTitle?: string;
        issue?: string;
        recommendation?: string;
        priority?: string;
      }>;
    }>({
      instruction: [
        '你是学习计划治理 reviewer。',
        '只审阅计划质量，不要直接重写计划。',
        '关注：目标是否清楚、阶段是否跳跃、资料/练习缺口、前置知识风险、节奏是否可执行。',
        '建议要少而强，最多 6 条。不要让用户面对大量字段。',
        '不要暴露 KG、grounding、compiler 等内部术语；可以说知识点依据、资料支撑、资料缺口。'
      ].join('\n'),
      schema: reviewSchema,
      input: {
        objective: loaded.plan.objective,
        planTitle: loaded.structuredPlan.title,
        stages: compactStages,
        userInstruction: input.instruction || ''
      },
      useCase: 'planner',
      timeoutMs: 90000
    });

    const data = response.data || {};
    return {
      review: {
        id: crypto.randomUUID(),
        summary: cleanString(data.summary, '已完成全局审阅。'),
        suggestions: (Array.isArray(data.suggestions) ? data.suggestions : [])
          .map((item) => ({
            stageId: cleanString(item.stageId),
            stageTitle: cleanString(item.stageTitle),
            issue: cleanString(item.issue),
            recommendation: cleanString(item.recommendation),
            priority: ['high', 'medium', 'low'].includes(String(item.priority)) ? String(item.priority) : 'medium'
          }))
          .filter((item) => item.issue || item.recommendation)
          .slice(0, 6),
        createdAt: new Date().toISOString()
      }
    };
  }
}

export const planGovernanceService = new PlanGovernanceService();

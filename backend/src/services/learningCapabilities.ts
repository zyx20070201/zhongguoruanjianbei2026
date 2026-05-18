import { capabilityRegistry } from './capabilityRegistry';
import { knowledgeSearchService } from './knowledgeSearchService';
import { learningContextBuilder } from './learningContextBuilder';
import { aiModelProviderService } from './aiModelProviderService';

type GoalPlanningOutput = {
  normalizedGoal: string;
  targetOutcome: string;
  skills: string[];
  milestones: Array<{ title: string; description: string; evidence: string }>;
  resourceNeeds: string[];
  successCriteria: string[];
};

type DiagnosisOutput = {
  questions: Array<{ id: string; prompt: string; targetSkill: string; expectedEvidence: string }>;
  suspectedWeaknesses: string[];
};

type ContentGenerationOutput = {
  brief: string;
  practice: string;
  notesTemplate: string;
};

type QuizGenerationOutput = {
  quiz: Array<{ id: string; type: string; prompt: string; answerGuide: string; skill: string }>;
};

const asStringArray = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map((item) => String(item || '').trim()).filter(Boolean);
  return normalized.length ? normalized : fallback;
};

const fallbackGoalPlanning = (input: { goalText?: string; skills?: string[] }): GoalPlanningOutput => {
  const skills = asStringArray(input.skills, ['核心概念理解', '例题推演', '练习巩固']);
  const goal = String(input.goalText || '建立新的学习目标').trim();

  return {
    normalizedGoal: goal,
    targetOutcome: '形成可复述、可练习、可复盘的学习成果',
    skills,
    milestones: [
      { title: '目标澄清', description: '确认学习边界、基础水平和最终产出', evidence: '能写出目标和验收标准' },
      { title: '诊断学习', description: '回答围绕核心技能的诊断问题', evidence: '能标记已掌握和模糊点' },
      { title: '练习复盘', description: '完成基础练习并整理错因', evidence: '能记录错题、疑问和下一步' }
    ],
    resourceNeeds: ['学习目标蓝图', '诊断练习', '学习笔记模板'],
    successCriteria: ['能用自己的话解释核心概念', '能完成一组基础练习', '能说出下一步要补的知识点']
  };
};

const fallbackDiagnosis = (skills: string[]): DiagnosisOutput => ({
  questions: skills.slice(0, 5).map((skill, index) => ({
    id: `diagnostic-${index + 1}`,
    prompt: `请用自己的话解释「${skill}」，并举一个你能理解的例子。`,
    targetSkill: skill,
    expectedEvidence: '回答应包含定义、例子和一个不确定点'
  })),
  suspectedWeaknesses: ['目标证据不足，需要先通过诊断题建立初始画像']
});

const fallbackContent = (input: { goalText?: string; skills?: string[] }): ContentGenerationOutput => {
  const goal = String(input.goalText || '当前学习目标');
  const skills = asStringArray(input.skills, ['核心概念理解']);

  return {
    brief: `# 学习蓝图\n\n目标：${goal}\n\n核心技能：\n${skills.map((skill) => `- ${skill}`).join('\n')}`,
    practice: `# 诊断练习\n\n${skills.map((skill, index) => `${index + 1}. 围绕「${skill}」写出定义、例子和疑问。`).join('\n')}`,
    notesTemplate: `# 学习笔记\n\n## 目标\n${goal}\n\n## 已理解\n\n## 仍有疑问\n\n## 下一步\n`
  };
};

const fallbackQuiz = (skills: string[]): QuizGenerationOutput => ({
  quiz: skills.slice(0, 5).map((skill, index) => ({
    id: `quiz-${index + 1}`,
    type: 'short_answer',
    prompt: `围绕「${skill}」设计一个简答题，并写出你的答案。`,
    answerGuide: '答案应包含关键定义、推理过程和一个例子。',
    skill
  }))
});

let registered = false;

export const registerLearningCapabilities = () => {
  if (registered) return;
  registered = true;

  capabilityRegistry.register({
    name: 'knowledge_retrieval',
    description: 'Retrieve relevant indexed workspace knowledge chunks for a learning query.',
    async execute(input: { query?: string; fileIds?: string[]; limit?: number }, context) {
      return {
        results: await knowledgeSearchService.search({
          workspaceId: context.workspaceId,
          query: input.query || '',
          fileIds: input.fileIds,
          limit: input.limit || 6
        })
      };
    }
  });

  capabilityRegistry.register({
    name: 'reflection',
    description: 'Build a compact learning context for tutor reflection and next-step planning.',
    async execute(input: { query?: string; activeFileId?: string }, context) {
      return {
        context: await learningContextBuilder.build({
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId,
          goalId: context.goalId,
          activeFileId: input.activeFileId,
          query: input.query
        })
      };
    }
  });

  capabilityRegistry.register({
    name: 'goal_planning',
    description: 'Plan a goal-oriented learning path from a user goal.',
    async execute(input: { goalText?: string; skills?: string[] }, context) {
      const fallback = fallbackGoalPlanning(input);
      if (!aiModelProviderService.isConfigured({ useCase: 'learning' })) return { plan: fallback, source: 'fallback' };

      try {
        const builtContext = await learningContextBuilder.build({
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId,
          goalId: context.goalId,
          query: input.goalText
        });
        const response = await aiModelProviderService.json<GoalPlanningOutput>({
          useCase: 'learning',
          instruction: '你是目标导向学习系统的 GoalPlanner。请把用户目标拆成可执行学习路径。',
          schema: {
            normalizedGoal: 'string',
            targetOutcome: 'string',
            skills: ['string'],
            milestones: [{ title: 'string', description: 'string', evidence: 'string' }],
            resourceNeeds: ['string'],
            successCriteria: ['string']
          },
          input: { ...input, context: builtContext },
          context: {
            workspaceId: context.workspaceId,
            workbenchId: context.workbenchId || undefined,
            learningContext: {
              goal: builtContext.goal,
              traces: builtContext.traces,
              knowledge: builtContext.knowledge
            }
          }
        });

        return { plan: response.data, source: response.provider, model: response.model, usage: response.usage };
      } catch (error) {
        return { plan: fallback, source: 'fallback', error: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  capabilityRegistry.register({
    name: 'diagnosis',
    description: 'Prepare diagnostic questions and weakness probes.',
    async execute(input: { skills?: string[]; goalText?: string }, context) {
      const skills = asStringArray(input.skills, ['核心概念理解', '练习巩固']);
      const fallback = fallbackDiagnosis(skills);
      if (!aiModelProviderService.isConfigured({ useCase: 'learning' })) return { ...fallback, source: 'fallback' };

      try {
        const response = await aiModelProviderService.json<DiagnosisOutput>({
          useCase: 'learning',
          instruction: '你是学习诊断 Agent。请生成能识别技能差距的诊断问题，问题应可用于学习者画像更新。',
          schema: {
            questions: [{ id: 'string', prompt: 'string', targetSkill: 'string', expectedEvidence: 'string' }],
            suspectedWeaknesses: ['string']
          },
          input: { ...input, skills },
          context: { workspaceId: context.workspaceId, workbenchId: context.workbenchId || undefined }
        });
        return { ...response.data, source: response.provider, model: response.model, usage: response.usage };
      } catch (error) {
        return { ...fallback, source: 'fallback', error: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  capabilityRegistry.register({
    name: 'content_generation',
    description: 'Generate learning resources for a workbench.',
    async execute(input: { goalText?: string; skills?: string[] }, context) {
      const fallback = fallbackContent(input);
      if (!aiModelProviderService.isConfigured({ useCase: 'learning' })) return { generated: fallback, source: 'fallback' };

      try {
        const builtContext = await learningContextBuilder.build({
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId,
          goalId: context.goalId,
          query: input.goalText
        });
        const response = await aiModelProviderService.json<ContentGenerationOutput>({
          useCase: 'learning',
          instruction: '你是学习资源生成 Agent。请生成学习蓝图、诊断练习和笔记模板，内容应贴合上下文资料。',
          schema: {
            brief: 'markdown string',
            practice: 'markdown string',
            notesTemplate: 'markdown string'
          },
          input: { ...input, context: builtContext },
          context: {
            workspaceId: context.workspaceId,
            workbenchId: context.workbenchId || undefined,
            learningContext: {
              goal: builtContext.goal,
              traces: builtContext.traces,
              knowledge: builtContext.knowledge
            }
          }
        });
        return { generated: response.data, source: response.provider, model: response.model, usage: response.usage };
      } catch (error) {
        return { generated: fallback, source: 'fallback', error: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  capabilityRegistry.register({
    name: 'quiz_generation',
    description: 'Generate lightweight mastery-check quiz items.',
    async execute(input: { skills?: string[]; goalText?: string }, context) {
      const skills = asStringArray(input.skills, ['核心概念理解']);
      const fallback = fallbackQuiz(skills);
      if (!aiModelProviderService.isConfigured({ useCase: 'learning' })) return { ...fallback, source: 'fallback' };

      try {
        const response = await aiModelProviderService.json<QuizGenerationOutput>({
          useCase: 'learning',
          instruction: '你是测验生成 Agent。请生成轻量掌握度检测题，题目应覆盖核心技能并附答案要点。',
          schema: {
            quiz: [{ id: 'string', type: 'string', prompt: 'string', answerGuide: 'string', skill: 'string' }]
          },
          input: { ...input, skills },
          context: { workspaceId: context.workspaceId, workbenchId: context.workbenchId || undefined }
        });
        return { ...response.data, source: response.provider, model: response.model, usage: response.usage };
      } catch (error) {
        return { ...fallback, source: 'fallback', error: error instanceof Error ? error.message : String(error) };
      }
    }
  });
};

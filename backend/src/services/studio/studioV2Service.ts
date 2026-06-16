import prisma from '../../config/db';
import { aiModelProviderService } from '../aiModelProviderService';
import { FileSystemService } from '../fileSystemService';
import { documentTextExtractionService } from '../documentTextExtractionService';
import { learningRunService } from '../learningRunService';
import { learnerStateContextAdapter } from '../learnerStateContextAdapter';
import { learningEventCollectionService } from '../learningEventCollectionService';
import { learnerStateAnalyzer } from '../learnerStateAnalyzer';
import { workbenchContextService } from '../contextSystemService';
import { knowledgeGraphPlanningAgentService } from '../knowledgeGraphPlanningAgentService';
import { studioTemplateRegistry } from './templateRegistry';
import { studioRecommendationService } from './recommendationService';
import { studioWorkflowRunner, templateSummary } from './workflow';
import { studioArtifactRepository } from './artifactRepository';
import { buildStudioDeliveryArtifact } from './visualArtifactAdapters';
import { studioRenderJobService } from './renderJobService';
import { quizQualityService } from '../quizQualityService';
import { normalizeStudioArtifact } from './artifactSchemas';
import { renderStudioArtifact } from './artifactRenderer';
import { REACT_CHAT_SYSTEM_PROMPT, reactChatVisualUserPrompt } from './reactChatVisualPrompt';
import { lightVisualLessonService } from './lightVisualLessonService';
import { presentonPptxService } from './presentonPptxService';
import { ContextCapsule } from '../../types/contextSystem';
import {
  StudioGenerateV2Input,
  StudioGenerateV2Result,
  StudioGenerationContext,
  StudioGoalCategory,
  StudioPracticeMasterySummary,
  StudioPracticeNextRecommendation,
  StudioRecommendInput,
  StudioResourceTemplate
} from './types';

const legacyAudience = (templateId: string) => {
  if (templateId.includes('quiz') || templateId.includes('practice')) return 'quiz' as const;
  if (templateId.includes('flashcard')) return 'flashcard' as const;
  return 'studio' as const;
};

const isPracticeTemplate = (templateId: string) =>
  templateId === 'custom_practice';

const emptyReactChatContextPolicy = () => ({
  includeSelection: false,
  includeViewport: false,
  includeActiveFileFullText: false,
  includeActiveFileSummary: false,
  ragScope: 'none' as const,
  includeResourceSummaries: false,
  maxRetrievedChunks: 0,
  intent: 'general_qa' as const,
  reasons: ['React-Chat Visual uses only explicit source selection and the user prompt.']
});

const emptyReactChatReview = (): StudioGenerateV2Result['review'] => ({
  score: 1,
  warnings: [],
  checks: [],
  metrics: {
    grounding: 1,
    schema: 1,
    personalization: 1,
    pedagogicalFit: 1,
    usability: 1
  },
  passed: true,
  summary: 'React-Chat Visual direct generation skips AI Studio review.'
});

const videoAnalysisText = (file: any) => {
  try {
    const metadata = file.metadataJson ? JSON.parse(file.metadataJson) : {};
    const analysis = metadata.videoAnalysis && typeof metadata.videoAnalysis === 'object' ? metadata.videoAnalysis : null;
    if (!analysis) return '';
    const transcript = Array.isArray(analysis.transcript)
      ? analysis.transcript.map((item: any) => `[${item.start ?? ''}] ${item.text || item.content || ''}`).join('\n')
      : '';
    const chapters = Array.isArray(analysis.chapters)
      ? analysis.chapters.map((item: any) => `${item.title || ''}\n${item.summary || ''}`).join('\n\n')
      : '';
    const keyPoints = Array.isArray(analysis.keyPoints)
      ? analysis.keyPoints.map((item: any) => `${item.concept || item.title || ''}: ${item.explanation || item.summary || ''}`).join('\n')
      : '';
    return [analysis.title ? `Title: ${analysis.title}` : '', analysis.summary || '', chapters, keyPoints, transcript]
      .filter(Boolean)
      .join('\n\n');
  } catch {
    return '';
  }
};

const readExplicitSourceText = async (workspaceId: string, file: any) => {
  const videoText = videoAnalysisText(file);
  if (videoText.trim()) return videoText;
  try {
    return await FileSystemService.getFileContent(workspaceId, file.id);
  } catch {
    const extracted = await documentTextExtractionService.extract(file).catch(() => null);
    return extracted?.text || '';
  }
};

const explicitSelectedSources = async (workspaceId: string, selectedResourceIds: unknown[] = []) => {
  const ids = [...new Set(selectedResourceIds.filter((value): value is string => typeof value === 'string' && Boolean(value)))];
  if (!ids.length) return [];
  const files = await prisma.fileSystemObject.findMany({
    where: { workspaceId, id: { in: ids }, nodeType: 'file' }
  });
  const byId = new Map(files.map((file) => [file.id, file] as const));
  return Promise.all(ids.map(async (id, index) => {
    const file = byId.get(id);
    if (!file) return { id, name: `Selected source ${index + 1}`, path: '', content: '' };
    const content = await readExplicitSourceText(workspaceId, file);
    return {
      id: file.id,
      name: file.name,
      path: file.path,
      fileId: file.id,
      content: String(content || '').trim()
    };
  }));
};

const reactChatVisualFilename = (prompt: string) => {
  const raw = clip(prompt || 'react-chat-visual', 40)
    .replace(/[\\/:*?"<>|#{}[\]`]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `react-chat-visual-${raw || 'visual'}.md`;
};

const buildNextPractice = (
  template: StudioResourceTemplate,
  mastery: StudioPracticeMasterySummary
): StudioPracticeNextRecommendation | null => {
  if (template.goal !== 'practice') return null;
  return {
    templateId: 'custom_practice',
    goal: 'practice',
    title: '继续自定义练习',
    reason: mastery.needsRemediation
      ? '练习结果仍有薄弱点，继续用自定义要求聚焦补强。'
      : '可以继续基于当前资料生成下一组自定义练习。',
    priority: Math.round(Math.max(50, Math.min(96, mastery.averageScore * 100 + (mastery.needsRemediation ? 10 : 0)))),
    evidence: [
      `平均得分 ${Math.round(mastery.averageScore * 100)}%`,
      `薄弱概念 ${mastery.weakConcepts.length} 个`,
      mastery.needsRemediation ? '需要继续补强' : '可以推进到验收'
    ],
    focusConcepts: mastery.weakConcepts.slice(0, 6),
    preferredDifficulty: mastery.averageScore >= 0.85 ? 'hard' : mastery.averageScore >= 0.65 ? 'medium' : 'easy',
    mastery
  };
};

const usedContextSummary = (capsule: StudioGenerationContext['capsule']) => ({
  mode: capsule.mode,
  selection: Boolean(capsule.selection),
  viewport: Boolean(capsule.viewport),
  activeFile: capsule.activeFile?.fileName || null,
  resources: capsule.resources?.length || 0,
  retrievedChunks: capsule.retrievedChunks?.length || 0,
  estimatedTokens: capsule.estimatedTokens,
  citations: capsule.citations.map((citation) => citation.label)
});

const outputContent = (
  content: string,
  review: StudioGenerateV2Result['review']
) => review.revisedContent || content;

const clip = (value: unknown, maxLength = 800) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

const parentPlanPreview = (plan: Record<string, any> | null) => {
  if (!plan) return null;
  return {
    id: plan.id,
    scope: plan.scope,
    objective: plan.objective,
    rationale: clip(plan.rationale, 500),
    targetSkills: Array.isArray(plan.targetSkills) ? plan.targetSkills.slice(0, 10) : [],
    weakSkills: Array.isArray(plan.weakSkills) ? plan.weakSkills.slice(0, 10) : [],
    nextStepId: plan.nextStepId || null,
    steps: Array.isArray(plan.steps)
      ? plan.steps.slice(0, 8).map((step: any) => ({
          id: step.id,
          title: step.title,
          type: step.type,
          status: step.status,
          rationale: clip(step.rationale || step.description, 400),
          estimatedMinutes: step.estimatedMinutes
        }))
      : [],
    candidateResources: Array.isArray(plan.candidateResources)
      ? plan.candidateResources.slice(0, 6).map((resource: any) => ({
          id: resource.id,
          title: resource.title,
          type: resource.type,
          role: resource.role,
          citationLabel: resource.citationLabel
        }))
      : [],
    constraintScores: plan.constraintScores || null
  };
};

const localRecommendationForTemplate = (
  template: StudioResourceTemplate,
  context: StudioGenerationContext
) => {
  const hasSources = context.capsule.citations.length > 0 || (context.capsule.retrievedChunks?.length || 0) > 0;
  return {
    id: `studio-rec-${template.id}`,
    goal: template.goal,
    templateId: template.id,
    title: `生成：${template.title}`,
    reason: template.recommendedUse || template.description,
    priority: hasSources ? 88 : 70,
    evidence: [
      hasSources
        ? `当前已选择 ${context.capsule.citations.length} 个可引用来源。`
        : '当前主要使用 Workbench 当前内容、视口、选区和当前文件。',
      `用户要求：${clip(context.input.prompt || template.promptFrame, 120)}`
    ],
    actions: [{ id: `generate-${template.id}`, label: `生成${template.shortTitle || template.title}`, templateId: template.id, goal: template.goal }]
  };
};

export class StudioV2Service {
  listTemplates(goal?: StudioGoalCategory) {
    return {
      goals: studioTemplateRegistry.listGoals(),
      templates: studioTemplateRegistry.list(goal)
    };
  }

  recommend(input: StudioRecommendInput) {
    return studioRecommendationService.recommend(input);
  }

  listArtifacts(input: { workspaceId: string; workbenchId?: string | null; limit?: number }) {
    return studioArtifactRepository.list(input);
  }

  private async generateReactChatVisualDirect(
    input: StudioGenerateV2Input,
    template: StudioResourceTemplate
  ): Promise<StudioGenerateV2Result> {
    const startedAt = Date.now();
    const runId = `react-chat-direct-${Date.now()}`;
    const selectedSources = input.prebuiltContextCapsule
      ? [
          ...(input.prebuiltContextCapsule.retrievedChunks || []).map((chunk) => ({
            id: chunk.sourceId || chunk.chunkId,
            name: chunk.fileName,
            path: '',
            fileId: chunk.fileId,
            content: chunk.content
          })),
          ...(input.prebuiltContextCapsule.resources || [])
            .filter((resource) => resource.summary)
            .map((resource) => ({
              id: resource.fileId,
              name: resource.fileName,
              path: resource.filePath || '',
              fileId: resource.fileId,
              content: resource.summary || resource.fileName
            }))
        ].slice(0, 12)
      : await explicitSelectedSources(input.workspaceId, input.context.selectedResourceIds || []);
    const selectedSourceIds = selectedSources.map((source) => source.id);
    const citations = input.prebuiltContextCapsule?.citations || selectedSources.map((source) => ({
      sourceId: source.id,
      fileId: source.fileId || source.id,
      fileName: source.name,
      label: source.name,
      sourceType: 'pinned' as const,
      confidence: 'high' as const,
      preview: clip(source.content, 600)
    }));
    const selectedSourceChars = selectedSources.reduce((sum, source) => sum + source.content.length, 0);
    const capsule: ContextCapsule = input.prebuiltContextCapsule || {
      capsuleId: runId,
      userId: 'react-chat-direct',
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || undefined,
      mode: 'workbench',
      resources: selectedSources.map((source) => ({
        fileId: source.fileId || source.id,
        fileName: source.name,
        filePath: source.path || undefined,
        type: 'generated',
        summary: clip(source.content, 300),
        tokenCount: Math.ceil(source.content.length / 4),
        indexed: false
      })),
      retrievedChunks: [],
      visualEvidence: [],
      tokenBudget: selectedSourceChars,
      estimatedTokens: Math.ceil(selectedSourceChars / 4),
      estimatedTokensByLayer: { selected_sources: Math.ceil(selectedSourceChars / 4) },
      promptContextPreview: selectedSources.map((source) => `## ${source.name}\n${clip(source.content, 1000)}`).join('\n\n---\n\n'),
      buildTrace: [],
      fallbackReasons: [],
      clippedItems: [],
      citations,
      sourceMap: citations.map((citation, index) => ({
        ...citation,
        sourceId: citation.sourceId || `S${index + 1}`,
        sourceType: citation.sourceType || 'retrieval',
        confidence: citation.confidence || 'medium',
        includedInPrompt: true
      })),
      createdAt: new Date(startedAt).toISOString()
    };
    const contextPolicy = input.prebuiltContextPolicy || emptyReactChatContextPolicy();
    const contextShell = {
      input,
      template,
      runId,
      goalId: null,
      capsule,
      contextPolicy,
      trace: []
    } as StudioGenerationContext;
    const response = await aiModelProviderService.chat(
      [
        {
          role: 'user',
          content: reactChatVisualUserPrompt(input.prompt || '', selectedSources)
        }
      ],
      undefined,
      {
        provider: 'openai',
        useCase: 'studio',
        systemPrompt: REACT_CHAT_SYSTEM_PROMPT,
        maxTokens: Number(process.env.REACT_CHAT_VISUAL_MAX_TOKENS || 131072),
        timeoutMs: Number(process.env.STUDIO_MODEL_TIMEOUT_MS || 240000)
      }
    );
    const rawContent = JSON.stringify({
      schemaVersion: 'visual_code_lesson.v1',
      title: input.prompt || template.title,
      summary: '使用 React-Chat 自由回答协议生成的可执行可视化讲解。',
      sourceIds: selectedSourceIds.slice(0, 20),
      contentMarkdown: response.reply.trim()
    }, null, 2);
    const structured = normalizeStudioArtifact(contextShell, rawContent);
    const content = renderStudioArtifact(structured);
    const metadata = {
      model: response.model,
      usage: response.usage,
      selectedResourceIds: selectedSourceIds,
      selectedSourceCount: selectedSources.length,
      selectedSourceChars,
      visualCodeLessonGeneration: {
        schemaVersion: 'visual_code_lesson.generation.v1',
        strategy: 'react_chat_direct',
        provider: response.provider,
        model: response.model,
        durationMs: Date.now() - startedAt
      }
    };
    const file = await FileSystemService.saveGeneratedContent({
      workspaceId: input.workspaceId,
      targetDir: 'Generated',
      filename: reactChatVisualFilename(input.prompt || template.title),
      category: 'generated',
      mimeType: 'text/markdown',
      isBinary: false,
      workbenchId: input.workbenchId || undefined,
      resourceRole: 'generated',
      resourceType: 'generated',
      scope: input.workbenchId ? 'workbench' : 'workspace',
      origin: 'ai',
      metadata: {
        generator: 'react-chat-direct',
        templateId: template.id,
        goal: template.goal,
        generatorKind: template.generator,
        renderer: template.renderer,
        source: `${response.provider}-react-chat-direct`,
        studioMetadata: metadata
      },
      content
    });
    return {
      file,
      content,
      template,
      goal: input.goal || template.goal,
      generator: template.generator,
      renderer: template.renderer,
      runId,
      source: `${response.provider}-react-chat-direct`,
      metadata,
      contextCapsule: capsule,
      contextPolicy,
      usedContextSummary: {
        mode: capsule.mode,
        selection: false,
        viewport: false,
        activeFile: null,
        resources: selectedSources.length,
        retrievedChunks: 0,
        estimatedTokens: capsule.estimatedTokens,
        citations: citations.map((citation) => citation.label)
      },
      workflowTrace: [],
      review: emptyReactChatReview(),
      qualityReport: null,
      practiceNext: null,
      recommendation: null,
      structured,
      artifact: null,
      renderJob: null,
      delivery: {
        kind: 'markdown',
        filename: file.name,
        mimeType: 'text/markdown',
        fileObjectId: file.id,
        path: file.path,
        previewContent: content
      }
    };
  }

  async generate(input: StudioGenerateV2Input): Promise<StudioGenerateV2Result> {
    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const template = studioTemplateRegistry.get(input.templateId);
    if (!template) throw new Error(`Studio template "${input.templateId}" not found`);

    if (template.id === 'react_chat_visual') {
      return this.generateReactChatVisualDirect(input, template);
    }

    if (template.id === 'light_visual_lesson') {
      return lightVisualLessonService.generate(input, template);
    }

    if (template.id === 'presenton_pptx') {
      return presentonPptxService.generate(input, template);
    }

    const workbench = input.workbenchId
      ? await prisma.workbench.findFirst({
          where: { id: input.workbenchId, workspaceId: input.workspaceId }
        })
      : null;

    const run = await learningRunService.startRun({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: workbench?.learningGoalId || null,
      intent: 'ai_studio_generate',
      input: {
        version: 'v2',
        goal: input.goal || template.goal,
        templateId: template.id,
        generator: template.generator,
        renderer: template.renderer,
        prompt: input.prompt,
        options: input.options || {},
        contextMode: input.context.contextMode
      }
    });

    const trace: StudioGenerationContext['trace'] = [];
    try {
      const contextShell = {
        input,
        template,
        runId: run.id,
        goalId: workbench?.learningGoalId || null,
        trace
      } as StudioGenerationContext;

      const capsuleResult = input.prebuiltContextCapsule
        ? await studioWorkflowRunner.step(
            contextShell,
            'ContextAgent',
            'agent-built context capsule',
            {
              contextMode: input.prebuiltContextCapsule.mode,
              templateId: template.id,
              contextRefs: input.contextRefs?.map((ref) => ({
                type: ref.type,
                fileId: ref.fileId,
                evidenceId: ref.evidenceId,
                messageId: ref.messageId,
                turnId: ref.turnId,
                title: ref.title
              })) || []
            },
            async () => ({
              capsule: input.prebuiltContextCapsule!,
              policy: input.prebuiltContextPolicy || emptyReactChatContextPolicy(),
              promptPreview: input.prebuiltContextCapsule!.promptContextPreview || '',
              trace: input.prebuiltContextCapsule!.buildTrace || []
            }),
            (output) =>
              `Accepted agent-built context capsule with ${output.capsule.citations.length} citation(s), ${output.capsule.retrievedChunks?.length || 0} retrieved chunk(s).`,
            (output) => ({
              estimatedTokens: output.capsule.estimatedTokens,
              citations: output.capsule.citations.map((citation) => citation.label)
            })
          )
        : await studioWorkflowRunner.step(
            contextShell,
            'ContextAgent',
            'context capsule',
            {
              contextMode: input.context.contextMode,
              templateId: template.id
            },
            () =>
              workbenchContextService.buildCapsule({
                context: {
                  ...input.context,
                  workspaceId: input.workspaceId,
                  workbenchId: input.workbenchId || input.context.workbenchId || null
                },
                messages: [{ role: 'user', content: input.prompt || template.promptFrame }]
              }),
            (output) =>
              `Built context capsule with ${output.capsule.citations.length} citation(s), ${output.capsule.retrievedChunks?.length || 0} retrieved chunk(s).`,
            (output) => ({
              estimatedTokens: output.capsule.estimatedTokens,
              citations: output.capsule.citations.map((citation) => citation.label)
            })
          );

      contextShell.capsule = capsuleResult.capsule;
      contextShell.contextPolicy = capsuleResult.policy;

      await studioWorkflowRunner.step(
        contextShell,
        'RetrievalAgent',
        'source retrieval summary',
        {
          templateId: template.id,
          contextMode: contextShell.capsule.mode
        },
        async () => ({
          citations: contextShell.capsule.citations,
          retrievedChunks: contextShell.capsule.retrievedChunks || [],
          resources: contextShell.capsule.resources || [],
          estimatedTokens: contextShell.capsule.estimatedTokens
        }),
        (output) =>
          `Selected ${output.citations.length} citation(s), ${output.retrievedChunks.length} retrieved chunk(s), ${output.resources.length} scoped resource(s).`,
        (output) => ({
          citations: output.citations.map((citation) => citation.label),
          retrievedChunks: output.retrievedChunks.length,
          resources: output.resources.length,
          estimatedTokens: output.estimatedTokens
        })
      );

      const learnerContext = await studioWorkflowRunner.step(
        contextShell,
        'LearnerStateAgent',
        'learner state adaptation',
        {
          audience: legacyAudience(template.id),
          goalId: workbench?.learningGoalId || null
        },
        () =>
          learnerStateContextAdapter.build({
            workspaceId: input.workspaceId,
            workbenchId: input.workbenchId || null,
            goalId: workbench?.learningGoalId || null,
            audience: legacyAudience(template.id)
          }),
        (output) => `Prepared learner context with ${output.guardrails.length} guardrail(s).`,
        (output) => ({
          guardrails: output.guardrails,
          promptPreview: output.promptContext.slice(0, 600)
        })
      );

      contextShell.learnerContext = learnerContext;

      if (template.id === 'study_plan') {
        const parentPlan = await studioWorkflowRunner.step(
          contextShell,
          'WorkspacePlanningAgent',
          'workspace parent plan snapshot',
          {
            scope: 'workspace-strategy-to-workbench-tactics',
            maxConcepts: input.options?.maxConcepts || 8
          },
          async () => {
            const plan = await knowledgeGraphPlanningAgentService.plan({
              workspaceId: input.workspaceId,
              workbenchId: input.workbenchId || null,
              goalId: workbench?.learningGoalId || null,
              objective: input.prompt || undefined,
              maxConcepts: typeof input.options?.maxConcepts === 'number' ? input.options.maxConcepts : 8
            }).catch((error) => {
              console.warn('Studio parent planning failed:', error);
              return null;
            });
            return parentPlanPreview(plan as Record<string, any> | null);
          },
          (output) =>
            output
              ? `Loaded workspace strategic plan "${output.objective}" with ${(output.steps as any[])?.length || 0} step(s).`
              : 'Workspace strategic plan was unavailable; generator will create a tactical plan from current context only.',
          (output) => output || {}
        );
        contextShell.enrichment = {
          ...(contextShell.enrichment || {}),
          parentPlan
        };
      }

      const recommendationResult = await studioWorkflowRunner.step(
        contextShell,
        'ResourcePlanningAgent',
        'resource recommendation snapshot',
        { goal: input.goal || template.goal, selectedTemplateId: template.id },
        async () => ({
          recommendations: [localRecommendationForTemplate(template, contextShell)],
          signals: {
            has_sources: contextShell.capsule.citations.length > 0 || (contextShell.capsule.retrievedChunks?.length || 0) > 0,
            selected_resources: Array.isArray(input.context.selectedResourceIds) && input.context.selectedResourceIds.length > 0
          }
        }),
        (output) => `Prepared ${output.recommendations.length} recommendation snapshot from existing context.`,
        (output) => ({
          topRecommendation: output.recommendations[0]?.templateId || null,
          signals: output.signals
        })
      );
      contextShell.recommendation =
        recommendationResult.recommendations.find((item) => item.templateId === template.id) ||
        recommendationResult.recommendations[0] ||
        null;

      const { generated, review } = await studioWorkflowRunner.generate(contextShell);
      const finalContent = outputContent(generated.content, review);
      const structured = generated.structured || null;
      const practiceQuestions = isPracticeTemplate(template.id)
        ? Array.isArray((structured as any)?.payload?.questions)
          ? ((structured as any).payload.questions as any[])
          : []
        : [];
      const practiceQuality = isPracticeTemplate(template.id) && practiceQuestions.length
        ? await quizQualityService.review(
            {
              title: String((structured as any)?.title || template.title),
              questions: practiceQuestions
            } as any,
            contextShell.capsule
          )
        : null;
      const practiceWeakConcepts = Array.from(
        new Set(
          practiceQuestions
            .flatMap((question) => [
              question.conceptId,
              question.objectiveId,
              ...(Array.isArray(question.knowledgePoints) ? question.knowledgePoints : []),
              question.commonMistake
            ])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        )
      ).slice(0, 8);
      const mastery: StudioPracticeMasterySummary = {
        averageScore: practiceQuality?.report.score ?? review.score,
        attemptedCount: practiceQuestions.length,
        correctCount: practiceQuality?.report.keptCount ?? practiceQuestions.length,
        weakConcepts: practiceWeakConcepts,
        masteredConcepts: practiceQuestions
          .map((question) => String(question.conceptId || question.skill || '').trim())
          .filter(Boolean)
          .slice(0, 8),
        needsRemediation: (practiceQuality?.report.score ?? review.score) < 0.66 || practiceWeakConcepts.length > 0
      };
      const practiceNext = buildNextPractice(template, mastery);
      const delivery = await buildStudioDeliveryArtifact(contextShell, finalContent, review);

      const file = await studioWorkflowRunner.step(
        contextShell,
        'PublisherAgent',
        'artifact publish',
        {
          templateId: template.id,
          filename: delivery.filename,
          format: template.format,
          deliveryKind: delivery.kind,
          framework: delivery.framework
        },
        () =>
          FileSystemService.saveGeneratedContent({
            workspaceId: input.workspaceId,
            targetDir: 'Generated',
            filename: delivery.filename,
            category: 'generated',
            mimeType: delivery.mimeType,
            isBinary: delivery.isBinary,
            workbenchId: input.workbenchId || undefined,
            resourceRole: 'generated',
            resourceType: 'generated',
            scope: input.workbenchId ? 'workbench' : 'workspace',
            origin: 'ai',
            metadata: {
              generator: 'studio-v2',
              templateId: template.id,
              goal: template.goal,
              generatorKind: template.generator,
              renderer: template.renderer,
              deliveryKind: delivery.kind,
              visualFramework: delivery.framework,
              source: generated.source,
              review,
              studioMetadata: generated.metadata || {},
              ...(delivery.metadata || {})
            },
            content: delivery.content
          }),
        (output) => `Published generated artifact to ${output.path}.`,
        (output) => ({
          fileObjectId: output.id,
          path: output.path,
          name: output.name
        })
      );

      const artifact = generated.structured
        ? await studioWorkflowRunner.step(
            contextShell,
            'ArtifactRepositoryAgent',
            'studio artifact persist',
            {
              templateId: template.id,
              templateVersion: template.version || '1.0.0',
              fileObjectId: file.id
            },
            () =>
              studioArtifactRepository.save({
                workspaceId: input.workspaceId,
                workbenchId: input.workbenchId || null,
                fileObjectId: file.id,
                runId: run.id,
                structured: generated.structured!,
                renderedContent: finalContent,
                source: generated.source,
                review,
                recommendation: contextShell.recommendation,
                workflowTrace: trace,
                metadata: {
                  contextSummary: usedContextSummary(contextShell.capsule),
                  source: generated.source,
                  studioMetadata: generated.metadata || {}
                }
              }),
            (output) => `Persisted StudioArtifact ${output.artifactKey}.`,
            (output) => ({
              artifactId: output.id,
              artifactKey: output.artifactKey,
              schemaVersion: output.schemaVersion
            })
          )
        : null;

      const renderJob = await studioWorkflowRunner.step(
        contextShell,
        'RenderQueueAgent',
        'visual render job',
        {
          templateId: template.id,
          deliveryKind: delivery.kind,
          framework: delivery.framework || null,
          fileObjectId: file.id
        },
        () =>
          studioRenderJobService.enqueue({
            workspaceId: input.workspaceId,
            workbenchId: input.workbenchId || null,
            artifactId: artifact?.id || null,
            sourceFileObjectId: file.id,
            templateId: template.id,
            renderer: template.renderer,
            delivery
          }),
        (output) => `Render job ${output?.id || 'n/a'} ${output?.status || 'queued'} for ${delivery.kind}.`,
        (output) => ({
          renderJobId: output?.id || null,
          status: output?.status || null,
          stage: output?.stage || null,
          progress: output?.progress || 0
        })
      );

      if (isPracticeTemplate(template.id) && practiceQuestions.length) {
        await learnerStateAnalyzer.analyzeQuizResult({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          question: {
            id: `${template.id}-aggregate`,
            type: 'short_answer',
            question: `${template.title} aggregate mastery snapshot`,
            answer: '',
            rubric: 'Aggregate practice quality review.',
            skill: mastery.weakConcepts[0] || template.title,
            difficulty: mastery.averageScore >= 0.85 ? 'hard' : mastery.averageScore >= 0.65 ? 'medium' : 'easy',
            learningObjective: template.promptFrame,
            commonMistake: mastery.weakConcepts[0] || template.title,
            knowledgePoints: mastery.weakConcepts,
            sourceRefs: []
          } as any,
          userAnswer: `averageScore=${mastery.averageScore.toFixed(2)}`,
          result: {
            correct: mastery.averageScore >= 0.72,
            score: mastery.averageScore,
            feedback: practiceQuality?.report.warnings.join(' ') || review.summary,
            missingPoints: practiceQuality?.report.issues.slice(0, 5).map((issue) => issue.message) || [],
            matchedPoints: mastery.masteredConcepts
          }
        }).catch((error) => console.warn('Practice aggregate learner analysis failed:', error));
      }

      await studioWorkflowRunner.step(
        contextShell,
        'FeedbackAgent',
        'learning feedback writeback',
        {
          templateId: template.id,
          artifactId: artifact?.id || null,
          reviewScore: review.score
        },
        () =>
          learningEventCollectionService.collect({
            workspaceId: input.workspaceId,
            workbenchId: input.workbenchId || null,
            goalId: workbench?.learningGoalId || null,
            eventType: 'studio.artifact_generated',
            actor: 'agent',
            object: { type: 'studio_artifact', id: file.id, title: template.title },
            payload: {
              version: 'v2',
              template: templateSummary(template),
              runId: run.id,
              artifactId: artifact?.id || null,
              source: generated.source,
              review,
              qualityReport: practiceQuality?.report || null,
              mastery,
              practiceNext
            },
            confidence: 0.78
          }),
        (output) => `Recorded learning event ${output.id} for generated artifact.`,
        (output) => ({
          eventId: output.id,
          eventType: output.eventType,
          confidence: output.confidence
        })
      ).catch((error) => console.warn('Learning event collection studio v2 failed:', error));

      await learningRunService.completeRun(run.id, {
        version: 'v2',
        goal: template.goal,
        templateId: template.id,
        generator: template.generator,
        renderer: template.renderer,
        fileObjectId: file.id,
        artifactId: artifact?.id || null,
        source: generated.source,
        review,
        qualityReport: practiceQuality?.report || null,
        mastery,
        practiceNext,
        citations: contextShell.capsule.citations.map((citation) => citation.label)
      });

      return {
          file,
          content: finalContent,
        template,
        goal: template.goal,
        generator: template.generator,
        renderer: template.renderer,
        runId: run.id,
        source: generated.source,
        metadata: generated.metadata || {},
        contextCapsule: contextShell.capsule,
        contextPolicy: contextShell.contextPolicy,
        usedContextSummary: usedContextSummary(contextShell.capsule),
        workflowTrace: trace,
        review,
        qualityReport: practiceQuality?.report || null,
        practiceNext,
        recommendation: contextShell.recommendation,
        structured: generated.structured || null,
        artifact: artifact
          ? {
                id: artifact.id,
                artifactKey: artifact.artifactKey,
                title: artifact.title,
                templateId: artifact.templateId,
                templateVersion: artifact.templateVersion,
              schemaVersion: artifact.schemaVersion
            }
          : null,
        renderJob: renderJob
          ? {
              id: renderJob.id,
              status: renderJob.status,
              stage: renderJob.stage,
              progress: renderJob.progress,
              kind: renderJob.kind,
              framework: renderJob.framework,
              outputFileObjectId: renderJob.outputFileObjectId,
              error: renderJob.error,
              logs: renderJob.logs
            }
          : null,
        delivery: {
            kind: delivery.kind,
            filename: delivery.filename,
            mimeType: delivery.mimeType,
            fileObjectId: file.id,
            path: file.path,
            framework: delivery.framework,
            previewContent: delivery.previewContent
          }
      };
    } catch (error) {
      await learningRunService.failRun(run.id, error);
      throw error;
    }
  }
}

export const studioV2Service = new StudioV2Service();

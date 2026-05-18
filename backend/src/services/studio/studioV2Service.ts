import prisma from '../../config/db';
import { FileSystemService } from '../fileSystemService';
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

  async generate(input: StudioGenerateV2Input): Promise<StudioGenerateV2Result> {
    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const template = studioTemplateRegistry.get(input.templateId);
    if (!template) throw new Error(`Studio template "${input.templateId}" not found`);

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

      const capsuleResult = await studioWorkflowRunner.step(
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
                  source: generated.source
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

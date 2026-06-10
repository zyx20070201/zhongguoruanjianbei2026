import { aiModelProviderService } from './aiModelProviderService';
import { learnerPortraitEntityBuilderService } from './learnerPortraitEntityBuilderService';
import { learnerPortraitEntityResolverService } from './learnerPortraitEntityResolverService';
import { learnerPortraitPolishService } from './learnerPortraitPolishService';
import { LearnerProfileEvidenceProjection, LearnerPortraitBundle } from './learnerProfileReadModel';
import { learnerProfileRepositoryService } from './learnerProfileRepositoryService';

const portraitLlmError = (stage: string, message?: string | null) =>
  new Error(`LLM 学习画像刷新失败（${stage}）：${message || '模型未返回可用结果'}`);

export class LearnerPortraitPipelineService {
  async build(input: {
    workspaceId: string;
    workbenchId?: string | null;
    projection: LearnerProfileEvidenceProjection;
    forcePortrait?: boolean;
  }): Promise<LearnerPortraitBundle> {
    const forcePortrait = Boolean(input.forcePortrait);
    if (forcePortrait && !aiModelProviderService.isConfigured({ useCase: 'memory' })) {
      throw portraitLlmError('模型配置', 'AI memory provider 未配置，无法执行 LLM 画像刷新');
    }
    const persistedCandidatesBeforeBuild = await learnerProfileRepositoryService.listCandidates({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      limit: 120
    }).catch(() => []);
    const persistedCandidateEntries = persistedCandidatesBeforeBuild.map((candidate) => ({
      id: candidate.id,
      dimension: String(candidate.dimension || candidate.payload?.learnerStateDimension || 'profileBase'),
      label: String(candidate.type || 'Persisted profile candidate'),
      value: String(candidate.title || ''),
      confidence: Number(candidate.confidence || 0.5),
      status: String(candidate.status || 'candidate'),
      evidenceCount: Array.isArray(candidate.evidenceIds) ? candidate.evidenceIds.length : 0,
      source: 'observation_memory' as const,
      observedAt: candidate.observedAt || candidate.updatedAt || null,
      rationale: candidate.description || null,
      sourcePipeline: candidate.sourcePipeline || null
    })).filter((entry) => entry.value);

    const portrait = await learnerPortraitEntityBuilderService.build({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      stableProfile: input.projection.stableProfile,
      workingState: [...input.projection.workingState, ...persistedCandidateEntries],
      savedMemoryEntries: input.projection.savedMemoryEntries,
      recentEvents: input.projection.recentEvents,
      limit: 56,
      forceLlmExtraction: forcePortrait
    });
    await learnerProfileRepositoryService.upsertCandidates({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      candidates: portrait.entities,
      sourcePipeline: 'learner_portrait_builder'
    });

    const portraitResolution = forcePortrait
      ? await learnerPortraitEntityResolverService.generateNow({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          entities: portrait.entities
        })
      : learnerPortraitEntityResolverService.getCachedOrFallback({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          entities: portrait.entities
        });

    if (forcePortrait && portraitResolution.source !== 'llm') {
      throw portraitLlmError('语义归并', portraitResolution.message);
    }

    const resolutionReadyForPolish = portraitResolution.status === 'ready' && (portraitResolution.source === 'llm' || portraitResolution.source === 'cache');
    const portraitPolish = forcePortrait
      ? await learnerPortraitPolishService.generateNow({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          entities: portraitResolution.entities
        })
      : resolutionReadyForPolish
        ? learnerPortraitPolishService.getCachedOrFallback({
            workspaceId: input.workspaceId,
            workbenchId: input.workbenchId || null,
            entities: portraitResolution.entities
          })
        : learnerPortraitPolishService.fallbackOnly({
            entities: portraitResolution.entities.length ? portraitResolution.entities : portrait.entities,
            source: 'fallback',
            status: 'ready',
            message: portraitResolution.status === 'pending'
              ? '等待语义归并完成后再进行 AI 精修。'
              : '语义归并暂不可用，当前展示候选画像。'
          });

    if (forcePortrait && portraitPolish.source !== 'llm') {
      throw portraitLlmError('展示润色', portraitPolish.message);
    }

    const entitiesToPersist = portraitPolish.entities?.length
      ? portraitPolish.entities
      : portraitResolution.entities.length
        ? portraitResolution.entities
        : portrait.entities;
    await learnerProfileRepositoryService.upsertEntities({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      entities: entitiesToPersist,
      resolutionSource: portraitResolution.source,
      polishSource: portraitPolish.source,
      entityHash: portraitPolish.entityHash || portraitResolution.entityHash || ''
    });
    const [persistedCandidates, persistedEntities] = await Promise.all([
      learnerProfileRepositoryService.listCandidates({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        limit: 120
      }),
      learnerProfileRepositoryService.listEntities({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        limit: 120
      })
    ]);

    return {
      portrait,
      portraitResolution,
      portraitPolish,
      persisted: {
        candidates: persistedCandidates,
        entities: persistedEntities
      }
    };
  }
}

export const learnerPortraitPipelineService = new LearnerPortraitPipelineService();

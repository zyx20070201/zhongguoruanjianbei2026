import prisma from '../config/db';
import { conversationHistoryService } from './conversationHistoryService';
import { learnerStateContextAdapter } from './learnerStateContextAdapter';
import { learnerStateGovernanceService } from './learnerStateGovernanceService';
import { learnerStateService } from './learnerStateService';
import { memoryCandidateService } from './memoryCandidateService';
import { profileControlService } from './profileControlService';
import { savedMemoryService } from './savedMemoryService';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export class MemoryGovernanceService {
  async listSaveCandidates(input: { workspaceId: string; limit?: number }) {
    return memoryCandidateService.list(input);
  }

  async decideSaveCandidate(input: {
    workspaceId: string;
    workbenchId?: string | null;
    candidateId: string;
    decision: 'save' | 'dismiss';
    text?: string;
    category?: string;
  }) {
    return memoryCandidateService.decide(input);
  }

  async debugOverview(input: { workspaceId: string; workbenchId?: string | null; query?: string; sessionId?: string | null }) {
    const [savedMemories, learnerContext, memoryEval, lifecycle, pendingCandidates] = await Promise.all([
      savedMemoryService.list({ workspaceId: input.workspaceId, limit: 8 }),
      learnerStateContextAdapter.build({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        audience: 'tutor',
        tokenBudget: 1000
      }),
      profileControlService.evaluate({ workspaceId: input.workspaceId }),
      profileControlService.lifecycle({ workspaceId: input.workspaceId }),
      this.listSaveCandidates({ workspaceId: input.workspaceId, limit: 5 })
    ]);

    const referenceHistory = input.query
      ? await conversationHistoryService.retrieve({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          query: input.query,
          currentSessionId: input.sessionId || null,
          limit: 6
        })
      : [];

    const recentExtractions = await prisma.learnerEvidence.findMany({
      where: { workspaceId: input.workspaceId, evidenceType: 'memory_extraction' },
      orderBy: { observedAt: 'desc' },
      take: 6
    });

    return {
      health: {
        readiness: memoryEval.assessment.readiness,
        evidenceCount: memoryEval.metrics.evidenceCount,
        sourceDiversity: memoryEval.metrics.sourceDiversity,
        activeUserControls: memoryEval.metrics.activeUserControls,
        pendingSaveCandidates: pendingCandidates.candidates.length,
        lifecycleRecommendations: lifecycle.recommendations
      },
      whatWillInfluenceAnswers: {
        savedMemories: savedMemories.map((memory) => ({ text: memory.text, category: memory.category, source: memory.source })),
        learnerSignals: learnerContext.learningSignals,
        retrievedHistory: referenceHistory,
        pendingSaveCandidates: pendingCandidates.candidates
      },
      plainEnglishTrace: [
        savedMemories.length
          ? `我会优先遵守 ${savedMemories.length} 条你明确保存的长期记忆。`
          : '目前没有会长期影响回答的 Saved Memory。',
        referenceHistory.length
          ? `这次问题能找回 ${referenceHistory.length} 条相关历史对话，但它们只作为参考，不会自动变成偏好。`
          : input.query
            ? '这次问题暂时没有找到强相关历史对话。'
            : '输入一个问题后，可以预览会找回哪些历史对话。',
        learnerContext.learningSignals.candidateWeaknesses.length || learnerContext.learningSignals.stableWeaknesses.length
          ? '学习状态会影响讲解节奏、练习推荐和复习建议，但不会被当成固定标签。'
          : '学习状态证据还比较少，系统会保持中性讲解。',
        pendingCandidates.candidates.length
          ? `有 ${pendingCandidates.candidates.length} 条候选偏好需要你确认后才会保存。`
          : '没有等待确认的长期记忆候选。'
      ],
      recentExtractions: recentExtractions.map((item) => ({
        id: item.id,
        summary: item.summary,
        confidence: item.confidence,
        observedAt: item.observedAt.toISOString(),
        result: parseJson(item.payloadJson, {})
      })),
      finalPromptPreview: [
        await savedMemoryService.promptContext({ workspaceId: input.workspaceId, limit: 8 }),
        conversationHistoryService.formatRetrieved(referenceHistory),
        learnerContext.promptContext
      ].join('\n\n')
    };
  }

  async runLifecycle(input: { workspaceId: string; workbenchId?: string | null }) {
    return learnerStateGovernanceService.govern({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null
    }).catch(() =>
      learnerStateService.governLifecycle({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        changedBy: 'MemoryGovernanceService'
      })
    );
  }
}

export const memoryGovernanceService = new MemoryGovernanceService();

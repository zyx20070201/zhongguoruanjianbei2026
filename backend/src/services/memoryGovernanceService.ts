import prisma from '../config/db';
import { conversationHistoryService } from './conversationHistoryService';
import { learnerMemoryControlService } from './learnerMemoryControlService';
import { learnerStateContextAdapter } from './learnerStateContextAdapter';
import { learnerStateGovernanceService } from './learnerStateGovernanceService';
import { learnerStateService } from './learnerStateService';
import { savedMemoryService } from './savedMemoryService';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const clip = (value: string | null | undefined, maxLength = 320) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const candidateFromEvidence = (item: any) => {
  const payload = parseJson<Record<string, any>>(item.payloadJson, {});
  const candidate = payload.candidate || {};
  return {
    id: item.id,
    text: clip(candidate.text || item.summary, 360),
    category: String(candidate.category || 'preference'),
    confidence: Number(candidate.confidence ?? item.confidence ?? 0.65),
    reason: clip(candidate.reason || 'This looks like a reusable preference.', 220),
    askUserToSaveText: clip(payload.askUserToSaveText || `是否保存为长期偏好：${candidate.text || item.summary}`, 360),
    createdAt: item.createdAt.toISOString(),
    observedAt: item.observedAt.toISOString()
  };
};

export class MemoryGovernanceService {
  async listSaveCandidates(input: { workspaceId: string; limit?: number }) {
    const candidates = await prisma.learnerEvidence.findMany({
      where: { workspaceId: input.workspaceId, evidenceType: 'saved_memory_prompt_candidate' },
      orderBy: { observedAt: 'desc' },
      take: Math.min(Math.max(input.limit || 8, 1), 30)
    });
    const decisions = await prisma.learnerEvidence.findMany({
      where: {
        workspaceId: input.workspaceId,
        evidenceType: 'saved_memory_candidate_decision',
        sourceId: { in: candidates.map((item) => item.id) }
      }
    });
    const decided = new Set(decisions.map((item) => item.sourceId).filter(Boolean));
    return {
      candidates: candidates.filter((item) => !decided.has(item.id)).map(candidateFromEvidence)
    };
  }

  async decideSaveCandidate(input: {
    workspaceId: string;
    workbenchId?: string | null;
    candidateId: string;
    decision: 'save' | 'dismiss';
    text?: string;
    category?: string;
  }) {
    const candidateEvidence = await prisma.learnerEvidence.findFirst({
      where: { workspaceId: input.workspaceId, id: input.candidateId, evidenceType: 'saved_memory_prompt_candidate' }
    });
    if (!candidateEvidence) throw new Error('Memory candidate not found');

    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const candidate = candidateFromEvidence(candidateEvidence);
    let memory = null;
    if (input.decision === 'save') {
      memory = await savedMemoryService.upsert({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        userId: workspace.userId,
        text: input.text || candidate.text,
        category: input.category || candidate.category,
        source: 'user_confirmed_candidate',
        confidence: 1
      });
    }

    await prisma.learnerEvidence.create({
      data: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        evidenceType: 'saved_memory_candidate_decision',
        sourceType: 'user_memory_control',
        sourceId: input.candidateId,
        actor: 'user',
        title: input.decision === 'save' ? 'User saved memory candidate' : 'User dismissed memory candidate',
        summary: input.decision === 'save' ? `Saved: ${input.text || candidate.text}` : `Dismissed: ${candidate.text}`,
        payloadJson: JSON.stringify({ decision: input.decision, candidate, savedMemoryKey: memory?.memoryKey || null }),
        confidence: 1
      }
    });

    return { memory, decision: input.decision };
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
      learnerMemoryControlService.evaluate({ workspaceId: input.workspaceId }),
      learnerMemoryControlService.lifecycle({ workspaceId: input.workspaceId }),
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

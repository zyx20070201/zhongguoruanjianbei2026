import prisma from '../config/db';
import { learnerStateContextAdapter } from './learnerStateContextAdapter';
import { buildLearnerMemoryKey } from './learnerMemoryKeys';

export type MemoryControlAction = 'correct' | 'delete' | 'freeze' | 'downrank' | 'restore';

export interface KeyMemoryItem {
  key: string;
  dimension: string;
  label: string;
  userFacingLabel: string;
  signalType: string;
  value: string;
  confidence: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  evidenceCount: number;
  sources: string[];
  status: 'active' | 'corrected' | 'frozen' | 'downranked' | 'deleted';
  explanation: string;
  editable: boolean;
}

const clip = (value: string | null | undefined, maxLength = 240) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const confidenceLabel = (confidence: number): KeyMemoryItem['confidenceLabel'] => {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.45) return 'medium';
  return 'low';
};

const parsePayload = (value: string) => {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const friendlyPreference = (value: string) => {
  const labels: Record<string, string> = {
    examples: '更适合先用现实案例进入抽象概念。',
    code_or_project: '偏好通过代码或小项目理解概念。',
    visual_explanation: '更适合用结构图或流程拆解辅助理解。',
    practice_or_quiz: '最近更适合用练习或小测巩固。',
    flashcards_or_review: '适合把重点整理成可复习的记忆卡片。',
    step_by_step: '讲解时适合分步骤推进。',
    concise_summary: '偏好先给简洁总结。'
  };
  return labels[value] || value;
};

export class LearnerMemoryControlService {
  async listKeyMemories(input: { workspaceId: string; workbenchId?: string | null; limit?: number }) {
    const context = await learnerStateContextAdapter.build({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      audience: 'general'
    });
    const controls = await prisma.learnerMemoryControl.findMany({
      where: { workspaceId: input.workspaceId, status: 'active' },
      orderBy: { updatedAt: 'desc' }
    });
    const controlByKey = new Map(controls.map((control) => [control.memoryKey, control]));
    const sourceCounts = await this.sourceCounts(input.workspaceId);
    const items: KeyMemoryItem[] = [];

    const push = (params: {
      dimension: string;
      label: string;
      userFacingLabel?: string;
      signalType?: string;
      value: string;
      baseConfidence: number;
      sources: string[];
      evidenceCount?: number;
    }) => {
      const key = buildLearnerMemoryKey(params.dimension, params.value);
      const control = controlByKey.get(key);
      if (control?.action === 'delete') return;
      const corrected = control?.action === 'correct' && control.correctedText ? control.correctedText : params.value;
      const multiplier = control?.action === 'downrank' ? Math.min(control.weightMultiplier, 0.5) : control?.weightMultiplier || 1;
      const confidence = Math.max(0, Math.min(1, params.baseConfidence * multiplier));
      const status =
        control?.action === 'correct'
          ? 'corrected'
          : control?.action === 'freeze'
            ? 'frozen'
            : control?.action === 'downrank'
              ? 'downranked'
              : 'active';
      items.push({
        key,
        dimension: params.dimension,
        label: params.label,
        userFacingLabel: params.userFacingLabel || params.label,
        signalType: params.signalType || params.label,
        value: corrected,
        confidence,
        confidenceLabel: confidenceLabel(confidence),
        evidenceCount: params.evidenceCount || 1,
        sources: params.sources,
        status,
        explanation: [
          `Based on ${params.sources.join(', ') || 'learner state'} signals.`,
          params.evidenceCount ? `${params.evidenceCount} supporting signal(s).` : '',
          control?.reason ? `User control: ${control.reason}` : ''
        ].filter(Boolean).join(' '),
        editable: true
      });
    };

    context.learningSignals.recentTopics.slice(0, 4).forEach((value) =>
      push({
        dimension: 'profileBase',
        label: 'Recent topic',
        userFacingLabel: '最近聊到的主题',
        signalType: 'recent_topic',
        value,
        baseConfidence: 0.4,
        sources: ['chat'],
        evidenceCount: sourceCounts.profileBase
      })
    );
    context.learningSignals.activeGoals.slice(0, 3).forEach((value) =>
      push({
        dimension: 'profileBase',
        label: 'Active learning goal',
        userFacingLabel: '正在形成的学习目标',
        signalType: 'active_learning_goal',
        value,
        baseConfidence: Math.max(0.45, context.provenance.confidence),
        sources: ['goals', 'chat'],
        evidenceCount: sourceCounts.profileBase
      })
    );
    context.learningSignals.stableWeaknesses.slice(0, 4).forEach((value) =>
      push({
        dimension: 'knowledgeState',
        label: 'Repeated weak signal',
        userFacingLabel: '多次证据指向的薄弱概念',
        signalType: 'stable_weak_concept',
        value,
        baseConfidence: 0.72,
        sources: ['quiz', 'flashcard', 'trace'],
        evidenceCount: sourceCounts.knowledgeState
      })
    );
    context.learningSignals.candidateWeaknesses.slice(0, 4).forEach((value) =>
      push({
        dimension: 'knowledgeState',
        label: 'Candidate weak signal',
        userFacingLabel: '可能需要补强的概念',
        signalType: 'candidate_weak_concept',
        value,
        baseConfidence: 0.42,
        sources: ['chat', 'quiz', 'trace'],
        evidenceCount: sourceCounts.knowledgeState
      })
    );
    context.learningSignals.preferredResourceForms.slice(0, 4).forEach((value) =>
      push({
        dimension: 'preferenceStyle',
        label: 'Resource preference',
        userFacingLabel: '讲解方式偏好',
        signalType: 'explanation_preference',
        value: friendlyPreference(value),
        baseConfidence: 0.55,
        sources: ['chat', 'generation choices'],
        evidenceCount: sourceCounts.preferenceStyle
      })
    );
    context.learningSignals.reviewPressure.slice(0, 4).forEach((value) =>
      push({
        dimension: 'reviewPlanning',
        label: 'Review pressure',
        userFacingLabel: '复习压力',
        signalType: 'review_pressure',
        value,
        baseConfidence: 0.62,
        sources: ['flashcard review'],
        evidenceCount: sourceCounts.reviewPlanning
      })
    );
    controls
      .filter((control) => control.action === 'delete')
      .forEach((control) => {
        items.push({
          key: control.memoryKey,
          dimension: control.dimension,
          label: 'Deleted memory',
          userFacingLabel: '已隐藏的学习状态信号',
          signalType: 'deleted',
          value: control.originalText || control.correctedText || control.memoryKey,
          confidence: 0,
          confidenceLabel: 'low',
          evidenceCount: 0,
          sources: ['user control'],
          status: 'deleted',
          explanation: control.reason
            ? `User deleted this memory: ${control.reason}`
            : 'User deleted this memory. It is hidden from learner context until restored.',
          editable: true
        });
      });

    return {
      memories: items
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, Math.min(Math.max(input.limit || 12, 1), 30)),
      contextSummary: context.summary,
      provenance: context.provenance
    };
  }

  async explain(input: { workspaceId: string; memoryKey: string }) {
    const controls = await prisma.learnerMemoryControl.findMany({
      where: { workspaceId: input.workspaceId, memoryKey: input.memoryKey, status: 'active' },
      orderBy: { updatedAt: 'desc' }
    });
    const dimension = input.memoryKey.split(':')[0] || '';
    const recentEvidence = await prisma.learnerEvidence.findMany({
      where: { workspaceId: input.workspaceId, payloadJson: { contains: input.memoryKey.split(':').slice(1).join(':').replace(/-/g, ' ') } },
      orderBy: { observedAt: 'desc' },
      take: 8
    });
    const recentPatches = await prisma.learnerStatePatch.findMany({
      where: { workspaceId: input.workspaceId, targetDimension: dimension },
      orderBy: { createdAt: 'desc' },
      take: 8
    });
    return {
      memoryKey: input.memoryKey,
      dimension,
      controls,
      evidence: recentEvidence.map((item) => ({
        id: item.id,
        evidenceType: item.evidenceType,
        sourceType: item.sourceType,
        title: item.title,
        summary: item.summary,
        confidence: item.confidence,
        observedAt: item.observedAt.toISOString(),
        payload: parsePayload(item.payloadJson)
      })),
      patches: recentPatches.map((patch) => ({
        id: patch.id,
        status: patch.status,
        operation: patch.operation,
        confidence: patch.confidence,
        rationale: patch.rationale,
        createdAt: patch.createdAt.toISOString(),
        appliedAt: patch.appliedAt?.toISOString() || null
      }))
    };
  }

  async control(input: {
    workspaceId: string;
    workbenchId?: string | null;
    memoryKey: string;
    dimension: string;
    action: MemoryControlAction;
    correctedText?: string;
    originalText?: string;
    reason?: string;
    weightMultiplier?: number;
  }) {
    const data = {
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      memoryKey: input.memoryKey,
      dimension: input.dimension,
      action: input.action,
      status: input.action === 'restore' ? 'inactive' : 'active',
      originalText: input.originalText || '',
      correctedText: input.correctedText || '',
      reason: input.reason || '',
      weightMultiplier:
        input.action === 'downrank'
          ? Math.max(0, Math.min(1, Number(input.weightMultiplier ?? 0.4)))
          : Math.max(0, Math.min(1.5, Number(input.weightMultiplier ?? 1)))
    };
    await prisma.learnerMemoryControl.updateMany({
      where: { workspaceId: input.workspaceId, memoryKey: input.memoryKey, status: 'active' },
      data: { status: 'inactive' }
    });
    const control = await prisma.learnerMemoryControl.create({ data });
    if (input.action === 'delete' || input.action === 'downrank' || input.action === 'correct') {
      await prisma.learnerStatePatch.create({
        data: {
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          targetDimension: input.dimension,
          operation: 'merge',
          proposedBy: 'LearnerMemoryControl',
          payloadJson: JSON.stringify({
            userControls: [
              {
                memoryKey: input.memoryKey,
                action: input.action,
                correctedText: input.correctedText || null,
                reason: input.reason || null,
                createdAt: new Date().toISOString()
              }
            ]
          }),
          rationale: 'User memory control should influence future learner context.',
          confidence: input.action === 'correct' ? 0.9 : 0.75
        }
      });
    }
    return control;
  }

  async lifecycle(input: { workspaceId: string; staleDays?: number }) {
    const staleSince = new Date(Date.now() - (input.staleDays || 120) * 24 * 60 * 60 * 1000);
    const staleEvidenceCount = await prisma.learnerEvidence.count({
      where: { workspaceId: input.workspaceId, observedAt: { lt: staleSince } }
    });
    const pendingPatchCount = await prisma.learnerStatePatch.count({
      where: { workspaceId: input.workspaceId, status: 'pending', createdAt: { lt: staleSince } }
    });
    return {
      staleEvidenceCount,
      pendingPatchCount,
      recommendations: [
        staleEvidenceCount > 100 ? 'Consider summarizing old evidence into state versions and archiving raw low-value evidence.' : '',
        pendingPatchCount > 0 ? 'Consider rejecting or applying old pending patches before generating new learner context.' : '',
        'Keep user corrections active until the user restores or edits them.'
      ].filter(Boolean)
    };
  }

  async evaluate(input: { workspaceId: string }) {
    const [evidenceCount, patchCount, appliedPatchCount, controlCount, state] = await Promise.all([
      prisma.learnerEvidence.count({ where: { workspaceId: input.workspaceId } }),
      prisma.learnerStatePatch.count({ where: { workspaceId: input.workspaceId } }),
      prisma.learnerStatePatch.count({ where: { workspaceId: input.workspaceId, status: 'applied' } }),
      prisma.learnerMemoryControl.count({ where: { workspaceId: input.workspaceId, status: 'active' } }),
      prisma.learnerState.findFirst({ where: { workspaceId: input.workspaceId, scope: 'workspace' } })
    ]);
    const sourceGroups = await prisma.learnerEvidence.groupBy({
      by: ['sourceType'],
      where: { workspaceId: input.workspaceId },
      _count: { sourceType: true }
    });
    const coverageScore = Math.min(1, sourceGroups.length / 4);
    const applicationRate = patchCount ? appliedPatchCount / patchCount : 0;
    const confidence = state ? Number(parsePayload(state.confidenceJson).confidence || parsePayload(state.confidenceJson).lastPatchConfidence || 0.45) : 0;
    return {
      metrics: {
        evidenceCount,
        patchCount,
        appliedPatchCount,
        applicationRate: Number(applicationRate.toFixed(2)),
        activeUserControls: controlCount,
        sourceDiversity: sourceGroups.length,
        coverageScore: Number(coverageScore.toFixed(2)),
        currentConfidence: Number(confidence.toFixed(2))
      },
      sourceBreakdown: sourceGroups.map((group) => ({ sourceType: group.sourceType, count: group._count.sourceType })),
      assessment: {
        readiness:
          evidenceCount >= 30 && coverageScore >= 0.75 && applicationRate >= 0.5
            ? 'operational'
            : evidenceCount >= 8
              ? 'early'
              : 'thin',
        gaps: [
          coverageScore < 0.75 ? 'Need more diverse evidence sources.' : '',
          applicationRate < 0.5 ? 'Many patches are pending or not consolidated.' : '',
          controlCount === 0 ? 'No user correction/control feedback yet.' : ''
        ].filter(Boolean)
      }
    };
  }

  private async sourceCounts(workspaceId: string) {
    const patches = await prisma.learnerStatePatch.groupBy({
      by: ['targetDimension'],
      where: { workspaceId },
      _count: { targetDimension: true }
    });
    const counts = new Map(patches.map((patch) => [patch.targetDimension, patch._count.targetDimension]));
    return {
      profileBase: counts.get('profileBase') || 0,
      knowledgeState: counts.get('knowledgeState') || 0,
      preferenceStyle: counts.get('preferenceStyle') || 0,
      reviewPlanning: counts.get('reviewPlanning') || 0
    };
  }
}

export const learnerMemoryControlService = new LearnerMemoryControlService();

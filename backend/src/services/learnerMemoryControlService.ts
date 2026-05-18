import prisma from '../config/db';
import { learnerStateContextAdapter } from './learnerStateContextAdapter';
import { buildLearnerMemoryKey } from './learnerMemoryKeys';
import { isPollutedLearningSignal } from './learnerSignalSanitizer';
import { learnerStateService } from './learnerStateService';
import type { LearnerSignalRecord } from './learnerStateModel';

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

const isoDate = (value?: Date | string | null) => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
    const state = await learnerStateService.ensureState({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null
    });
    const controls = await prisma.learnerMemoryControl.findMany({
      where: { workspaceId: input.workspaceId, status: 'active' },
      orderBy: { updatedAt: 'desc' }
    });
    const controlByKey = new Map(controls.map((control) => [control.memoryKey, control]));
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
      explanation?: string;
    }) => {
      if (isPollutedLearningSignal(params.value)) return;
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
          params.explanation,
          `Based on ${params.sources.join(', ') || 'learner state'} signals.`,
          params.evidenceCount ? `${params.evidenceCount} supporting signal(s).` : '',
          control?.reason ? `User control: ${control.reason}` : ''
        ].filter(Boolean).join(' '),
        editable: true
      });
    };

    const pushSignal = (signal: LearnerSignalRecord, params: {
      dimension: string;
      label: string;
      userFacingLabel: string;
      signalType: string;
      value?: string;
      explanation: string;
    }) => push({
      dimension: params.dimension,
      label: params.label,
      userFacingLabel: params.userFacingLabel,
      signalType: params.signalType,
      value: params.value || signal.value,
      baseConfidence: signal.confidence,
      sources: signal.sources.length ? signal.sources : ['learner_state_core'],
      evidenceCount: signal.evidenceIds.length || signal.sources.length || 1,
      explanation: params.explanation
    });

    state.coreState.stableProfile.learningGoals.slice(0, 4).forEach((signal) =>
      pushSignal(signal, {
        dimension: 'profileBase',
        label: 'Stable learning goal',
        userFacingLabel: '长期学习目标',
        signalType: 'stable_profile.learning_goal',
        explanation: 'Long-term learner profile: stable goal signal after governed consolidation.'
      })
    );
    state.coreState.workingState.currentCourseState.activeGoals.slice(0, 3).forEach((signal) =>
      pushSignal(signal, {
        dimension: 'profileBase',
        label: 'Working learning goal',
        userFacingLabel: '当前学习目标',
        signalType: 'working_state.active_goal',
        explanation: 'Working learner state: goal active in the current course/workbench context.'
      })
    );
    state.coreState.stableProfile.weakKnowledge.slice(0, 5).forEach((signal) =>
      pushSignal(signal, {
        dimension: 'knowledgeState',
        label: 'Stable weak knowledge',
        userFacingLabel: '长期薄弱知识',
        signalType: 'stable_profile.weak_knowledge',
        explanation: 'Stable profile: repeated evidence has made this more durable than a single observation.'
      })
    );
    state.coreState.stableProfile.masteredKnowledge.slice(0, 4).forEach((signal) =>
      pushSignal(signal, {
        dimension: 'knowledgeState',
        label: 'Mastered knowledge',
        userFacingLabel: '已掌握知识',
        signalType: 'stable_profile.mastered_knowledge',
        explanation: 'Stable profile: stronger mastery evidence available for this knowledge point.'
      })
    );
    state.coreState.stableProfile.learningPreferences.slice(0, 5).forEach((signal) =>
      pushSignal(signal, {
        dimension: 'preferenceStyle',
        label: 'Stable learning preference',
        userFacingLabel: '长期学习偏好',
        signalType: 'stable_profile.learning_preference',
        value: friendlyPreference(signal.value),
        explanation: 'Stable profile: this preference is treated as durable personalization.'
      })
    );
    state.coreState.stableProfile.commonErrors.slice(0, 4).forEach((signal) =>
      pushSignal(signal, {
        dimension: 'misconceptionState',
        label: 'Common error',
        userFacingLabel: '常见错误模式',
        signalType: 'stable_profile.common_error',
        explanation: 'Stable profile: candidate recurring error or misconception.'
      })
    );
    state.coreState.workingState.currentCourseState.focusKnowledge.slice(0, 5).forEach((signal) =>
      pushSignal(signal, {
        dimension: 'knowledgeState',
        label: 'Current focus knowledge',
        userFacingLabel: '当前学习位置/焦点',
        signalType: 'working_state.focus_knowledge',
        explanation: 'Working state: current focus, not necessarily a long-term learner trait.'
      })
    );
    state.coreState.workingState.recentBehaviorSummary.reviewPressure.slice(0, 4).forEach((signal) =>
      pushSignal(signal, {
        dimension: 'reviewPlanning',
        label: 'Review pressure',
        userFacingLabel: '当前复习压力',
        signalType: 'working_state.review_pressure',
        explanation: 'Working state: recent review signal that can shape immediate next actions.'
      })
    );
    state.coreState.observationMemory.observations.slice(0, 8).forEach((signal) =>
      pushSignal(signal, {
        dimension:
          signal.id.includes(':knowledgeState:') ? 'knowledgeState' :
            signal.id.includes(':preferenceStyle:') ? 'preferenceStyle' :
              signal.id.includes(':reviewPlanning:') ? 'reviewPlanning' :
                signal.id.includes(':misconceptionState:') ? 'misconceptionState' :
                  signal.id.includes(':behaviorEngagement:') ? 'behaviorEngagement' : 'profileBase',
        label: 'Short-term observation',
        userFacingLabel: signal.id.includes(':behaviorEngagement:') ? '短期行为观察' : '短期观察',
        signalType: 'observation_memory.short_term',
        explanation: 'Observation memory: short-term signal. It should not be treated as stable profile until repeated evidence promotes it.'
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
    const recentPatches = await prisma.$queryRawUnsafe<Array<{
      id: string;
      status: string;
      operation: string;
      confidence: number;
      rationale: string;
      createdAt: Date | string;
      appliedAt?: Date | string | null;
    }>>(
      `SELECT "id","status","operation","confidence","rationale","createdAt","appliedAt"
       FROM "LearnerStateTransition"
       WHERE "workspaceId" = ? AND "targetDimension" = ?
       ORDER BY "createdAt" DESC
       LIMIT 8`,
      input.workspaceId,
      dimension
    );
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
        createdAt: isoDate(patch.createdAt) || '',
        appliedAt: isoDate(patch.appliedAt)
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
      const state = await learnerStateService.ensureState({ workspaceId: input.workspaceId, workbenchId: input.workbenchId || null });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "LearnerStateTransition" ("id","status","proposedBy","targetDimension","operation","confidence","payloadJson","rationale","workspaceId","workbenchId","learnerStateCoreId")
         VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),?,?,?,?,?,?,?,?,?,?)`,
        'pending',
        'LearnerMemoryControl',
        input.dimension,
        'merge',
        input.action === 'correct' ? 0.9 : 0.75,
        JSON.stringify({
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
        'User memory control should influence future learner context.',
        input.workspaceId,
        input.workbenchId || null,
        state.id
      );
    }
    return control;
  }

  async lifecycle(input: { workspaceId: string; staleDays?: number }) {
    const staleSince = new Date(Date.now() - (input.staleDays || 120) * 24 * 60 * 60 * 1000);
    const staleEvidenceCount = await prisma.learnerEvidence.count({
      where: { workspaceId: input.workspaceId, observedAt: { lt: staleSince } }
    });
    const pendingPatchCount = Number((await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*) as count FROM "LearnerStateTransition" WHERE "workspaceId" = ? AND "status" = 'pending' AND "createdAt" < ?`,
      input.workspaceId,
      staleSince.toISOString()
    ))[0]?.count || 0);
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
    const [evidenceCount, transitionRows, appliedTransitionRows, controlCount, state] = await Promise.all([
      prisma.learnerEvidence.count({ where: { workspaceId: input.workspaceId } }),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(`SELECT COUNT(*) as count FROM "LearnerStateTransition" WHERE "workspaceId" = ?`, input.workspaceId),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(`SELECT COUNT(*) as count FROM "LearnerStateTransition" WHERE "workspaceId" = ? AND "status" = 'applied'`, input.workspaceId),
      prisma.learnerMemoryControl.count({ where: { workspaceId: input.workspaceId, status: 'active' } }),
      learnerStateService.ensureState({ workspaceId: input.workspaceId }).catch(() => null)
    ]);
    const sourceGroups = await prisma.learnerEvidence.groupBy({
      by: ['sourceType'],
      where: { workspaceId: input.workspaceId },
      _count: { sourceType: true }
    });
    const coverageScore = Math.min(1, sourceGroups.length / 4);
    const patchCount = Number(transitionRows[0]?.count || 0);
    const appliedPatchCount = Number(appliedTransitionRows[0]?.count || 0);
    const applicationRate = patchCount ? appliedPatchCount / patchCount : 0;
    const confidence = state ? Number(state.state.confidence.confidence || state.state.confidence.lastPatchConfidence || 0.45) : 0;
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

}

export const learnerMemoryControlService = new LearnerMemoryControlService();

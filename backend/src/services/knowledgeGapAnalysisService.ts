import prisma from '../config/db';
import { courseKnowledgeReasoningService } from './courseKnowledgeReasoningService';
import { targetKnowledgeStructureService, TargetKnowledgeStructure, TargetKnowledgeNode } from './targetKnowledgeStructureService';

type GapSeverity = 'none' | 'low' | 'medium' | 'high' | 'unknown';

export interface KnowledgeGapNode {
  targetNodeId: string;
  conceptId?: string | null;
  title: string;
  role: TargetKnowledgeNode['role'];
  requiredMastery: number;
  masteryEstimate: number | null;
  weaknessEstimate: number | null;
  readinessEstimate: number | null;
  evidenceStrength: number;
  status: 'covered' | 'partial' | 'gap' | 'blocked' | 'needs_evidence';
  severity: GapSeverity;
  gapScore: number;
  blockers: string[];
  evidenceNeeds: string[];
  recommendedAction: 'skip' | 'diagnose' | 'remediate' | 'practice' | 'assess';
}

export interface KnowledgeGapAnalysis {
  schema: 'knowledge_gap_analysis.v1';
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  targetStructureId: string;
  objective: string;
  summary: {
    targetNodeCount: number;
    coveredCount: number;
    partialCount: number;
    gapCount: number;
    blockedCount: number;
    needsEvidenceCount: number;
    overallReadiness: number;
    masteryCoverage: number;
    evidenceCoverage: number;
    highRiskCount: number;
  };
  nodes: KnowledgeGapNode[];
  prerequisiteBlockers: Array<{ from: string; to: string; reason: string; severity: GapSeverity }>;
  recommendedSequence: string[];
  nextActions: string[];
  confidence: number;
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const stringify = (value: unknown, fallback: unknown = {}) => {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
};

const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const evidenceStrengthFrom = (evidence: Record<string, any>, stateSourceIds: string[]) => {
  const signals = evidence.resourceSignals && typeof evidence.resourceSignals === 'object' ? evidence.resourceSignals : {};
  const resourceEvidence = Array.isArray(evidence.resourceEvidence) ? evidence.resourceEvidence.length : 0;
  return clamp01(
    Math.min(0.34, Number(signals.sourceCount || 0) * 0.08) +
    Math.min(0.24, Number(signals.assessmentCount || 0) * 0.08) +
    Math.min(0.18, resourceEvidence * 0.03) +
    Math.min(0.24, stateSourceIds.length * 0.06)
  );
};

export class KnowledgeGapAnalysisService {
  async analyze(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    objective?: string;
    targetStructure?: TargetKnowledgeStructure;
    persist?: boolean;
  }): Promise<{ analysis: KnowledgeGapAnalysis; targetStructure: TargetKnowledgeStructure; evidenceId?: string }> {
    const targetStructure = input.targetStructure || (await targetKnowledgeStructureService.build({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      objective: input.objective,
      persist: input.persist
    })).structure;

    const conceptIds = targetStructure.nodes.map((node) => node.conceptId).filter((id): id is string => Boolean(id));
    const [concepts, prerequisiteGaps] = await Promise.all([
      prisma.courseKnowledgeConcept.findMany({
        where: { workspaceId: input.workspaceId, id: { in: conceptIds } },
        include: {
          learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 },
          bindings: true
        }
      }),
      courseKnowledgeReasoningService.getPrerequisiteGaps({ workspaceId: input.workspaceId, conceptIds }).catch(() => [])
    ]);
    const conceptById = new Map(concepts.map((concept) => [concept.id, concept] as const));
    const gapByTargetTitle = new Map(prerequisiteGaps.map((gap: any) => [String(gap.targetConcept?.title || ''), gap] as const));

    const nodes = targetStructure.nodes.map((node) => {
      const concept = node.conceptId ? conceptById.get(node.conceptId) : null;
      const state = concept?.learnerStates?.[0];
      const sourceIds = parseJson<string[]>(state?.sourceSignalIdsJson, []);
      const conceptEvidence = parseJson<Record<string, any>>(concept?.evidenceJson, {});
      const evidenceStrength = concept ? evidenceStrengthFrom(conceptEvidence, sourceIds) : 0;
      const mastery = state?.masteryEstimate ?? null;
      const weakness = state?.weaknessEstimate ?? null;
      const readiness = state?.readinessEstimate ?? null;
      const requiredMastery = node.requiredMastery;
      const masteryGap = mastery === null ? 0.55 : Math.max(0, requiredMastery - mastery);
      const readinessGap = readiness === null ? 0.45 : Math.max(0, targetStructure.priorityPolicy.blockerThreshold - readiness);
      const evidenceGap = Math.max(0, targetStructure.priorityPolicy.evidenceThreshold - evidenceStrength);
      const graphGap = gapByTargetTitle.get(node.title);
      const blocked = Boolean(graphGap && Number((graphGap as any).gapScore || 0) >= 0.42);
      const gapScore = clamp01(masteryGap * 0.46 + readinessGap * 0.28 + evidenceGap * 0.18 + (blocked ? 0.24 : 0));
      const status =
        blocked ? 'blocked'
          : !concept || evidenceStrength < 0.25 ? 'needs_evidence'
            : mastery !== null && mastery >= requiredMastery && evidenceStrength >= targetStructure.priorityPolicy.evidenceThreshold ? 'covered'
              : gapScore >= 0.32 ? 'gap'
                : 'partial';
      const severity: GapSeverity =
        status === 'covered' ? 'none'
          : status === 'needs_evidence' ? 'unknown'
            : gapScore >= 0.62 ? 'high'
              : gapScore >= 0.38 ? 'medium'
                : 'low';
      const evidenceNeeds = node.evidenceRequired.filter((type) => {
        if (type === 'quiz_result') return !concept?.bindings.some((binding) => binding.bindingType === 'quiz');
        if (type === 'practice_attempt') return mastery === null || mastery < requiredMastery;
        return evidenceStrength < targetStructure.priorityPolicy.evidenceThreshold;
      });
      return {
        targetNodeId: node.id,
        conceptId: node.conceptId || null,
        title: node.title,
        role: node.role,
        requiredMastery,
        masteryEstimate: mastery,
        weaknessEstimate: weakness,
        readinessEstimate: readiness,
        evidenceStrength: Number(evidenceStrength.toFixed(3)),
        status,
        severity,
        gapScore: Number(gapScore.toFixed(3)),
        blockers: blocked ? [(graphGap as any).prerequisite?.title || 'prerequisite gap'] : [],
        evidenceNeeds,
        recommendedAction:
          status === 'covered' ? 'skip'
            : status === 'needs_evidence' ? 'diagnose'
              : blocked ? 'remediate'
                : node.role === 'assessment' ? 'assess'
                  : 'practice'
      } satisfies KnowledgeGapNode;
    });

    const prerequisiteBlockers = targetStructure.edges
      .filter((edge) => edge.relationType === 'prerequisite' && edge.required)
      .flatMap((edge) => {
        const from = nodes.find((node) => node.targetNodeId === edge.from);
        const to = nodes.find((node) => node.targetNodeId === edge.to);
        if (!from || !to) return [];
        if (from.status === 'covered') return [];
        return [{
          from: from.title,
          to: to.title,
          reason: `${from.title} is required before ${to.title}, current status=${from.status}.`,
          severity: from.severity
        }];
      });

    const sorted = [...nodes].sort((left, right) => {
      const actionWeight = (node: KnowledgeGapNode) => node.status === 'blocked' ? 4 : node.status === 'gap' ? 3 : node.status === 'needs_evidence' ? 2 : node.status === 'partial' ? 1 : 0;
      return actionWeight(right) - actionWeight(left) || right.gapScore - left.gapScore;
    });
    const summary = {
      targetNodeCount: nodes.length,
      coveredCount: nodes.filter((node) => node.status === 'covered').length,
      partialCount: nodes.filter((node) => node.status === 'partial').length,
      gapCount: nodes.filter((node) => node.status === 'gap').length,
      blockedCount: nodes.filter((node) => node.status === 'blocked').length,
      needsEvidenceCount: nodes.filter((node) => node.status === 'needs_evidence').length,
      overallReadiness: Number(avg(nodes.map((node) => node.readinessEstimate ?? 0.38)).toFixed(3)),
      masteryCoverage: Number((nodes.filter((node) => node.masteryEstimate !== null && node.masteryEstimate >= node.requiredMastery).length / Math.max(nodes.length, 1)).toFixed(3)),
      evidenceCoverage: Number(avg(nodes.map((node) => node.evidenceStrength)).toFixed(3)),
      highRiskCount: nodes.filter((node) => node.severity === 'high').length
    };
    const analysis: KnowledgeGapAnalysis = {
      schema: 'knowledge_gap_analysis.v1',
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: targetStructure.goalId || input.goalId || null,
      targetStructureId: targetStructure.id,
      objective: targetStructure.objective,
      summary,
      nodes,
      prerequisiteBlockers,
      recommendedSequence: sorted.map((node) => node.targetNodeId).slice(0, 18),
      nextActions: sorted
        .filter((node) => node.status !== 'covered')
        .slice(0, 6)
        .map((node) => `${node.recommendedAction}:${node.title}`),
      confidence: Number(clamp01(targetStructure.confidence * 0.55 + summary.evidenceCoverage * 0.25 + Math.min(0.2, nodes.length * 0.01)).toFixed(3))
    };

    let evidenceId: string | undefined;
    if (input.persist) {
      const evidence = await prisma.learnerEvidence.create({
        data: {
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          goalId: analysis.goalId || null,
          evidenceType: 'knowledge_gap_analysis',
          sourceType: 'gap_analysis_engine',
          sourceId: analysis.targetStructureId,
          actor: 'system',
          title: `Knowledge gap analysis: ${analysis.objective}`,
          summary: `covered=${summary.coveredCount}, gaps=${summary.gapCount}, blocked=${summary.blockedCount}, needsEvidence=${summary.needsEvidenceCount}.`,
          payloadJson: stringify({ targetStructure, analysis }),
          confidence: analysis.confidence
        }
      });
      evidenceId = evidence.id;
    }

    return { analysis, targetStructure, evidenceId };
  }
}

export const knowledgeGapAnalysisService = new KnowledgeGapAnalysisService();

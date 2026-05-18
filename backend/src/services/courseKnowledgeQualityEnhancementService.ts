import prisma from '../config/db';
import { stableHash } from './chunkSchema';

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

const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

type QualityAction = {
  action: 'merge_candidate' | 'downgrade_relation' | 'promote_relation' | 'needs_evidence' | 'canonicalize_alias' | 'add_assessment_binding';
  severity: 'info' | 'warning' | 'critical';
  targetType: string;
  targetId?: string;
  confidence: number;
  rationale: string;
  payload: Record<string, unknown>;
};

export class CourseKnowledgeQualityEnhancementService {
  async enhance(input: { workspaceId: string; apply?: boolean; minConfidence?: number }) {
    const minConfidence = input.minConfidence ?? 0.58;
    const [concepts, relations, bindings] = await Promise.all([
      prisma.courseKnowledgeConcept.findMany({
        where: { workspaceId: input.workspaceId, status: 'active' },
        include: {
          bindings: true,
          incomingRelations: true,
          outgoingRelations: true,
          learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 },
          misconceptions: true
        },
        take: 1200
      }),
      prisma.courseKnowledgeRelation.findMany({
        where: { workspaceId: input.workspaceId },
        include: { fromConcept: true, toConcept: true },
        take: 2400
      }),
      prisma.courseKnowledgeBinding.findMany({ where: { workspaceId: input.workspaceId }, take: 2400 })
    ]);

    const actions: QualityAction[] = [
      ...this.detectCanonicalizationActions(concepts),
      ...this.detectEvidenceActions(concepts),
      ...this.scoreRelationActions(relations, bindings),
      ...this.detectAssessmentCoverageActions(concepts)
    ].sort((a, b) => b.confidence - a.confidence);

    if (input.apply) {
      for (const action of actions.filter((item) => item.confidence >= minConfidence).slice(0, 80)) {
        await this.applyAction(input.workspaceId, action).catch((error) => console.warn('KG quality action failed:', error));
      }
    }

    const relationConfidence = avg(relations.map((relation) => relation.confidence));
    const conceptEvidenceCoverage = concepts.filter((concept) => {
      const evidence = parseJson<Record<string, unknown>>(concept.evidenceJson, {});
      return Object.keys(evidence).length > 0 && concept.source !== 'system';
    }).length / Math.max(concepts.length, 1);
    const duplicateRisk = actions.filter((action) => action.action === 'merge_candidate').length / Math.max(concepts.length, 1);
    const assessmentCoverage = concepts.filter((concept) => concept.bindings.some((binding) => binding.bindingType === 'quiz' || binding.bindingType === 'task')).length / Math.max(concepts.length, 1);
    const graphQualityScore = clamp01(
      conceptEvidenceCoverage * 0.28 +
      relationConfidence * 0.24 +
      assessmentCoverage * 0.18 +
      (1 - duplicateRisk) * 0.18 +
      Math.min(1, bindings.length / Math.max(concepts.length, 1)) * 0.12
    );

    const report = {
      schema: 'course_kg_quality_enhancement.v1',
      method: {
        extraction: 'EDC-style Extract-Define-Canonicalize quality loop over existing KG candidates',
        validation: 'KGValidator-style structural checks plus evidence/provenance confidence scoring',
        retrievalGrounding: 'GraphRAG-inspired dual view: concept graph quality is judged with resource/evidence bindings',
        governance: 'Actions are logged and only high-confidence changes are applied when requested'
      },
      workspaceId: input.workspaceId,
      applied: Boolean(input.apply),
      summary: {
        conceptCount: concepts.length,
        relationCount: relations.length,
        bindingCount: bindings.length,
        actionCount: actions.length,
        highConfidenceActionCount: actions.filter((action) => action.confidence >= minConfidence).length,
        graphQualityScore: Number(graphQualityScore.toFixed(3)),
        conceptEvidenceCoverage: Number(conceptEvidenceCoverage.toFixed(3)),
        averageRelationConfidence: Number(relationConfidence.toFixed(3)),
        assessmentCoverage: Number(assessmentCoverage.toFixed(3)),
        duplicateRisk: Number(duplicateRisk.toFixed(3))
      },
      actions: actions.slice(0, 120)
    };

    await prisma.courseKnowledgeGovernanceLog.create({
      data: {
        workspaceId: input.workspaceId,
        action: input.apply ? 'kg_quality_enhancement_applied' : 'kg_quality_enhancement_review',
        targetType: 'course_knowledge_graph',
        targetId: input.workspaceId,
        beforeJson: '{}',
        afterJson: stringify(report.summary),
        rationale: `KG quality enhancement ${input.apply ? 'applied' : 'reviewed'}: quality=${report.summary.graphQualityScore}, actions=${report.summary.actionCount}.`,
        confidence: report.summary.graphQualityScore
      }
    });

    return report;
  }

  private detectCanonicalizationActions(concepts: Array<any>): QualityAction[] {
    const buckets = new Map<string, Array<any>>();
    concepts.forEach((concept) => {
      const aliases = parseJson<string[]>(concept.aliasesJson, []);
      const keys = Array.from(new Set([concept.title, ...aliases].map(normalize).filter((key) => key.length >= 2)));
      keys.forEach((key) => buckets.set(key, [...(buckets.get(key) || []), concept]));
    });
    const actions: QualityAction[] = [];
    buckets.forEach((items, key) => {
      const uniqueConcepts = Array.from(new Map(items.map((item) => [item.id, item])).values());
      if (uniqueConcepts.length < 2) return;
      const canonical = uniqueConcepts
        .sort((a, b) => (b.bindings.length + b.incomingRelations.length + b.outgoingRelations.length) - (a.bindings.length + a.incomingRelations.length + a.outgoingRelations.length))[0];
      const duplicates = uniqueConcepts.filter((concept) => concept.id !== canonical.id);
      actions.push({
        action: 'merge_candidate',
        severity: 'warning',
        targetType: 'course_knowledge_concept',
        targetId: canonical.id,
        confidence: 0.78,
        rationale: `Multiple active concepts share canonical alias "${key}".`,
        payload: {
          canonicalConceptId: canonical.id,
          canonicalTitle: canonical.title,
          duplicateConceptIds: duplicates.map((concept) => concept.id),
          duplicateTitles: duplicates.map((concept) => concept.title),
          alias: key
        }
      });
    });
    concepts.forEach((concept) => {
      const normalizedTitle = normalize(concept.title);
      const aliases = parseJson<string[]>(concept.aliasesJson, []);
      if (normalizedTitle && !aliases.map(normalize).includes(normalizedTitle)) {
        actions.push({
          action: 'canonicalize_alias',
          severity: 'info',
          targetType: 'course_knowledge_concept',
          targetId: concept.id,
          confidence: 0.68,
          rationale: 'Concept title is missing from normalized alias set.',
          payload: { conceptId: concept.id, title: concept.title, normalizedAlias: normalizedTitle }
        });
      }
    });
    return actions;
  }

  private detectEvidenceActions(concepts: Array<any>): QualityAction[] {
    return concepts.flatMap((concept) => {
      const evidence = parseJson<Record<string, unknown>>(concept.evidenceJson, {});
      const evidenceScore =
        (Object.keys(evidence).length ? 0.34 : 0) +
        Math.min(0.32, concept.bindings.length * 0.08) +
        Math.min(0.18, (concept.incomingRelations.length + concept.outgoingRelations.length) * 0.03) +
        Math.min(0.16, concept.learnerStates.length * 0.08);
      if (evidenceScore >= 0.45) return [];
      return [{
        action: 'needs_evidence' as const,
        severity: concept.bindings.length ? 'info' as const : 'warning' as const,
        targetType: 'course_knowledge_concept',
        targetId: concept.id,
        confidence: Number((1 - evidenceScore).toFixed(3)),
        rationale: `Concept "${concept.title}" lacks enough extraction provenance, bindings, or learner evidence.`,
        payload: {
          conceptId: concept.id,
          title: concept.title,
          evidenceScore: Number(evidenceScore.toFixed(3)),
          source: concept.source,
          bindingCount: concept.bindings.length,
          relationCount: concept.incomingRelations.length + concept.outgoingRelations.length
        }
      }];
    });
  }

  private scoreRelationActions(relations: Array<any>, bindings: Array<any>): QualityAction[] {
    const bindingByConcept = new Map<string, number>();
    bindings.forEach((binding) => bindingByConcept.set(binding.conceptId, (bindingByConcept.get(binding.conceptId) || 0) + binding.confidence));
    const actions: QualityAction[] = [];
    relations.forEach((relation) => {
      const structuralSupport =
        relation.relationType === 'prerequisite' ? 0.18 :
          relation.relationType === 'part_of' ? 0.14 :
            relation.relationType === 'related' ? 0.08 : 0.1;
      const endpointEvidence = clamp01(((bindingByConcept.get(relation.fromConceptId) || 0) + (bindingByConcept.get(relation.toConceptId) || 0)) / 4);
      const textOverlap = this.tokenOverlap(relation.fromConcept.title, relation.toConcept.title);
      const recomputed = clamp01(relation.weight * 0.32 + relation.confidence * 0.24 + endpointEvidence * 0.2 + structuralSupport + textOverlap * 0.16);
      if (recomputed < 0.38 && relation.confidence > 0.38) {
        actions.push({
          action: 'downgrade_relation' as const,
          severity: 'warning' as const,
          targetType: 'course_knowledge_relation',
          targetId: relation.id,
          confidence: Number((1 - recomputed).toFixed(3)),
          rationale: `${relation.relationType} edge has weak endpoint evidence and low semantic overlap.`,
          payload: { relationId: relation.id, from: relation.fromConcept.title, to: relation.toConcept.title, recomputedConfidence: Number(recomputed.toFixed(3)) }
        });
        return;
      }
      if (recomputed >= 0.72 && relation.confidence < recomputed - 0.08) {
        actions.push({
          action: 'promote_relation' as const,
          severity: 'info' as const,
          targetType: 'course_knowledge_relation',
          targetId: relation.id,
          confidence: Number(recomputed.toFixed(3)),
          rationale: `${relation.relationType} edge has enough structural and evidence support for confidence promotion.`,
          payload: { relationId: relation.id, from: relation.fromConcept.title, to: relation.toConcept.title, recomputedConfidence: Number(recomputed.toFixed(3)) }
        });
      }
    });
    return actions;
  }

  private detectAssessmentCoverageActions(concepts: Array<any>): QualityAction[] {
    return concepts
      .filter((concept) => {
        const weak = concept.learnerStates[0]?.weaknessEstimate ?? 0.3;
        const hasAssessment = concept.bindings.some((binding: any) => binding.bindingType === 'quiz' || binding.bindingType === 'task');
        return weak >= 0.48 && !hasAssessment;
      })
      .map((concept) => ({
        action: 'add_assessment_binding' as const,
        severity: 'warning' as const,
        targetType: 'course_knowledge_concept',
        targetId: concept.id,
        confidence: Number(Math.min(0.86, 0.48 + (concept.learnerStates[0]?.weaknessEstimate || 0.3) * 0.44).toFixed(3)),
        rationale: `Weak concept "${concept.title}" lacks quiz/task evidence, so diagnosis and planning cannot close the loop.`,
        payload: { conceptId: concept.id, title: concept.title, weaknessEstimate: concept.learnerStates[0]?.weaknessEstimate ?? null }
      }));
  }

  private async applyAction(workspaceId: string, action: QualityAction) {
    if (action.action === 'canonicalize_alias' && action.targetId) {
      const concept = await prisma.courseKnowledgeConcept.findFirst({ where: { id: action.targetId, workspaceId } });
      if (!concept) return;
      const aliases = parseJson<string[]>(concept.aliasesJson, []);
      const nextAliases = Array.from(new Set([...aliases, concept.title, String(action.payload.normalizedAlias || '')].filter(Boolean)));
      await prisma.courseKnowledgeConcept.update({
        where: { id: concept.id },
        data: {
          aliasesJson: stringify(nextAliases, []),
          evidenceJson: stringify({
            ...parseJson<Record<string, unknown>>(concept.evidenceJson, {}),
            qualityEnhancement: { action: action.action, confidence: action.confidence, appliedAt: new Date().toISOString() }
          })
        }
      });
    }
    if ((action.action === 'downgrade_relation' || action.action === 'promote_relation') && action.targetId) {
      const relation = await prisma.courseKnowledgeRelation.findFirst({ where: { id: action.targetId, workspaceId } });
      if (!relation) return;
      const recomputed = Number(action.payload.recomputedConfidence);
      await prisma.courseKnowledgeRelation.update({
        where: { id: relation.id },
        data: {
          confidence: clamp01(Number.isFinite(recomputed) ? recomputed : relation.confidence),
          evidenceJson: stringify({
            ...parseJson<Record<string, unknown>>(relation.evidenceJson, {}),
            qualityEnhancement: { action: action.action, confidence: action.confidence, appliedAt: new Date().toISOString() }
          })
        }
      });
    }
    await prisma.courseKnowledgeGovernanceLog.create({
      data: {
        workspaceId,
        action: `kg_quality_${action.action}`,
        targetType: action.targetType,
        targetId: action.targetId || stableHash(action.payload).slice(0, 16),
        beforeJson: '{}',
        afterJson: stringify(action.payload),
        rationale: action.rationale,
        confidence: action.confidence,
        status: action.confidence >= 0.58 ? 'completed' : 'candidate'
      }
    });
  }

  private tokenOverlap(a: string, b: string) {
    const left = new Set(normalize(a).split(' ').filter(Boolean));
    const right = new Set(normalize(b).split(' ').filter(Boolean));
    if (!left.size || !right.size) return 0;
    const intersection = Array.from(left).filter((token) => right.has(token)).length;
    return intersection / Math.max(left.size, right.size);
  }
}

export const courseKnowledgeQualityEnhancementService = new CourseKnowledgeQualityEnhancementService();

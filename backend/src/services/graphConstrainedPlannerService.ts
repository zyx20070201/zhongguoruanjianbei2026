import prisma from '../config/db';
import { isProbablyKnowledgeConcept } from './learnerSignalSanitizer';
import { learningDiagnosisEngine } from './learningDiagnosisEngine';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

type PlannerConcept = {
  concept: {
    id: string;
    title: string;
  };
  diagnosis: string;
  masteryEstimate: number;
  weaknessEstimate: number;
  readinessEstimate: number;
  confidence: number;
};

const stepLoadFor = (concept: PlannerConcept, index: number) => {
  if (index === 0 || concept.readinessEstimate < 0.45) return 'light';
  if (concept.weaknessEstimate > 0.68 || concept.masteryEstimate < 0.42) return 'medium';
  return 'medium';
};

export class GraphConstrainedPlannerService {
  async buildCandidatePath(input: {
    workspaceId: string;
    objective?: string;
    conceptIds?: string[];
    maxConcepts?: number;
  }) {
    const diagnosis = await learningDiagnosisEngine.diagnose({
      workspaceId: input.workspaceId,
      conceptIds: input.conceptIds,
      limit: Math.min(Math.max(input.maxConcepts || 8, 1), 24)
    });

    const candidateConcepts = (diagnosis.concepts as PlannerConcept[])
      .filter((concept) => isProbablyKnowledgeConcept(concept.concept.title))
      .filter((concept) => ['weak', 'prerequisite_gap', 'developing'].includes(concept.diagnosis))
      .sort((a, b) => {
        const scoreA = a.weaknessEstimate * 0.45 + (1 - a.readinessEstimate) * 0.35 + (1 - a.confidence) * 0.2;
        const scoreB = b.weaknessEstimate * 0.45 + (1 - b.readinessEstimate) * 0.35 + (1 - b.confidence) * 0.2;
        return scoreB - scoreA;
      })
      .slice(0, Math.min(Math.max(input.maxConcepts || 6, 1), 12));

    const conceptIds = candidateConcepts.map((concept) => concept.concept.id);
    const [relations, bindings] = await Promise.all([
      prisma.courseKnowledgeRelation.findMany({
        where: {
          workspaceId: input.workspaceId,
          source: 'ai_kg_extraction',
          OR: [{ fromConceptId: { in: conceptIds } }, { toConceptId: { in: conceptIds } }]
        },
        include: { fromConcept: true, toConcept: true },
        orderBy: { weight: 'desc' },
        take: 120
      }),
      prisma.courseKnowledgeBinding.findMany({
        where: { workspaceId: input.workspaceId, conceptId: { in: conceptIds } },
        orderBy: [{ strength: 'desc' }, { confidence: 'desc' }],
        take: 120
      })
    ]);

    const prerequisitesByTarget = new Map<string, string[]>();
    relations
      .filter((relation) => relation.relationType === 'prerequisite' && isProbablyKnowledgeConcept(relation.fromConcept.title) && isProbablyKnowledgeConcept(relation.toConcept.title))
      .forEach((relation) => {
        const list = prerequisitesByTarget.get(relation.toConceptId) || [];
        list.push(relation.fromConcept.title);
        prerequisitesByTarget.set(relation.toConceptId, list);
      });

    const bindingsByConcept = new Map<string, typeof bindings>();
    bindings.forEach((binding) => {
      const list = bindingsByConcept.get(binding.conceptId) || [];
      list.push(binding);
      bindingsByConcept.set(binding.conceptId, list);
    });

    const orderedConcepts = this.topologicalSort(candidateConcepts, relations);
    const allSteps = orderedConcepts.flatMap((concept, index) => {
      const support = (bindingsByConcept.get(concept.concept.id) || [])[0];
      const prereqs = prerequisitesByTarget.get(concept.concept.id) || [];
      const difficulty = Math.max(1, Math.min(5, Math.round(1 + concept.readinessEstimate * 3 + (concept.weaknessEstimate < 0.45 ? 1 : 0))));
      const load = stepLoadFor(concept, index);
      const base = {
        conceptId: concept.concept.id,
        conceptTitle: concept.concept.title,
        prerequisites: prereqs.slice(0, 5),
        resourceBinding: support
          ? {
              bindingType: support.bindingType,
              targetType: support.targetType,
              targetId: support.targetId,
              role: support.role,
              strength: support.strength,
              confidence: support.confidence,
              evidence: parseJson<Record<string, unknown>>(support.evidenceJson, {})
            }
          : null,
        difficulty,
        estimatedLoad: load,
        zpdScore: clamp01(1 - Math.abs(concept.readinessEstimate - 0.62) - Math.max(0, concept.weaknessEstimate - 0.75) * 0.3),
        cognitiveLoadScore: load === 'light' ? 0.86 : 0.72
      };
      return [
        {
          ...base,
          stepType: concept.diagnosis === 'prerequisite_gap' ? 'diagnose' : 'explain',
          title: concept.diagnosis === 'prerequisite_gap' ? `诊断前置缺口：${concept.concept.title}` : `建立概念模型：${concept.concept.title}`,
          rationale: concept.diagnosis === 'prerequisite_gap'
            ? 'GraphMASAL-style prerequisite edge indicates this concept should not be planned as an isolated target.'
            : 'Use KG-bound resources first, then move into practice evidence.'
        },
        {
          ...base,
          stepType: 'practice',
          title: `针对练习：${concept.concept.title}`,
          rationale: 'Convert concept exposure into observable performance evidence for learner-state update.',
          estimatedLoad: concept.weaknessEstimate > 0.7 ? 'medium' : load,
          cognitiveLoadScore: concept.weaknessEstimate > 0.7 ? 0.68 : base.cognitiveLoadScore
        },
        {
          ...base,
          stepType: 'quiz',
          title: `检测掌握度：${concept.concept.title}`,
          rationale: 'Assessment evidence closes the DeepTutor-style interaction-memory loop.',
          estimatedLoad: 'light',
          cognitiveLoadScore: 0.84
        }
      ];
    });
    const steps = this.greedyCoverSteps(allSteps).slice(0, 18);

    const scores = {
      graphConstraintCoverage: Number((steps.filter((step) => step.prerequisites.length || step.resourceBinding).length / Math.max(steps.length, 1)).toFixed(3)),
      zpdFit: Number(avg(steps.map((step) => step.zpdScore)).toFixed(3)),
      cognitiveLoadFit: Number(avg(steps.map((step) => step.cognitiveLoadScore)).toFixed(3)),
      evidenceClosure: Number((steps.filter((step) => ['diagnose', 'quiz', 'practice'].includes(step.stepType)).length / Math.max(steps.length, 1)).toFixed(3))
    };

    return {
      schema: 'graph_constrained_plan_candidates.v1',
      workspaceId: input.workspaceId,
      objective: input.objective || 'graph-constrained adaptive learning path',
      diagnosisSummary: diagnosis.summary,
      targetConcepts: orderedConcepts.map((concept) => ({
        id: concept.concept.id,
        title: concept.concept.title,
        diagnosis: concept.diagnosis,
        weaknessEstimate: concept.weaknessEstimate,
        readinessEstimate: concept.readinessEstimate,
        confidence: concept.confidence
      })),
      steps,
      constraints: [
        'prerequisite concepts must be diagnosed or remediated before target practice',
        'every high-priority concept should produce observable evidence',
        'resource/task/quiz bindings are preferred over ungrounded generated steps',
        'low-readiness concepts start with lower cognitive-load actions'
      ],
      scores
    };
  }

  private greedyCoverSteps(steps: Array<Record<string, any>>) {
    const required = new Set(steps.map((step) => step.conceptId).filter(Boolean));
    const covered = new Set<string>();
    const selected: Array<Record<string, any>> = [];
    const remaining = [...steps];
    while (covered.size < required.size && remaining.length) {
      remaining.sort((a, b) => {
        const gainA = (covered.has(a.conceptId) ? 0.25 : 1) + (a.stepType === 'quiz' ? 0.2 : a.stepType === 'practice' ? 0.15 : 0.1);
        const gainB = (covered.has(b.conceptId) ? 0.25 : 1) + (b.stepType === 'quiz' ? 0.2 : b.stepType === 'practice' ? 0.15 : 0.1);
        const costA = (1 - Number(a.zpdScore || 0.5)) + (1 - Number(a.cognitiveLoadScore || 0.5)) + (a.resourceBinding ? 0 : 0.18);
        const costB = (1 - Number(b.zpdScore || 0.5)) + (1 - Number(b.cognitiveLoadScore || 0.5)) + (b.resourceBinding ? 0 : 0.18);
        return (gainB / Math.max(costB, 0.1)) - (gainA / Math.max(costA, 0.1));
      });
      const next = remaining.shift();
      if (!next) break;
      selected.push({
        ...next,
        msmsCost: Number(((1 - Number(next.zpdScore || 0.5)) * 0.45 + (1 - Number(next.cognitiveLoadScore || 0.5)) * 0.35 + (next.resourceBinding ? 0 : 0.2)).toFixed(3)),
        coverageGain: covered.has(next.conceptId) ? 0.25 : 1
      });
      covered.add(next.conceptId);
      const paired = remaining.findIndex((step) => step.conceptId === next.conceptId && step.stepType === 'quiz');
      if (paired >= 0 && !selected.some((step) => step.conceptId === next.conceptId && step.stepType === 'quiz')) {
        const quiz = remaining.splice(paired, 1)[0];
        selected.push({ ...quiz, msmsCost: 0.22, coverageGain: 0.35 });
      }
    }
    const diagnosticFirst = selected.sort((a, b) => {
      const weight = (step: any) => step.stepType === 'diagnose' ? 0 : step.stepType === 'explain' ? 1 : step.stepType === 'practice' ? 2 : step.stepType === 'quiz' ? 3 : 4;
      return weight(a) - weight(b);
    });
    return diagnosticFirst.length ? diagnosticFirst : steps;
  }

  private topologicalSort(concepts: PlannerConcept[], relations: Array<{ fromConceptId: string; toConceptId: string; relationType: string; weight: number }>) {
    const byId = new Map(concepts.map((concept) => [concept.concept.id, concept]));
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    concepts.forEach((concept) => incoming.set(concept.concept.id, 0));
    relations
      .filter((relation) => relation.relationType === 'prerequisite' && byId.has(relation.fromConceptId) && byId.has(relation.toConceptId))
      .forEach((relation) => {
        incoming.set(relation.toConceptId, (incoming.get(relation.toConceptId) || 0) + 1);
        outgoing.set(relation.fromConceptId, [...(outgoing.get(relation.fromConceptId) || []), relation.toConceptId]);
      });
    const queue = concepts
      .filter((concept) => (incoming.get(concept.concept.id) || 0) === 0)
      .sort((a, b) => b.weaknessEstimate - a.weaknessEstimate);
    const result: PlannerConcept[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      result.push(current);
      (outgoing.get(current.concept.id) || []).forEach((nextId) => {
        incoming.set(nextId, (incoming.get(nextId) || 1) - 1);
        if ((incoming.get(nextId) || 0) === 0 && byId.has(nextId)) queue.push(byId.get(nextId)!);
      });
    }
    const emitted = new Set(result.map((concept) => concept.concept.id));
    return [
      ...result,
      ...concepts.filter((concept) => !emitted.has(concept.concept.id)).sort((a, b) => b.weaknessEstimate - a.weaknessEstimate)
    ];
  }
}

export const graphConstrainedPlannerService = new GraphConstrainedPlannerService();

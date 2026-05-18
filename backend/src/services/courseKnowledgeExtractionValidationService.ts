import prisma from '../config/db';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

type IssueSeverity = 'info' | 'warning' | 'critical';

export class CourseKnowledgeExtractionValidationService {
  async validate(input: { workspaceId: string }) {
    const [concepts, relations, bindings, misconceptions, files, quizEvents] = await Promise.all([
      prisma.courseKnowledgeConcept.findMany({ where: { workspaceId: input.workspaceId, status: 'active' }, include: { bindings: true, incomingRelations: true, outgoingRelations: true, misconceptions: true } }),
      prisma.courseKnowledgeRelation.findMany({ where: { workspaceId: input.workspaceId }, include: { fromConcept: true, toConcept: true } }),
      prisma.courseKnowledgeBinding.findMany({ where: { workspaceId: input.workspaceId } }),
      prisma.courseKnowledgeMisconception.findMany({ where: { workspaceId: input.workspaceId } }),
      prisma.fileSystemObject.count({ where: { workspaceId: input.workspaceId, nodeType: 'file', knowledgeChunks: { some: {} } } }),
      prisma.learningEvent.count({ where: { workspaceId: input.workspaceId, eventFamily: 'assessment' } }).catch(() => 0)
    ]);

    const issues: Array<{ severity: IssueSeverity; code: string; message: string; target?: Record<string, unknown>; recommendation: string }> = [];
    const aliasBuckets = new Map<string, string[]>();
    concepts.forEach((concept) => {
      const aliases = parseJson<string[]>(concept.aliasesJson, []);
      [concept.title, ...aliases].map(normalize).filter(Boolean).forEach((alias) => {
        aliasBuckets.set(alias, [...(aliasBuckets.get(alias) || []), concept.id]);
      });
    });
    aliasBuckets.forEach((ids, alias) => {
      const uniqueIds = Array.from(new Set(ids));
      if (uniqueIds.length > 1) {
        issues.push({
          severity: 'warning',
          code: 'possible_duplicate_concept',
          message: `Multiple concepts share alias "${alias}".`,
          target: { alias, conceptIds: uniqueIds },
          recommendation: 'Review aliases and merge duplicate concepts or add disambiguating descriptions.'
        });
      }
    });

    concepts.forEach((concept) => {
      if (!concept.bindings.length) {
        issues.push({
          severity: 'warning',
          code: 'concept_without_binding',
          message: `Concept "${concept.title}" is not linked to resources, tasks, quizzes, or events.`,
          target: { conceptId: concept.id, title: concept.title },
          recommendation: 'Bind at least one resource and one assessment/evidence source to this concept.'
        });
      }
      if (!concept.incomingRelations.length && !concept.outgoingRelations.length) {
        issues.push({
          severity: 'info',
          code: 'isolated_concept',
          message: `Concept "${concept.title}" is isolated in the KG.`,
          target: { conceptId: concept.id, title: concept.title },
          recommendation: 'Add prerequisite, part-of, related, supports, assesses, or remediates edges.'
        });
      }
      if (concept.difficulty > 0.72 && !concept.incomingRelations.some((relation) => relation.relationType === 'prerequisite')) {
        issues.push({
          severity: 'warning',
          code: 'advanced_concept_without_prerequisites',
          message: `High-difficulty concept "${concept.title}" has no prerequisite edges.`,
          target: { conceptId: concept.id, difficulty: concept.difficulty },
          recommendation: 'Add prerequisite relations so graph-constrained planning can avoid unsupported jumps.'
        });
      }
      const evidence = parseJson<Record<string, unknown>>(concept.evidenceJson, {});
      if (!Object.keys(evidence).length || concept.source === 'system') {
        issues.push({
          severity: 'info',
          code: 'weak_extraction_evidence',
          message: `Concept "${concept.title}" has weak extraction provenance.`,
          target: { conceptId: concept.id, source: concept.source },
          recommendation: 'Attach file/chunk/question/event evidence to support auditable KG construction.'
        });
      }
    });

    relations.forEach((relation) => {
      if (relation.confidence < 0.45) {
        issues.push({
          severity: 'warning',
          code: 'low_confidence_relation',
          message: `${relation.relationType} relation ${relation.fromConcept.title} -> ${relation.toConcept.title} has low confidence.`,
          target: { relationId: relation.id, confidence: relation.confidence },
          recommendation: 'Review this edge with extracted source evidence or learner co-evidence.'
        });
      }
    });

    const cycleEdges = relations.filter((relation) => relation.relationType === 'prerequisite');
    const cycles = this.detectCycles(cycleEdges);
    cycles.forEach((cycle) => {
      issues.push({
        severity: 'critical',
        code: 'prerequisite_cycle',
        message: `Prerequisite cycle detected: ${cycle.join(' -> ')}.`,
        target: { conceptIds: cycle },
        recommendation: 'Break the cycle by changing one edge to related/supports or reversing the incorrect prerequisite.'
      });
    });

    const resourceBindings = bindings.filter((binding) => binding.bindingType === 'resource');
    const quizBindings = bindings.filter((binding) => binding.bindingType === 'quiz');
    const coverage = {
      conceptsWithResources: concepts.filter((concept) => concept.bindings.some((binding) => binding.bindingType === 'resource')).length,
      conceptsWithAssessments: concepts.filter((concept) => concept.bindings.some((binding) => binding.bindingType === 'quiz' || binding.bindingType === 'task')).length,
      resourceBindingRatio: Number((resourceBindings.length / Math.max(files, 1)).toFixed(3)),
      quizBindingRatio: Number((quizBindings.length / Math.max(quizEvents, 1)).toFixed(3)),
      misconceptionBindingRatio: Number((misconceptions.length / Math.max(concepts.length, 1)).toFixed(3))
    };

    const critical = issues.filter((issue) => issue.severity === 'critical').length;
    const warning = issues.filter((issue) => issue.severity === 'warning').length;
    const qualityScore = Math.max(0, Math.min(1,
      0.35 * (coverage.conceptsWithResources / Math.max(concepts.length, 1)) +
      0.25 * (coverage.conceptsWithAssessments / Math.max(concepts.length, 1)) +
      0.2 * (1 - warning / Math.max(concepts.length + relations.length, 1)) +
      0.2 * (critical ? 0 : 1)
    ));

    return {
      schema: 'course_kg_validation_report.v1',
      workspaceId: input.workspaceId,
      summary: {
        conceptCount: concepts.length,
        relationCount: relations.length,
        bindingCount: bindings.length,
        misconceptionCount: misconceptions.length,
        criticalIssues: critical,
        warningIssues: warning,
        qualityScore: Number(qualityScore.toFixed(3))
      },
      coverage,
      issues
    };
  }

  async validateAndLog(input: { workspaceId: string }) {
    const validation = await this.validate(input);
    await prisma.courseKnowledgeGovernanceLog.create({
      data: {
        workspaceId: input.workspaceId,
        action: 'kg_validation_snapshot',
        targetType: 'course_knowledge_graph',
        targetId: input.workspaceId,
        beforeJson: '{}',
        afterJson: JSON.stringify(validation.summary),
        rationale: `KG validation completed: quality=${validation.summary.qualityScore}, critical=${validation.summary.criticalIssues}, warning=${validation.summary.warningIssues}.`,
        confidence: validation.summary.qualityScore
      }
    });
    return validation;
  }

  private detectCycles(relations: Array<{ fromConceptId: string; toConceptId: string }>) {
    const outgoing = new Map<string, string[]>();
    relations.forEach((relation) => outgoing.set(relation.fromConceptId, [...(outgoing.get(relation.fromConceptId) || []), relation.toConceptId]));
    const cycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const path: string[] = [];
    const dfs = (node: string) => {
      if (visiting.has(node)) {
        const start = path.indexOf(node);
        if (start >= 0) cycles.push(path.slice(start).concat(node));
        return;
      }
      if (visited.has(node)) return;
      visiting.add(node);
      path.push(node);
      (outgoing.get(node) || []).forEach(dfs);
      path.pop();
      visiting.delete(node);
      visited.add(node);
    };
    Array.from(outgoing.keys()).forEach(dfs);
    return cycles.slice(0, 20);
  }
}

export const courseKnowledgeExtractionValidationService = new CourseKnowledgeExtractionValidationService();

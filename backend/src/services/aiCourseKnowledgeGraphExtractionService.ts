import prisma from '../config/db';
import { stableHash } from './chunkSchema';
import { aiModelProviderService } from './aiModelProviderService';
import { ResourceIntelligence, resourceIntelligenceService } from './resourceIntelligenceService';
import { isStrictCourseKnowledgeConcept } from './courseKnowledgeConceptRules';

type RelationType = 'prerequisite' | 'related' | 'part_of' | 'supports' | 'assesses' | 'remediates';
type ConceptKind = 'concept' | 'skill' | 'procedure' | 'application' | 'assessment' | 'misconception';
type ExerciseType = 'question' | 'task' | 'quiz' | 'coding' | 'design' | 'calculation' | 'explanation';

export interface AiKgEvidenceRef {
  chunkId?: string;
  chunkIndex?: number;
  sectionId?: string;
  quote?: string;
  rationale?: string;
}

export interface AiKgExtractedConcept {
  localId: string;
  title: string;
  description?: string;
  aliases?: string[];
  kind?: ConceptKind;
  difficulty?: number;
  confidence?: number;
  evidenceRefs?: AiKgEvidenceRef[];
}

export interface AiKgExtractedRelation {
  localId: string;
  fromLocalId: string;
  toLocalId: string;
  relationType: RelationType;
  description?: string;
  weight?: number;
  confidence?: number;
  evidenceRefs?: AiKgEvidenceRef[];
}

export interface AiKgExtractedMisconception {
  localId: string;
  conceptLocalId: string;
  title: string;
  description?: string;
  repairHint?: string;
  severity?: number;
  confidence?: number;
  evidenceRefs?: AiKgEvidenceRef[];
}

export interface AiKgExtractedExercise {
  localId: string;
  title: string;
  prompt: string;
  exerciseType?: ExerciseType;
  difficulty?: number;
  answer?: unknown;
  explanation?: string;
  conceptLocalIds?: string[];
  conceptTitles?: string[];
  confidence?: number;
  evidenceRefs?: AiKgEvidenceRef[];
}

export interface AiKgCanonicalConcept extends AiKgExtractedConcept {
  action: 'existing' | 'new';
  existingConceptId?: string | null;
  canonicalTitle: string;
  canonicalAliases: string[];
  canonicalRationale?: string;
}

export interface AiKgApprovedConcept extends AiKgCanonicalConcept {
  approved: boolean;
  reviewConfidence: number;
  reviewIssues: string[];
}

export interface AiKgApprovedRelation extends AiKgExtractedRelation {
  approved: boolean;
  reviewConfidence: number;
  reviewIssues: string[];
}

export interface AiKgApprovedMisconception extends AiKgExtractedMisconception {
  approved: boolean;
  reviewConfidence: number;
  reviewIssues: string[];
}

export interface AiKgApprovedExercise extends AiKgExtractedExercise {
  approved: boolean;
  reviewConfidence: number;
  reviewIssues: string[];
}

export interface AiKgCommunity {
  id: string;
  title: string;
  summary: string;
  conceptLocalIds: string[];
  relationLocalIds: string[];
  learningSequence?: string[];
  evidenceRefs?: AiKgEvidenceRef[];
  confidence?: number;
}

export interface AiCourseKnowledgeGraphExtraction {
  schema: 'ai_course_knowledge_graph_extraction.v1';
  workspaceId: string;
  fileObjectId: string;
  source: string;
  models: {
    resourceSemantic?: string;
    extraction?: string;
    canonicalization?: string;
    review?: string;
    communities?: string;
  };
  resource: {
    fileName: string;
    path: string;
    intelligenceStatus: ResourceIntelligence['status'];
    overview?: string;
    sectionCount: number;
  };
  chunks: Array<{
    id: string;
    chunkIndex: number;
    summary?: string | null;
    text: string;
    metadata: Record<string, unknown>;
  }>;
  concepts: AiKgApprovedConcept[];
  relations: AiKgApprovedRelation[];
  exercises: AiKgApprovedExercise[];
  misconceptions: AiKgApprovedMisconception[];
  communities: AiKgCommunity[];
  trace: {
    extractedConceptCount: number;
    extractedRelationCount: number;
    extractedExerciseCount?: number;
    extractedMisconceptionCount: number;
    approvedConceptCount: number;
    approvedRelationCount: number;
    approvedExerciseCount: number;
    approvedMisconceptionCount: number;
  };
}

type ExtractionModelOutput = {
  concepts?: AiKgExtractedConcept[];
  relations?: AiKgExtractedRelation[];
  exercises?: AiKgExtractedExercise[];
  misconceptions?: AiKgExtractedMisconception[];
};

type CanonicalizationModelOutput = {
  mappings?: Array<{
    localId: string;
    action: 'existing' | 'new';
    existingConceptId?: string | null;
    canonicalTitle?: string;
    canonicalAliases?: string[];
    rationale?: string;
  }>;
};

type ReviewModelOutput = {
  concepts?: Array<{ localId: string; approved: boolean; confidence?: number; issues?: string[] }>;
  relations?: Array<{ localId: string; approved: boolean; confidence?: number; issues?: string[] }>;
  exercises?: Array<{ localId: string; approved: boolean; confidence?: number; issues?: string[] }>;
  misconceptions?: Array<{ localId: string; approved: boolean; confidence?: number; issues?: string[] }>;
};

type CommunitiesModelOutput = {
  communities?: AiKgCommunity[];
};

const AI_KG_TIMEOUT_MS = Number(process.env.AI_COURSE_KG_TIMEOUT_MS || 70000);
const AI_KG_PROVIDER = (process.env.AI_COURSE_KG_PROVIDER || 'local').trim().toLowerCase();
const AI_KG_BASE_URL = (process.env.AI_COURSE_KG_BASE_URL || '').replace(/\/$/, '');
const AI_KG_API_KEY = process.env.AI_COURSE_KG_API_KEY || '';
const AI_KG_REMOTE_TIMEOUT_MS = Number(process.env.AI_COURSE_KG_REMOTE_TIMEOUT_MS || 4 * 60 * 1000);
const MAX_CHUNKS = Math.max(8, Number(process.env.AI_COURSE_KG_MAX_CHUNKS || 24));
const MAX_EXISTING_CONCEPTS = Math.max(40, Number(process.env.AI_COURSE_KG_CANONICAL_CANDIDATES || 180));

const clamp01 = (value: unknown, fallback = 0.5) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
};

const clip = (value: unknown, max = 900) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const unique = (items: Array<string | null | undefined>, max = 12) =>
  Array.from(new Set(items.map((item) => clip(item, 160)).filter(Boolean))).slice(0, max);

const parseJsonObject = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const compactChunkMetadata = (metadata: Record<string, unknown>) => ({
  chunkType: clip(metadata.chunkType, 80) || undefined,
  purpose: clip(metadata.purpose, 80) || undefined,
  headingPath: Array.isArray(metadata.headingPath) ? metadata.headingPath.map((item) => clip(item, 120)).filter(Boolean).slice(0, 8) : undefined,
  locator: metadata.locator && typeof metadata.locator === 'object' ? metadata.locator : undefined,
  pageStart: metadata.pageStart,
  pageEnd: metadata.pageEnd,
  sectionId: clip(metadata.sectionId, 80) || undefined
});

const localIdFor = (prefix: string, value: unknown, index: number) =>
  `${prefix}-${stableHash([value, index]).slice(0, 10)}`;

const evidenceKey = (ref: AiKgEvidenceRef) =>
  `${ref.chunkId || ''}:${ref.chunkIndex ?? ''}:${ref.sectionId || ''}:${clip(ref.quote, 120)}`;

const relationTypes = new Set<RelationType>(['prerequisite', 'related', 'part_of', 'supports', 'assesses', 'remediates']);
const conceptKinds = new Set<ConceptKind>(['concept', 'skill', 'procedure', 'application', 'assessment', 'misconception']);
const exerciseTypes = new Set<ExerciseType>(['question', 'task', 'quiz', 'coding', 'design', 'calculation', 'explanation']);

export class AiCourseKnowledgeGraphExtractionService {
  async extract(input: {
    workspaceId: string;
    fileObjectId: string;
    source?: string;
  }): Promise<AiCourseKnowledgeGraphExtraction> {
    this.assertConfigured();

    const file = await prisma.fileSystemObject.findFirst({
      where: { id: input.fileObjectId, workspaceId: input.workspaceId },
      include: { knowledgeChunks: { orderBy: { chunkIndex: 'asc' }, take: MAX_CHUNKS } }
    });
    if (!file) throw new Error('AI KG extraction failed: file not found');
    if (!file.knowledgeChunks.length) throw new Error(`AI KG extraction failed: ${file.name} has no indexed chunks`);

    const resourceSemantic = await this.buildResourceSemanticLayer(input.workspaceId, input.fileObjectId);
    const chunks = file.knowledgeChunks.map((chunk) => ({
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      summary: chunk.summary,
      text: clip(chunk.text, 1500),
      metadata: compactChunkMetadata(parseJsonObject(chunk.metadataJson))
    }));

    if (AI_KG_PROVIDER === 'autodl') {
      return this.extractWithRemoteWorker({
        workspaceId: input.workspaceId,
        file: { id: file.id, name: file.name, path: file.path },
        source: input.source || 'ai_course_kg',
        resourceSemantic,
        chunks
      });
    }

    const extraction = await this.extractConceptsAndRelations({
      file: { id: file.id, name: file.name, path: file.path },
      resourceSemantic,
      chunks
    });
    const normalizedExtraction = this.normalizeExtraction(extraction.data, chunks);

    const canonicalized = await this.canonicalize({
      workspaceId: input.workspaceId,
      extraction: normalizedExtraction,
      fileName: file.name
    });

    const review = await this.review({
      file: { id: file.id, name: file.name, path: file.path },
      resourceSemantic,
      chunks,
      concepts: canonicalized.concepts,
      relations: normalizedExtraction.relations,
      exercises: normalizedExtraction.exercises,
      misconceptions: normalizedExtraction.misconceptions
    });

    const reviewed = this.applyReview(canonicalized.concepts, normalizedExtraction.relations, normalizedExtraction.exercises, normalizedExtraction.misconceptions, review.data);
    const communities = await this.summarizeCommunities({
      file: { id: file.id, name: file.name, path: file.path },
      concepts: reviewed.concepts.filter((concept) => concept.approved),
      relations: reviewed.relations.filter((relation) => relation.approved),
      chunks,
      resourceSemantic
    });

    return {
      schema: 'ai_course_knowledge_graph_extraction.v1',
      workspaceId: input.workspaceId,
      fileObjectId: input.fileObjectId,
      source: input.source || 'ai_course_kg',
      models: {
        resourceSemantic: resourceSemantic.model,
        extraction: extraction.model,
        canonicalization: canonicalized.model,
        review: review.model,
        communities: communities.model
      },
      resource: {
        fileName: file.name,
        path: file.path,
        intelligenceStatus: resourceSemantic.status,
        overview: resourceSemantic.overview,
        sectionCount: resourceSemantic.sections.length
      },
      chunks,
      concepts: reviewed.concepts,
      relations: reviewed.relations,
      exercises: reviewed.exercises,
      misconceptions: reviewed.misconceptions,
      communities: communities.communities,
      trace: {
        extractedConceptCount: normalizedExtraction.concepts.length,
        extractedRelationCount: normalizedExtraction.relations.length,
        extractedMisconceptionCount: normalizedExtraction.misconceptions.length,
        approvedConceptCount: reviewed.concepts.filter((concept) => concept.approved).length,
        approvedRelationCount: reviewed.relations.filter((relation) => relation.approved).length,
        approvedExerciseCount: reviewed.exercises.filter((exercise) => exercise.approved).length,
        approvedMisconceptionCount: reviewed.misconceptions.filter((item) => item.approved).length
      }
    };
  }

  private assertConfigured() {
    if (AI_KG_PROVIDER === 'autodl') {
      if (!AI_KG_BASE_URL) throw new Error('AI KG extraction failed: AI_COURSE_KG_BASE_URL is not configured');
      return;
    }
    const requiredUseCases: Array<'resource' | 'learning'> = ['resource', 'learning'];
    const missing = requiredUseCases.filter((useCase) => !aiModelProviderService.isConfigured({ useCase }));
    if (missing.length) {
      throw new Error(`AI KG extraction failed: model provider is not configured for ${missing.join(', ')}`);
    }
  }

  private async extractWithRemoteWorker(input: {
    workspaceId: string;
    file: { id: string; name: string; path: string };
    source: string;
    resourceSemantic: ResourceIntelligence;
    chunks: AiCourseKnowledgeGraphExtraction['chunks'];
  }): Promise<AiCourseKnowledgeGraphExtraction> {
    const existingConcepts = await prisma.courseKnowledgeConcept.findMany({
      where: { workspaceId: input.workspaceId, status: 'active' },
      orderBy: [{ activationScore: 'desc' }, { updatedAt: 'desc' }],
      take: MAX_EXISTING_CONCEPTS,
      select: { id: true, title: true, aliasesJson: true, description: true, category: true, difficulty: true }
    });
    const response = await fetch(`${AI_KG_BASE_URL}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(AI_KG_API_KEY ? { Authorization: `Bearer ${AI_KG_API_KEY}` } : {})
      },
      signal: AbortSignal.timeout(AI_KG_REMOTE_TIMEOUT_MS),
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        fileObjectId: input.file.id,
        source: input.source,
        resource: input.file,
        semanticLayer: {
          status: input.resourceSemantic.status,
          model: input.resourceSemantic.model,
          overview: input.resourceSemantic.overview,
          readingAdvice: input.resourceSemantic.readingAdvice,
          sections: input.resourceSemantic.sections.slice(0, 40).map((section) => ({
            id: section.id,
            title: section.title,
            summary: section.summary,
            rangeLabel: section.rangeLabel,
            evidence: clip(section.evidence || section.evidenceSnippets?.slice(0, 2).map((item) => item.text).join('\n'), 700)
          })),
          transcript: input.resourceSemantic.transcript?.slice(0, 16).map((segment) => ({
            id: segment.id,
            title: segment.title,
            text: clip(segment.text, 700),
            locator: segment.locator
          }))
        },
        chunks: input.chunks,
        existingCourseConcepts: existingConcepts.map((concept) => ({
          id: concept.id,
          title: concept.title,
          aliases: this.parseAliases(concept.aliasesJson),
          description: concept.description,
          category: concept.category,
          difficulty: concept.difficulty
        }))
      })
    });
    const data = await response.json().catch(() => null) as Partial<AiCourseKnowledgeGraphExtraction> & { error?: string } | null;
    if (!response.ok) {
      const detail = (data as any)?.detail;
      throw new Error(
        data?.error ||
        (typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : '') ||
        `AI KG remote worker failed with status ${response.status}`
      );
    }
    if (!data || !Array.isArray(data.concepts) || !Array.isArray(data.relations) || !Array.isArray(data.misconceptions)) {
      throw new Error('AI KG remote worker returned an invalid extraction payload');
    }
    return {
      schema: 'ai_course_knowledge_graph_extraction.v1',
      workspaceId: input.workspaceId,
      fileObjectId: input.file.id,
      source: input.source,
      models: {
        resourceSemantic: input.resourceSemantic.model,
        ...(data.models || {})
      },
      resource: {
        fileName: input.file.name,
        path: input.file.path,
        intelligenceStatus: input.resourceSemantic.status,
        overview: input.resourceSemantic.overview,
        sectionCount: input.resourceSemantic.sections.length
      },
      chunks: input.chunks,
      concepts: data.concepts as AiKgApprovedConcept[],
      relations: data.relations as AiKgApprovedRelation[],
      exercises: Array.isArray(data.exercises) ? data.exercises as AiKgApprovedExercise[] : [],
      misconceptions: data.misconceptions as AiKgApprovedMisconception[],
      communities: Array.isArray(data.communities) ? data.communities as AiKgCommunity[] : [],
      trace: data.trace || {
        extractedConceptCount: data.concepts.length,
        extractedRelationCount: data.relations.length,
        extractedExerciseCount: Array.isArray(data.exercises) ? data.exercises.length : 0,
        extractedMisconceptionCount: data.misconceptions.length,
        approvedConceptCount: data.concepts.filter((concept: any) => concept.approved).length,
        approvedRelationCount: data.relations.filter((relation: any) => relation.approved).length,
        approvedExerciseCount: Array.isArray(data.exercises) ? data.exercises.filter((exercise: any) => exercise.approved).length : 0,
        approvedMisconceptionCount: data.misconceptions.filter((item: any) => item.approved).length
      }
    };
  }

  private async buildResourceSemanticLayer(workspaceId: string, fileObjectId: string) {
    const analysis = await resourceIntelligenceService.analyze(workspaceId, fileObjectId);
    if (!analysis.model) {
      throw new Error(`AI KG extraction failed: resource semantic layer did not use a model (${analysis.status}${analysis.error ? `: ${analysis.error}` : ''})`);
    }
    if (analysis.status === 'failed' || !analysis.sections.length) {
      throw new Error(`AI KG extraction failed: resource semantic layer failed (${analysis.error || 'empty semantic sections'})`);
    }
    return analysis;
  }

  private async extractConceptsAndRelations(input: {
    file: { id: string; name: string; path: string };
    resourceSemantic: ResourceIntelligence;
    chunks: AiCourseKnowledgeGraphExtraction['chunks'];
  }) {
    return aiModelProviderService.json<ExtractionModelOutput>({
      useCase: 'learning',
      timeoutMs: AI_KG_TIMEOUT_MS,
      instruction: [
        'You are CourseKnowledgeGraphExtractor in a production learning graph system.',
        'Extract stable course knowledge points, misconceptions, and typed relations only from the supplied evidence.',
        'Also extract concrete high-value exercises/questions/tasks into exercises, but never put exercise text into concepts.',
        'Every concept and relation must cite chunkId/chunkIndex or sectionId evidence. Do not infer from heading order, co-occurrence, or formatting alone.',
        'Prefer teachable, assessable concepts and skills. Avoid labels, page titles, logistics, UI text, file names, and generic words.',
        'Do not create concept nodes for exercise/question/query/task sentences, concrete assessment instances, resource titles, examples, or prompt-like commands. Put useful concrete questions/tasks into exercises and bind them to concept localIds.',
        'Only keep exercises that are specific enough to practice or assess a concept and can be bound to at least one extracted concept.',
        'Use relationType precisely: prerequisite means the source is needed before the target; part_of means structural inclusion; supports means evidence or example support; assesses means an assessment evaluates a concept; remediates means it repairs a misconception; related is weak semantic relation.',
        'If evidence is insufficient, return fewer items. JSON only.'
      ].join('\n'),
      schema: {
        concepts: [{
          localId: 'stable local id like c1',
          title: 'canonical concept title',
          description: 'short grounded definition',
          aliases: ['alternate names from evidence'],
          kind: 'concept|skill|procedure|application|assessment|misconception',
          difficulty: 0.5,
          confidence: 0.8,
          evidenceRefs: [{ chunkId: 'string', chunkIndex: 0, sectionId: 'string optional', quote: 'short exact evidence quote', rationale: 'why this evidence supports the concept' }]
        }],
        relations: [{
          localId: 'stable local id like r1',
          fromLocalId: 'concept localId',
          toLocalId: 'concept localId',
          relationType: 'prerequisite|related|part_of|supports|assesses|remediates',
          description: 'short grounded relation statement',
          weight: 0.7,
          confidence: 0.8,
          evidenceRefs: [{ chunkId: 'string', chunkIndex: 0, quote: 'short exact evidence quote', rationale: 'why relation is supported' }]
        }],
        exercises: [{
          localId: 'stable local id like e1',
          title: 'short exercise title',
          prompt: 'full question or task prompt',
          exerciseType: 'question|task|quiz|coding|design|calculation|explanation',
          difficulty: 0.5,
          answer: 'optional answer or structured answer object',
          explanation: 'optional solving explanation',
          conceptLocalIds: ['concept localId assessed or practiced'],
          conceptTitles: ['concept titles assessed or practiced'],
          confidence: 0.8,
          evidenceRefs: [{ chunkId: 'string', chunkIndex: 0, sectionId: 'string optional', quote: 'short exact evidence quote', rationale: 'why this is a useful exercise' }]
        }],
        misconceptions: [{
          localId: 'stable local id like m1',
          conceptLocalId: 'concept localId',
          title: 'misconception title',
          description: 'what is wrong',
          repairHint: 'how to repair',
          severity: 0.5,
          confidence: 0.7,
          evidenceRefs: [{ chunkId: 'string', chunkIndex: 0, quote: 'short exact evidence quote' }]
        }]
      },
      input: {
        resource: input.file,
        semanticLayer: {
          model: input.resourceSemantic.model,
          overview: input.resourceSemantic.overview,
          readingAdvice: input.resourceSemantic.readingAdvice,
          sections: input.resourceSemantic.sections.slice(0, 30).map((section) => ({
            id: section.id,
            title: section.title,
            summary: section.summary,
            rangeLabel: section.rangeLabel,
            evidence: clip(section.evidence || section.evidenceSnippets?.slice(0, 2).map((item) => item.text).join('\n'), 700)
          })),
          transcript: input.resourceSemantic.transcript?.slice(0, 12).map((segment) => ({
            id: segment.id,
            title: segment.title,
            text: clip(segment.text, 700),
            locator: segment.locator
          }))
        },
        chunks: input.chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          summary: chunk.summary,
          metadata: chunk.metadata,
          text: chunk.text
        }))
      }
    });
  }

  private normalizeExtraction(output: ExtractionModelOutput, chunks: AiCourseKnowledgeGraphExtraction['chunks']) {
    const chunkIds = new Set(chunks.map((chunk) => chunk.id));
    const chunkIndexes = new Set(chunks.map((chunk) => chunk.chunkIndex));
    const normalizeRefs = (refs: AiKgEvidenceRef[] | undefined) => {
      const byKey = new Map<string, AiKgEvidenceRef>();
      (Array.isArray(refs) ? refs : []).forEach((ref) => {
        const next = {
          chunkId: ref.chunkId && chunkIds.has(ref.chunkId) ? ref.chunkId : undefined,
          chunkIndex: typeof ref.chunkIndex === 'number' && chunkIndexes.has(ref.chunkIndex) ? ref.chunkIndex : undefined,
          sectionId: clip(ref.sectionId, 80) || undefined,
          quote: clip(ref.quote, 360) || undefined,
          rationale: clip(ref.rationale, 260) || undefined
        };
        if (!next.chunkId && next.chunkIndex === undefined && !next.sectionId) return;
        byKey.set(evidenceKey(next), next);
      });
      return Array.from(byKey.values()).slice(0, 8);
    };

    const concepts = (Array.isArray(output.concepts) ? output.concepts : [])
      .map((concept, index) => ({
        localId: clip(concept.localId, 60) || localIdFor('c', concept.title, index),
        title: clip(concept.title, 140),
        description: clip(concept.description, 420),
        aliases: unique(concept.aliases || [], 8),
        kind: conceptKinds.has(concept.kind as ConceptKind) ? concept.kind : 'concept',
        difficulty: clamp01(concept.difficulty, 0.5),
        confidence: clamp01(concept.confidence, 0.6),
        evidenceRefs: normalizeRefs(concept.evidenceRefs)
      }))
      .filter((concept) => concept.title && concept.evidenceRefs.length && isStrictCourseKnowledgeConcept(concept.title));

    const conceptIds = new Set(concepts.map((concept) => concept.localId));
    const relations = (Array.isArray(output.relations) ? output.relations : [])
      .map((relation, index) => ({
        localId: clip(relation.localId, 60) || localIdFor('r', `${relation.fromLocalId}:${relation.toLocalId}`, index),
        fromLocalId: clip(relation.fromLocalId, 60),
        toLocalId: clip(relation.toLocalId, 60),
        relationType: relationTypes.has(relation.relationType) ? relation.relationType : 'related',
        description: clip(relation.description, 360),
        weight: clamp01(relation.weight, 0.6),
        confidence: clamp01(relation.confidence, 0.58),
        evidenceRefs: normalizeRefs(relation.evidenceRefs)
      }))
      .filter((relation) => conceptIds.has(relation.fromLocalId) && conceptIds.has(relation.toLocalId) && relation.fromLocalId !== relation.toLocalId && relation.evidenceRefs.length);

    const conceptsByTitle = new Map(concepts.flatMap((concept) => [
      [concept.title.toLowerCase(), concept.localId],
      ...(concept.aliases || []).map((alias) => [alias.toLowerCase(), concept.localId] as const)
    ]));
    const exercises = (Array.isArray(output.exercises) ? output.exercises : [])
      .map((exercise, index) => {
        const conceptLocalIds = unique([
          ...(Array.isArray(exercise.conceptLocalIds) ? exercise.conceptLocalIds : []),
          ...(Array.isArray(exercise.conceptTitles)
            ? exercise.conceptTitles.map((title) => conceptsByTitle.get(clip(title, 140).toLowerCase()) || '')
            : [])
        ], 8).filter((id) => conceptIds.has(id));
        return {
          localId: clip(exercise.localId, 60) || localIdFor('e', exercise.prompt || exercise.title, index),
          title: clip(exercise.title || exercise.prompt, 180),
          prompt: clip(exercise.prompt || exercise.title, 1200),
          exerciseType: exerciseTypes.has(exercise.exerciseType as ExerciseType) ? exercise.exerciseType : 'question',
          difficulty: clamp01(exercise.difficulty, 0.5),
          answer: exercise.answer ?? null,
          explanation: clip(exercise.explanation, 900),
          conceptLocalIds,
          conceptTitles: unique(exercise.conceptTitles || [], 8),
          confidence: clamp01(exercise.confidence, 0.62),
          evidenceRefs: normalizeRefs(exercise.evidenceRefs)
        };
      })
      .filter((exercise) => exercise.title && exercise.prompt.length >= 8 && exercise.conceptLocalIds.length && exercise.evidenceRefs.length);

    const misconceptions = (Array.isArray(output.misconceptions) ? output.misconceptions : [])
      .map((item, index) => ({
        localId: clip(item.localId, 60) || localIdFor('m', item.title, index),
        conceptLocalId: clip(item.conceptLocalId, 60),
        title: clip(item.title, 160),
        description: clip(item.description, 420),
        repairHint: clip(item.repairHint, 420),
        severity: clamp01(item.severity, 0.5),
        confidence: clamp01(item.confidence, 0.58),
        evidenceRefs: normalizeRefs(item.evidenceRefs)
      }))
      .filter((item) => item.title && conceptIds.has(item.conceptLocalId) && item.evidenceRefs.length);

    return { concepts, relations, exercises, misconceptions };
  }

  private async canonicalize(input: {
    workspaceId: string;
    fileName: string;
    extraction: {
      concepts: AiKgExtractedConcept[];
      relations: AiKgExtractedRelation[];
      exercises: AiKgExtractedExercise[];
      misconceptions: AiKgExtractedMisconception[];
    };
  }) {
    const existingConcepts = await prisma.courseKnowledgeConcept.findMany({
      where: { workspaceId: input.workspaceId, status: 'active' },
      orderBy: [{ activationScore: 'desc' }, { updatedAt: 'desc' }],
      take: MAX_EXISTING_CONCEPTS,
      select: { id: true, title: true, aliasesJson: true, description: true, category: true, difficulty: true, evidenceJson: true }
    });

    const response = await aiModelProviderService.json<CanonicalizationModelOutput>({
      useCase: 'learning',
      timeoutMs: AI_KG_TIMEOUT_MS,
      instruction: [
        'You are CourseKnowledgeCanonicalizer.',
        'Decide whether each newly extracted concept is the same knowledge concept as an existing course graph concept.',
        'Use semantic equivalence, not string equality. Keep distinct concepts separate when scope, level, or meaning differs.',
        'For existing matches, return the exact existingConceptId. For new concepts, return action=new.',
        'Return one mapping for every extracted concept. JSON only.'
      ].join('\n'),
      schema: {
        mappings: [{
          localId: 'extracted concept localId',
          action: 'existing|new',
          existingConceptId: 'existing concept id or null',
          canonicalTitle: 'canonical title to persist',
          canonicalAliases: ['merged aliases'],
          rationale: 'semantic identity rationale'
        }]
      },
      input: {
        sourceFile: input.fileName,
        extractedConcepts: input.extraction.concepts.map((concept) => ({
          localId: concept.localId,
          title: concept.title,
          description: concept.description,
          aliases: concept.aliases,
          kind: concept.kind,
          evidenceRefs: concept.evidenceRefs
        })),
        existingCourseConcepts: existingConcepts.map((concept) => ({
          id: concept.id,
          title: concept.title,
          aliases: this.parseAliases(concept.aliasesJson),
          description: concept.description,
          category: concept.category,
          difficulty: concept.difficulty
        }))
      }
    });

    const existingIds = new Set(existingConcepts.map((concept) => concept.id));
    const mappings = new Map((Array.isArray(response.data.mappings) ? response.data.mappings : []).map((mapping) => [mapping.localId, mapping]));
    const concepts = input.extraction.concepts.map((concept) => {
      const mapping = mappings.get(concept.localId);
      const action = mapping?.action === 'existing' && mapping.existingConceptId && existingIds.has(mapping.existingConceptId) ? 'existing' : 'new';
      return {
        ...concept,
        action,
        existingConceptId: action === 'existing' ? mapping?.existingConceptId || null : null,
        canonicalTitle: clip(mapping?.canonicalTitle || concept.title, 140),
        canonicalAliases: unique([...(mapping?.canonicalAliases || []), ...(concept.aliases || []), concept.title], 12),
        canonicalRationale: clip(mapping?.rationale, 360)
      } satisfies AiKgCanonicalConcept;
    });

    return { concepts, model: response.model };
  }

  private async review(input: {
    file: { id: string; name: string; path: string };
    resourceSemantic: ResourceIntelligence;
    chunks: AiCourseKnowledgeGraphExtraction['chunks'];
    concepts: AiKgCanonicalConcept[];
    relations: AiKgExtractedRelation[];
    misconceptions: AiKgExtractedMisconception[];
    exercises: AiKgExtractedExercise[];
  }) {
    return aiModelProviderService.json<ReviewModelOutput>({
      useCase: 'learning',
      timeoutMs: AI_KG_TIMEOUT_MS,
      instruction: [
        'You are CourseKnowledgeGraphReviewer.',
        'Review the extracted course graph before persistence.',
        'Approve only concepts and relations directly supported by supplied evidence. Reject generic labels, duplicated noise, over-broad terms, unsupported prerequisite claims, and relations whose evidence only shows co-occurrence.',
        'Reject exercise/question/query/task sentences, concrete assessment instances, resource or file titles, prompt-like commands, and examples used as concept nodes. The main graph should contain only reusable knowledge points.',
        'Approve exercises only when they are concrete, source-grounded, non-generic, and bound to at least one approved concept.',
        'Do not add new concepts or relations. Return approvals, confidence, and issues. JSON only.'
      ].join('\n'),
      schema: {
        concepts: [{ localId: 'concept localId', approved: true, confidence: 0.8, issues: ['string'] }],
        relations: [{ localId: 'relation localId', approved: true, confidence: 0.8, issues: ['string'] }],
        exercises: [{ localId: 'exercise localId', approved: true, confidence: 0.8, issues: ['string'] }],
        misconceptions: [{ localId: 'misconception localId', approved: true, confidence: 0.8, issues: ['string'] }]
      },
      input: {
        resource: input.file,
        semanticLayer: {
          overview: input.resourceSemantic.overview,
          sections: input.resourceSemantic.sections.slice(0, 30).map((section) => ({
            id: section.id,
            title: section.title,
            summary: section.summary,
            evidence: clip(section.evidence || section.evidenceSnippets?.slice(0, 2).map((item) => item.text).join('\n'), 700)
          }))
        },
        chunks: input.chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          summary: chunk.summary,
          text: chunk.text
        })),
        concepts: input.concepts,
        relations: input.relations,
        exercises: input.exercises,
        misconceptions: input.misconceptions
      }
    });
  }

  private applyReview(
    concepts: AiKgCanonicalConcept[],
    relations: AiKgExtractedRelation[],
    exercises: AiKgExtractedExercise[],
    misconceptions: AiKgExtractedMisconception[],
    review: ReviewModelOutput
  ) {
    const conceptReview = new Map((Array.isArray(review.concepts) ? review.concepts : []).map((item) => [item.localId, item]));
    const relationReview = new Map((Array.isArray(review.relations) ? review.relations : []).map((item) => [item.localId, item]));
    const exerciseReview = new Map((Array.isArray(review.exercises) ? review.exercises : []).map((item) => [item.localId, item]));
    const misconceptionReview = new Map((Array.isArray(review.misconceptions) ? review.misconceptions : []).map((item) => [item.localId, item]));

    const reviewedConcepts = concepts.map((concept) => {
      const verdict = conceptReview.get(concept.localId);
      const validKnowledgePoint = isStrictCourseKnowledgeConcept(concept.canonicalTitle || concept.title);
      return {
        ...concept,
        approved: verdict?.approved === true && validKnowledgePoint,
        reviewConfidence: clamp01(verdict?.confidence, 0.5),
        reviewIssues: unique([...(verdict?.issues || []), ...(validKnowledgePoint ? [] : ['not_stable_knowledge_point'])], 8)
      } satisfies AiKgApprovedConcept;
    });
    const approvedConceptIds = new Set(reviewedConcepts.filter((concept) => concept.approved).map((concept) => concept.localId));

    const reviewedRelations = relations.map((relation) => {
      const verdict = relationReview.get(relation.localId);
      return {
        ...relation,
        approved: verdict?.approved === true && approvedConceptIds.has(relation.fromLocalId) && approvedConceptIds.has(relation.toLocalId),
        reviewConfidence: clamp01(verdict?.confidence, 0.5),
        reviewIssues: unique(verdict?.issues || [], 8)
      } satisfies AiKgApprovedRelation;
    });

    const reviewedExercises = exercises.map((exercise) => {
      const verdict = exerciseReview.get(exercise.localId);
      const linkedConceptIds = unique(exercise.conceptLocalIds || [], 8).filter((id) => approvedConceptIds.has(id));
      return {
        ...exercise,
        conceptLocalIds: linkedConceptIds,
        approved: verdict?.approved === true && linkedConceptIds.length > 0,
        reviewConfidence: clamp01(verdict?.confidence, 0.5),
        reviewIssues: unique([...(verdict?.issues || []), ...(linkedConceptIds.length ? [] : ['no_approved_concept_binding'])], 8)
      } satisfies AiKgApprovedExercise;
    });

    const reviewedMisconceptions = misconceptions.map((item) => {
      const verdict = misconceptionReview.get(item.localId);
      return {
        ...item,
        approved: verdict?.approved === true && approvedConceptIds.has(item.conceptLocalId),
        reviewConfidence: clamp01(verdict?.confidence, 0.5),
        reviewIssues: unique(verdict?.issues || [], 8)
      } satisfies AiKgApprovedMisconception;
    });

    return { concepts: reviewedConcepts, relations: reviewedRelations, exercises: reviewedExercises, misconceptions: reviewedMisconceptions };
  }

  private async summarizeCommunities(input: {
    file: { id: string; name: string; path: string };
    resourceSemantic: ResourceIntelligence;
    chunks: AiCourseKnowledgeGraphExtraction['chunks'];
    concepts: AiKgApprovedConcept[];
    relations: AiKgApprovedRelation[];
  }) {
    if (!input.concepts.length) return { communities: [] as AiKgCommunity[], model: undefined };
    const response = await aiModelProviderService.json<CommunitiesModelOutput>({
      useCase: 'learning',
      timeoutMs: AI_KG_TIMEOUT_MS,
      instruction: [
        'You are CourseKnowledgeCommunitySummarizer.',
        'Group approved course graph concepts into coherent learning communities or sections.',
        'Summaries must describe what the community teaches and how it fits a learning sequence.',
        'Use only approved concept localIds and relation localIds. JSON only.'
      ].join('\n'),
      schema: {
        communities: [{
          id: 'community id',
          title: 'learning community title',
          summary: 'short teaching summary',
          conceptLocalIds: ['approved concept localId'],
          relationLocalIds: ['approved relation localId'],
          learningSequence: ['ordered concept localIds'],
          evidenceRefs: [{ chunkId: 'string', chunkIndex: 0, sectionId: 'string', quote: 'string' }],
          confidence: 0.8
        }]
      },
      input: {
        resource: input.file,
        semanticSections: input.resourceSemantic.sections.slice(0, 30).map((section) => ({
          id: section.id,
          title: section.title,
          summary: section.summary,
          rangeLabel: section.rangeLabel
        })),
        approvedConcepts: input.concepts.map((concept) => ({
          localId: concept.localId,
          title: concept.canonicalTitle,
          kind: concept.kind,
          description: concept.description
        })),
        approvedRelations: input.relations.map((relation) => ({
          localId: relation.localId,
          fromLocalId: relation.fromLocalId,
          toLocalId: relation.toLocalId,
          relationType: relation.relationType,
          description: relation.description
        })),
        chunks: input.chunks.map((chunk) => ({ id: chunk.id, chunkIndex: chunk.chunkIndex, summary: chunk.summary }))
      }
    });

    const conceptIds = new Set(input.concepts.map((concept) => concept.localId));
    const relationIds = new Set(input.relations.map((relation) => relation.localId));
    const communities = (Array.isArray(response.data.communities) ? response.data.communities : [])
      .map((community, index) => ({
        id: clip(community.id, 80) || localIdFor('community', community.title, index),
        title: clip(community.title, 140),
        summary: clip(community.summary, 700),
        conceptLocalIds: unique(community.conceptLocalIds || [], 30).filter((id) => conceptIds.has(id)),
        relationLocalIds: unique(community.relationLocalIds || [], 40).filter((id) => relationIds.has(id)),
        learningSequence: unique(community.learningSequence || [], 30).filter((id) => conceptIds.has(id)),
        evidenceRefs: (Array.isArray(community.evidenceRefs) ? community.evidenceRefs : []).slice(0, 8),
        confidence: clamp01(community.confidence, 0.65)
      }))
      .filter((community) => community.title && community.conceptLocalIds.length);

    return { communities, model: response.model };
  }

  private parseAliases(value: string | null | undefined) {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean).slice(0, 12) : [];
    } catch {
      return [];
    }
  }
}

export const aiCourseKnowledgeGraphExtractionService = new AiCourseKnowledgeGraphExtractionService();

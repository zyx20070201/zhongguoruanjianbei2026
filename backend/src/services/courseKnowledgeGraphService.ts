import prisma from '../config/db';
import { stableHash } from './chunkSchema';
import {
  isCourseConceptCandidate,
  isStrictCourseKnowledgeConcept,
  stripCourseConceptNoise
} from './courseKnowledgeConceptRules';
import { isProbablyKnowledgeConcept } from './learnerSignalSanitizer';
import {
  AiKgEvidenceRef,
  aiCourseKnowledgeGraphExtractionService
} from './aiCourseKnowledgeGraphExtractionService';
import { aiModelProviderService } from './aiModelProviderService';

type RelationType = 'prerequisite' | 'related' | 'part_of' | 'supports' | 'assesses' | 'remediates';
type BindingType = 'resource' | 'task' | 'quiz' | 'misconception' | 'event' | 'plan' | 'goal';
type ConceptTagSource = 'system_candidate' | 'ai_suggested' | 'user';
type ConceptTagState = 'candidate' | 'applied';

const SYSTEM_CANDIDATE_TAGS = new Set(['核心概念', '可能难点', '易混淆']);

const stringify = (value: unknown, fallback: unknown = {}) => {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
};

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const clamp01 = (value: unknown, fallback = 0.5) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
};

const normalizeText = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeTagLabel = (value: unknown) => normalizeText(value).replace(/^#+/, '').slice(0, 32);
const normalizedTagKey = (value: unknown) => normalizeTagLabel(value).toLowerCase();

const unique = (items: Array<string | null | undefined>) =>
  Array.from(new Set(items.map((item) => normalizeText(item)).filter((item) => item.length >= 2)));

const markdownExtensions = new Set(['md', 'markdown']);
const courseSourceExtensions = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'md', 'markdown', 'txt']);
const generatedPathPattern = /(^|\/)(Generated|Artifacts|Video Frames)(\/|$)/i;
const sourcePathPattern = /(^|\/)Sources(\/|$)/i;
const userNotePathPattern = /(^|\/)(Files|Notes)(\/|$)/i;

const parseMetadataObject = (value: string | null | undefined) => parseJson<Record<string, unknown>>(value, {});

export const isCourseKnowledgeGraphSourceFile = (file: {
  nodeType?: string | null;
  name?: string | null;
  path?: string | null;
  extension?: string | null;
  fileCategory?: string | null;
  resourceType?: string | null;
  origin?: string | null;
  mimeType?: string | null;
  metadataJson?: string | null;
}) => {
  if (file.nodeType !== 'file') return false;

  const name = String(file.name || '');
  const path = String(file.path || '');
  const extension = String(file.extension || name.split('.').pop() || '').toLowerCase().replace(/^\./, '');
  const category = String(file.fileCategory || '').toLowerCase();
  const resourceType = String(file.resourceType || '').toLowerCase();
  const origin = String(file.origin || '').toLowerCase();
  const mimeType = String(file.mimeType || '').toLowerCase();
  const metadata = parseMetadataObject(file.metadataJson);

  if (generatedPathPattern.test(path)) return false;
  if (category === 'generated' || resourceType === 'generated' || origin === 'ai' || origin === 'system') return false;
  if (['html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'sql', 'json', 'xml', 'yaml', 'yml'].includes(extension)) return false;
  if (mimeType.includes('html') || mimeType.includes('javascript') || mimeType.includes('json')) return false;

  const isSource = resourceType === 'source' || category === 'source' || sourcePathPattern.test(path);
  const isUserMarkdownNote =
    markdownExtensions.has(extension) &&
    (resourceType === 'note' || category === 'note' || userNotePathPattern.test(path)) &&
    (origin === 'user' || origin === 'upload' || origin === 'legacy' || !origin);

  if (isSource) {
    return courseSourceExtensions.has(extension) || category === 'web' || origin === 'web';
  }

  if (isUserMarkdownNote) return true;

  return Boolean(metadata.courseKnowledgeGraph === true || metadata.extractToCourseKnowledgeGraph === true);
};

export const conceptKeyFor = (workspaceId: string, title: string) => {
  const normalized = normalizeText(title).toLowerCase();
  return stableHash([workspaceId, normalized]).slice(0, 32);
};

const cleanConceptList = (values: Array<string | null | undefined>, limit = 12) =>
  Array.from(new Set(values.map((value) => stripCourseConceptNoise(normalizeText(value))).filter(isCourseConceptCandidate))).slice(0, limit);

type ResourceConceptEvidence = {
  fileObjectId: string;
  fileName: string;
  path: string;
  chunkId?: string;
  chunkIndex?: number;
  role: 'heading' | 'definition' | 'example' | 'assessment' | 'misconception' | 'mention' | 'video_key_point' | 'video_chapter';
  headingPath?: string[];
  snippet?: string;
  confidence: number;
};

const clip = (value: unknown, maxLength = 420) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const dateIso = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const parseTagSources = (value: string | null | undefined): ConceptTagSource[] => {
  const parsed = parseJson<string[]>(value, []);
  return Array.from(new Set(parsed.filter((item): item is ConceptTagSource =>
    item === 'system_candidate' || item === 'ai_suggested' || item === 'user'
  )));
};

const serializeTag = (tag: {
  id: string;
  label: string;
  normalizedLabel: string;
  state: string;
  sourcesJson: string;
  rationale: string;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: tag.id,
  label: tag.label,
  normalizedLabel: tag.normalizedLabel,
  state: tag.state as ConceptTagState,
  sources: parseTagSources(tag.sourcesJson),
  rationale: tag.rationale,
  createdAt: dateIso(tag.createdAt),
  updatedAt: dateIso(tag.updatedAt)
});

const mergeEvidenceArrays = <T extends Record<string, any>>(
  existing: T[] | undefined,
  incoming: T[] | undefined,
  keyFor: (item: T) => string,
  limit: number
) => {
  const byKey = new Map<string, T>();
  [...(existing || []), ...(incoming || [])].forEach((item) => {
    const key = keyFor(item);
    if (!key) return;
    const current = byKey.get(key);
    if (!current || Number(item.confidence || 0) > Number(current.confidence || 0)) byKey.set(key, item);
  });
  return Array.from(byKey.values())
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))
    .slice(0, limit);
};

const mergeConceptEvidence = (
  existing: Record<string, any>,
  incoming: Record<string, any>
) => {
  const existingSignals = existing.resourceSignals && typeof existing.resourceSignals === 'object' ? existing.resourceSignals : {};
  const incomingSignals = incoming.resourceSignals && typeof incoming.resourceSignals === 'object' ? incoming.resourceSignals : {};
  const sourceFileIds = unique([
    ...(Array.isArray(existingSignals.sourceFileIds) ? existingSignals.sourceFileIds : []),
    ...(Array.isArray(incomingSignals.sourceFileIds) ? incomingSignals.sourceFileIds : [])
  ] as string[]);
  const workbenchIds = unique([
    ...(Array.isArray(existingSignals.workbenchIds) ? existingSignals.workbenchIds : []),
    ...(Array.isArray(incomingSignals.workbenchIds) ? incomingSignals.workbenchIds : [])
  ] as string[]);
  const resourceEvidence = mergeEvidenceArrays<ResourceConceptEvidence>(
    Array.isArray(existing.resourceEvidence) ? existing.resourceEvidence : [],
    Array.isArray(incoming.resourceEvidence) ? incoming.resourceEvidence : [],
    (item) => `${item.fileObjectId}:${item.chunkId || item.chunkIndex || ''}:${item.role}:${clip(item.snippet, 80)}`,
    18
  );
  const occurrenceCount = Number(existingSignals.occurrenceCount || 0) + Number(incomingSignals.occurrenceCount || 0);
  const headingCount = Number(existingSignals.headingCount || 0) + Number(incomingSignals.headingCount || 0);
  const assessmentCount = Number(existingSignals.assessmentCount || 0) + Number(incomingSignals.assessmentCount || 0);
  const evidenceStrength = Math.max(
    Number(existing.canonicalLayer?.evidenceStrength || 0),
    Math.min(1, sourceFileIds.length * 0.16 + headingCount * 0.08 + assessmentCount * 0.12 + Math.min(0.28, occurrenceCount * 0.025))
  );

  return {
    ...existing,
    ...incoming,
    resourceSignals: {
      ...existingSignals,
      ...incomingSignals,
      occurrenceCount,
      headingCount,
      assessmentCount,
      sourceFileIds,
      sourceCount: sourceFileIds.length,
      workbenchIds
    },
    resourceEvidence,
    canonicalLayer: {
      ...(existing.canonicalLayer || {}),
      ...(incoming.canonicalLayer || {}),
      sourceLayer: 'resource_extraction',
      status:
        evidenceStrength >= 0.74 ? 'verified' :
          evidenceStrength >= 0.42 ? 'active' :
            'candidate',
      evidenceStrength: Number(evidenceStrength.toFixed(3)),
      updatedAt: new Date().toISOString()
    }
  };
};

export class CourseKnowledgeGraphService {
  async upsertConcept(input: {
    workspaceId: string;
    title: string;
    description?: string;
    aliases?: string[];
    category?: string;
    difficulty?: number;
    source?: string;
    evidence?: Record<string, unknown>;
  }) {
    const title = normalizeText(input.title);
    if (!title) throw new Error('valid concept title is required');
    const validConceptTitle = input.source === 'ai_kg_extraction'
      ? isStrictCourseKnowledgeConcept(title)
      : isCourseConceptCandidate(title);
    if (!validConceptTitle) {
      throw new Error('valid concept title is required');
    }
    const conceptKey = conceptKeyFor(input.workspaceId, title);
    const existing = await prisma.courseKnowledgeConcept.findUnique({
      where: { workspaceId_conceptKey: { workspaceId: input.workspaceId, conceptKey } }
    });
    const aliases = unique([...(input.aliases || []), title]);
    if (existing) {
      const existingAliases = parseJson<string[]>(existing.aliasesJson, []);
      const existingEvidence = parseJson<Record<string, any>>(existing.evidenceJson, {});
      return prisma.courseKnowledgeConcept.update({
        where: { id: existing.id },
        data: {
          title: existing.title || title,
          description: input.description || existing.description,
          aliasesJson: stringify(unique([...existingAliases, ...aliases]), []),
          category: input.category || existing.category,
          difficulty: input.difficulty !== undefined ? clamp01(input.difficulty) : existing.difficulty,
          source: input.source || existing.source,
          evidenceJson: stringify(mergeConceptEvidence(existingEvidence, input.evidence || {}))
        }
      });
    }
    return prisma.courseKnowledgeConcept.create({
      data: {
        workspaceId: input.workspaceId,
        conceptKey,
        title,
        description: input.description || '',
        aliasesJson: stringify(aliases, []),
        category: input.category || 'concept',
        difficulty: clamp01(input.difficulty, 0.5),
        source: input.source || 'system',
        evidenceJson: stringify(mergeConceptEvidence({}, input.evidence || {}))
      }
    });
  }

  async upsertRelation(input: {
    workspaceId: string;
    fromConceptId: string;
    toConceptId: string;
    relationType: RelationType;
    weight?: number;
    confidence?: number;
    source?: string;
    evidence?: Record<string, unknown>;
  }) {
    if (input.fromConceptId === input.toConceptId) return null;
    return prisma.courseKnowledgeRelation.upsert({
      where: {
        workspaceId_fromConceptId_toConceptId_relationType: {
          workspaceId: input.workspaceId,
          fromConceptId: input.fromConceptId,
          toConceptId: input.toConceptId,
          relationType: input.relationType
        }
      },
      create: {
        workspaceId: input.workspaceId,
        fromConceptId: input.fromConceptId,
        toConceptId: input.toConceptId,
        relationType: input.relationType,
        weight: clamp01(input.weight, 0.6),
        confidence: clamp01(input.confidence, 0.55),
        source: input.source || 'system',
        evidenceJson: stringify(input.evidence || {})
      },
      update: {
        weight: clamp01(input.weight, 0.6),
        confidence: clamp01(input.confidence, 0.55),
        source: input.source || 'system',
        evidenceJson: stringify(input.evidence || {})
      }
    });
  }

  async bindConcept(input: {
    workspaceId: string;
    conceptId: string;
    bindingType: BindingType;
    targetType: string;
    targetId: string;
    role?: string;
    strength?: number;
    confidence?: number;
    fileObjectId?: string | null;
    workbenchId?: string | null;
    goalId?: string | null;
    evidence?: Record<string, unknown>;
  }) {
    return prisma.courseKnowledgeBinding.upsert({
      where: {
        workspaceId_conceptId_targetType_targetId_role: {
          workspaceId: input.workspaceId,
          conceptId: input.conceptId,
          targetType: input.targetType,
          targetId: input.targetId,
          role: input.role || 'supports'
        }
      },
      create: {
        workspaceId: input.workspaceId,
        conceptId: input.conceptId,
        bindingType: input.bindingType,
        targetType: input.targetType,
        targetId: input.targetId,
        role: input.role || 'supports',
        strength: clamp01(input.strength, 0.55),
        confidence: clamp01(input.confidence, 0.55),
        fileObjectId: input.fileObjectId || null,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        evidenceJson: stringify(input.evidence || {})
      },
      update: {
        bindingType: input.bindingType,
        strength: clamp01(input.strength, 0.55),
        confidence: clamp01(input.confidence, 0.55),
        fileObjectId: input.fileObjectId || null,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        evidenceJson: stringify(input.evidence || {})
      }
    });
  }

  async upsertMisconception(input: {
    workspaceId: string;
    conceptId: string;
    title: string;
    description?: string;
    repairHint?: string;
    severity?: number;
    confidence?: number;
    evidence?: Record<string, unknown>;
  }) {
    const title = normalizeText(input.title);
    if (!title) return null;
    const misconceptionKey = stableHash([input.workspaceId, input.conceptId, title.toLowerCase()]).slice(0, 32);
    return prisma.courseKnowledgeMisconception.upsert({
      where: {
        workspaceId_conceptId_misconceptionKey: {
          workspaceId: input.workspaceId,
          conceptId: input.conceptId,
          misconceptionKey
        }
      },
      create: {
        workspaceId: input.workspaceId,
        conceptId: input.conceptId,
        misconceptionKey,
        title,
        description: input.description || '',
        repairHint: input.repairHint || '',
        severity: clamp01(input.severity, 0.5),
        confidence: clamp01(input.confidence, 0.55),
        evidenceJson: stringify(input.evidence || {})
      },
      update: {
        description: input.description || '',
        repairHint: input.repairHint || '',
        severity: clamp01(input.severity, 0.5),
        confidence: clamp01(input.confidence, 0.55),
        evidenceJson: stringify(input.evidence || {})
      }
    });
  }

  async activateConcept(input: {
    workspaceId: string;
    conceptId: string;
    activationType: string;
    sourceType: string;
    sourceId?: string | null;
    score?: number;
    evidence?: Record<string, unknown>;
  }) {
    const score = clamp01(input.score, 0.4);
    await prisma.courseKnowledgeActivation.create({
      data: {
        workspaceId: input.workspaceId,
        conceptId: input.conceptId,
        activationType: input.activationType,
        sourceType: input.sourceType,
        sourceId: input.sourceId || null,
        score,
        evidenceJson: stringify(input.evidence || {})
      }
    });
    return prisma.courseKnowledgeConcept.update({
      where: { id: input.conceptId },
      data: {
        activationScore: { increment: score },
        lastActivatedAt: new Date()
      }
    });
  }

  private async upsertExercise(input: {
    workspaceId: string;
    fileObjectId: string;
    title: string;
    prompt: string;
    exerciseType?: string;
    difficulty?: number;
    answer?: unknown;
    explanation?: string;
    source?: string;
    evidence?: Record<string, unknown>;
  }) {
    const title = clip(input.title || input.prompt, 180);
    const prompt = clip(input.prompt || input.title, 1800);
    if (!title || prompt.length < 8) return null;
    const exerciseKey = stableHash([input.workspaceId, input.fileObjectId, normalizeText(prompt).toLowerCase()]).slice(0, 32);
    const id = `exercise-${exerciseKey}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CourseKnowledgeExercise" (
        "id", "exerciseKey", "title", "prompt", "exerciseType", "difficulty", "answerJson", "explanation", "source", "evidenceJson", "workspaceId", "fileObjectId", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT("workspaceId", "exerciseKey") DO UPDATE SET
        "title" = excluded."title",
        "prompt" = excluded."prompt",
        "exerciseType" = excluded."exerciseType",
        "difficulty" = excluded."difficulty",
        "answerJson" = excluded."answerJson",
        "explanation" = excluded."explanation",
        "source" = excluded."source",
        "evidenceJson" = excluded."evidenceJson",
        "fileObjectId" = excluded."fileObjectId",
        "status" = 'active',
        "updatedAt" = CURRENT_TIMESTAMP`,
      id,
      exerciseKey,
      title,
      prompt,
      input.exerciseType || 'question',
      clamp01(input.difficulty, 0.5),
      stringify(input.answer ?? null, null),
      input.explanation || '',
      input.source || 'ai_kg_extraction',
      stringify(input.evidence || {}),
      input.workspaceId,
      input.fileObjectId
    );
    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT * FROM "CourseKnowledgeExercise" WHERE "workspaceId" = ? AND "exerciseKey" = ? LIMIT 1`,
      input.workspaceId,
      exerciseKey
    );
    return rows[0] || null;
  }

  private async bindExerciseToConcept(input: {
    workspaceId: string;
    exerciseId: string;
    conceptId: string;
    role?: string;
    strength?: number;
    confidence?: number;
    evidence?: Record<string, unknown>;
  }) {
    const role = input.role || 'assesses';
    const id = `exercise-binding-${stableHash([input.workspaceId, input.exerciseId, input.conceptId, role]).slice(0, 32)}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CourseKnowledgeExerciseBinding" (
        "id", "role", "strength", "confidence", "evidenceJson", "workspaceId", "exerciseId", "conceptId", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT("workspaceId", "exerciseId", "conceptId", "role") DO UPDATE SET
        "strength" = excluded."strength",
        "confidence" = excluded."confidence",
        "evidenceJson" = excluded."evidenceJson",
        "updatedAt" = CURRENT_TIMESTAMP`,
      id,
      role,
      clamp01(input.strength, 0.65),
      clamp01(input.confidence, 0.65),
      stringify(input.evidence || {}),
      input.workspaceId,
      input.exerciseId,
      input.conceptId
    );
  }

  async updateLearnerConceptState(input: {
    workspaceId: string;
    conceptId: string;
    masteryDelta?: number;
    weaknessDelta?: number;
    readinessDelta?: number;
    masteryEstimate?: number;
    weaknessEstimate?: number;
    readinessEstimate?: number;
    sourceSignalId?: string | null;
    evidence?: Record<string, unknown>;
  }) {
    const existing = await prisma.courseKnowledgeLearnerState.findUnique({
      where: {
        workspaceId_conceptId_stateScope: {
          workspaceId: input.workspaceId,
          conceptId: input.conceptId,
          stateScope: 'workspace'
        }
      }
    });
    const existingEvidence = parseJson<Record<string, unknown>>(existing?.evidenceJson, {});
    const existingSignalIds = parseJson<string[]>(existing?.sourceSignalIdsJson, []);
    const nextMastery = input.masteryEstimate !== undefined
      ? clamp01(input.masteryEstimate)
      : clamp01((existing?.masteryEstimate ?? 0.5) + (input.masteryDelta || 0), 0.5);
    const nextWeakness = input.weaknessEstimate !== undefined
      ? clamp01(input.weaknessEstimate)
      : clamp01((existing?.weaknessEstimate ?? 0.3) + (input.weaknessDelta || 0), 0.3);
    const nextReadiness = input.readinessEstimate !== undefined
      ? clamp01(input.readinessEstimate)
      : clamp01((existing?.readinessEstimate ?? 0.5) + (input.readinessDelta || 0), 0.5);
    const evidenceJson = stringify({
      ...existingEvidence,
      lastUpdate: input.evidence || {},
      updatedAt: new Date().toISOString()
    });
    const signalIds = unique([...(existingSignalIds || []), input.sourceSignalId || '']);
    return prisma.courseKnowledgeLearnerState.upsert({
      where: {
        workspaceId_conceptId_stateScope: {
          workspaceId: input.workspaceId,
          conceptId: input.conceptId,
          stateScope: 'workspace'
        }
      },
      create: {
        workspaceId: input.workspaceId,
        conceptId: input.conceptId,
        masteryEstimate: nextMastery,
        weaknessEstimate: nextWeakness,
        readinessEstimate: nextReadiness,
        evidenceJson,
        sourceSignalIdsJson: stringify(signalIds, [])
      },
      update: {
        masteryEstimate: nextMastery,
        weaknessEstimate: nextWeakness,
        readinessEstimate: nextReadiness,
        evidenceJson,
        sourceSignalIdsJson: stringify(signalIds, [])
      }
    });
  }

  async ingestResourceFile(input: {
    workspaceId: string;
    fileObjectId: string;
    source?: string;
  }) {
    const file = await prisma.fileSystemObject.findFirst({
      where: { id: input.fileObjectId, workspaceId: input.workspaceId }
    });
    if (!file) throw new Error('File not found');
    if (!isCourseKnowledgeGraphSourceFile(file)) {
      return {
        concepts: [],
        bindings: 0,
        skipped: true,
        reason: 'not_course_kg_source',
        file: { id: file.id, name: file.name, path: file.path, resourceType: file.resourceType, fileCategory: file.fileCategory }
      };
    }
    const extraction = await aiCourseKnowledgeGraphExtractionService.extract({
      workspaceId: input.workspaceId,
      fileObjectId: input.fileObjectId,
      source: input.source || 'course_graph_build'
    });
    const chunkById = new Map(extraction.chunks.map((chunk) => [chunk.id, chunk] as const));
    const chunkByIndex = new Map(extraction.chunks.map((chunk) => [chunk.chunkIndex, chunk] as const));
    const evidenceFor = (refs: AiKgEvidenceRef[], patch: Record<string, unknown> = {}) => {
      const resourceEvidence = refs.map((ref) => {
        const chunk = (ref.chunkId ? chunkById.get(ref.chunkId) : undefined) || (typeof ref.chunkIndex === 'number' ? chunkByIndex.get(ref.chunkIndex) : undefined);
        return {
          fileObjectId: file.id,
          fileName: file.name,
          path: file.path,
          chunkId: chunk?.id || ref.chunkId,
          chunkIndex: chunk?.chunkIndex ?? ref.chunkIndex,
          role: 'ai_evidence',
          headingPath: Array.isArray(chunk?.metadata?.headingPath) ? chunk.metadata.headingPath : [],
          snippet: ref.quote || clip(chunk?.summary || chunk?.text, 260),
          rationale: ref.rationale,
          sectionId: ref.sectionId,
          confidence: 0.86
        };
      });
      return {
        schema: 'ai_course_kg_evidence.v1',
        sourceLayer: 'ai_kg_extraction',
        source: input.source || 'course_graph_build',
        fileObjectId: file.id,
        fileName: file.name,
        path: file.path,
        aiPipeline: {
          models: extraction.models,
          trace: extraction.trace,
          resource: extraction.resource
        },
        resourceSignals: {
          sourceFileIds: [file.id],
          sourceCount: 1,
          workbenchIds: file.ownerWorkbenchId ? [file.ownerWorkbenchId] : [],
          occurrenceCount: resourceEvidence.length,
          headingCount: 0,
          assessmentCount: 0,
          roles: ['ai_extracted']
        },
        resourceEvidence,
        ...patch
      };
    };

    const concepts: Array<Awaited<ReturnType<CourseKnowledgeGraphService['upsertConcept']>>> = [];
    const conceptByLocalId = new Map<string, Awaited<ReturnType<CourseKnowledgeGraphService['upsertConcept']>>>();

    for (const item of extraction.concepts.filter((concept) => concept.approved && isStrictCourseKnowledgeConcept(concept.canonicalTitle || concept.title))) {
      const evidence = evidenceFor(item.evidenceRefs || [], {
        canonicalization: {
          action: item.action,
          existingConceptId: item.existingConceptId || null,
          rationale: item.canonicalRationale || ''
        },
        review: {
          confidence: item.reviewConfidence,
          issues: item.reviewIssues
        }
      });
      const existing = item.existingConceptId
        ? await prisma.courseKnowledgeConcept.findFirst({ where: { id: item.existingConceptId, workspaceId: input.workspaceId, status: 'active' } })
        : null;
      const concept = existing
        ? await prisma.courseKnowledgeConcept.update({
            where: { id: existing.id },
            data: {
              description: item.description || existing.description,
              aliasesJson: stringify(unique([...parseJson<string[]>(existing.aliasesJson, []), ...item.canonicalAliases, item.canonicalTitle]), []),
              category: item.kind || existing.category,
              difficulty: item.difficulty !== undefined ? clamp01(item.difficulty) : existing.difficulty,
              source: 'ai_kg_extraction',
              evidenceJson: stringify(mergeConceptEvidence(parseJson<Record<string, any>>(existing.evidenceJson, {}), evidence))
            }
          })
        : await this.upsertConcept({
            workspaceId: input.workspaceId,
            title: item.canonicalTitle,
            description: item.description,
            aliases: item.canonicalAliases,
            category: item.kind || 'concept',
            difficulty: item.difficulty,
            source: 'ai_kg_extraction',
            evidence
          });

      concepts.push(concept);
      conceptByLocalId.set(item.localId, concept);
      await this.bindConcept({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        bindingType: 'resource',
        targetType: 'resource',
        targetId: file.id,
        role: item.kind === 'assessment'
          ? 'assesses'
          : item.kind === 'misconception'
            ? 'remediates'
            : item.kind === 'application' || item.kind === 'procedure'
              ? 'supports'
              : 'explains',
        strength: Math.min(0.94, Math.max(item.confidence || 0, item.reviewConfidence || 0.6)),
        confidence: item.reviewConfidence,
        fileObjectId: file.id,
        workbenchId: file.ownerWorkbenchId || null,
        evidence
      });
      await this.activateConcept({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        activationType: 'ai_resource_indexed',
        sourceType: 'resource',
        sourceId: file.id,
        score: Math.min(0.46, 0.16 + item.reviewConfidence * 0.22),
        evidence
      });
      await this.updateLearnerConceptState({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        readinessDelta: Math.min(0.06, 0.015 + item.reviewConfidence * 0.035),
        evidence
      });
    }

    let exerciseCount = 0;
    let exerciseBindingCount = 0;
    for (const exercise of (extraction.exercises || []).filter((item) => item.approved)) {
      const boundConcepts = unique(exercise.conceptLocalIds || []).slice(0, 8)
        .map((localId) => conceptByLocalId.get(localId))
        .filter(Boolean) as Array<Awaited<ReturnType<CourseKnowledgeGraphService['upsertConcept']>>>;
      if (!boundConcepts.length) continue;
      const evidence = evidenceFor(exercise.evidenceRefs || [], {
        exerciseLocalId: exercise.localId,
        conceptLocalIds: exercise.conceptLocalIds || [],
        conceptTitles: exercise.conceptTitles || [],
        review: {
          confidence: exercise.reviewConfidence,
          issues: exercise.reviewIssues
        }
      });
      const persistedExercise = await this.upsertExercise({
        workspaceId: input.workspaceId,
        fileObjectId: file.id,
        title: exercise.title,
        prompt: exercise.prompt,
        exerciseType: exercise.exerciseType,
        difficulty: exercise.difficulty,
        answer: exercise.answer,
        explanation: exercise.explanation,
        source: 'ai_kg_extraction',
        evidence
      });
      if (!persistedExercise?.id) continue;
      exerciseCount += 1;
      for (const concept of boundConcepts) {
        await this.bindExerciseToConcept({
          workspaceId: input.workspaceId,
          exerciseId: persistedExercise.id,
          conceptId: concept.id,
          role: exercise.exerciseType === 'task' || exercise.exerciseType === 'design' || exercise.exerciseType === 'coding' ? 'applies' : 'assesses',
          strength: Math.min(0.92, Math.max(exercise.confidence || 0, exercise.reviewConfidence || 0.62)),
          confidence: exercise.reviewConfidence,
          evidence
        });
        exerciseBindingCount += 1;
      }
    }

    for (const relation of extraction.relations.filter((item) => item.approved)) {
      const from = conceptByLocalId.get(relation.fromLocalId);
      const to = conceptByLocalId.get(relation.toLocalId);
      if (!from || !to || from.id === to.id) continue;
      await this.upsertRelation({
        workspaceId: input.workspaceId,
        fromConceptId: from.id,
        toConceptId: to.id,
        relationType: relation.relationType,
        weight: relation.weight,
        confidence: relation.reviewConfidence,
        source: 'ai_kg_extraction',
        evidence: evidenceFor(relation.evidenceRefs || [], {
          relationLocalId: relation.localId,
          description: relation.description || '',
          review: {
            confidence: relation.reviewConfidence,
            issues: relation.reviewIssues
          }
        })
      });
    }

    for (const misconception of extraction.misconceptions.filter((item) => item.approved)) {
      const concept = conceptByLocalId.get(misconception.conceptLocalId);
      if (!concept) continue;
      await this.upsertMisconception({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        title: misconception.title,
        description: misconception.description,
        repairHint: misconception.repairHint,
        severity: misconception.severity,
        confidence: misconception.reviewConfidence,
        evidence: evidenceFor(misconception.evidenceRefs || [], {
          misconceptionLocalId: misconception.localId,
          review: {
            confidence: misconception.reviewConfidence,
            issues: misconception.reviewIssues
          }
        })
      }).catch(() => null);
    }

    await prisma.courseKnowledgeGovernanceLog.create({
      data: {
        workspaceId: input.workspaceId,
        action: 'ai_kg_extraction_completed',
        targetType: 'resource',
        targetId: file.id,
        beforeJson: '{}',
        afterJson: stringify({
          schema: extraction.schema,
          models: extraction.models,
          trace: extraction.trace,
          communities: extraction.communities,
          persistedConceptIds: concepts.map((concept) => concept.id),
          persistedExerciseCount: exerciseCount,
          persistedExerciseBindingCount: exerciseBindingCount
        }),
        rationale: 'AI-only five-layer course KG extraction completed: resource semantic layer, extraction, canonicalization, review, and community summaries.',
        confidence: concepts.length ? Math.min(0.95, 0.55 + concepts.length * 0.02) : 0.4
      }
    }).catch((error) => console.warn('AI KG extraction governance log failed:', error));

    return {
      concepts,
      bindings: concepts.length,
      exercises: exerciseCount,
      exerciseBindings: exerciseBindingCount,
      skipped: concepts.length === 0,
      reason: concepts.length ? null : 'ai_no_approved_concepts',
      aiExtraction: extraction
    };
  }

  async bindQuizQuestion(input: {
    workspaceId: string;
    workbenchId?: string | null;
    question: any;
    targetId?: string;
    result?: Record<string, unknown>;
  }) {
    const points = cleanConceptList([
      input.question?.skill,
      input.question?.learningObjective,
      ...(Array.isArray(input.question?.knowledgePoints) ? input.question.knowledgePoints : [])
    ], 8);
    const concepts = [];
    for (const point of points) {
      const concept = await this.upsertConcept({
        workspaceId: input.workspaceId,
        title: point,
        source: 'quiz',
        evidence: { questionId: input.question?.id, question: input.question?.question }
      });
      concepts.push(concept);
      await this.bindConcept({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        bindingType: 'quiz',
        targetType: 'quiz_question',
        targetId: input.targetId || input.question?.id || stableHash(input.question || {}).slice(0, 16),
        role: 'assesses',
        strength: 0.72,
        confidence: 0.7,
        workbenchId: input.workbenchId || null,
        evidence: { question: input.question, result: input.result || null }
      });
      if (input.question?.commonMistake) {
        await this.upsertMisconception({
          workspaceId: input.workspaceId,
          conceptId: concept.id,
          title: input.question.commonMistake,
          repairHint: input.question.explanation || input.question.hint || '',
          severity: 0.62,
          confidence: 0.66,
          evidence: { questionId: input.question?.id }
        });
      }
      await this.activateConcept({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        activationType: 'quiz_activity',
        sourceType: 'quiz_question',
        sourceId: input.question?.id || null,
        score: input.result ? 0.35 : 0.22,
        evidence: { result: input.result || null }
      });
      const score = Number((input.result as any)?.score);
      await this.updateLearnerConceptState({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        masteryDelta: Number.isFinite(score) ? (score - 0.5) * 0.18 : 0,
        weaknessDelta: Number.isFinite(score) && score < 0.55 ? 0.14 : Number.isFinite(score) && score > 0.82 ? -0.08 : 0,
        readinessDelta: Number.isFinite(score) ? (score - 0.5) * 0.12 : 0.02,
        sourceSignalId: input.question?.id || null,
        evidence: { source: 'quiz', score: Number.isFinite(score) ? score : null, questionId: input.question?.id }
      });
    }
    return concepts;
  }

  async bindPlan(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    planId: string;
    targetSkills?: string[];
    weakSkills?: string[];
    steps?: Array<Record<string, any>>;
  }) {
    const concepts = new Map<string, Awaited<ReturnType<CourseKnowledgeGraphService['upsertConcept']>>>();
    const add = async (title: string, role: string, evidence: Record<string, unknown>) => {
      const concept = await this.upsertConcept({ workspaceId: input.workspaceId, title, source: 'planner', evidence });
      concepts.set(concept.id, concept);
      await this.bindConcept({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        bindingType: 'plan',
        targetType: 'learning_plan',
        targetId: input.planId,
        role,
        strength: role === 'remediates' ? 0.72 : 0.62,
        confidence: 0.62,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        evidence
      });
      await this.updateLearnerConceptState({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        weaknessDelta: role === 'remediates' ? 0.08 : 0,
        readinessDelta: role === 'targets' ? 0.04 : 0.02,
        evidence: { source: 'planner', role, planId: input.planId }
      });
      return concept;
    };
    for (const skill of cleanConceptList(input.targetSkills || [], 12)) await add(skill, 'targets', { planId: input.planId });
    for (const skill of cleanConceptList(input.weakSkills || [], 12)) await add(skill, 'remediates', { planId: input.planId });
    for (const step of input.steps || []) {
      const conceptTitle = normalizeText(step.concept || step.title);
      if (isCourseConceptCandidate(conceptTitle)) {
        const concept = await add(conceptTitle, 'task', { planId: input.planId, stepId: step.id || step.title });
        for (const prerequisite of cleanConceptList(step.prerequisites || [], 8)) {
          const prereq = await this.upsertConcept({ workspaceId: input.workspaceId, title: prerequisite, source: 'planner' });
          await this.upsertRelation({
            workspaceId: input.workspaceId,
            fromConceptId: prereq.id,
            toConceptId: concept.id,
            relationType: 'prerequisite',
            weight: 0.72,
            confidence: 0.64,
            source: 'planner',
            evidence: { planId: input.planId, stepTitle: step.title }
          });
        }
      }
    }
    return Array.from(concepts.values());
  }

  async cleanupPollutedKnowledgeData(input: {
    workspaceId?: string;
    dryRun?: boolean;
    rebuildResourceGraph?: boolean;
  } = {}) {
    const workspaceIds = input.workspaceId
      ? [input.workspaceId]
      : (await prisma.workspace.findMany({ select: { id: true } })).map((workspace) => workspace.id);
    const reports = [];
    for (const workspaceId of workspaceIds) {
      reports.push(await this.cleanupWorkspacePollution({
        workspaceId,
        dryRun: Boolean(input.dryRun),
        rebuildResourceGraph: Boolean(input.rebuildResourceGraph)
      }));
    }
    const summary = reports.reduce((acc, report) => ({
      pollutedConcepts: acc.pollutedConcepts + report.pollutedConcepts,
      suppressedConcepts: acc.suppressedConcepts + report.suppressedConcepts,
      suppressedLearnerStates: acc.suppressedLearnerStates + report.suppressedLearnerStates,
      suppressedSignals: acc.suppressedSignals + report.suppressedSignals,
      suppressedObservations: acc.suppressedObservations + report.suppressedObservations,
      cleanedPlans: acc.cleanedPlans + report.cleanedPlans,
      rebuiltFiles: acc.rebuiltFiles + report.rebuiltFiles
    }), {
      pollutedConcepts: 0,
      suppressedConcepts: 0,
      suppressedLearnerStates: 0,
      suppressedSignals: 0,
      suppressedObservations: 0,
      cleanedPlans: 0,
      rebuiltFiles: 0
    });
    return {
      schema: 'course_kg_pollution_cleanup.v1',
      dryRun: Boolean(input.dryRun),
      workspaceCount: workspaceIds.length,
      summary,
      reports
    };
  }

  private cleanPlanRecord(plan: any) {
    const cleanArrayJson = (value: string, limit: number) => cleanConceptList(parseJson<string[]>(value, []), limit);
    const targetSkills = cleanArrayJson(plan.targetSkillsJson, 16);
    const weakSkills = cleanArrayJson(plan.weakSkillsJson, 16);
    const steps = parseJson<Array<Record<string, any>>>(plan.stepsJson, []).map((step) => {
      const next = { ...step };
      next.targetSkills = cleanConceptList(Array.isArray(step.targetSkills) ? step.targetSkills : [], 8);
      next.prerequisites = cleanConceptList(Array.isArray(step.prerequisites) ? step.prerequisites : [], 8);
      if (next.concept && !isCourseConceptCandidate(next.concept)) delete next.concept;
      return next;
    });
    const diagnosticReport = { ...parseJson<Record<string, any>>(plan.diagnosticReportJson, {}) };
    if (Array.isArray(diagnosticReport.strengths)) diagnosticReport.strengths = cleanConceptList(diagnosticReport.strengths, 12);
    if (Array.isArray(diagnosticReport.weakSkills)) diagnosticReport.weakSkills = cleanConceptList(diagnosticReport.weakSkills, 12);
    if (Array.isArray(diagnosticReport.prerequisiteGaps)) diagnosticReport.prerequisiteGaps = cleanConceptList(diagnosticReport.prerequisiteGaps, 12);
    const knowledgeGraphSnapshot = { ...parseJson<Record<string, any>>(plan.knowledgeGraphSnapshotJson, {}) };
    if (Array.isArray(knowledgeGraphSnapshot.nodes)) {
      const nodes = knowledgeGraphSnapshot.nodes.filter((node: any) => isCourseConceptCandidate(node.title || node.label));
      const ids = new Set(nodes.map((node: any) => node.id));
      knowledgeGraphSnapshot.nodes = nodes;
      knowledgeGraphSnapshot.edges = Array.isArray(knowledgeGraphSnapshot.edges)
        ? knowledgeGraphSnapshot.edges.filter((edge: any) => ids.has(edge.source || edge.from) && ids.has(edge.target || edge.to))
        : [];
    }
    const next = {
      targetSkillsJson: stringify(targetSkills, []),
      weakSkillsJson: stringify(weakSkills, []),
      stepsJson: stringify(steps, []),
      diagnosticReportJson: stringify(diagnosticReport, {}),
      knowledgeGraphSnapshotJson: stringify(knowledgeGraphSnapshot, {})
    };
    const changed = Object.entries(next).some(([key, value]) => String((plan as any)[key] || '') !== value);
    return { changed, next };
  }

  private async cleanupWorkspacePollution(input: {
    workspaceId: string;
    dryRun: boolean;
    rebuildResourceGraph: boolean;
  }) {
    const [concepts, plans, signals, observations] = await Promise.all([
      prisma.courseKnowledgeConcept.findMany({ where: { workspaceId: input.workspaceId, status: 'active' }, take: 5000 }),
      prisma.learningPlan.findMany({ where: { workspaceId: input.workspaceId }, take: 1000 }),
      prisma.learnerStateSignal.findMany({
        where: { workspaceId: input.workspaceId, dimension: 'knowledgeState', status: { in: ['active', 'candidate'] } },
        take: 5000
      }),
      prisma.learnerObservation.findMany({
        where: { workspaceId: input.workspaceId, dimension: 'knowledgeState', status: 'active' },
        take: 5000
      })
    ]);
    const pollutedConcepts = concepts.filter((concept) => !isCourseConceptCandidate(concept.title));
    const pollutedConceptIds = pollutedConcepts.map((concept) => concept.id);
    const pollutedSignals = signals.filter((signal) => !isProbablyKnowledgeConcept(signal.value));
    const pollutedObservations = observations.filter((observation) => !isProbablyKnowledgeConcept(observation.value));
    const cleanedPlans = plans
      .map((plan) => ({ plan, clean: this.cleanPlanRecord(plan) }))
      .filter((item) => item.clean.changed);

    let suppressedConcepts = 0;
    let suppressedLearnerStates = 0;
    let suppressedSignals = 0;
    let suppressedObservations = 0;
    let updatedPlans = 0;
    let rebuiltFiles = 0;

    if (!input.dryRun) {
      for (const concept of pollutedConcepts) {
        await prisma.courseKnowledgeConcept.update({
          where: { id: concept.id },
          data: {
            status: 'suppressed',
            evidenceJson: stringify({
              ...parseJson<Record<string, unknown>>(concept.evidenceJson, {}),
              pollutionCleanup: {
                reason: 'resource_label_or_non_concept_title',
                previousTitle: concept.title,
                source: concept.source,
                cleanedAt: new Date().toISOString()
              }
            })
          }
        });
        suppressedConcepts += 1;
      }
      if (pollutedConceptIds.length) {
        const learnerStateResult = await prisma.courseKnowledgeLearnerState.updateMany({
          where: { workspaceId: input.workspaceId, conceptId: { in: pollutedConceptIds }, status: 'active' },
          data: { status: 'suppressed' }
        });
        suppressedLearnerStates = learnerStateResult.count;
      }
      if (pollutedSignals.length) {
        const result = await prisma.learnerStateSignal.updateMany({
          where: { id: { in: pollutedSignals.map((signal) => signal.id) } },
          data: { status: 'suppressed' }
        });
        suppressedSignals = result.count;
      }
      if (pollutedObservations.length) {
        const result = await prisma.learnerObservation.updateMany({
          where: { id: { in: pollutedObservations.map((observation) => observation.id) } },
          data: { status: 'suppressed' }
        });
        suppressedObservations = result.count;
      }
      for (const item of cleanedPlans) {
        await prisma.learningPlan.update({
          where: { id: item.plan.id },
          data: item.clean.next
        });
        updatedPlans += 1;
      }
      if (input.rebuildResourceGraph) {
        const files = (await prisma.fileSystemObject.findMany({
          where: { workspaceId: input.workspaceId, nodeType: 'file', knowledgeChunks: { some: {} } },
          select: {
            id: true,
            nodeType: true,
            name: true,
            path: true,
            extension: true,
            fileCategory: true,
            resourceType: true,
            origin: true,
            mimeType: true,
            metadataJson: true
          },
          take: 1000
        })).filter((file) => isCourseKnowledgeGraphSourceFile(file));
        for (const file of files) {
          await this.ingestResourceFile({ workspaceId: input.workspaceId, fileObjectId: file.id, source: 'pollution_cleanup_rebuild' })
            .catch((error) => console.warn('Course KG cleanup rebuild failed:', error));
          rebuiltFiles += 1;
        }
      }
      await prisma.courseKnowledgeGovernanceLog.create({
        data: {
          workspaceId: input.workspaceId,
          action: 'kg_pollution_cleanup',
          targetType: 'course_knowledge_graph',
          targetId: input.workspaceId,
          beforeJson: stringify({
            pollutedConcepts: pollutedConcepts.map((concept) => ({ id: concept.id, title: concept.title, source: concept.source })).slice(0, 80),
            pollutedSignals: pollutedSignals.map((signal) => signal.value).slice(0, 80)
          }),
          afterJson: stringify({
            suppressedConcepts,
            suppressedLearnerStates,
            suppressedSignals,
            suppressedObservations,
            cleanedPlans: updatedPlans,
            rebuiltFiles
          }),
          rationale: 'Suppressed resource labels and non-concept titles from KG, learner state, and learning plans.',
          confidence: 0.86,
          status: 'completed'
        }
      });
    }

    return {
      workspaceId: input.workspaceId,
      dryRun: input.dryRun,
      pollutedConcepts: pollutedConcepts.length,
      pollutedConceptTitles: pollutedConcepts.map((concept) => concept.title).slice(0, 50),
      suppressedConcepts: input.dryRun ? pollutedConcepts.length : suppressedConcepts,
      suppressedLearnerStates: input.dryRun ? pollutedConceptIds.length : suppressedLearnerStates,
      suppressedSignals: input.dryRun ? pollutedSignals.length : suppressedSignals,
      suppressedObservations: input.dryRun ? pollutedObservations.length : suppressedObservations,
      cleanedPlans: input.dryRun ? cleanedPlans.length : updatedPlans,
      rebuiltFiles
    };
  }

  private systemCandidateTagsFor(concept: {
    title: string;
    description?: string | null;
    difficulty?: number | null;
    activationScore?: number | null;
    misconceptions?: Array<{ title?: string | null }> | null;
    learnerStates?: Array<{ weaknessEstimate?: number | null }> | null;
  }, degree = 0) {
    const tags: Array<{ label: string; rationale: string }> = [];
    const difficulty = Number(concept.difficulty ?? 0.5);
    const weakness = Number(concept.learnerStates?.[0]?.weaknessEstimate ?? 0);
    const text = `${concept.title} ${concept.description || ''}`;

    if ((concept.activationScore ?? 0) >= 0.5 || degree >= 3) {
      tags.push({ label: '核心概念', rationale: '该节点在图谱中连接度或活跃度较高，适合作为学习组织入口。' });
    }
    if (difficulty >= 0.68 || weakness >= 0.62 || /复杂|难|证明|推导|递归|并发|优化|抽象/.test(text)) {
      tags.push({ label: '可能难点', rationale: '该节点的难度、语义或现有学习信号显示它可能需要额外关注。' });
    }
    if ((concept.misconceptions || []).length || /区别|对比|混淆|误区|边界|相似/.test(text)) {
      tags.push({ label: '易混淆', rationale: '该节点有误区线索或容易与相近概念形成混淆。' });
    }

    return tags.slice(0, 2);
  }

  private async ensureSystemCandidateTags(input: {
    workspaceId: string;
    concepts: Array<{
      id: string;
      title: string;
      description?: string | null;
      difficulty?: number | null;
      activationScore?: number | null;
      misconceptions?: Array<{ title?: string | null }> | null;
      learnerStates?: Array<{ weaknessEstimate?: number | null }> | null;
    }>;
    degreeById: Map<string, number>;
  }) {
    const limited = input.concepts
      .map((concept) => ({ concept, degree: input.degreeById.get(concept.id) || 0 }))
      .filter((item) => item.degree >= 2 || Number(item.concept.activationScore || 0) >= 0.45 || Number(item.concept.difficulty || 0) >= 0.68 || (item.concept.misconceptions || []).length)
      .sort((left, right) => right.degree - left.degree || Number(right.concept.activationScore || 0) - Number(left.concept.activationScore || 0))
      .slice(0, 14);

    for (const item of limited) {
      const tags = this.systemCandidateTagsFor(item.concept, item.degree);
      for (const tag of tags) {
        await this.upsertConceptTag({
          workspaceId: input.workspaceId,
          conceptId: item.concept.id,
          label: tag.label,
          source: 'system_candidate',
          state: 'candidate',
          rationale: tag.rationale
        }).catch(() => null);
      }
    }
  }

  async listConceptTags(input: { workspaceId: string; conceptId: string }) {
    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT "id", "label", "normalizedLabel", "state", "sourcesJson", "rationale", "createdAt", "updatedAt"
       FROM "CourseKnowledgeConceptTag"
       WHERE "workspaceId" = ? AND "conceptId" = ?
       ORDER BY CASE WHEN "state" = 'applied' THEN 0 ELSE 1 END, "updatedAt" DESC`,
      input.workspaceId,
      input.conceptId
    );
    return rows.map((row) => serializeTag(row));
  }

  async upsertConceptTag(input: {
    workspaceId: string;
    conceptId: string;
    label: string;
    source?: ConceptTagSource;
    state?: ConceptTagState;
    rationale?: string;
  }) {
    const label = normalizeTagLabel(input.label);
    const normalizedLabel = normalizedTagKey(label);
    if (!label || normalizedLabel.length < 1) throw new Error('valid tag label is required');
    if (input.source === 'system_candidate' && !SYSTEM_CANDIDATE_TAGS.has(label)) {
      throw new Error('system candidate tag must be 核心概念, 可能难点, or 易混淆');
    }
    const source: ConceptTagSource = input.source || 'user';
    const state: ConceptTagState = input.state || (source === 'user' ? 'applied' : 'candidate');
    const existing = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT "id", "label", "normalizedLabel", "state", "sourcesJson", "rationale", "createdAt", "updatedAt"
       FROM "CourseKnowledgeConceptTag"
       WHERE "workspaceId" = ? AND "conceptId" = ? AND "normalizedLabel" = ?
       LIMIT 1`,
      input.workspaceId,
      input.conceptId,
      normalizedLabel
    );
    const id = existing[0]?.id || `concept-tag-${stableHash([input.workspaceId, input.conceptId, normalizedLabel]).slice(0, 32)}`;
    const nextState: ConceptTagState = existing[0]?.state === 'applied' || state === 'applied' ? 'applied' : 'candidate';
    const sources = Array.from(new Set([
      ...(existing[0] ? parseTagSources(existing[0].sourcesJson) : []),
      source,
      ...(nextState === 'applied' ? ['user' as ConceptTagSource] : [])
    ]));
    const rationale = clip(input.rationale || existing[0]?.rationale || '', 360);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "CourseKnowledgeConceptTag" ("id", "label", "normalizedLabel", "state", "sourcesJson", "rationale", "workspaceId", "conceptId")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT("workspaceId", "conceptId", "normalizedLabel") DO UPDATE SET
         "label" = excluded."label",
         "state" = excluded."state",
         "sourcesJson" = excluded."sourcesJson",
         "rationale" = CASE WHEN excluded."rationale" != '' THEN excluded."rationale" ELSE "CourseKnowledgeConceptTag"."rationale" END,
         "updatedAt" = CURRENT_TIMESTAMP`,
      id,
      label,
      normalizedLabel,
      nextState,
      stringify(sources, []),
      rationale,
      input.workspaceId,
      input.conceptId
    );
    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT "id", "label", "normalizedLabel", "state", "sourcesJson", "rationale", "createdAt", "updatedAt"
       FROM "CourseKnowledgeConceptTag"
       WHERE "id" = ?
       LIMIT 1`,
      id
    );
    return rows[0] ? serializeTag(rows[0]) : null;
  }

  async deleteConceptTag(input: { workspaceId: string; conceptId: string; tagId: string }) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "CourseKnowledgeConceptTag" WHERE "workspaceId" = ? AND "conceptId" = ? AND "id" = ?`,
      input.workspaceId,
      input.conceptId,
      input.tagId
    );
    return { ok: true };
  }

  async chatAboutConceptForTags(input: {
    workspaceId: string;
    conceptId: string;
    question?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) {
    const graph = await this.getGraph({ workspaceId: input.workspaceId, limit: 220 });
    const concept = (graph.nodes as any[]).find((node) => node.id === input.conceptId);
    if (!concept) throw new Error('concept not found');
    const neighbors = (graph.edges as any[])
      .filter((edge) => edge.from === input.conceptId || edge.to === input.conceptId)
      .slice(0, 12)
      .map((edge) => ({
        relationType: edge.relationType,
        direction: edge.from === input.conceptId ? 'outgoing' : 'incoming',
        concept: (graph.nodes as any[]).find((node) => node.id === (edge.from === input.conceptId ? edge.to : edge.from))?.title || ''
      }));
    const sourceSnippets = (concept.sources || [])
      .flatMap((source: any) => (source.snippets || []).slice(0, 2).map((snippet: any) => ({
        source: source.name,
        quote: snippet.quote || snippet.snippet || ''
      })))
      .slice(0, 6);

    const result = await aiModelProviderService.json<{
      reply?: string;
      suggestedTags?: Array<{ label: string; rationale?: string }>;
    }>({
      instruction: [
        '你是一个轻量知识图谱节点助手。',
        '只基于给定节点、邻近图信息、来源片段和用户问题回答。',
        '如果用户继续追问，可以承接前文上下文，尽量直接解释这个节点的概念、作用、前置关系、常见误区或来源依据。',
        '对话后可以建议少量 tag，但不要替用户做学习诊断，不要输出掌握度、薄弱点、学习状态。',
        'tag 是用户可采纳的轻量标记，最多 4 个，标签应简短。'
      ].join('\n'),
      schema: {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          suggestedTags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                rationale: { type: 'string' }
              }
            }
          }
        }
      },
      input: {
        question: input.question || '请解释这个节点，并建议是否需要打标签。',
        concept: {
          title: concept.title,
          description: concept.description || '',
          category: concept.category || '',
          tags: concept.tags || []
        },
        history: Array.isArray(input.history) ? input.history.slice(-6) : [],
        neighbors,
        sourceSnippets
      },
      useCase: 'chat',
      timeoutMs: 45000
    });

    const suggestedTags = (Array.isArray(result.data.suggestedTags) ? result.data.suggestedTags : [])
      .map((tag) => ({
        label: normalizeTagLabel(tag.label),
        rationale: clip(tag.rationale || '', 260)
      }))
      .filter((tag) => tag.label && !SYSTEM_CANDIDATE_TAGS.has(tag.label))
      .slice(0, 4);

    return {
      reply: result.data.reply || '',
      suggestedTags,
      model: result.model,
      provider: result.provider
    };
  }

  async *streamConceptExplanation(input: {
    workspaceId: string;
    conceptId: string;
    question?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) {
    const graph = await this.getGraph({ workspaceId: input.workspaceId, limit: 220 });
    const concept = (graph.nodes as any[]).find((node) => node.id === input.conceptId);
    if (!concept) throw new Error('concept not found');
    const neighbors = (graph.edges as any[])
      .filter((edge) => edge.from === input.conceptId || edge.to === input.conceptId)
      .slice(0, 12)
      .map((edge) => ({
        relationType: edge.relationType,
        direction: edge.from === input.conceptId ? 'outgoing' : 'incoming',
        concept: (graph.nodes as any[]).find((node) => node.id === (edge.from === input.conceptId ? edge.to : edge.from))?.title || ''
      }));
    const sourceSnippets = (concept.sources || [])
      .flatMap((source: any) => (source.snippets || []).slice(0, 2).map((snippet: any) => ({
        source: source.name,
        quote: snippet.quote || snippet.snippet || ''
      })))
      .slice(0, 6);
    const history = Array.isArray(input.history)
      ? input.history
          .slice(-6)
          .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${clip(message.content, 600)}`)
          .join('\n')
      : '';

    const prompt = [
      '你是一个轻量知识图谱节点助手。',
      '只基于给定节点、邻近图信息、来源片段和用户问题回答。',
      '直接解释这个节点的概念、作用、前置关系、常见误区或来源依据。',
      '不要输出掌握度、薄弱点、学习状态，也不要生成 tag 列表。',
      '默认使用简体中文，回答可以使用 Markdown，但保持简洁。',
      '',
      `用户问题: ${input.question || '请解释这个节点。'}`,
      `节点: ${JSON.stringify({
        title: concept.title,
        description: concept.description || '',
        category: concept.category || '',
        tags: concept.tags || []
      })}`,
      `邻近关系: ${JSON.stringify(neighbors)}`,
      `来源片段: ${JSON.stringify(sourceSnippets)}`,
      history ? `历史对话:\n${history}` : ''
    ].filter(Boolean).join('\n\n');

    for await (const delta of aiModelProviderService.chatStream(
      [{ role: 'user', content: prompt }],
      { useCase: 'chat', timeoutMs: 45000 }
    )) {
      yield delta;
    }
  }

  async getGraph(input: { workspaceId: string; limit?: number; sourceIds?: string[]; tagQuery?: string }) {
    const sourceIds = unique(input.sourceIds || []);
    const rawConcepts = await prisma.courseKnowledgeConcept.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: 'active',
        ...(sourceIds.length
          ? { bindings: { some: { bindingType: 'resource', fileObjectId: { in: sourceIds } } } }
          : {})
      },
      orderBy: [{ activationScore: 'desc' }, { updatedAt: 'desc' }],
      take: Math.min(Math.max((input.limit || 80) * 3, 20), 500),
      include: {
        bindings: {
          take: 24,
          orderBy: { updatedAt: 'desc' },
          include: {
            fileObject: {
              select: {
                id: true,
                name: true,
                path: true,
                resourceType: true,
                origin: true,
                mimeType: true,
                extension: true,
                updatedAt: true
              }
            }
          }
        },
        misconceptions: { take: 5, orderBy: { severity: 'desc' } },
        learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 }
      }
    });
    let concepts = rawConcepts
      .filter((concept) => isCourseConceptCandidate(concept.title))
      .slice(0, Math.min(Math.max(input.limit || 80, 1), 300));
    const initialIds = concepts.map((concept) => concept.id);
    let relations = await prisma.courseKnowledgeRelation.findMany({
      where: {
        workspaceId: input.workspaceId,
        fromConceptId: { in: initialIds },
        toConceptId: { in: initialIds }
      },
      orderBy: { confidence: 'desc' },
      take: 600
    });
    const degreeById = new Map<string, number>();
    relations.forEach((relation) => {
      degreeById.set(relation.fromConceptId, (degreeById.get(relation.fromConceptId) || 0) + 1);
      degreeById.set(relation.toConceptId, (degreeById.get(relation.toConceptId) || 0) + 1);
    });
    await this.ensureSystemCandidateTags({
      workspaceId: input.workspaceId,
      concepts,
      degreeById
    });
    const tagRows = initialIds.length
      ? await prisma.$queryRawUnsafe<Array<any>>(
          `SELECT "id", "label", "normalizedLabel", "state", "sourcesJson", "rationale", "createdAt", "updatedAt", "conceptId"
           FROM "CourseKnowledgeConceptTag"
           WHERE "workspaceId" = ? AND "conceptId" IN (${initialIds.map(() => '?').join(',')})
           ORDER BY CASE WHEN "state" = 'applied' THEN 0 ELSE 1 END, "updatedAt" DESC`,
          input.workspaceId,
          ...initialIds
        )
      : [];
    const tagsByConceptId = new Map<string, Array<ReturnType<typeof serializeTag>>>();
    tagRows.forEach((row) => {
      const items = tagsByConceptId.get(row.conceptId) || [];
      items.push(serializeTag(row));
      tagsByConceptId.set(row.conceptId, items);
    });
    const tagQuery = normalizedTagKey(input.tagQuery || '');
    if (tagQuery) {
      concepts = concepts.filter((concept) =>
        (tagsByConceptId.get(concept.id) || []).some((tag) => tag.state === 'applied' && tag.normalizedLabel.includes(tagQuery))
      );
      const filteredIds = new Set(concepts.map((concept) => concept.id));
      relations = relations.filter((relation) => filteredIds.has(relation.fromConceptId) && filteredIds.has(relation.toConceptId));
    }
    const sourceById = new Map<string, {
      id: string;
      name: string;
      path: string;
      resourceType?: string | null;
      origin?: string | null;
      mimeType?: string | null;
      extension?: string | null;
      updatedAt?: string | null;
      nodeCount: number;
      edgeCount: number;
    }>();
    const touchSource = (source: {
      id: string;
      name?: string | null;
      path?: string | null;
      resourceType?: string | null;
      origin?: string | null;
      mimeType?: string | null;
      extension?: string | null;
      updatedAt?: Date | string | null;
    }, kind: 'node' | 'edge') => {
      if (!source.id) return;
      const current = sourceById.get(source.id) || {
        id: source.id,
        name: source.name || 'Unknown source',
        path: source.path || '',
        resourceType: source.resourceType || null,
        origin: source.origin || null,
        mimeType: source.mimeType || null,
        extension: source.extension || null,
        updatedAt: source.updatedAt instanceof Date ? source.updatedAt.toISOString() : source.updatedAt || null,
        nodeCount: 0,
        edgeCount: 0
      };
      if (kind === 'node') current.nodeCount += 1;
      if (kind === 'edge') current.edgeCount += 1;
      sourceById.set(source.id, current);
    };
    const sourceRefsFromEvidence = (evidence: Record<string, any>) => {
      const refs = Array.isArray(evidence.resourceEvidence) ? evidence.resourceEvidence : [];
      const byId = new Map<string, any>();
      refs.forEach((item) => {
        const id = normalizeText(item.fileObjectId);
        if (!id) return;
        const current = byId.get(id);
        if (!current) {
          byId.set(id, {
            id,
            name: item.fileName || 'Unknown source',
            path: item.path || '',
            snippets: item.snippet ? [{
              chunkId: item.chunkId || null,
              chunkIndex: item.chunkIndex ?? null,
              sectionId: item.sectionId || null,
              quote: clip(item.snippet, 260),
              rationale: item.rationale || '',
              confidence: item.confidence ?? null
            }] : []
          });
          return;
        }
        if (item.snippet && current.snippets.length < 3) {
          current.snippets.push({
            chunkId: item.chunkId || null,
            chunkIndex: item.chunkIndex ?? null,
            sectionId: item.sectionId || null,
            quote: clip(item.snippet, 260),
            rationale: item.rationale || '',
            confidence: item.confidence ?? null
          });
        }
      });
      return Array.from(byId.values());
    };
    return {
      schema: 'course_knowledge_graph.v1',
      nodes: concepts.map((concept) => {
        const evidence = parseJson<Record<string, any>>(concept.evidenceJson, {});
        const bindingSources = concept.bindings
          .filter((binding) => binding.bindingType === 'resource' && binding.fileObjectId && binding.fileObject)
          .map((binding) => ({
            id: binding.fileObjectId as string,
            name: binding.fileObject?.name || 'Unknown source',
            path: binding.fileObject?.path || '',
            resourceType: binding.fileObject?.resourceType || null,
            origin: binding.fileObject?.origin || null,
            mimeType: binding.fileObject?.mimeType || null,
            extension: binding.fileObject?.extension || null,
            role: binding.role,
            strength: binding.strength,
            confidence: binding.confidence,
            updatedAt: binding.fileObject?.updatedAt?.toISOString?.() || null
          }));
        const evidenceSources = sourceRefsFromEvidence(evidence);
        const sources = bindingSources.map((source) => {
          const evidenceSource = evidenceSources.find((item) => item.id === source.id);
          return { ...source, snippets: evidenceSource?.snippets || [] };
        });
        evidenceSources
          .filter((item) => !sources.some((source) => source.id === item.id))
          .forEach((item) => sources.push({ ...item, role: 'evidence', strength: null, confidence: null }));
        const uniqueSources = Array.from(new Map(sources.map((source) => [source.id, source])).values());
        uniqueSources.forEach((source) => touchSource(source, 'node'));
        return {
          id: concept.id,
          conceptKey: concept.conceptKey,
          title: concept.title,
          description: concept.description,
          aliases: parseJson<string[]>(concept.aliasesJson, []),
          category: concept.category,
          difficulty: concept.difficulty,
          source: concept.source,
          tags: tagsByConceptId.get(concept.id) || [],
          sourceIds: uniqueSources.map((source) => source.id),
          sources: uniqueSources,
          activationScore: concept.activationScore,
          aiEvidence: {
            sourceLayer: evidence.sourceLayer,
            aiPipeline: evidence.aiPipeline || null,
            resourceEvidence: Array.isArray(evidence.resourceEvidence) ? evidence.resourceEvidence.slice(0, 6) : [],
            canonicalization: evidence.canonicalization || null,
            review: evidence.review || null
          },
          learnerState: concept.learnerStates[0]
            ? {
                masteryEstimate: concept.learnerStates[0].masteryEstimate,
                weaknessEstimate: concept.learnerStates[0].weaknessEstimate,
                readinessEstimate: concept.learnerStates[0].readinessEstimate
              }
            : null,
          lastActivatedAt: concept.lastActivatedAt?.toISOString() || null,
          bindings: concept.bindings.map((binding) => ({
            targetType: binding.targetType,
            targetId: binding.targetId,
            role: binding.role,
            strength: binding.strength,
            fileObjectId: binding.fileObjectId || null,
            fileName: binding.fileObject?.name || null,
            path: binding.fileObject?.path || null
          })),
          misconceptions: concept.misconceptions.map((item) => ({
            title: item.title,
            repairHint: item.repairHint,
            severity: item.severity
          }))
        };
      }),
      edges: relations.map((relation) => {
        const evidence = parseJson<Record<string, any>>(relation.evidenceJson, {});
        const sources = sourceRefsFromEvidence(evidence);
        sources.forEach((source) => touchSource(source, 'edge'));
        return {
          id: relation.id,
          from: relation.fromConceptId,
          to: relation.toConceptId,
          relationType: relation.relationType,
          weight: relation.weight,
          confidence: relation.confidence,
          source: relation.source,
          sourceIds: sources.map((source) => source.id),
          sources,
          aiEvidence: {
            sourceLayer: evidence.sourceLayer,
            description: evidence.description || '',
            resourceEvidence: Array.isArray(evidence.resourceEvidence) ? evidence.resourceEvidence.slice(0, 4) : [],
            review: evidence.review || null
          }
        };
      }),
      sources: Array.from(sourceById.values())
        .sort((left, right) => right.nodeCount - left.nodeCount || left.name.localeCompare(right.name))
    };
  }

  async getConceptExercises(input: { workspaceId: string; conceptId: string; limit?: number }) {
    const limit = Math.min(Math.max(input.limit || 12, 1), 50);
    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT
        e."id",
        e."title",
        e."prompt",
        e."exerciseType",
        e."difficulty",
        e."answerJson",
        e."explanation",
        e."source",
        e."evidenceJson",
        e."fileObjectId",
        e."updatedAt",
        b."role",
        b."strength",
        b."confidence",
        f."name" AS "fileName",
        f."path" AS "path",
        f."resourceType" AS "resourceType",
        f."origin" AS "origin"
      FROM "CourseKnowledgeExerciseBinding" b
      JOIN "CourseKnowledgeExercise" e ON e."id" = b."exerciseId"
      LEFT JOIN "FileSystemObject" f ON f."id" = e."fileObjectId"
      WHERE b."workspaceId" = ? AND b."conceptId" = ? AND e."status" = 'active'
      ORDER BY b."confidence" DESC, e."updatedAt" DESC
      LIMIT ?`,
      input.workspaceId,
      input.conceptId,
      limit
    );
    return rows.map((row) => {
      const evidence = parseJson<Record<string, any>>(row.evidenceJson, {});
      return {
        id: row.id,
        title: row.title,
        prompt: row.prompt,
        exerciseType: row.exerciseType,
        difficulty: row.difficulty,
        answer: parseJson(row.answerJson, null),
        explanation: row.explanation,
        source: row.source,
        role: row.role,
        strength: row.strength,
        confidence: row.confidence,
        updatedAt: row.updatedAt,
        sourceRef: row.fileObjectId
          ? {
              id: row.fileObjectId,
              name: row.fileName || 'Unknown source',
              path: row.path || '',
              resourceType: row.resourceType || null,
              origin: row.origin || null
            }
          : null,
        evidence: {
          sourceLayer: evidence.sourceLayer,
          resourceEvidence: Array.isArray(evidence.resourceEvidence) ? evidence.resourceEvidence.slice(0, 4) : [],
          review: evidence.review || null
        }
      };
    });
  }
}

export const courseKnowledgeGraphService = new CourseKnowledgeGraphService();

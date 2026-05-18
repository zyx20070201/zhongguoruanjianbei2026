import prisma from '../config/db';
import { stableHash } from './chunkSchema';
import {
  isProbablyKnowledgeConcept,
  isToolGeneratedLearningRequest
} from './learnerSignalSanitizer';

type RelationType = 'prerequisite' | 'related' | 'part_of' | 'supports' | 'assesses' | 'remediates';
type BindingType = 'resource' | 'task' | 'quiz' | 'misconception' | 'event' | 'plan' | 'goal';

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

const stripMarkdownNoise = (value: string) =>
  value
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)、]\s*/, '')
    .replace(/\*\*|__|`/g, '')
    .trim();

const isCourseConceptCandidate = (value: string | null | undefined) => {
  const text = stripMarkdownNoise(normalizeText(value));
  if (!isProbablyKnowledgeConcept(text)) return false;
  if (/^(?:name|aid|viewport|utf-?8|zh-cn|segoe ui|width\s*=|initial-scale|youtube\.com)$/i.test(text)) return false;
  if (/^(?:资源|来源依据|个性化依据|适用对象|核心内容|核心直觉|关键概念|复盘问题|战术任务|事件|读者|大纲|要什么|如何做|关系|计划|写故事|盖房子)$/.test(text)) return false;
  if (/youtube\.com|digitalocean|hugging face|google for developers/i.test(text)) return false;
  if (/根据当前资料生成|提取关键概念|方便我|给我|帮我|写一段|只输出|不要标题|语言：|难度：|数量：|细节：/.test(text)) return false;
  if (/生成.*(?:概念讲解|检查问题|知识点|学习资源)|有来源依据|个性化学习资源|学习者$/.test(text)) return false;
  if (/^(?:功能|代码).*(?:完成|写了)\s*\d+%$/.test(text)) return false;
  if (/[=<>]/.test(text)) return false;
  if (/[,，]/.test(text) && text.length > 28) return false;
  if (/[。！？?]/.test(text) && text.length > 24) return false;
  return true;
};

export const conceptKeyFor = (workspaceId: string, title: string) => {
  const normalized = normalizeText(title).toLowerCase();
  return stableHash([workspaceId, normalized]).slice(0, 32);
};

const conceptCandidatesFromText = (text: string, limit = 8) => {
  if (isToolGeneratedLearningRequest(text)) return [];
  const candidates: string[] = [];
  for (const match of text.matchAll(/[「“"]([^」”"]{2,80})[」”"]/g)) candidates.push(match[1]);
  for (const match of text.matchAll(/(?:知识点|概念|主题|skill|concept|topic)\s*[:：]\s*([^，。；;\n]{2,80})/gi)) candidates.push(match[1]);
  for (const match of text.matchAll(/(?:理解|掌握|学习|解释|介绍|关于)\s*([^，。！？\n]{2,60})/g)) candidates.push(match[1]);
  return unique(candidates)
    .map((item) => item.replace(/^(的|和|与)/, '').replace(/(是什么|的区别|的概念|相关内容)$/g, '').trim())
    .filter(isCourseConceptCandidate)
    .slice(0, limit);
};

const cleanConceptList = (values: Array<string | null | undefined>, limit = 12) =>
  Array.from(new Set(values.map((value) => stripMarkdownNoise(normalizeText(value))).filter(isCourseConceptCandidate))).slice(0, limit);

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

type ResourceConceptCandidate = {
  title: string;
  aliases: string[];
  roles: Set<ResourceConceptEvidence['role']>;
  score: number;
  occurrenceCount: number;
  headingCount: number;
  assessmentCount: number;
  evidence: ResourceConceptEvidence[];
};

const clip = (value: unknown, maxLength = 420) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const canonicalTitleKey = (value: unknown) => normalizeText(value).toLowerCase();

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

const inferChunkRole = (chunk: any, metadata: Record<string, any>): ResourceConceptEvidence['role'] => {
  const chunkType = String(metadata.chunkType || '').toLowerCase();
  const purpose = String(metadata.purpose || '').toLowerCase();
  const text = `${chunk.summary || ''}\n${chunk.text || ''}`;
  if (chunkType === 'video_key_point') return 'video_key_point';
  if (chunkType === 'video_chapter') return 'video_chapter';
  if (/quiz|assessment|exercise|题|练习|测验|考察|考点/i.test(purpose) || /(?:题目|选择题|填空题|判断题|答案|解析)/.test(text)) return 'assessment';
  if (/误区|易错|常见错误|错因|pitfall|mistake/i.test(text)) return 'misconception';
  if (/例如|例子|案例|示例|example/i.test(text)) return 'example';
  if (/定义|是指|指的是|means|is defined as/i.test(text)) return 'definition';
  return 'mention';
};

const candidateFromText = (text: string, limit = 10) => {
  if (isToolGeneratedLearningRequest(text)) return [];
  const candidates: string[] = [];
  for (const match of text.matchAll(/[「“"]([^」”"]{2,80})[」”"]/g)) candidates.push(match[1]);
  for (const match of text.matchAll(/(?:知识点|概念|主题|技能|考点|能力点|skill|concept|topic)\s*[:：]\s*([^，。；;\n]{2,80})/gi)) candidates.push(match[1]);
  for (const match of text.matchAll(/(?:理解|掌握|学习|解释|介绍|关于|考察)\s*([^，。！？\n]{2,60})/g)) candidates.push(match[1]);
  return cleanConceptList(candidates, limit);
};

const addCandidate = (
  candidates: Map<string, ResourceConceptCandidate>,
  title: string,
  patch: {
    aliases?: string[];
    role: ResourceConceptEvidence['role'];
    score: number;
    evidence: ResourceConceptEvidence;
  }
) => {
  const cleanTitle = cleanConceptList([title], 1)[0];
  if (!cleanTitle) return;
  const key = canonicalTitleKey(cleanTitle);
  const current = candidates.get(key) || {
    title: cleanTitle,
    aliases: [],
    roles: new Set<ResourceConceptEvidence['role']>(),
    score: 0,
    occurrenceCount: 0,
    headingCount: 0,
    assessmentCount: 0,
    evidence: []
  };
  current.aliases = unique([...current.aliases, ...(patch.aliases || []), cleanTitle]);
  current.roles.add(patch.role);
  current.score += patch.score;
  current.occurrenceCount += 1;
  if (patch.role === 'heading' || patch.role === 'video_chapter') current.headingCount += 1;
  if (patch.role === 'assessment') current.assessmentCount += 1;
  current.evidence = mergeEvidenceArrays<ResourceConceptEvidence>(
    current.evidence,
    [patch.evidence],
    (item) => `${item.fileObjectId}:${item.chunkId || item.chunkIndex || ''}:${item.role}:${clip(item.snippet, 80)}`,
    8
  );
  candidates.set(key, current);
};

const relationEvidenceFor = (input: {
  file: { id: string; name: string; path: string };
  relationSource: string;
  headingPath?: string[];
  chunkId?: string;
  chunkIndex?: number;
  rationale: string;
}) => ({
  schema: 'course_relation_evidence.v1',
  sourceLayer: 'resource_extraction',
  fileObjectId: input.file.id,
  fileName: input.file.name,
  path: input.file.path,
  relationSource: input.relationSource,
  headingPath: input.headingPath || [],
  chunkId: input.chunkId,
  chunkIndex: input.chunkIndex,
  rationale: input.rationale
});

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
    if (!isCourseConceptCandidate(title)) throw new Error('valid concept title is required');
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
      where: { id: input.fileObjectId, workspaceId: input.workspaceId },
      include: { knowledgeChunks: { orderBy: { chunkIndex: 'asc' }, take: 12 } }
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
    const candidates = new Map<string, ResourceConceptCandidate>();
    const relatedTitles = new Set<string>();
    const fileMetadata = parseJson<Record<string, any>>(file.metadataJson, {});
    const fileHeadingPath = Array.isArray(fileMetadata.headingPath) ? fileMetadata.headingPath.map((item: unknown) => normalizeText(item)).filter(Boolean) : [];

    file.knowledgeChunks.forEach((chunk) => {
      const metadata = parseJson<Record<string, any>>(chunk.metadataJson, {});
      const headingPath = Array.isArray(metadata.headingPath) ? metadata.headingPath.map((item: unknown) => normalizeText(item)).filter(Boolean) : [];
      const role = inferChunkRole(chunk, metadata);
      const chunkText = `${chunk.summary || ''}\n${chunk.text || ''}`;
      const headingCandidates = [...headingPath, ...fileHeadingPath].filter(Boolean);
      const textCandidates = candidateFromText(chunkText, 10);
      const conceptsFromChunk = cleanConceptList([
        ...headingCandidates,
        ...textCandidates,
        ...(Array.isArray(metadata.conceptCandidates) ? metadata.conceptCandidates : [])
      ], 18);
      conceptsFromChunk.forEach((title) => {
        relatedTitles.add(title);
        addCandidate(candidates, title, {
          aliases: headingCandidates,
          role: headingCandidates.includes(title) ? 'heading' : role,
          score: headingCandidates.includes(title)
            ? 1.4
            : role === 'assessment'
              ? 1.1
              : role === 'definition'
                ? 1
                : role === 'example'
                  ? 0.88
                  : role === 'misconception'
                    ? 1.05
                    : 0.72,
          evidence: {
            fileObjectId: file.id,
            fileName: file.name,
            path: file.path,
            chunkId: chunk.id,
            chunkIndex: chunk.chunkIndex,
            role,
            headingPath,
            snippet: clip(chunk.summary || chunk.text, 260),
            confidence: headingCandidates.includes(title) ? 0.92 : role === 'assessment' ? 0.84 : 0.7
          }
        });
      });
    });

    const orderedCandidates = Array.from(candidates.values())
      .map((candidate) => ({
        ...candidate,
        title: candidate.title,
        evidence: candidate.evidence.sort((left, right) => right.confidence - left.confidence)
      }))
      .sort((left, right) => {
        const weightedLeft =
          left.score +
          left.headingCount * 0.8 +
          left.assessmentCount * 0.7 +
          Math.min(1.2, left.occurrenceCount * 0.12);
        const weightedRight =
          right.score +
          right.headingCount * 0.8 +
          right.assessmentCount * 0.7 +
          Math.min(1.2, right.occurrenceCount * 0.12);
        return weightedRight - weightedLeft;
      })
      .slice(0, 24);

    const concepts: Array<Awaited<ReturnType<CourseKnowledgeGraphService['upsertConcept']>>> = [];
    const conceptByKey = new Map<string, Awaited<ReturnType<CourseKnowledgeGraphService['upsertConcept']>>>();

    for (const candidate of orderedCandidates) {
      const evidence = {
        sourceLayer: 'resource_extraction',
        source: input.source || 'resource_index',
        fileObjectId: file.id,
        fileName: file.name,
        path: file.path,
        resourceSignals: {
          sourceFileIds: [file.id],
          sourceCount: 1,
          workbenchIds: file.ownerWorkbenchId ? [file.ownerWorkbenchId] : [],
          occurrenceCount: candidate.occurrenceCount,
          headingCount: candidate.headingCount,
          assessmentCount: candidate.assessmentCount,
          roles: Array.from(candidate.roles)
        },
        resourceEvidence: candidate.evidence
      };
      const concept = await this.upsertConcept({
        workspaceId: input.workspaceId,
        title: candidate.title,
        aliases: candidate.aliases,
        source: input.source || 'resource_index',
        difficulty: Math.min(1, 0.28 + candidate.headingCount * 0.08 + candidate.assessmentCount * 0.12 + Math.min(0.36, candidate.score * 0.04)),
        evidence
      });
      concepts.push(concept);
      conceptByKey.set(canonicalTitleKey(candidate.title), concept);
      conceptByKey.set(concept.conceptKey, concept);
      await this.bindConcept({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        bindingType: 'resource',
        targetType: 'resource',
        targetId: file.id,
        role: candidate.roles.has('assessment')
          ? 'assesses'
          : candidate.roles.has('misconception')
            ? 'remediates'
            : candidate.roles.has('example')
              ? 'supports'
              : 'explains',
        strength: Math.min(0.92, 0.46 + candidate.headingCount * 0.08 + candidate.assessmentCount * 0.06 + Math.min(0.18, candidate.occurrenceCount * 0.02)),
        confidence: Math.min(0.92, 0.52 + candidate.headingCount * 0.1 + candidate.assessmentCount * 0.07),
        fileObjectId: file.id,
        evidence
      });
      await this.activateConcept({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        activationType: 'resource_indexed',
        sourceType: 'resource',
        sourceId: file.id,
        score: Math.min(0.42, 0.12 + candidate.occurrenceCount * 0.03 + candidate.headingCount * 0.04 + candidate.assessmentCount * 0.05),
        evidence
      });
      await this.updateLearnerConceptState({
        workspaceId: input.workspaceId,
        conceptId: concept.id,
        readinessDelta: Math.min(0.08, 0.015 + candidate.headingCount * 0.01 + candidate.assessmentCount * 0.008),
        evidence
      });
      if (candidate.roles.has('assessment')) {
        await this.upsertMisconception({
          workspaceId: input.workspaceId,
          conceptId: concept.id,
          title: `Assessment coverage around ${candidate.title}`,
          description: `This concept appears in assessment-oriented chunks for ${file.name}.`,
          repairHint: 'Use the assessment pattern to validate whether the learner can apply the concept, not just recall it.',
          severity: Math.min(0.72, 0.32 + candidate.assessmentCount * 0.08),
          confidence: 0.68,
          evidence
        }).catch(() => null);
      }
    }

    const rootCandidate = orderedCandidates[0];
    for (let i = 1; i < orderedCandidates.length; i += 1) {
      const current = orderedCandidates[i];
      const currentConcept = conceptByKey.get(canonicalTitleKey(current.title));
      const rootConcept = rootCandidate ? conceptByKey.get(canonicalTitleKey(rootCandidate.title)) : null;
      if (!currentConcept || !rootConcept || currentConcept.id === rootConcept.id) continue;
      const relationType = current.roles.has('assessment')
        ? 'assesses'
        : current.roles.has('misconception')
          ? 'remediates'
          : current.roles.has('example')
            ? 'supports'
            : current.headingCount > 0 && rootCandidate?.headingCount && i < 6
              ? 'part_of'
              : 'related';
      await this.upsertRelation({
        workspaceId: input.workspaceId,
        fromConceptId: currentConcept.id,
        toConceptId: rootConcept.id,
        relationType,
        weight: relationType === 'part_of'
          ? 0.72
          : relationType === 'assesses'
            ? 0.68
            : relationType === 'remediates'
              ? 0.66
              : relationType === 'supports'
                ? 0.58
                : 0.46,
        confidence: Math.min(0.92, 0.42 + current.occurrenceCount * 0.02 + current.headingCount * 0.05),
        source: 'resource_structure',
        evidence: relationEvidenceFor({
          file: { id: file.id, name: file.name, path: file.path },
          relationSource: 'resource_extraction',
          headingPath: current.evidence[0]?.headingPath || fileHeadingPath,
          chunkId: current.evidence[0]?.chunkId,
          chunkIndex: current.evidence[0]?.chunkIndex,
          rationale: relationType === 'part_of'
            ? 'Derived from shared heading hierarchy in user resources.'
            : relationType === 'assesses'
              ? 'Derived from assessment-oriented resource evidence.'
              : relationType === 'remediates'
                ? 'Derived from misconception-oriented resource evidence.'
                : relationType === 'supports'
                  ? 'Derived from examples or explanatory resource evidence.'
                  : 'Derived from co-occurrence and resource evidence.'
        })
      });
    }

    if (orderedCandidates.length >= 2) {
      const headingCandidates = orderedCandidates.filter((candidate) => candidate.headingCount > 0).slice(0, 6);
      for (let i = 0; i < headingCandidates.length - 1; i += 1) {
        const from = conceptByKey.get(canonicalTitleKey(headingCandidates[i].title));
        const to = conceptByKey.get(canonicalTitleKey(headingCandidates[i + 1].title));
        if (!from || !to || from.id === to.id) continue;
        await this.upsertRelation({
          workspaceId: input.workspaceId,
          fromConceptId: from.id,
          toConceptId: to.id,
          relationType: 'prerequisite',
          weight: 0.62,
          confidence: 0.52,
          source: 'resource_heading_order',
          evidence: relationEvidenceFor({
            file: { id: file.id, name: file.name, path: file.path },
            relationSource: 'heading_order',
            headingPath: headingCandidates[i].evidence[0]?.headingPath || fileHeadingPath,
            chunkId: headingCandidates[i].evidence[0]?.chunkId,
            chunkIndex: headingCandidates[i].evidence[0]?.chunkIndex,
            rationale: 'Derived from heading order inside the source material.'
          })
        });
      }
    }

    return {
      concepts,
      bindings: concepts.length,
      candidates: orderedCandidates.map((candidate) => ({
        title: candidate.title,
        aliases: candidate.aliases,
        roles: Array.from(candidate.roles),
        score: Number(candidate.score.toFixed(3)),
        occurrenceCount: candidate.occurrenceCount,
        headingCount: candidate.headingCount,
        assessmentCount: candidate.assessmentCount,
        evidenceCount: candidate.evidence.length
      }))
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

  async getGraph(input: { workspaceId: string; limit?: number }) {
    const rawConcepts = await prisma.courseKnowledgeConcept.findMany({
      where: { workspaceId: input.workspaceId, status: 'active' },
      orderBy: [{ activationScore: 'desc' }, { updatedAt: 'desc' }],
      take: Math.min(Math.max((input.limit || 80) * 3, 20), 500),
      include: {
        bindings: { take: 8, orderBy: { updatedAt: 'desc' } },
        misconceptions: { take: 5, orderBy: { severity: 'desc' } },
        learnerStates: { where: { stateScope: 'workspace', status: 'active' }, take: 1 }
      }
    });
    const concepts = rawConcepts
      .filter((concept) => isCourseConceptCandidate(concept.title))
      .slice(0, Math.min(Math.max(input.limit || 80, 1), 300));
    const ids = concepts.map((concept) => concept.id);
    const relations = await prisma.courseKnowledgeRelation.findMany({
      where: {
        workspaceId: input.workspaceId,
        fromConceptId: { in: ids },
        toConceptId: { in: ids }
      },
      orderBy: { confidence: 'desc' },
      take: 600
    });
    return {
      schema: 'course_knowledge_graph.v1',
      nodes: concepts.map((concept) => ({
        id: concept.id,
        conceptKey: concept.conceptKey,
        title: concept.title,
        description: concept.description,
        aliases: parseJson<string[]>(concept.aliasesJson, []),
        category: concept.category,
        difficulty: concept.difficulty,
        activationScore: concept.activationScore,
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
          strength: binding.strength
        })),
        misconceptions: concept.misconceptions.map((item) => ({
          title: item.title,
          repairHint: item.repairHint,
          severity: item.severity
        }))
      })),
      edges: relations.map((relation) => ({
        id: relation.id,
        from: relation.fromConceptId,
        to: relation.toConceptId,
        relationType: relation.relationType,
        weight: relation.weight,
        confidence: relation.confidence
      }))
    };
  }
}

export const courseKnowledgeGraphService = new CourseKnowledgeGraphService();

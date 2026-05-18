import prisma from '../../config/db';
import { LearningPlanResource, ResourceLearningUnit } from '../planningTypes';
import { findWorkbenchResourceFiles } from '../workbenchResourceScope';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const clip = (value: unknown, maxLength = 520) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const unique = (items: Array<string | null | undefined>, limit = 10) =>
  Array.from(new Set(items.map((item) => clip(item, 140)).filter(Boolean))).slice(0, limit);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const resourceTypeFor = (file: any): LearningPlanResource['type'] => {
  const extension = String(file.extension || file.name?.split('.').pop() || '').toLowerCase();
  const category = String(file.fileCategory || '').toLowerCase();
  const mimeType = String(file.mimeType || '').toLowerCase();
  if (mimeType.startsWith('video/') || category === 'media' || ['mp4', 'mov', 'avi', 'mkv'].includes(extension)) return 'video';
  if (category === 'generated' && /quiz|测验|题|练习/i.test(file.name || file.path || '')) return 'quiz';
  if (/quiz|测验|题库|练习/i.test(file.name || file.path || '')) return 'exercise';
  if (/flashcard|卡片/i.test(file.name || file.path || '')) return 'flashcards';
  if (/project|case|案例|实操/i.test(file.name || file.path || '')) return 'project';
  return 'document';
};

const modalityFor = (type: LearningPlanResource['type']): ResourceLearningUnit['modality'] => {
  if (type === 'video') return 'watch';
  if (type === 'quiz') return 'quiz';
  if (type === 'exercise') return 'practice';
  if (type === 'flashcards') return 'review';
  if (type === 'project') return 'project';
  if (type === 'context') return 'mixed';
  return 'read';
};

const locatorLabel = (locator?: Record<string, any>) => {
  if (!locator) return '';
  if (typeof locator.timestampStart === 'number') {
    const start = secondsToClock(locator.timestampStart);
    const end = typeof locator.timestampEnd === 'number' && locator.timestampEnd !== locator.timestampStart
      ? `-${secondsToClock(locator.timestampEnd)}`
      : '';
    return `${start}${end}`;
  }
  if (locator.pageStart && locator.pageEnd) return locator.pageStart === locator.pageEnd ? `第 ${locator.pageStart} 页` : `第 ${locator.pageStart}-${locator.pageEnd} 页`;
  if (locator.page || locator.primaryPage) return `第 ${locator.page || locator.primaryPage} 页`;
  if (Array.isArray(locator.headingPath) && locator.headingPath.length) return `章节：${locator.headingPath.join(' / ')}`;
  if (typeof locator.chunkIndex === 'number') return `chunk ${locator.chunkIndex}`;
  return '';
};

const secondsToClock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

const conceptsFrom = (...values: unknown[]) => {
  const text = values.map((value) => String(value || '')).join(' ');
  const headingLike = Array.from(text.matchAll(/(?:章节|概念|知识点|主题|目标|技能|key points?|concepts?)[:：]\s*([^。；;\n]+)/gi))
    .flatMap((match) => String(match[1]).split(/[、,，/;；]/g));
  const bracketLike = Array.from(text.matchAll(/[「《]([^」》]{2,32})[」》]/g)).map((match) => match[1]);
  return unique([...headingLike, ...bracketLike], 8);
};

const unitId = (prefix: string, ...parts: unknown[]) =>
  `${prefix}-${parts.map((part) => String(part || '').replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 36)).filter(Boolean).join('-')}`;

type ResourceFile = {
  id: string;
  name: string;
  path: string;
  extension?: string | null;
  fileCategory?: string | null;
  mimeType?: string | null;
  metadataJson?: string | null;
  resourceType?: string | null;
  updatedAt?: Date | string | null;
  workbenchBindings?: Array<{ role?: string | null; pinned?: boolean; orderIndex?: number | null }>;
  knowledgeChunks?: Array<{
    id: string;
    chunkIndex: number;
    text: string;
    summary?: string | null;
    metadataJson: string;
    tokenEstimate?: number | null;
  }>;
};

export class ResourceLearningUnitService {
  async build(input: {
    workspaceId: string;
    workbenchId?: string | null;
    resources: LearningPlanResource[];
    maxFiles?: number;
    maxUnits?: number;
  }): Promise<ResourceLearningUnit[]> {
    const fileRecords = await this.loadFiles(input);
    const units = [
      ...this.unitsFromFiles(fileRecords),
      ...this.unitsFromCandidateResources(input.resources)
    ];
    const kgUnits = await this.unitsFromKgBindings(input.workspaceId, input.workbenchId, fileRecords).catch(() => []);
    const deduped = this.dedupe([...kgUnits, ...units]);
    return deduped
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .slice(0, input.maxUnits || 36);
  }

  private async loadFiles(input: {
    workspaceId: string;
    workbenchId?: string | null;
    maxFiles?: number;
  }): Promise<ResourceFile[]> {
    if (input.workbenchId) {
      return findWorkbenchResourceFiles({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId,
        include: {
          workbenchBindings: {
            where: { workbenchId: input.workbenchId },
            orderBy: [{ orderIndex: 'asc' }, { updatedAt: 'desc' }]
          },
          knowledgeChunks: {
            orderBy: { chunkIndex: 'asc' },
            take: 12
          }
        },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
        take: input.maxFiles || 18
      }) as Promise<ResourceFile[]>;
    }

    return prisma.fileSystemObject.findMany({
      where: { workspaceId: input.workspaceId, nodeType: 'file', knowledgeChunks: { some: {} } },
      include: {
        knowledgeChunks: {
          orderBy: { chunkIndex: 'asc' },
          take: 10
        }
      },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: input.maxFiles || 18
    }) as Promise<ResourceFile[]>;
  }

  private unitsFromFiles(files: ResourceFile[]): ResourceLearningUnit[] {
    return files.flatMap((file) => {
      const type = resourceTypeFor(file);
      const metadata = parseJson<Record<string, any>>(file.metadataJson, {});
      const intelligence = metadata.resourceIntelligence && typeof metadata.resourceIntelligence === 'object'
        ? metadata.resourceIntelligence as Record<string, any>
        : null;
      const binding = file.workbenchBindings?.[0];
      const baseSignals = [
        binding?.pinned ? 'pinned_in_workbench' : '',
        binding?.role ? `workbench_role:${binding.role}` : '',
        intelligence?.status ? `resource_intelligence:${intelligence.status}` : ''
      ].filter(Boolean);

      const intelligenceUnits = intelligence
        ? this.unitsFromResourceIntelligence(file, type, intelligence, baseSignals)
        : [];
      const chunkUnits = this.unitsFromKnowledgeChunks(file, type, baseSignals);
      const overviewUnit = this.overviewUnit(file, type, intelligence, baseSignals);

      return [overviewUnit, ...intelligenceUnits, ...chunkUnits].filter(Boolean).slice(0, 9) as ResourceLearningUnit[];
    });
  }

  private overviewUnit(
    file: ResourceFile,
    type: LearningPlanResource['type'],
    intelligence: Record<string, any> | null,
    signals: string[]
  ): ResourceLearningUnit {
    const binding = file.workbenchBindings?.[0];
    const summary = clip(intelligence?.overview || file.knowledgeChunks?.[0]?.summary || file.knowledgeChunks?.[0]?.text || `${file.name} (${file.path})`, 620);
    return {
      id: unitId('file-overview', file.id),
      resourceId: file.id,
      resourceTitle: file.name,
      resourceType: type,
      sourceFileName: file.name,
      sourceFilePath: file.path,
      workbenchRole: binding?.role || undefined,
      title: `资源概览：${file.name}`,
      summary,
      entryPoint: intelligence?.readingAdvice ? clip(intelligence.readingAdvice, 220) : '先浏览资源概览，再进入相关章节或片段。',
      teaches: conceptsFrom(file.name, summary, intelligence?.readingAdvice),
      prerequisites: [],
      difficulty: type === 'project' ? 4 : type === 'quiz' || type === 'exercise' ? 3 : 2,
      estimatedMinutes: type === 'video' ? 12 : type === 'project' ? 30 : 10,
      modality: modalityFor(type),
      coverage: 'overview',
      evidenceSnippets: [summary].filter(Boolean),
      resourceSignals: signals,
      relevanceScore: 0.52 + (binding?.pinned ? 0.12 : 0) + (intelligence?.status === 'ready' ? 0.08 : 0),
      source: 'knowledge_chunk'
    };
  }

  private unitsFromResourceIntelligence(
    file: ResourceFile,
    type: LearningPlanResource['type'],
    intelligence: Record<string, any>,
    signals: string[]
  ): ResourceLearningUnit[] {
    const sections = Array.isArray(intelligence.sections) ? intelligence.sections : [];
    const transcript = Array.isArray(intelligence.transcript) ? intelligence.transcript : [];
    const sectionUnits = sections.slice(0, 10).map((section: any, index: number): ResourceLearningUnit => {
      const locator = section.locator && typeof section.locator === 'object' ? section.locator : undefined;
      return {
        id: unitId('ri-section', file.id, section.id || index + 1),
        resourceId: file.id,
        resourceTitle: file.name,
        resourceType: type,
        sourceFileName: file.name,
        sourceFilePath: file.path,
        workbenchRole: file.workbenchBindings?.[0]?.role || undefined,
        title: clip(section.title || `${file.name} 章节 ${index + 1}`, 160),
        summary: clip(section.summary || section.evidence || intelligence.overview, 620),
        locator,
        entryPoint: locatorLabel(locator) || section.rangeLabel || undefined,
        teaches: conceptsFrom(section.title, section.summary, section.evidence, ...(section.evidenceSnippets || []).map((snippet: any) => snippet.text)),
        prerequisites: [],
        difficulty: type === 'video' ? 2 : 3,
        estimatedMinutes: type === 'video' ? 8 : 12,
        modality: modalityFor(type),
        coverage: locator?.timestampStart != null ? 'timestamp_range' : locator?.pageStart || locator?.page ? 'page_range' : 'section',
        evidenceSnippets: [
          clip(section.evidence, 220),
          ...(Array.isArray(section.evidenceSnippets) ? section.evidenceSnippets.map((snippet: any) => clip(snippet.text, 220)) : [])
        ].filter(Boolean).slice(0, 3),
        resourceSignals: [...signals, section.confidence ? `confidence:${section.confidence}` : ''],
        relevanceScore: 0.74 - index * 0.015 + (section.confidence === 'high' ? 0.06 : 0),
        source: 'knowledge_chunk'
      };
    });

    const transcriptUnits = transcript.slice(0, 8).map((segment: any, index: number): ResourceLearningUnit => {
      const locator = segment.locator && typeof segment.locator === 'object' ? segment.locator : undefined;
      return {
        id: unitId('ri-transcript', file.id, segment.id || index + 1),
        resourceId: file.id,
        resourceTitle: file.name,
        resourceType: 'video',
        sourceFileName: file.name,
        sourceFilePath: file.path,
        workbenchRole: file.workbenchBindings?.[0]?.role || undefined,
        title: clip(segment.title || `${file.name} 视频片段 ${index + 1}`, 160),
        summary: clip(segment.text, 620),
        locator,
        entryPoint: locatorLabel(locator),
        teaches: conceptsFrom(segment.title, segment.text),
        prerequisites: [],
        difficulty: 2,
        estimatedMinutes: 6,
        modality: 'watch',
        coverage: 'timestamp_range',
        evidenceSnippets: [clip(segment.text, 260)],
        resourceSignals: signals,
        relevanceScore: 0.7 - index * 0.015,
        source: 'knowledge_chunk'
      };
    });

    return [...sectionUnits, ...transcriptUnits];
  }

  private unitsFromKnowledgeChunks(
    file: ResourceFile,
    type: LearningPlanResource['type'],
    signals: string[]
  ): ResourceLearningUnit[] {
    return (file.knowledgeChunks || []).slice(0, 10).map((chunk, index): ResourceLearningUnit => {
      const metadata = parseJson<Record<string, any>>(chunk.metadataJson, {});
      const locator = metadata.locator && typeof metadata.locator === 'object' ? metadata.locator : metadata;
      const headingPath = Array.isArray(locator.headingPath) ? locator.headingPath : [];
      const title = headingPath.length ? headingPath.join(' / ') : `${file.name} 片段 ${chunk.chunkIndex + 1}`;
      const summary = clip(chunk.summary || chunk.text, 620);
      return {
        id: unitId('chunk', file.id, chunk.id || chunk.chunkIndex),
        resourceId: file.id,
        resourceTitle: file.name,
        resourceType: type,
        sourceFileName: file.name,
        sourceFilePath: file.path,
        workbenchRole: file.workbenchBindings?.[0]?.role || undefined,
        title: clip(title, 160),
        summary,
        locator,
        entryPoint: locatorLabel(locator),
        teaches: conceptsFrom(title, summary, chunk.text),
        prerequisites: [],
        difficulty: type === 'exercise' || type === 'quiz' ? 3 : 2,
        estimatedMinutes: clamp(Math.round((chunk.tokenEstimate || 700) / 180), 5, 18),
        modality: modalityFor(type),
        coverage: locator?.timestampStart != null ? 'timestamp_range' : locator?.page || locator?.pageStart ? 'page_range' : 'chunk',
        evidenceSnippets: [clip(chunk.text, 260)].filter(Boolean),
        resourceSignals: [...signals, `chunkIndex:${chunk.chunkIndex}`],
        relevanceScore: 0.64 - index * 0.012,
        source: 'knowledge_chunk'
      };
    });
  }

  private unitsFromCandidateResources(resources: LearningPlanResource[]): ResourceLearningUnit[] {
    return resources.slice(0, 12).map((resource, index): ResourceLearningUnit => ({
      id: unitId('candidate', resource.id || index + 1),
      resourceId: resource.sourceId || resource.id,
      resourceTitle: resource.title,
      resourceType: resource.type,
      sourceFileName: resource.title,
      title: resource.title,
      summary: clip(resource.summary, 620),
      entryPoint: resource.citationLabel,
      teaches: conceptsFrom(resource.title, resource.summary, resource.citationLabel),
      prerequisites: [],
      difficulty: resource.difficulty,
      estimatedMinutes: resource.estimatedMinutes,
      modality: modalityFor(resource.type),
      coverage: resource.type === 'context' ? 'chunk' : 'overview',
      evidenceSnippets: [clip(resource.summary, 260)].filter(Boolean),
      resourceSignals: [resource.citationLabel ? `citation:${resource.citationLabel}` : ''],
      relevanceScore: resource.relevanceScore,
      source: 'fallback'
    }));
  }

  private async unitsFromKgBindings(
    workspaceId: string,
    workbenchId: string | null | undefined,
    files: ResourceFile[]
  ): Promise<ResourceLearningUnit[]> {
    const fileIds = files.map((file) => file.id);
    if (!fileIds.length) return [];
    const fileById = new Map(files.map((file) => [file.id, file] as const));
    const bindings = await prisma.courseKnowledgeBinding.findMany({
      where: {
        workspaceId,
        OR: [
          { fileObjectId: { in: fileIds } },
          { targetType: 'resource', targetId: { in: fileIds } },
          ...(workbenchId ? [{ workbenchId }] : [])
        ]
      },
      include: { concept: true },
      orderBy: [{ strength: 'desc' }, { confidence: 'desc' }],
      take: 120
    });

    return bindings.slice(0, 36).map((binding, index): ResourceLearningUnit | null => {
      const file = (binding.fileObjectId ? fileById.get(binding.fileObjectId) : null) || fileById.get(binding.targetId);
      if (!file) return null;
      const evidence = parseJson<Record<string, any>>(binding.evidenceJson, {});
      const type = binding.bindingType === 'quiz'
        ? 'quiz'
        : binding.bindingType === 'task'
          ? 'exercise'
          : resourceTypeFor(file);
      return {
        id: unitId('kg-binding', binding.id || index + 1),
        resourceId: file.id,
        resourceTitle: file.name,
        resourceType: type,
        sourceFileName: file.name,
        sourceFilePath: file.path,
        workbenchRole: file.workbenchBindings?.[0]?.role || undefined,
        title: clip(`${binding.concept.title} / ${binding.role}`, 160),
        summary: clip(evidence.summary || evidence.fileName || `${file.name} 支持概念「${binding.concept.title}」`, 620),
        locator: evidence.locator,
        entryPoint: locatorLabel(evidence.locator) || evidence.fileName,
        teaches: unique([binding.concept.title, ...(Array.isArray(evidence.concepts) ? evidence.concepts : [])], 8),
        prerequisites: [],
        difficulty: clamp(Math.round(1 + Number(binding.strength || 0.55) * 4), 1, 5),
        estimatedMinutes: type === 'quiz' ? 10 : type === 'exercise' ? 18 : 12,
        modality: modalityFor(type),
        coverage: 'binding',
        evidenceSnippets: [clip(evidence.snippet || evidence.text || evidence.fileName || file.name, 260)].filter(Boolean),
        resourceSignals: [`kg_binding:${binding.bindingType}`, `role:${binding.role}`, `confidence:${binding.confidence}`],
        relevanceScore: clamp(Number(binding.strength || 0.55) * 0.55 + Number(binding.confidence || 0.55) * 0.45, 0, 1),
        source: 'kg_binding'
      };
    }).filter((unit): unit is ResourceLearningUnit => Boolean(unit));
  }

  private dedupe(units: ResourceLearningUnit[]) {
    const byKey = new Map<string, ResourceLearningUnit>();
    units.forEach((unit) => {
      const key = `${unit.resourceId}:${unit.title}:${JSON.stringify(unit.locator || {})}`;
      const existing = byKey.get(key);
      if (!existing || unit.relevanceScore > existing.relevanceScore) {
        byKey.set(key, {
          ...unit,
          teaches: unit.teaches.length ? unit.teaches : conceptsFrom(unit.title, unit.summary),
          evidenceSnippets: unit.evidenceSnippets.slice(0, 4),
          resourceSignals: (unit.resourceSignals || []).filter(Boolean).slice(0, 8),
          relevanceScore: Number(clamp(unit.relevanceScore, 0, 1).toFixed(3))
        });
      }
    });
    return Array.from(byKey.values());
  }
}

export const resourceLearningUnitService = new ResourceLearningUnitService();

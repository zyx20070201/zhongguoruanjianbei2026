import prisma from '../config/db';
import { courseKnowledgeExtractionValidationService } from './courseKnowledgeExtractionValidationService';
import { courseKnowledgeGraphService, isCourseKnowledgeGraphSourceFile } from './courseKnowledgeGraphService';
import { knowledgeIndexingService } from './knowledgeIndexingService';
import {
  buildWorkspaceResourceWhere,
  findWorkbenchResourceFiles
} from './workbenchResourceScope';

const stringify = (value: unknown, fallback: unknown = {}) => {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
};

const unique = <T,>(items: T[]) => Array.from(new Set(items));

type ResourceFile = {
  id: string;
  name: string;
  nodeType: string;
  fileCategory: string | null;
  resourceType: string;
  scope: string;
  origin: string;
  metadataJson: string | null;
  extension: string | null;
  path: string;
  mimeType: string | null;
  ownerWorkbenchId: string | null;
  workspaceId: string;
  updatedAt?: Date | string;
};

type ScopeKind = 'workbench' | 'workspace';

interface BuildInput {
  workspaceId: string;
  workbenchId?: string | null;
  resourceRole?: string | null;
  reindex?: boolean;
  validate?: boolean;
  includeWorkspaceResources?: boolean;
  maxFilesPerWorkbench?: number;
  maxWorkspaceFiles?: number;
  graphLimit?: number;
}

export interface CourseGraphBuildProgress {
  stage: string;
  message: string;
  percent: number;
  processedFiles?: number;
  totalFiles?: number;
  currentFileId?: string | null;
  currentFileName?: string | null;
}

interface BuildOptions {
  onProgress?: (progress: CourseGraphBuildProgress) => void;
}

interface WorkbenchBuildReport {
  workbenchId: string;
  title: string;
  rootPath: string | null;
  resourceCount: number;
  uniqueFileCount: number;
  indexedFileCount: number;
  sourceFileCount: number;
  ingestedFileCount: number;
  conceptCount: number;
  bindingCount: number;
  skippedFileCount: number;
  sampleConcepts: string[];
}

interface FileBuildReport {
  fileId: string;
  fileName: string;
  path: string;
  scopeKinds: ScopeKind[];
  workbenchIds: string[];
  sourceEligible: boolean;
  knowledgeChunkCountBefore: number;
  knowledgeChunkCountAfter: number;
  resourceBindingCountBefore: number;
  indexed: boolean;
  indexStatus: string | null;
  ingested: boolean;
  conceptsExtracted: number;
  bindingsCreated: number;
  skippedReason: string | null;
  error: string | null;
}

export interface CourseGraphBuildReport {
  schema: 'course_graph_build_report.v1';
  workspaceId: string;
  scope: 'workspace' | 'workbench';
  workbenchId: string | null;
  summary: {
    workbenchCount: number;
    fileReferenceCount: number;
    uniqueFileCount: number;
    indexedFileCount: number;
    sourceFileCount: number;
    ingestedFileCount: number;
    conceptCount: number;
    bindingCount: number;
    skippedFileCount: number;
    failedFileCount: number;
  };
  workbenches: WorkbenchBuildReport[];
  files: FileBuildReport[];
  graph?: Record<string, unknown>;
  validation?: Record<string, unknown>;
}

const FILE_SELECT = {
  id: true,
  name: true,
  nodeType: true,
  fileCategory: true,
  resourceType: true,
  scope: true,
  origin: true,
  metadataJson: true,
  extension: true,
  path: true,
  mimeType: true,
  ownerWorkbenchId: true,
  workspaceId: true,
  updatedAt: true
} as const;

const clip = (value: unknown, maxLength = 180) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const workbenchTitle = (workbench: { title?: string | null; name?: string | null }) =>
  clip(workbench.title || workbench.name || 'Untitled Workbench', 120);

export class CourseGraphBuildService {
  async build(input: BuildInput, options: BuildOptions = {}): Promise<CourseGraphBuildReport> {
    const emit = (progress: CourseGraphBuildProgress) => options.onProgress?.(progress);
    const scope = input.workbenchId ? 'workbench' : 'workspace';
    const includeWorkspaceResources = input.includeWorkspaceResources ?? !input.workbenchId;
    emit({
      stage: 'scanning',
      message: '正在扫描 workbench 和 workspace 课程资源。',
      percent: 4
    });
    const [workspace, workbenchRecords] = await Promise.all([
      prisma.workspace.findFirst({
        where: { id: input.workspaceId },
        select: { id: true, name: true }
      }),
      input.workbenchId
        ? prisma.workbench.findMany({
            where: { id: input.workbenchId, workspaceId: input.workspaceId },
            select: { id: true, title: true, name: true, rootPath: true, workspaceId: true }
          })
        : prisma.workbench.findMany({
            where: { workspaceId: input.workspaceId },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, title: true, name: true, rootPath: true, workspaceId: true }
          })
    ]);

    if (!workspace) {
      throw new Error('Workspace not found');
    }

    const workbenches = input.workbenchId
      ? workbenchRecords
      : workbenchRecords;

    const fileScopes: Array<{
      file: ResourceFile;
      scopeKind: ScopeKind;
      workbenchId: string | null;
    }> = [];
    const seenFileIds = new Set<string>();
    const memberships = new Map<string, { scopeKinds: Set<ScopeKind>; workbenchIds: Set<string> }>();
    const workbenchReports: WorkbenchBuildReport[] = [];

    for (const workbench of workbenches) {
      const files = await findWorkbenchResourceFiles({
        workspaceId: input.workspaceId,
        workbenchId: workbench.id,
        role: input.resourceRole || undefined,
        rootPath: workbench.rootPath || undefined,
        take: input.maxFilesPerWorkbench || undefined,
        select: FILE_SELECT as any
      }) as unknown as ResourceFile[];

      const uniqueFiles = unique(files.map((file) => file.id)).map((id) => files.find((file) => file.id === id)!).filter(Boolean);
      for (const file of uniqueFiles) {
        const membership = memberships.get(file.id) || { scopeKinds: new Set<ScopeKind>(), workbenchIds: new Set<string>() };
        membership.scopeKinds.add('workbench');
        membership.workbenchIds.add(workbench.id);
        memberships.set(file.id, membership);
        if (!seenFileIds.has(file.id)) {
          fileScopes.push({ file, scopeKind: 'workbench', workbenchId: workbench.id });
          seenFileIds.add(file.id);
        }
      }

      workbenchReports.push({
        workbenchId: workbench.id,
        title: workbenchTitle(workbench),
        rootPath: workbench.rootPath || null,
        resourceCount: files.length,
        uniqueFileCount: uniqueFiles.length,
        indexedFileCount: 0,
        sourceFileCount: 0,
        ingestedFileCount: 0,
        conceptCount: 0,
        bindingCount: 0,
        skippedFileCount: 0,
        sampleConcepts: []
      });
    }

    if (includeWorkspaceResources) {
      const workspaceFiles = await prisma.fileSystemObject.findMany({
        where: buildWorkspaceResourceWhere({
          workspaceId: input.workspaceId,
          role: input.resourceRole || undefined
        }),
        select: FILE_SELECT as any,
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
        take: input.maxWorkspaceFiles || undefined
      }) as unknown as ResourceFile[];

      const uniqueWorkspaceFiles = unique(workspaceFiles.map((file) => file.id)).map((id) => workspaceFiles.find((file) => file.id === id)!).filter(Boolean);
      for (const file of uniqueWorkspaceFiles) {
        const membership = memberships.get(file.id) || { scopeKinds: new Set<ScopeKind>(), workbenchIds: new Set<string>() };
        membership.scopeKinds.add('workspace');
        memberships.set(file.id, membership);
        if (!seenFileIds.has(file.id)) {
          fileScopes.push({ file, scopeKind: 'workspace', workbenchId: null });
          seenFileIds.add(file.id);
        }
      }
    }

    let conceptCount = 0;
    let bindingCount = 0;
    let indexedFileCount = 0;
    let sourceFileCount = 0;
    let ingestedFileCount = 0;
    let skippedFileCount = 0;
    let failedFileCount = 0;

    const fileReports: FileBuildReport[] = [];
    const workbenchReportById = new Map(workbenchReports.map((report) => [report.workbenchId, report] as const));
    const totalFiles = fileScopes.length;

    for (const [index, item] of fileScopes.entries()) {
      const file = item.file;
      const basePercent = totalFiles ? 8 + Math.round((index / totalFiles) * 72) : 80;
      emit({
        stage: 'indexing',
        message: `正在索引并抽取课程知识：${file.name}`,
        percent: basePercent,
        processedFiles: index,
        totalFiles,
        currentFileId: file.id,
        currentFileName: file.name
      });
      const membership = memberships.get(file.id) || { scopeKinds: new Set<ScopeKind>([item.scopeKind]), workbenchIds: new Set<string>() };
      if (item.workbenchId) membership.workbenchIds.add(item.workbenchId);
      const sourceEligible = isCourseKnowledgeGraphSourceFile(file);
      const fileReport: FileBuildReport = {
        fileId: file.id,
        fileName: file.name,
        path: file.path,
        scopeKinds: Array.from(membership.scopeKinds),
        workbenchIds: Array.from(membership.workbenchIds),
        sourceEligible,
        knowledgeChunkCountBefore: 0,
        knowledgeChunkCountAfter: 0,
        resourceBindingCountBefore: 0,
        indexed: false,
        indexStatus: null,
        ingested: false,
        conceptsExtracted: 0,
        bindingsCreated: 0,
        skippedReason: null,
        error: null
      };

      try {
        fileReport.knowledgeChunkCountBefore = await prisma.knowledgeChunk.count({
          where: { workspaceId: input.workspaceId, fileObjectId: file.id }
        });
        fileReport.resourceBindingCountBefore = await prisma.courseKnowledgeBinding.count({
          where: { workspaceId: input.workspaceId, fileObjectId: file.id, bindingType: 'resource' }
        });

        if (input.reindex || fileReport.knowledgeChunkCountBefore === 0) {
          const job = await knowledgeIndexingService.indexFile({
            workspaceId: input.workspaceId,
            fileObjectId: file.id,
            reason: 'course-graph-build',
            force: Boolean(input.reindex)
          });
          fileReport.indexed = Boolean(job && job.status !== 'skipped');
          fileReport.indexStatus = job?.status || null;
          if (fileReport.indexed) indexedFileCount += 1;
        } else {
          fileReport.indexStatus = 'cached';
        }

        fileReport.knowledgeChunkCountAfter = await prisma.knowledgeChunk.count({
          where: { workspaceId: input.workspaceId, fileObjectId: file.id }
        });

        if (sourceEligible) {
          sourceFileCount += 1;
        }

        if (sourceEligible && fileReport.resourceBindingCountBefore === 0) {
          const ingestResult = await courseKnowledgeGraphService.ingestResourceFile({
            workspaceId: input.workspaceId,
            fileObjectId: file.id,
            source: 'course_graph_build'
          });
          fileReport.ingested = !ingestResult.skipped;
          fileReport.conceptsExtracted = ingestResult.concepts.length;
          fileReport.bindingsCreated = ingestResult.bindings;
          fileReport.skippedReason = ingestResult.skipped ? ingestResult.reason || 'skipped' : null;
          if (ingestResult.skipped) {
            skippedFileCount += 1;
          } else {
            ingestedFileCount += 1;
            conceptCount += ingestResult.concepts.length;
            bindingCount += ingestResult.bindings;
          }
        } else if (sourceEligible) {
          skippedFileCount += 1;
          fileReport.skippedReason = fileReport.resourceBindingCountBefore > 0 ? 'already_ingested' : 'no_source_bindings';
        } else if (fileReport.knowledgeChunkCountAfter === 0) {
          skippedFileCount += 1;
          fileReport.skippedReason = 'not_indexed';
        }

        const sampleConcepts = fileReport.ingested
          ? (await prisma.courseKnowledgeConcept.findMany({
              where: {
                workspaceId: input.workspaceId,
                bindings: { some: { fileObjectId: file.id, bindingType: 'resource' } }
              },
              select: { title: true },
              take: 5
            })).map((concept) => concept.title)
          : [];
        for (const workbenchId of fileReport.workbenchIds) {
          const report = workbenchReportById.get(workbenchId);
          if (!report) continue;
          if (fileReport.indexed) report.indexedFileCount += 1;
          if (fileReport.sourceEligible) report.sourceFileCount += 1;
          if (fileReport.ingested) report.ingestedFileCount += 1;
          if (fileReport.ingested) report.conceptCount += fileReport.conceptsExtracted;
          if (fileReport.ingested) report.bindingCount += fileReport.bindingsCreated;
          if (fileReport.skippedReason) report.skippedFileCount += 1;
          report.sampleConcepts = unique([...report.sampleConcepts, ...sampleConcepts]).slice(0, 8);
        }

        fileReports.push(fileReport);
      } catch (error) {
        failedFileCount += 1;
        fileReport.error = error instanceof Error ? error.message : String(error);
        fileReports.push(fileReport);
      }
    }

    emit({
      stage: 'assembling',
      message: '正在组装课程图谱视图。',
      percent: 84,
      processedFiles: fileReports.length,
      totalFiles
    });
    const graph = await courseKnowledgeGraphService.getGraph({
      workspaceId: input.workspaceId,
      limit: input.graphLimit || 120
    }).catch(() => undefined);
    emit({
      stage: 'validating',
      message: '正在校验图谱质量和治理记录。',
      percent: 92,
      processedFiles: fileReports.length,
      totalFiles
    });
    const validation = input.validate === false
      ? undefined
      : await courseKnowledgeExtractionValidationService.validate({ workspaceId: input.workspaceId }).catch(() => undefined);

    const report: CourseGraphBuildReport = {
      schema: 'course_graph_build_report.v1',
      workspaceId: input.workspaceId,
      scope,
      workbenchId: input.workbenchId || null,
      summary: {
        workbenchCount: workbenchReports.length,
        fileReferenceCount: fileScopes.length,
        uniqueFileCount: fileReports.length,
        indexedFileCount,
        sourceFileCount,
        ingestedFileCount,
        conceptCount,
        bindingCount,
        skippedFileCount,
        failedFileCount
      },
      workbenches: workbenchReports,
      files: fileReports,
      graph,
      validation
    };

    await prisma.courseKnowledgeGovernanceLog.create({
      data: {
        workspaceId: input.workspaceId,
        action: input.workbenchId ? 'kg_build_workbench' : 'kg_build_workspace',
        targetType: 'course_knowledge_graph',
        targetId: input.workbenchId || input.workspaceId,
        beforeJson: '{}',
        afterJson: stringify({
          summary: report.summary,
          workbenchIds: report.workbenches.map((item) => item.workbenchId),
          validation: validation?.summary || null
        }),
        rationale: input.workbenchId
          ? `Built course KG from workbench resources for ${input.workbenchId}.`
          : 'Built course KG from all workspace workbenches and workspace resources.',
        confidence: validation?.summary?.qualityScore || 0.72
      }
    }).catch((error) => console.warn('Course graph build governance log failed:', error));

    return report;
  }
}

export const courseGraphBuildService = new CourseGraphBuildService();

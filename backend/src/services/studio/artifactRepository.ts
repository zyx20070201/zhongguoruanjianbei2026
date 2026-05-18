import crypto from 'crypto';
import prisma from '../../config/db';
import {
  StudioRecommendation,
  StudioReviewResult,
  StudioStructuredArtifact,
  StudioWorkflowTraceItem
} from './types';

const stringify = (value: unknown, fallback = '{}') => {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
};

const artifactKeyFor = (input: {
  templateId: string;
  templateVersion: string;
  runId?: string | null;
  fileObjectId?: string | null;
}) =>
  [
    input.templateId,
    input.templateVersion,
    input.runId || input.fileObjectId || crypto.randomUUID()
  ].join(':');

export interface SaveStudioArtifactInput {
  workspaceId: string;
  workbenchId?: string | null;
  fileObjectId?: string | null;
  runId?: string | null;
  structured: StudioStructuredArtifact;
  renderedContent: string;
  source: string;
  review: StudioReviewResult;
  recommendation?: StudioRecommendation | null;
  workflowTrace: StudioWorkflowTraceItem[];
  metadata?: Record<string, unknown>;
}

export class StudioArtifactRepository {
  async save(input: SaveStudioArtifactInput) {
    const artifactKey = artifactKeyFor({
      templateId: input.structured.templateId,
      templateVersion: input.structured.templateVersion,
      runId: input.runId,
      fileObjectId: input.fileObjectId
    });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      artifactKey: string;
      title: string;
      templateId: string;
      templateVersion: string;
      schemaVersion: string;
    }>>(
      `INSERT INTO "StudioArtifact" (
        "id", "artifactKey", "title", "summary", "status", "goal", "templateId", "templateVersion",
        "generatorKind", "generatorVersion", "renderer", "schemaVersion", "source", "structuredJson",
        "renderedContent", "sourceRefsJson", "reviewJson", "recommendationJson", "workflowTraceJson",
        "metadataJson", "createdAt", "updatedAt", "workspaceId", "workbenchId", "fileObjectId", "runId"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT("workspaceId", "artifactKey") DO UPDATE SET
        "title" = excluded."title",
        "summary" = excluded."summary",
        "status" = excluded."status",
        "goal" = excluded."goal",
        "templateId" = excluded."templateId",
        "templateVersion" = excluded."templateVersion",
        "generatorKind" = excluded."generatorKind",
        "generatorVersion" = excluded."generatorVersion",
        "renderer" = excluded."renderer",
        "schemaVersion" = excluded."schemaVersion",
        "source" = excluded."source",
        "structuredJson" = excluded."structuredJson",
        "renderedContent" = excluded."renderedContent",
        "sourceRefsJson" = excluded."sourceRefsJson",
        "reviewJson" = excluded."reviewJson",
        "recommendationJson" = excluded."recommendationJson",
        "workflowTraceJson" = excluded."workflowTraceJson",
        "metadataJson" = excluded."metadataJson",
        "updatedAt" = excluded."updatedAt",
        "workbenchId" = excluded."workbenchId",
        "fileObjectId" = excluded."fileObjectId",
        "runId" = excluded."runId"
      RETURNING "id", "artifactKey", "title", "templateId", "templateVersion", "schemaVersion"`,
      id,
      artifactKey,
      input.structured.title,
      input.structured.summary,
      input.review.passed ? 'ready' : 'needs_review',
      input.structured.goal,
      input.structured.templateId,
      input.structured.templateVersion,
      input.structured.generatorKind,
      input.structured.generatorVersion,
      input.structured.renderer,
      input.structured.schemaVersion,
      input.source,
      stringify(input.structured),
      input.renderedContent,
      stringify(input.structured.sourceRefs, '[]'),
      stringify(input.review),
      stringify(input.recommendation || {}),
      stringify(input.workflowTrace, '[]'),
      stringify(input.metadata || {}),
      now,
      now,
      input.workspaceId,
      input.workbenchId || null,
      input.fileObjectId || null,
      input.runId || null
    );
    return rows[0];
  }

  async list(input: { workspaceId: string; workbenchId?: string | null; limit?: number }) {
    return prisma.$queryRawUnsafe<Array<{
      id: string;
      artifactKey: string;
      title: string;
      summary: string;
      goal: string;
      templateId: string;
      templateVersion: string;
      status: string;
      renderer: string;
      updatedAt: string;
    }>>(
      `SELECT "id", "artifactKey", "title", "summary", "goal", "templateId", "templateVersion", "status", "renderer", "updatedAt"
       FROM "StudioArtifact"
       WHERE "workspaceId" = ? ${input.workbenchId ? 'AND "workbenchId" = ?' : ''}
       ORDER BY "updatedAt" DESC
       LIMIT ?`,
      ...(input.workbenchId
        ? [input.workspaceId, input.workbenchId, Math.min(Math.max(input.limit || 30, 1), 100)]
        : [input.workspaceId, Math.min(Math.max(input.limit || 30, 1), 100)])
    );
  }
}

export const studioArtifactRepository = new StudioArtifactRepository();

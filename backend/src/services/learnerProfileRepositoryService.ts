import crypto from 'crypto';
import prisma from '../config/db';

const stringify = (value: unknown, fallback = '{}') => {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
};

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const isoDate = (value?: Date | string | null) => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const stableKey = (prefix: string, value: string) =>
  `${prefix}:${String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5:_-]/gi, '')
    .slice(0, 160) || crypto.createHash('sha1').update(value || prefix).digest('hex').slice(0, 12)}`;

type CandidateRow = {
  id: string;
  workspaceId: string;
  workbenchId?: string | null;
  candidateKey: string;
  dimension: string;
  type: string;
  title: string;
  description: string;
  polarity: string;
  status: string;
  confidence: number;
  severity?: string | null;
  evidenceIdsJson: string;
  sourceTypesJson: string;
  payloadJson: string;
  sourcePipeline: string;
  observedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type EntityRow = {
  id: string;
  workspaceId: string;
  workbenchId?: string | null;
  entityKey: string;
  dimension: string;
  type: string;
  title: string;
  description: string;
  status: string;
  polarity: string;
  confidence: number;
  severity?: string | null;
  evidenceCount: number;
  evidenceIdsJson: string;
  candidateKeysJson: string;
  affectedConceptsJson: string;
  recommendation: string;
  payloadJson: string;
  resolutionSource: string;
  polishSource: string;
  entityHash: string;
  observedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export class LearnerProfileRepositoryService {
  candidateKey(candidate: { id?: string; dimension?: string; type?: string; title?: string }) {
    return stableKey('profile-candidate', candidate.id || `${candidate.dimension}:${candidate.type}:${candidate.title}`);
  }

  entityKey(entity: { id?: string; dimension?: string; type?: string; title?: string }) {
    return stableKey('profile-entity', entity.id || `${entity.dimension}:${entity.type}:${entity.title}`);
  }

  async upsertCandidates(input: { workspaceId: string; workbenchId?: string | null; candidates: Array<any>; sourcePipeline?: string }) {
    for (const candidate of input.candidates) {
      const candidateKey = this.candidateKey(candidate);
      const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
      const evidenceIds = Array.from(new Set(evidence.map((item: any) => String(item.id || '')).filter(Boolean)));
      const sourceTypes = Array.from(new Set(evidence.map((item: any) => String(item.sourceType || '')).filter(Boolean)));
      const observedAt = evidence
        .map((item: any) => item.observedAt)
        .filter(Boolean)
        .sort()
        .reverse()[0] || candidate.updatedAt || null;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "LearnerProfileCandidate"
          ("id","workspaceId","workbenchId","candidateKey","dimension","type","title","description","polarity","status","confidence","severity","evidenceIdsJson","sourceTypesJson","payloadJson","sourcePipeline","observedAt","updatedAt")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT("workspaceId","candidateKey") DO UPDATE SET
           "workbenchId"=excluded."workbenchId",
           "dimension"=excluded."dimension",
           "type"=excluded."type",
           "title"=excluded."title",
           "description"=excluded."description",
           "polarity"=excluded."polarity",
           "status"=excluded."status",
           "confidence"=excluded."confidence",
           "severity"=excluded."severity",
           "evidenceIdsJson"=excluded."evidenceIdsJson",
           "sourceTypesJson"=excluded."sourceTypesJson",
           "payloadJson"=excluded."payloadJson",
           "sourcePipeline"=excluded."sourcePipeline",
           "observedAt"=excluded."observedAt",
           "updatedAt"=CURRENT_TIMESTAMP`,
        crypto.randomUUID(),
        input.workspaceId,
        input.workbenchId || null,
        candidateKey,
        String(candidate.dimension || ''),
        String(candidate.type || 'profileSignal'),
        String(candidate.title || ''),
        String(candidate.description || ''),
        String(candidate.polarity || 'neutral'),
        String(candidate.status || 'candidate'),
        Number(candidate.confidence ?? 0.5),
        candidate.severity || null,
        stringify(evidenceIds, '[]'),
        stringify(sourceTypes, '[]'),
        stringify(candidate, '{}'),
        input.sourcePipeline || 'learner_portrait_pipeline',
        observedAt ? new Date(observedAt).toISOString() : null
      );
    }
  }

  async upsertEntities(input: {
    workspaceId: string;
    workbenchId?: string | null;
    entities: Array<any>;
    resolutionSource?: string;
    polishSource?: string;
    entityHash?: string;
  }) {
    for (const entity of input.entities) {
      const entityKey = this.entityKey(entity);
      const evidence = Array.isArray(entity.evidence) ? entity.evidence : [];
      const evidenceIds = Array.from(new Set(evidence.map((item: any) => String(item.id || '')).filter(Boolean)));
      const candidateKeys = Array.from(new Set([entity.id, ...(Array.isArray(entity.mergedFrom) ? entity.mergedFrom : [])].map((item) => this.candidateKey({ id: String(item || '') }))));
      const observedAt = evidence
        .map((item: any) => item.observedAt)
        .filter(Boolean)
        .sort()
        .reverse()[0] || entity.updatedAt || null;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "LearnerProfileEntity"
          ("id","workspaceId","workbenchId","entityKey","dimension","type","title","description","status","polarity","confidence","severity","evidenceCount","evidenceIdsJson","candidateKeysJson","affectedConceptsJson","recommendation","payloadJson","resolutionSource","polishSource","entityHash","observedAt","updatedAt")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT("workspaceId","entityKey") DO UPDATE SET
           "workbenchId"=excluded."workbenchId",
           "dimension"=excluded."dimension",
           "type"=excluded."type",
           "title"=excluded."title",
           "description"=excluded."description",
           "status"=excluded."status",
           "polarity"=excluded."polarity",
           "confidence"=excluded."confidence",
           "severity"=excluded."severity",
           "evidenceCount"=excluded."evidenceCount",
           "evidenceIdsJson"=excluded."evidenceIdsJson",
           "candidateKeysJson"=excluded."candidateKeysJson",
           "affectedConceptsJson"=excluded."affectedConceptsJson",
           "recommendation"=excluded."recommendation",
           "payloadJson"=excluded."payloadJson",
           "resolutionSource"=excluded."resolutionSource",
           "polishSource"=excluded."polishSource",
           "entityHash"=excluded."entityHash",
           "observedAt"=excluded."observedAt",
           "updatedAt"=CURRENT_TIMESTAMP`,
        crypto.randomUUID(),
        input.workspaceId,
        input.workbenchId || null,
        entityKey,
        String(entity.dimension || ''),
        String(entity.type || 'profileEntity'),
        String(entity.displayTitle || entity.title || ''),
        String(entity.displayDescription || entity.description || ''),
        String(entity.status || 'candidate'),
        String(entity.polarity || 'neutral'),
        Number(entity.confidence ?? 0.5),
        entity.severity || null,
        Number(entity.evidenceCount || evidence.length || 0),
        stringify(evidenceIds, '[]'),
        stringify(candidateKeys, '[]'),
        stringify(entity.affectedConcepts || [], '[]'),
        String(entity.displayRecommendation || entity.recommendation || ''),
        stringify(entity, '{}'),
        input.resolutionSource || entity.resolutionSource || 'builder',
        input.polishSource || 'fallback',
        input.entityHash || '',
        observedAt ? new Date(observedAt).toISOString() : null
      );
    }
  }

  async listEntities(input: { workspaceId: string; workbenchId?: string | null; limit?: number; includeInactive?: boolean }) {
    const rows = await prisma.$queryRawUnsafe<EntityRow[]>(
      `SELECT * FROM "LearnerProfileEntity"
       WHERE "workspaceId" = ?
       ${input.workbenchId ? 'AND ("workbenchId" = ? OR "workbenchId" IS NULL)' : ''}
       ${input.includeInactive ? '' : `AND "status" NOT IN ('deleted','suppressed')`}
       ORDER BY "updatedAt" DESC
       LIMIT ?`,
      input.workspaceId,
      ...(input.workbenchId ? [input.workbenchId] : []),
      Math.min(Math.max(input.limit || 80, 1), 200)
    );
    return rows.map((row) => ({
      id: row.entityKey,
      key: row.entityKey,
      dimension: row.dimension,
      type: row.type,
      title: row.title,
      description: row.description,
      status: row.status,
      polarity: row.polarity,
      confidence: row.confidence,
      severity: row.severity || undefined,
      evidenceCount: row.evidenceCount,
      evidenceIds: parseJson<string[]>(row.evidenceIdsJson, []),
      candidateKeys: parseJson<string[]>(row.candidateKeysJson, []),
      affectedConcepts: parseJson<string[]>(row.affectedConceptsJson, []),
      recommendation: row.recommendation,
      payload: parseJson<Record<string, unknown>>(row.payloadJson, {}),
      resolutionSource: row.resolutionSource,
      polishSource: row.polishSource,
      entityHash: row.entityHash,
      observedAt: isoDate(row.observedAt),
      createdAt: isoDate(row.createdAt),
      updatedAt: isoDate(row.updatedAt)
    }));
  }

  async listCandidates(input: { workspaceId: string; workbenchId?: string | null; limit?: number; includeInactive?: boolean }) {
    const rows = await prisma.$queryRawUnsafe<CandidateRow[]>(
      `SELECT * FROM "LearnerProfileCandidate"
       WHERE "workspaceId" = ?
       ${input.workbenchId ? 'AND ("workbenchId" = ? OR "workbenchId" IS NULL)' : ''}
       ${input.includeInactive ? '' : `AND "status" NOT IN ('deleted','suppressed')`}
       ORDER BY "updatedAt" DESC
       LIMIT ?`,
      input.workspaceId,
      ...(input.workbenchId ? [input.workbenchId] : []),
      Math.min(Math.max(input.limit || 120, 1), 300)
    );
    return rows.map((row) => ({
      id: row.candidateKey,
      key: row.candidateKey,
      dimension: row.dimension,
      type: row.type,
      title: row.title,
      description: row.description,
      polarity: row.polarity,
      status: row.status,
      confidence: row.confidence,
      severity: row.severity || undefined,
      evidenceIds: parseJson<string[]>(row.evidenceIdsJson, []),
      sourceTypes: parseJson<string[]>(row.sourceTypesJson, []),
      payload: parseJson<Record<string, unknown>>(row.payloadJson, {}),
      sourcePipeline: row.sourcePipeline,
      observedAt: isoDate(row.observedAt),
      createdAt: isoDate(row.createdAt),
      updatedAt: isoDate(row.updatedAt)
    }));
  }
}

export const learnerProfileRepositoryService = new LearnerProfileRepositoryService();

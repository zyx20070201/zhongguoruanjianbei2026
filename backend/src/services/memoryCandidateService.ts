import prisma from '../config/db';
import { savedMemoryService } from './savedMemoryService';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const clip = (value: string | null | undefined, maxLength = 320) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

export const memoryCandidateFromEvidence = (item: any) => {
  const payload = parseJson<Record<string, any>>(item.payloadJson, {});
  const candidate = payload.candidate || {};
  return {
    id: item.id,
    text: clip(candidate.text || item.summary, 360),
    category: String(candidate.category || 'preference'),
    confidence: Number(candidate.confidence ?? item.confidence ?? 0.65),
    reason: clip(candidate.reason || 'This looks like a reusable preference.', 220),
    askUserToSaveText: clip(payload.askUserToSaveText || `是否保存为长期偏好：${candidate.text || item.summary}`, 360),
    createdAt: item.createdAt.toISOString(),
    observedAt: item.observedAt.toISOString()
  };
};

export class MemoryCandidateService {
  async list(input: { workspaceId: string; limit?: number }) {
    const candidates = await prisma.learnerEvidence.findMany({
      where: { workspaceId: input.workspaceId, evidenceType: 'saved_memory_prompt_candidate' },
      orderBy: { observedAt: 'desc' },
      take: Math.min(Math.max(input.limit || 8, 1), 30)
    });
    const decisions = await prisma.learnerEvidence.findMany({
      where: {
        workspaceId: input.workspaceId,
        evidenceType: 'saved_memory_candidate_decision',
        sourceId: { in: candidates.map((item) => item.id) }
      }
    });
    const decided = new Set(decisions.map((item) => item.sourceId).filter(Boolean));
    return {
      candidates: candidates.filter((item) => !decided.has(item.id)).map(memoryCandidateFromEvidence)
    };
  }

  async decide(input: {
    workspaceId: string;
    workbenchId?: string | null;
    candidateId: string;
    decision: 'save' | 'dismiss';
    text?: string;
    category?: string;
  }) {
    const candidateEvidence = await prisma.learnerEvidence.findFirst({
      where: { workspaceId: input.workspaceId, id: input.candidateId, evidenceType: 'saved_memory_prompt_candidate' }
    });
    if (!candidateEvidence) throw new Error('Memory candidate not found');

    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const candidate = memoryCandidateFromEvidence(candidateEvidence);
    let memory = null;
    if (input.decision === 'save') {
      memory = await savedMemoryService.upsert({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        userId: workspace.userId,
        text: input.text || candidate.text,
        category: input.category || candidate.category,
        source: 'user_confirmed_candidate',
        confidence: 1
      });
    }

    await prisma.learnerEvidence.create({
      data: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        evidenceType: 'saved_memory_candidate_decision',
        sourceType: 'user_memory_control',
        sourceId: input.candidateId,
        actor: 'user',
        title: input.decision === 'save' ? 'User saved memory candidate' : 'User dismissed memory candidate',
        summary: input.decision === 'save' ? `Saved: ${input.text || candidate.text}` : `Dismissed: ${candidate.text}`,
        payloadJson: JSON.stringify({ decision: input.decision, candidate, savedMemoryKey: memory?.memoryKey || null }),
        confidence: 1
      }
    });

    return { memory, decision: input.decision };
  }
}

export const memoryCandidateService = new MemoryCandidateService();

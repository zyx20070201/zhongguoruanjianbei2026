import { learningEventCollectionService } from './learningEventCollectionService';
import { clipProfileText, LearnerProfileEntry } from './learnerProfileReadModel';

export class RecentEventProjectionService {
  async project(input: { workspaceId: string; workbenchId?: string | null; limit?: number }) {
    const events = await learningEventCollectionService.list({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      limit: input.limit || 40
    });

    const recentEvents: LearnerProfileEntry[] = events.map((event) => ({
      id: event.id,
      dimension: 'event',
      label: event.eventType,
      value: clipProfileText(event.payload?.interaction?.userText || event.payload?.object?.title || event.objectType || event.eventType, 160),
      confidence: event.confidence,
      status: event.actor,
      evidenceCount: 0,
      source: 'event',
      observedAt: event.observedAt,
      rationale: clipProfileText(event.payload?.interaction?.assistantText || event.payload?.source?.component || '', 120),
      eventFamily: event.eventFamily,
      eventType: event.eventType,
      objectType: event.objectType,
      objectId: event.objectId,
      diagnosticFeatures: event.diagnosticFeatures,
      cognitiveSignals: event.cognitiveSignals,
      quality: event.quality
    }));

    return { events, recentEvents };
  }
}

export const recentEventProjectionService = new RecentEventProjectionService();

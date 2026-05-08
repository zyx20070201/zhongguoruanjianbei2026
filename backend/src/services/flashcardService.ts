import prisma from '../config/db';
import { deepseekService } from './deepseekService';
import { learningMemoryService } from './learningMemoryService';
import { learnerStateAnalyzer } from './learnerStateAnalyzer';

export type FlashcardRating = 'again' | 'hard' | 'good' | 'easy';

export interface FlashcardSourceRef {
  sourceId?: string;
  title?: string;
  fileId?: string;
  fileName?: string;
  locator?: Record<string, unknown>;
  snippet?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface StructuredFlashcardInput {
  front: string;
  back: string;
  cardType?: 'basic' | 'reverse' | 'cloze' | 'mcq' | 'concept';
  difficulty?: 'easy' | 'medium' | 'hard';
  concept?: string;
  explanation?: string;
  tags?: string[];
  sourceRefs?: FlashcardSourceRef[];
  metadata?: Record<string, unknown>;
}

export interface StructuredDeckInput {
  workspaceId: string;
  workbenchId?: string | null;
  title: string;
  description?: string;
  source?: string;
  sourceFileIds?: string[];
  sourceRefs?: FlashcardSourceRef[];
  settings?: Record<string, unknown>;
  generationRunId?: string | null;
  fileObjectId?: string | null;
  cards: StructuredFlashcardInput[];
}

const REVIEW_WEIGHTS: Record<FlashcardRating, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4
};

const INITIAL_STABILITY: Record<FlashcardRating, number> = {
  again: 0.02,
  hard: 0.25,
  good: 1,
  easy: 3
};

const safeJson = (value: unknown, fallback: unknown) => {
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60 * 1000);

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const daysBetween = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);

const retention = (stability: number, elapsedDays: number) => {
  if (stability <= 0) return 1;
  return clamp(Math.pow(1 + elapsedDays / (9 * stability), -1), 0, 1);
};

const nextReviewState = (
  card: {
    stability: number;
    fsrsDifficulty: number;
    retrievability: number;
    state: string;
    lastReviewedAt: Date | null;
    dueAt: Date;
    reviewCount: number;
    lapseCount: number;
  },
  rating: FlashcardRating,
  reviewedAt: Date
) => {
  const elapsedDays = card.lastReviewedAt ? daysBetween(card.lastReviewedAt, reviewedAt) : 0;
  const currentStability = card.stability > 0 ? card.stability : 0;
  const currentDifficulty = card.fsrsDifficulty > 0 ? card.fsrsDifficulty : 5;
  const currentRetrievability = retention(currentStability, elapsedDays);

  if (!currentStability || card.state === 'new') {
    const stability = INITIAL_STABILITY[rating];
    const difficulty = clamp(6 - (REVIEW_WEIGHTS[rating] - 2) * 0.9, 1, 10);
    const dueAt =
      rating === 'again'
        ? addMinutes(reviewedAt, 10)
        : rating === 'hard'
          ? addHours(reviewedAt, 12)
          : addDays(reviewedAt, stability);

    return {
      dueAt,
      stability,
      fsrsDifficulty: difficulty,
      retrievability: rating === 'again' ? 0.35 : 1,
      state: rating === 'again' ? 'learning' : 'review',
      lapseCount: rating === 'again' ? card.lapseCount + 1 : card.lapseCount
    };
  }

  const difficultyDelta = rating === 'again' ? 1.2 : rating === 'hard' ? 0.45 : rating === 'good' ? -0.15 : -0.45;
  const nextDifficulty = clamp(currentDifficulty + difficultyDelta, 1, 10);
  const recallBonus = rating === 'hard' ? 1.2 : rating === 'good' ? 2.45 : 3.6;
  const stability =
    rating === 'again'
      ? Math.max(0.08, currentStability * 0.45)
      : clamp(currentStability * (1 + recallBonus * (11 - nextDifficulty) / 10 * (1.05 - currentRetrievability + 0.15)), 0.1, 3650);
  const intervalDays =
    rating === 'again'
      ? 0
      : rating === 'hard'
        ? Math.max(1, stability * 0.55)
        : rating === 'good'
          ? Math.max(1, stability)
          : Math.max(2, stability * 1.35);

  return {
    dueAt: rating === 'again' ? addMinutes(reviewedAt, 15) : addDays(reviewedAt, intervalDays),
    stability,
    fsrsDifficulty: nextDifficulty,
    retrievability: rating === 'again' ? 0.25 : 1,
    state: rating === 'again' ? 'relearning' : 'review',
    lapseCount: rating === 'again' ? card.lapseCount + 1 : card.lapseCount
  };
};

const addHours = (date: Date, hours: number) => addMinutes(date, hours * 60);

const mapCard = (card: any) => ({
  id: card.id,
  deckId: card.deckId,
  workspaceId: card.workspaceId,
  workbenchId: card.workbenchId,
  front: card.front,
  back: card.back,
  cardType: card.cardType,
  difficulty: card.difficulty,
  concept: card.concept,
  explanation: card.explanation,
  tags: parseJson<string[]>(card.tagsJson, []),
  sourceRefs: parseJson<FlashcardSourceRef[]>(card.sourceRefsJson, []),
  metadata: parseJson<Record<string, unknown>>(card.metadataJson, {}),
  orderIndex: card.orderIndex,
  reviewCount: card.reviewCount,
  lapseCount: card.lapseCount,
  dueAt: card.dueAt.toISOString(),
  lastReviewedAt: card.lastReviewedAt?.toISOString() || null,
  stability: card.stability,
  retrievability: card.retrievability,
  fsrsDifficulty: card.fsrsDifficulty,
  state: card.state,
  suspended: card.suspended,
  createdAt: card.createdAt.toISOString(),
  updatedAt: card.updatedAt.toISOString()
});

const mapDeck = (deck: any) => ({
  id: deck.id,
  workspaceId: deck.workspaceId,
  workbenchId: deck.workbenchId,
  title: deck.title,
  description: deck.description,
  source: deck.source,
  sourceFileIds: parseJson<string[]>(deck.sourceFileIds, []),
  sourceRefs: parseJson<FlashcardSourceRef[]>(deck.sourceRefsJson, []),
  settings: parseJson<Record<string, unknown>>(deck.settingsJson, {}),
  generationRunId: deck.generationRunId,
  fileObjectId: deck.fileObjectId,
  createdAt: deck.createdAt.toISOString(),
  updatedAt: deck.updatedAt.toISOString(),
  cards: Array.isArray(deck.cards) ? deck.cards.map(mapCard) : undefined,
  cardCount: typeof deck._count?.cards === 'number' ? deck._count.cards : deck.cards?.length || 0
});

export class FlashcardService {
  async createDeck(input: StructuredDeckInput) {
    const cards = input.cards
      .map((card, index) => ({
        ...card,
        front: String(card.front || '').trim(),
        back: String(card.back || '').trim(),
        orderIndex: index
      }))
      .filter((card) => card.front && card.back)
      .slice(0, 80);

    if (!cards.length) throw new Error('No valid flashcards were generated');

    const deck = await prisma.flashcardDeck.create({
      data: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        title: input.title || 'AI Flashcards',
        description: input.description || '',
        source: input.source || 'ai_studio',
        sourceFileIds: safeJson(input.sourceFileIds || [], []),
        sourceRefsJson: safeJson(input.sourceRefs || [], []),
        settingsJson: safeJson(input.settings || {}, {}),
        generationRunId: input.generationRunId || null,
        fileObjectId: input.fileObjectId || null,
        cards: {
          create: cards.map((card) => ({
            workspaceId: input.workspaceId,
            workbenchId: input.workbenchId || null,
            front: card.front.slice(0, 1200),
            back: card.back.slice(0, 3000),
            cardType: card.cardType || 'basic',
            difficulty: card.difficulty || 'medium',
            concept: String(card.concept || '').slice(0, 180),
            explanation: String(card.explanation || '').slice(0, 3000),
            tagsJson: safeJson(card.tags || [], []),
            sourceRefsJson: safeJson(card.sourceRefs || [], []),
            metadataJson: safeJson(card.metadata || {}, {}),
            orderIndex: card.orderIndex,
            dueAt: new Date()
          }))
        }
      },
      include: { cards: { orderBy: { orderIndex: 'asc' } } }
    });

    await learningMemoryService.recordEvent({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      eventType: 'flashcard.deck_created',
      actor: 'assistant',
      payload: {
        deckId: deck.id,
        title: deck.title,
        cardCount: deck.cards.length,
        source: deck.source,
        generationRunId: input.generationRunId || null
      }
    });

    return mapDeck(deck);
  }

  async getDeck(workspaceId: string, deckId: string) {
    const deck = await prisma.flashcardDeck.findFirst({
      where: { id: deckId, workspaceId },
      include: { cards: { orderBy: { orderIndex: 'asc' } } }
    });
    if (!deck) throw new Error('Flashcard deck not found');
    return mapDeck(deck);
  }

  async listDecks(workspaceId: string, workbenchId?: string | null) {
    const decks = await prisma.flashcardDeck.findMany({
      where: {
        workspaceId,
        ...(workbenchId ? { workbenchId } : {})
      },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { cards: true } } }
    });
    return decks.map(mapDeck);
  }

  async dueCards(workspaceId: string, input: { workbenchId?: string | null; deckId?: string | null; limit?: number }) {
    const now = new Date();
    const cards = await prisma.flashcard.findMany({
      where: {
        workspaceId,
        suspended: false,
        dueAt: { lte: now },
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.deckId ? { deckId: input.deckId } : {})
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      take: clamp(input.limit || 30, 1, 100)
    });
    return cards.map(mapCard);
  }

  async reviewCard(input: {
    workspaceId: string;
    cardId: string;
    rating: FlashcardRating;
    elapsedMs?: number;
    metadata?: Record<string, unknown>;
  }) {
    const card = await prisma.flashcard.findFirst({ where: { id: input.cardId, workspaceId: input.workspaceId } });
    if (!card) throw new Error('Flashcard not found');
    if (!REVIEW_WEIGHTS[input.rating]) throw new Error('Invalid flashcard rating');

    const reviewedAt = new Date();
    const next = nextReviewState(card, input.rating, reviewedAt);
    const updated = await prisma.$transaction(async (tx) => {
      const nextCard = await tx.flashcard.update({
        where: { id: card.id },
        data: {
          dueAt: next.dueAt,
          lastReviewedAt: reviewedAt,
          stability: next.stability,
          retrievability: next.retrievability,
          fsrsDifficulty: next.fsrsDifficulty,
          state: next.state,
          reviewCount: { increment: 1 },
          lapseCount: next.lapseCount
        }
      });
      await tx.flashcardDeck.update({
        where: { id: card.deckId },
        data: { updatedAt: reviewedAt }
      });
      await tx.flashcardReviewLog.create({
        data: {
          workspaceId: input.workspaceId,
          cardId: card.id,
          rating: input.rating,
          elapsedMs: Math.max(0, Math.round(input.elapsedMs || 0)),
          previousState: card.state,
          nextState: next.state,
          previousDueAt: card.dueAt,
          nextDueAt: next.dueAt,
          previousStability: card.stability,
          nextStability: next.stability,
          previousDifficulty: card.fsrsDifficulty,
          nextDifficulty: next.fsrsDifficulty,
          previousRetrievability: card.retrievability,
          nextRetrievability: next.retrievability,
          reviewedAt,
          metadataJson: safeJson(input.metadata || {}, {})
        }
      });
      return nextCard;
    });

    await learningMemoryService.recordEvent({
      workspaceId: input.workspaceId,
      workbenchId: card.workbenchId,
      eventType: 'flashcard.reviewed',
      actor: 'user',
      payload: {
        cardId: card.id,
        deckId: card.deckId,
        rating: input.rating,
        nextDueAt: next.dueAt.toISOString(),
        concept: card.concept,
        difficulty: card.difficulty,
        state: next.state
      }
    });
    await learnerStateAnalyzer.analyzeFlashcardReview({
      workspaceId: input.workspaceId,
      workbenchId: card.workbenchId,
      cardId: card.id,
      deckId: card.deckId,
      rating: input.rating,
      concept: card.concept,
      difficulty: card.difficulty,
      state: next.state,
      nextDueAt: next.dueAt.toISOString()
    }).catch((error) => console.warn('LearnerStateAnalyzer flashcard review failed:', error));

    return mapCard(updated);
  }

  async explainCard(input: { workspaceId: string; cardId: string; userMessage?: string }) {
    const card = await prisma.flashcard.findFirst({ where: { id: input.cardId, workspaceId: input.workspaceId } });
    if (!card) throw new Error('Flashcard not found');
    const sourceRefs = parseJson<FlashcardSourceRef[]>(card.sourceRefsJson, []);
    if (!deepseekService.isConfigured()) {
      return {
        reply: card.explanation || `这张卡考察「${card.concept || card.front}」。答案要点是：${card.back}`,
        sourceRefs,
        explainedBy: 'fallback'
      };
    }

    const response = await deepseekService.json<{ reply: string; suggestedFollowUps?: string[] }>({
      instruction: [
        '你是 source-grounded flashcard tutor。',
        '只围绕这一张卡解释，回答要简洁、教学化、可用于复习。',
        '优先引用 sourceRefs 中的片段；如果来源不足，明确说明不足，不要编造。',
        '如果用户提出具体问题，直接回应问题，再补充卡片知识点。'
      ].join('\n'),
      schema: {
        reply: 'string',
        suggestedFollowUps: ['string']
      },
      input: {
        front: card.front,
        back: card.back,
        concept: card.concept,
        existingExplanation: card.explanation,
        sourceRefs,
        userMessage: input.userMessage || ''
      }
    });

    return {
      reply: response.data.reply || card.explanation || card.back,
      suggestedFollowUps: response.data.suggestedFollowUps || [],
      sourceRefs,
      explainedBy: 'deepseek'
    };
  }
}

export const flashcardService = new FlashcardService();

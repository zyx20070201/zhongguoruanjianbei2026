import { Router } from 'express';
import { Request, Response } from 'express';
import { flashcardService, FlashcardRating } from '../services/flashcardService';

const router = Router();
const RATINGS = new Set<FlashcardRating>(['again', 'hard', 'good', 'easy']);
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

router.get('/decks', async (req: Request, res: Response) => {
  const workspaceId = String(req.query.workspaceId || '');
  const workbenchId = typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const decks = await flashcardService.listDecks(workspaceId, workbenchId);
    return res.json({ decks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list flashcard decks';
    return res.status(500).json({ error: message });
  }
});

router.post('/decks', async (req: Request, res: Response) => {
  const { workspaceId, workbenchId, title, description, source, sourceFileIds, sourceRefs, settings, generationRunId, fileObjectId, cards } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }
  if (!Array.isArray(cards) || !cards.length) {
    return res.status(400).json({ error: 'cards are required' });
  }

  try {
    const reusableDeck = await flashcardService.findDeckByGenerationRun(
      workspaceId,
      typeof generationRunId === 'string' && generationRunId ? generationRunId : null
    );
    if (reusableDeck) {
      return res.status(200).json({ deck: reusableDeck, reused: true });
    }

    const deck = await flashcardService.createDeck({
      workspaceId,
      workbenchId: typeof workbenchId === 'string' && workbenchId ? workbenchId : null,
      title: typeof title === 'string' && title.trim() ? title.trim() : 'AI Flashcards',
      description: typeof description === 'string' ? description : '',
      source: typeof source === 'string' && source.trim() ? source.trim() : 'ai_studio_manualized',
      sourceFileIds: Array.isArray(sourceFileIds) ? sourceFileIds.map(String).filter(Boolean) : [],
      sourceRefs: Array.isArray(sourceRefs) ? sourceRefs : [],
      settings: settings && typeof settings === 'object' ? settings : {},
      generationRunId: typeof generationRunId === 'string' && generationRunId ? generationRunId : null,
      fileObjectId: typeof fileObjectId === 'string' && fileObjectId ? fileObjectId : null,
      cards: cards.map((card) => ({
        front: String(card?.front || ''),
        back: String(card?.back || ''),
        cardType: typeof card?.cardType === 'string' ? card.cardType : 'basic',
        difficulty: typeof card?.difficulty === 'string' ? card.difficulty : 'medium',
        concept: typeof card?.concept === 'string' ? card.concept : '',
        explanation: typeof card?.explanation === 'string' ? card.explanation : '',
        tags: Array.isArray(card?.tags) ? card.tags.map(String).filter(Boolean) : [],
        sourceRefs: Array.isArray(card?.sourceRefs) ? card.sourceRefs : [],
        metadata: card?.metadata && typeof card.metadata === 'object' ? card.metadata : {}
      }))
    });
    return res.status(201).json({ deck });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create flashcard deck';
    return res.status(502).json({ error: message });
  }
});

router.get('/decks/:deckId', async (req: Request, res: Response) => {
  const workspaceId = String(req.query.workspaceId || '');
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const deck = await flashcardService.getDeck(workspaceId, one(req.params.deckId) || '');
    return res.json({ deck });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load flashcard deck';
    return res.status(404).json({ error: message });
  }
});

router.get('/due', async (req: Request, res: Response) => {
  const workspaceId = String(req.query.workspaceId || '');
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });

  try {
    const cards = await flashcardService.dueCards(workspaceId, {
      workbenchId: typeof req.query.workbenchId === 'string' ? req.query.workbenchId : null,
      deckId: typeof req.query.deckId === 'string' ? req.query.deckId : null,
      limit: Number(req.query.limit) || 30
    });
    return res.json({ cards });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load due flashcards';
    return res.status(500).json({ error: message });
  }
});

router.post('/cards/:cardId/review', async (req: Request, res: Response) => {
  const { workspaceId, rating, elapsedMs, metadata } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }
  if (!RATINGS.has(rating)) {
    return res.status(400).json({ error: 'rating is invalid' });
  }

  try {
    const card = await flashcardService.reviewCard({
      workspaceId,
      cardId: one(req.params.cardId) || '',
      rating,
      elapsedMs: Number(elapsedMs) || 0,
      metadata: metadata && typeof metadata === 'object' ? metadata : undefined
    });
    return res.json({ card });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to review flashcard';
    return res.status(502).json({ error: message });
  }
});

router.post('/cards/:cardId/explain', async (req: Request, res: Response) => {
  const { workspaceId, userMessage } = req.body ?? {};
  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  try {
    const result = await flashcardService.explainCard({
      workspaceId,
      cardId: one(req.params.cardId) || '',
      userMessage: typeof userMessage === 'string' ? userMessage : ''
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to explain flashcard';
    return res.status(502).json({ error: message });
  }
});

export default router;

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

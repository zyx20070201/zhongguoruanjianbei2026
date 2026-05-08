import prisma from '../config/db';
import { buildLearnerMemoryKey } from './learnerMemoryKeys';
import { learnerStateService, LearnerStateDimension } from './learnerStateService';
import type { FlashcardRating } from './flashcardService';
import type { StudioQuizQuestion } from './aiStudioService';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

interface AnalyzeChatInput {
  workspaceId: string;
  workbenchId?: string | null;
  messages: ChatMessage[];
  answer?: string;
  taskType?: string;
  sourceId?: string | null;
}

interface AnalyzeQuizInput {
  workspaceId: string;
  workbenchId?: string | null;
  question: StudioQuizQuestion;
  userAnswer: string;
  result: {
    correct: boolean;
    score: number;
    feedback?: string;
    missingPoints?: string[];
    matchedPoints?: string[];
    judgedBy?: string;
  };
}

interface AnalyzeFlashcardInput {
  workspaceId: string;
  workbenchId?: string | null;
  cardId: string;
  deckId: string;
  rating: FlashcardRating;
  concept?: string;
  difficulty?: string;
  state?: string;
  nextDueAt?: string;
}

interface SignalPatch {
  dimension: LearnerStateDimension;
  payload: Record<string, unknown>;
  confidence: number;
  rationale: string;
}

const clip = (value: string | null | undefined, maxLength = 800) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const unique = (items: Array<string | null | undefined>) =>
  Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));

const latestUserMessage = (messages: ChatMessage[]) =>
  [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() || '';

const hasAny = (text: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));

const resourcePreferenceSignals = (text: string) => {
  const signals: string[] = [];
  if (/例子|案例|示例|example/i.test(text)) signals.push('examples');
  if (/代码|实现|code|demo|项目/i.test(text)) signals.push('code_or_project');
  if (/图|图解|可视化|流程图|mind\s*map|visual/i.test(text)) signals.push('visual_explanation');
  if (/题|练习|quiz|测验|刷题/i.test(text)) signals.push('practice_or_quiz');
  if (/卡片|flashcard|复习|间隔/i.test(text)) signals.push('flashcards_or_review');
  if (/一步一步|慢一点|详细|拆解|step/i.test(text)) signals.push('step_by_step');
  if (/简洁|快点|概括|总结|摘要/i.test(text)) signals.push('concise_summary');
  return unique(signals);
};

const uncertaintySignals = (text: string) => {
  const signals: string[] = [];
  if (/不懂|没懂|看不懂|不会| confused|confusing/i.test(text)) signals.push('explicit_confusion');
  if (/为什么|怎么理解|什么意思|what does|why/i.test(text)) signals.push('needs_explanation');
  if (/区别|不同|对比|混淆|vs\.?|versus/i.test(text)) signals.push('comparison_needed');
  if (/报错|错误|错在哪|debug|bug|exception/i.test(text)) signals.push('debug_or_error_analysis');
  return unique(signals);
};

const conceptFromText = (text: string, fallback?: string) => {
  const bracketed = text.match(/[「“"]([^」”"]{2,60})[」”"]/);
  if (bracketed?.[1]) return bracketed[1].trim();
  const afterTalk = text.match(/(?:讲讲|解释|介绍|说说|梳理|总结|理解)\s*([^，。！？\n]{2,60})/);
  if (afterTalk?.[1]) return afterTalk[1].trim().replace(/的?(三个|几个|一些|例子|案例)$/g, '');
  const afterAbout = text.match(/(?:关于|围绕|学习|解释|理解|掌握)\s*([^，。！？\n]{2,60})/);
  if (afterAbout?.[1]) return afterAbout[1].trim();
  return fallback ? clip(fallback, 80) : '';
};

const ratingWeight: Record<FlashcardRating, number> = {
  again: 0.25,
  hard: 0.45,
  good: 0.72,
  easy: 0.86
};

const hasMemoryControl = async (workspaceId: string, memoryKey: string, action?: string) => {
  const where: Record<string, unknown> = { workspaceId, memoryKey, status: 'active' };
  if (action) where.action = action;
  const count = await prisma.learnerMemoryControl.count({ where }).catch(() => 0);
  return count > 0;
};

export class LearnerStateAnalyzer {
  private async recentEvidenceCounts(input: {
    workspaceId: string;
    evidenceType: string;
    contains: string;
    days?: number;
  }) {
    const since = new Date(Date.now() - (input.days || 45) * 24 * 60 * 60 * 1000);
    return prisma.learnerEvidence.count({
      where: {
        workspaceId: input.workspaceId,
        evidenceType: input.evidenceType,
        observedAt: { gte: since },
        payloadJson: { contains: input.contains }
      }
    }).catch(() => 0);
  }

  private async maybeConsolidateRepeatedSignal(input: {
    workspaceId: string;
    workbenchId?: string | null;
    dimension: LearnerStateDimension;
    evidenceId: string;
    signal: string;
    evidenceType: string;
    stablePayload: Record<string, unknown>;
    threshold?: number;
    confidence?: number;
    rationale: string;
  }) {
    if (!input.signal) return null;
    const count = await this.recentEvidenceCounts({
      workspaceId: input.workspaceId,
      evidenceType: input.evidenceType,
      contains: input.signal
    });
    if (count < (input.threshold || 3)) return null;
    return learnerStateService.proposePatch({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      targetDimension: input.dimension,
      operation: 'merge',
      proposedBy: 'LearnerStateAnalyzer.consolidation',
      payload: input.stablePayload,
      evidenceId: input.evidenceId,
      confidence: input.confidence || 0.62,
      rationale: input.rationale
    });
  }

  async analyzeChat(input: AnalyzeChatInput) {
    const userMessage = latestUserMessage(input.messages);
    if (!userMessage) return { evidence: null, patches: [] };

    const preferenceSignals = resourcePreferenceSignals(userMessage);
    const uncertainty = uncertaintySignals(userMessage);
    const possibleConcept = conceptFromText(userMessage);
    const explicitGoalIntent = /目标|计划|希望掌握|需要掌握|准备|考试|项目|论文|复习|我想学|我要学/i.test(userMessage);
    const shouldPropose =
      preferenceSignals.length > 0 ||
      uncertainty.length > 0 ||
      Boolean(possibleConcept) ||
      explicitGoalIntent;

    const evidence = await learnerStateService.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      evidenceType: 'chat_observation',
      sourceType: 'ai_chat',
      sourceId: input.sourceId || null,
      actor: 'user',
      title: 'AI chat learner signal',
      summary: clip(userMessage, 240),
      payload: {
        userMessage: clip(userMessage, 1200),
        answer: clip(input.answer, 1200),
        taskType: input.taskType || null,
        preferenceSignals,
        uncertaintySignals: uncertainty,
        possibleConcept
      },
      confidence: shouldPropose ? 0.38 : 0.22
    });

    if (!shouldPropose) return { evidence, patches: [] };

    const blockedByControl = async (signal: string, dimension: LearnerStateDimension) =>
      hasMemoryControl(input.workspaceId, buildLearnerMemoryKey(dimension, signal), 'delete') ||
      hasMemoryControl(input.workspaceId, buildLearnerMemoryKey(dimension, signal), 'freeze');

    const patches: SignalPatch[] = [];
    if (preferenceSignals.length) {
      for (const preference of preferenceSignals) {
        if (await blockedByControl(preference, 'preferenceStyle')) continue;
        patches.push({
          dimension: 'preferenceStyle',
          confidence: 0.34,
          rationale: 'Single chat preference signal; keep as tentative until repeated.',
          payload: {
            tentativeResourcePreferences: [preference],
            lastPreferenceSignal: clip(userMessage, 180)
          }
        });
      }
    }

    if (uncertainty.length) {
      patches.push({
        dimension: 'behaviorEngagement',
        confidence: 0.36,
        rationale: 'Learner asked for help or clarification; this is engagement evidence, not a stable weakness yet.',
        payload: {
          questionPatterns: uncertainty,
          recentHelpSeeking: [{ signal: uncertainty, text: clip(userMessage, 180), observedAt: new Date().toISOString() }]
        }
      });
      if (possibleConcept) {
        if (!(await blockedByControl(possibleConcept, 'knowledgeState'))) {
        patches.push({
          dimension: 'knowledgeState',
          confidence: 0.32,
          rationale: 'Chat indicates possible uncertainty around a concept; keep as candidate, not confirmed misconception.',
          payload: {
            candidateWeakSkills: [possibleConcept],
            weakSkillSignals: [{ concept: possibleConcept, source: 'chat', strength: 'weak', text: clip(userMessage, 160) }]
          }
        });
        }
      }
    }

    if (possibleConcept) {
      patches.push({
        dimension: 'profileBase',
        confidence: 0.34,
        rationale: 'Recent chat topic; use for continuity and retrieval, not as a learning goal.',
        payload: {
          recentTopics: [possibleConcept],
          transientTopicSignals: [{ topic: possibleConcept, text: clip(userMessage, 180), observedAt: new Date().toISOString() }]
        }
      });
    }

    if (explicitGoalIntent) {
      if (!(await blockedByControl(userMessage, 'profileBase'))) {
      patches.push({
        dimension: 'profileBase',
        confidence: 0.4,
        rationale: 'User expressed a goal-like learning intent; treat as active goal signal until confirmed by goal creation or repeated activity.',
        payload: {
          activeLearningGoalSignals: [clip(userMessage, 220)]
        }
      });
      }
    }

    const created = [];
    for (const patch of patches) {
      created.push(
        await learnerStateService.proposePatch({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          targetDimension: patch.dimension,
          operation: 'merge',
          proposedBy: 'LearnerStateAnalyzer.chat',
          payload: patch.payload,
          evidenceId: evidence.id,
          confidence: patch.confidence,
          rationale: patch.rationale
        })
      );
    }
    for (const preference of preferenceSignals) {
      const consolidated = await this.maybeConsolidateRepeatedSignal({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        dimension: 'preferenceStyle',
        evidenceId: evidence.id,
        signal: preference,
        evidenceType: 'chat_observation',
        threshold: 3,
        confidence: 0.58,
        rationale: 'Repeated chat interactions indicate a stable resource preference.',
        stablePayload: {
          preferredResourceForms: [preference],
          stablePreferenceEvidence: [{ preference, source: 'chat', observedAt: new Date().toISOString() }]
        }
      });
      if (consolidated) created.push(consolidated);
    }
    for (const signal of uncertainty) {
      const consolidated = await this.maybeConsolidateRepeatedSignal({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        dimension: 'behaviorEngagement',
        evidenceId: evidence.id,
        signal,
        evidenceType: 'chat_observation',
        threshold: 3,
        confidence: 0.56,
        rationale: 'Repeated help-seeking pattern; use for tutoring style adaptation, not ability judgment.',
        stablePayload: {
          recurringQuestionPatterns: [signal]
        }
      });
      if (consolidated) created.push(consolidated);
    }

    return { evidence, patches: created };
  }

  async analyzeQuizResult(input: AnalyzeQuizInput) {
    const score = Math.max(0, Math.min(1, Number(input.result.score) || 0));
    const skill = clip(input.question.skill || input.question.learningObjective || input.question.knowledgePoints?.[0], 120);
    const concept = skill || conceptFromText(input.question.question, input.question.source || input.question.id);
    const conceptMemoryKey = buildLearnerMemoryKey('knowledgeState', concept);
    if (await hasMemoryControl(input.workspaceId, conceptMemoryKey, 'delete') || await hasMemoryControl(input.workspaceId, conceptMemoryKey, 'freeze')) {
      const evidence = await learnerStateService.recordEvidence({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        evidenceType: 'quiz_answer_judged',
        sourceType: 'quiz',
        sourceId: input.question.id,
        actor: 'user',
        title: `Quiz result: ${concept || input.question.id}`,
        summary: `score=${score.toFixed(2)}, correct=${Boolean(input.result.correct)}`,
        payload: { question: input.question, userAnswer: clip(input.userAnswer, 1200), result: input.result },
        confidence: 0.35
      });
      return { evidence, patches: [] };
    }
    const confidence = score >= 0.85 || score <= 0.35 ? 0.62 : 0.52;
    const evidence = await learnerStateService.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      evidenceType: 'quiz_answer_judged',
      sourceType: 'quiz',
      sourceId: input.question.id,
      actor: 'user',
      title: `Quiz result: ${concept || input.question.id}`,
      summary: `score=${score.toFixed(2)}, correct=${Boolean(input.result.correct)}`,
      payload: {
        question: {
          id: input.question.id,
          type: input.question.type,
          skill,
          difficulty: input.question.difficulty,
          knowledgePoints: input.question.knowledgePoints || [],
          commonMistake: input.question.commonMistake || null
        },
        userAnswer: clip(input.userAnswer, 1200),
        result: input.result
      },
      confidence
    });

    const priorSignals = concept
      ? await prisma.learnerEvidence.count({
          where: {
            workspaceId: input.workspaceId,
            evidenceType: 'quiz_answer_judged',
            payloadJson: { contains: concept }
          }
        })
      : 0;
    const repeated = priorSignals >= 2;
    const patches: SignalPatch[] = [
      {
        dimension: 'knowledgeState',
        confidence: repeated ? confidence : Math.min(confidence, 0.52),
        rationale: repeated
          ? 'Repeated quiz evidence for this concept; update mastery signal more confidently.'
          : 'Single quiz result; record as a mastery signal without making a strong conclusion.',
        payload: {
          masterySignals: [
            {
              concept,
              source: 'quiz',
              score,
              correct: Boolean(input.result.correct),
              difficulty: input.question.difficulty,
              observedAt: new Date().toISOString()
            }
          ],
          ...(score < 0.55 ? { candidateWeakSkills: [concept] } : {}),
          ...(score >= 0.85 && repeated ? { emergingStrengths: [concept] } : {})
        }
      },
      {
        dimension: 'misconceptionState',
        confidence: score < 0.55 ? 0.5 : 0.28,
        rationale: score < 0.55
          ? 'Quiz feedback suggests possible misconception or missing point; keep as candidate until confirmed.'
          : 'Quiz did not strongly indicate misconception.',
        payload: {
          candidateMisconceptions: score < 0.55
            ? unique([input.question.commonMistake, ...(input.result.missingPoints || [])]).slice(0, 5)
            : [],
          repairStrategies: score < 0.55 ? ['review_rubric', 'ask_for_explanation', 'retry_similar_question'] : []
        }
      }
    ];

    const created = [];
    for (const patch of patches.filter((patch) => patch.confidence >= 0.3)) {
      created.push(
        await learnerStateService.proposePatch({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          targetDimension: patch.dimension,
          operation: 'merge',
          proposedBy: 'LearnerStateAnalyzer.quiz',
          payload: patch.payload,
          evidenceId: evidence.id,
          confidence: patch.confidence,
          rationale: patch.rationale
        })
      );
    }
    if (concept && repeated) {
      const consolidated = await learnerStateService.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: 'knowledgeState',
        operation: 'merge',
        proposedBy: 'LearnerStateAnalyzer.quiz.consolidation',
        payload:
          score < 0.55
            ? { weakSkills: [concept], stableWeaknessEvidence: [{ concept, source: 'quiz', score }] }
            : score >= 0.85
              ? { emergingStrengths: [concept], strengthEvidence: [{ concept, source: 'quiz', score }] }
              : { focusConcepts: [concept] },
        evidenceId: evidence.id,
        confidence: score < 0.55 || score >= 0.85 ? 0.66 : 0.55,
        rationale: 'Repeated quiz evidence upgraded from candidate signal to a more stable learner-state signal.'
      });
      created.push(consolidated);
    }

    return { evidence, patches: created };
  }

  async analyzeFlashcardReview(input: AnalyzeFlashcardInput) {
    const concept = clip(input.concept || input.cardId, 120);
    const conceptMemoryKey = buildLearnerMemoryKey('knowledgeState', concept);
    if (await hasMemoryControl(input.workspaceId, conceptMemoryKey, 'delete') || await hasMemoryControl(input.workspaceId, conceptMemoryKey, 'freeze')) {
      const evidence = await learnerStateService.recordEvidence({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        evidenceType: 'flashcard_review_signal',
        sourceType: 'flashcard_review',
        sourceId: input.cardId,
        actor: 'user',
        title: `Flashcard review: ${concept}`,
        summary: `rating=${input.rating}, concept=${concept}`,
        payload: input,
        confidence: 0.3
      });
      return { evidence, patches: [] };
    }
    const evidence = await learnerStateService.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      evidenceType: 'flashcard_review_signal',
      sourceType: 'flashcard_review',
      sourceId: input.cardId,
      actor: 'user',
      title: `Flashcard review: ${concept}`,
      summary: `rating=${input.rating}, concept=${concept}`,
      payload: input,
      confidence: 0.58
    });

    const conceptReviewCount = await prisma.flashcardReviewLog.count({
      where: {
        workspaceId: input.workspaceId,
        card: {
          concept: input.concept || undefined
        }
      }
    }).catch(() => 0);
    const repeated = conceptReviewCount >= 3;
    const score = ratingWeight[input.rating];
    const isWeak = input.rating === 'again' || input.rating === 'hard';
    const confidence = repeated ? 0.62 : 0.46;
    const patches: SignalPatch[] = [
      {
        dimension: 'knowledgeState',
        confidence,
        rationale: repeated
          ? 'Repeated flashcard reviews provide a more stable memory signal.'
          : 'Flashcard review is useful but should accumulate before changing stable mastery.',
        payload: {
          masterySignals: [
            {
              concept,
              source: 'flashcard',
              rating: input.rating,
              score,
              difficulty: input.difficulty,
              observedAt: new Date().toISOString()
            }
          ],
          ...(isWeak ? { candidateWeakSkills: [concept] } : repeated && input.rating === 'easy' ? { emergingStrengths: [concept] } : {})
        }
      },
      {
        dimension: 'reviewPlanning',
        confidence: 0.58,
        rationale: 'Flashcard scheduling signal updates review planning, not broad learner ability.',
        payload: {
          recentFlashcardReviews: [
            {
              cardId: input.cardId,
              deckId: input.deckId,
              concept,
              rating: input.rating,
              nextDueAt: input.nextDueAt || null
            }
          ],
          reviewPressureSignals: isWeak ? [concept] : []
        }
      }
    ];

    const created = [];
    for (const patch of patches) {
      created.push(
        await learnerStateService.proposePatch({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          targetDimension: patch.dimension,
          operation: 'merge',
          proposedBy: 'LearnerStateAnalyzer.flashcard',
          payload: patch.payload,
          evidenceId: evidence.id,
          confidence: patch.confidence,
          rationale: patch.rationale
        })
      );
    }
    if (repeated && concept) {
      created.push(
        await learnerStateService.proposePatch({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          targetDimension: 'knowledgeState',
          operation: 'merge',
          proposedBy: 'LearnerStateAnalyzer.flashcard.consolidation',
          payload: isWeak
            ? { weakSkills: [concept], stableWeaknessEvidence: [{ concept, source: 'flashcard', rating: input.rating }] }
            : input.rating === 'easy'
              ? { emergingStrengths: [concept], strengthEvidence: [{ concept, source: 'flashcard', rating: input.rating }] }
              : { focusConcepts: [concept] },
          evidenceId: evidence.id,
          confidence: isWeak || input.rating === 'easy' ? 0.64 : 0.55,
          rationale: 'Repeated flashcard review evidence upgraded from review signal to stable learner-state signal.'
        })
      );
    }

    return { evidence, patches: created };
  }
}

export const learnerStateAnalyzer = new LearnerStateAnalyzer();

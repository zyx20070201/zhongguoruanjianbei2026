import { ContextCapsule } from '../types/contextSystem';
import { aiModelProviderService } from './aiModelProviderService';

export type QuizQuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'short_answer'
  | 'error_analysis'
  | 'application'
  | 'coding_calculation';

export interface QuizQualityQuestion {
  id: string;
  type: QuizQuestionType;
  question: string;
  options?: Array<{ id: 'A' | 'B' | 'C' | 'D'; text: string }>;
  answer: string;
  acceptableAnswers?: string[];
  rubric: string;
  skill: string;
  difficulty: 'easy' | 'medium' | 'hard';
  source?: string;
  explanation?: string;
  knowledgePoints?: string[];
  learningObjective?: string;
  commonMistake?: string;
  sourceRefs?: Array<{ title: string; snippet: string }>;
}

export interface QuizQualityPayload {
  title: string;
  questions: QuizQualityQuestion[];
}

export interface QuizQualityIssue {
  questionId: string;
  severity: 'low' | 'medium' | 'high';
  code:
    | 'duplicate_question'
    | 'duplicate_answer'
    | 'missing_option'
    | 'invalid_answer'
    | 'missing_rubric'
    | 'missing_explanation'
    | 'weak_grounding'
    | 'control_text_leak'
    | 'question_too_short'
    | 'question_too_long';
  message: string;
}

export interface QuizQualityReport {
  score: number;
  keptCount: number;
  removedCount: number;
  issues: QuizQualityIssue[];
  warnings: string[];
}

const CONTROL_TEXT_PATTERN =
  /course_id|task_id|question_types|source_scope|focus_modes|answer_mode|current_workspace|current_workbench|Context Capsule|mock|JSON/i;

const normalizeText = (value: string | undefined | null) =>
  String(value || '')
    .toLowerCase()
    .replace(/[，。！？；：、,.!?;:()[\]{}"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const clip = (value: string | undefined | null, maxLength = 400) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const buildEvidenceBank = (capsule: ContextCapsule) =>
  [
    capsule.selection?.content,
    capsule.viewport?.content,
    capsule.activeFile?.summary,
    capsule.activeFile?.content,
    ...(capsule.retrievedChunks || []).map((chunk) => chunk.content),
    ...(capsule.citations || []).map((citation) => `${citation.label} ${citation.preview || ''}`)
  ]
    .filter(Boolean)
    .map((item) => normalizeText(String(item)))
    .filter(Boolean)
    .slice(0, 24);

const hasGroundingSignal = (question: QuizQualityQuestion, evidenceBank: string[]) => {
  const keywords = Array.from(
    new Set(
      normalizeText(
        [
          question.question,
          question.answer,
          question.skill,
          ...(question.knowledgePoints || []),
          question.source,
          ...(question.sourceRefs || []).flatMap((item) => [item.title, item.snippet])
        ].join(' ')
      )
        .split(' ')
        .filter((token) => token.length >= 3)
    )
  ).slice(0, 18);

  if (keywords.length === 0) return false;
  const matches = keywords.filter((keyword) => evidenceBank.some((evidence) => evidence.includes(keyword)));
  return matches.length >= Math.min(2, keywords.length);
};

const findRuleIssues = (question: QuizQualityQuestion, evidenceBank: string[]): QuizQualityIssue[] => {
  const issues: QuizQualityIssue[] = [];
  const questionText = question.question.trim();

  if (!questionText || questionText.length < 12) {
    issues.push({
      questionId: question.id,
      severity: 'high',
      code: 'question_too_short',
      message: '题干过短，缺少明确考察内容。'
    });
  }

  if (questionText.length > 280) {
    issues.push({
      questionId: question.id,
      severity: 'medium',
      code: 'question_too_long',
      message: '题干过长，可能混入了控制信息或冗余描述。'
    });
  }

  if (CONTROL_TEXT_PATTERN.test(questionText)) {
    issues.push({
      questionId: question.id,
      severity: 'high',
      code: 'control_text_leak',
      message: '题干包含内部控制参数或生成提示词泄露。'
    });
  }

  const isChoice =
    question.type === 'single_choice' || question.type === 'multiple_choice' || question.type === 'true_false';

  if (isChoice) {
    const options = Array.isArray(question.options) ? question.options : [];
    const optionMap = new Map(options.map((option) => [option.id, normalizeText(option.text)]));
    if (optionMap.size !== 4 || !['A', 'B', 'C', 'D'].every((id) => optionMap.has(id as 'A'))) {
      issues.push({
        questionId: question.id,
        severity: 'high',
        code: 'missing_option',
        message: '选择题缺少完整的 A/B/C/D 四个选项。'
      });
    }
    const uniqueOptionTexts = new Set(Array.from(optionMap.values()).filter(Boolean));
    if (uniqueOptionTexts.size < Math.min(4, optionMap.size)) {
      issues.push({
        questionId: question.id,
        severity: 'high',
        code: 'duplicate_answer',
        message: '选项文本重复，干扰项质量不足。'
      });
    }
    if (!/^[A-D]$/i.test(String(question.answer || '').trim())) {
      issues.push({
        questionId: question.id,
        severity: 'high',
        code: 'invalid_answer',
        message: '选择题答案不是合法的 A/B/C/D。'
      });
    }
  } else {
    if (!question.rubric?.trim()) {
      issues.push({
        questionId: question.id,
        severity: 'high',
        code: 'missing_rubric',
        message: '主观题缺少 rubric，无法稳定评分。'
      });
    }
    if (!question.explanation?.trim()) {
      issues.push({
        questionId: question.id,
        severity: 'medium',
        code: 'missing_explanation',
        message: '主观题缺少 explanation，学习反馈会偏弱。'
      });
    }
  }

  if (!hasGroundingSignal(question, evidenceBank)) {
    issues.push({
      questionId: question.id,
      severity: 'medium',
      code: 'weak_grounding',
      message: '题目与当前证据的显式关联较弱。'
    });
  }

  return issues;
};

const findDuplicateQuestionIds = (questions: QuizQualityQuestion[]) => {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const question of questions) {
    const fingerprint = normalizeText(
      `${question.type} ${question.question} ${(question.options || []).map((item) => item.text).join(' ')}`
    );
    const first = seen.get(fingerprint);
    if (first) {
      duplicates.add(question.id);
      duplicates.add(first);
    } else {
      seen.set(fingerprint, question.id);
    }
  }
  return duplicates;
};

const aiReviewQuestion = async (
  question: QuizQualityQuestion,
  evidenceBank: string[]
): Promise<QuizQualityIssue[]> => {
  if (!aiModelProviderService.isConfigured({ useCase: 'quiz' })) return [];
  try {
    const response = await aiModelProviderService.json<{
      grounded: boolean;
      answerValid: boolean;
      distractorsValid?: boolean;
      issues?: string[];
    }>({
      useCase: 'quiz',
      instruction: [
        '你是 Quiz Quality Reviewer。',
        '请检查题目是否基于给定证据、答案是否合理、选择题干扰项是否有效。',
        '如果存在问题，只指出最关键的 1-3 个问题。',
        '只输出 JSON。'
      ].join('\n'),
      schema: {
        grounded: 'boolean',
        answerValid: 'boolean',
        distractorsValid: 'boolean',
        issues: ['string']
      },
      input: {
        question,
        evidence: evidenceBank.slice(0, 6).map((item) => clip(item, 300))
      }
    });

    const issues: QuizQualityIssue[] = [];
    if (!response.data.grounded) {
      issues.push({
        questionId: question.id,
        severity: 'medium',
        code: 'weak_grounding',
        message: 'AI 复核认为题目与上下文证据绑定不够强。'
      });
    }
    if (!response.data.answerValid) {
      issues.push({
        questionId: question.id,
        severity: 'high',
        code: 'invalid_answer',
        message: 'AI 复核认为答案或解析存在明显问题。'
      });
    }
    if (
      (question.type === 'single_choice' || question.type === 'multiple_choice' || question.type === 'true_false') &&
      response.data.distractorsValid === false
    ) {
      issues.push({
        questionId: question.id,
        severity: 'medium',
        code: 'duplicate_answer',
        message: 'AI 复核认为干扰项区分度不足。'
      });
    }
    return issues;
  } catch {
    return [];
  }
};

export class QuizQualityService {
  async review(
    payload: QuizQualityPayload,
    capsule: ContextCapsule
  ): Promise<{ quiz: QuizQualityPayload; report: QuizQualityReport }> {
    const evidenceBank = buildEvidenceBank(capsule);
    const duplicateIds = findDuplicateQuestionIds(payload.questions);
    const issues: QuizQualityIssue[] = [];
    const keptQuestions: QuizQualityQuestion[] = [];
    const removedIds = new Set<string>();

    for (const question of payload.questions) {
      const questionIssues = findRuleIssues(question, evidenceBank);
      if (duplicateIds.has(question.id)) {
        questionIssues.push({
          questionId: question.id,
          severity: 'high',
          code: 'duplicate_question',
          message: '题目与其他题高度重复。'
        });
      }

      if (questionIssues.length === 0 || questionIssues.some((issue) => issue.severity !== 'high')) {
        const aiIssues = await aiReviewQuestion(question, evidenceBank);
        questionIssues.push(...aiIssues);
      }

      issues.push(...questionIssues);

      const hasHighIssue = questionIssues.some((issue) => issue.severity === 'high');
      if (hasHighIssue) {
        removedIds.add(question.id);
        continue;
      }

      keptQuestions.push(question);
    }

    const fallbackQuestions =
      keptQuestions.length > 0
        ? keptQuestions
        : payload.questions.slice(0, 3).map((question) => ({
            ...question,
            question: clip(question.question, 220) || '请根据当前资料回答一个核心概念问题。'
          }));

    const warnings: string[] = [];
    if (removedIds.size > 0) {
      warnings.push(`质检移除了 ${removedIds.size} 道高风险题目。`);
    }
    if (fallbackQuestions.length < Math.min(3, payload.questions.length)) {
      warnings.push('通过质检的题目数量偏少，建议扩大来源范围或放宽题型限制后重试。');
    }

    const report: QuizQualityReport = {
      score: Math.max(0, Math.min(1, 1 - issues.length * 0.08)),
      keptCount: fallbackQuestions.length,
      removedCount: removedIds.size,
      issues,
      warnings
    };

    return {
      quiz: {
        ...payload,
        questions: fallbackQuestions
      },
      report
    };
  }
}

export const quizQualityService = new QuizQualityService();

import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';

type QuizQuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'short_answer'
  | 'error_analysis'
  | 'application'
  | 'coding_calculation';

interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  question: string;
  options: string[];
  answer: string;
  rubric: string;
  skill: string;
  difficulty: 'easy' | 'medium' | 'hard';
  explanation?: string;
  hint?: string;
  knowledgePoints?: string[];
  learningObjective?: string;
  commonMistake?: string;
  sourceRefs?: Array<{ title: string; snippet: string }>;
}

export interface QuizPracticePayload {
  title: string;
  summary?: string;
  questions: QuizQuestion[];
}

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isChoiceQuestion = (type: QuizQuestionType) =>
  type === 'single_choice' || type === 'multiple_choice' || type === 'true_false';

const questionTypeLabel = (type: string) => {
  if (type === 'single_choice') return '单选题';
  if (type === 'multiple_choice') return '多选题';
  if (type === 'true_false') return '判断题';
  if (type === 'fill_blank') return '填空题';
  if (type === 'error_analysis') return '错因分析题';
  if (type === 'application') return '应用题';
  if (type === 'coding_calculation') return '代码/计算题';
  return '简答题';
};

const normalizeQuestionType = (value: unknown): QuizQuestionType => {
  const type = String(value || '');
  if (
    type === 'single_choice' ||
    type === 'multiple_choice' ||
    type === 'true_false' ||
    type === 'fill_blank' ||
    type === 'short_answer' ||
    type === 'error_analysis' ||
    type === 'application' ||
    type === 'coding_calculation'
  ) {
    return type;
  }
  if (type === 'multiple_choice_legacy') return 'multiple_choice';
  return 'short_answer';
};

const normalizeDifficulty = (value: unknown): QuizQuestion['difficulty'] => {
  if (value === 'easy' || value === 'medium' || value === 'hard') return value;
  return 'medium';
};

const normalizeOptions = (options: unknown, type: QuizQuestionType) => {
  if (!isChoiceQuestion(type)) return [];
  const rawOptions = Array.isArray(options) ? options : [];
  const optionMap = new Map<string, string>();
  rawOptions.forEach((option, index) => {
    if (typeof option === 'string') {
      const key = option.match(/^([A-D])[\).\s、]+/i)?.[1]?.toUpperCase() || String.fromCharCode(65 + index);
      optionMap.set(key, option.replace(/^[A-D][\).\s、]+/i, '').trim() || option);
      return;
    }
    if (isRecord(option)) {
      const key = String(option.id || option.key || String.fromCharCode(65 + index)).toUpperCase();
      optionMap.set(key, String(option.text || option.label || option.value || '').trim());
    }
  });
  if (type === 'true_false' && !optionMap.size) {
    optionMap.set('A', '正确');
    optionMap.set('B', '错误');
  }
  return Array.from(optionMap.entries())
    .filter(([, text]) => text)
    .map(([key, text]) => `${key}. ${text}`);
};

export const extractQuizPracticePayloadFromText = (content: string, fallbackTitle: string): QuizPracticePayload | null => {
  if (!content.trim()) return null;
  try {
    const parsed = JSON.parse(content);
    const payload = isRecord(parsed?.payload) ? parsed.payload : parsed;
    if (!isRecord(payload) || !Array.isArray(payload.questions) || !payload.questions.length) return null;
    const questions = payload.questions
      .map((item: any, index): QuizQuestion | null => {
        const type = normalizeQuestionType(item?.type);
        const question = String(item?.question || item?.stem || '').trim();
        if (!question) return null;
        return {
          id: String(item?.id || `quiz-${index + 1}`),
          type,
          question,
          options: normalizeOptions(item?.options, type),
          answer: String(item?.answer || '').trim(),
          rubric: String(item?.rubric || item?.explanation || item?.answer || '').trim(),
          skill: String(item?.skill || item?.knowledgePoints?.[0] || '核心理解').trim(),
          difficulty: normalizeDifficulty(item?.difficulty),
          explanation: item?.explanation ? String(item.explanation) : undefined,
          hint: item?.hint ? String(item.hint) : undefined,
          knowledgePoints: Array.isArray(item?.knowledgePoints) ? item.knowledgePoints.map(String) : undefined,
          learningObjective: item?.learningObjective ? String(item.learningObjective) : undefined,
          commonMistake: item?.commonMistake ? String(item.commonMistake) : undefined,
          sourceRefs: Array.isArray(item?.sourceRefs)
            ? item.sourceRefs.map((ref: any) => ({
                title: String(ref?.title || 'Source'),
                snippet: String(ref?.snippet || '')
              }))
            : undefined
        };
      })
      .filter((item: QuizQuestion | null): item is QuizQuestion => Boolean(item));
    if (!questions.length) return null;
    return {
      title: String(payload.title || payload.quizTitle || payload.name || fallbackTitle || '练习题').trim(),
      summary: payload.summary ? String(payload.summary) : undefined,
      questions
    };
  } catch {
    return null;
  }
};

const optionKey = (option: string) => option.match(/^([A-D])[\).\s、]+/i)?.[1]?.toUpperCase() || option.slice(0, 1);

const answerMatchesChoice = (answer: string, option: string) => {
  const key = optionKey(option);
  return answer
    .split(/[,，、\s]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .includes(key);
};

export function QuizPracticeViewer({ lesson }: { lesson: QuizPracticePayload }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const question = lesson.questions[index];
  const currentAnswer = answers[question.id] || '';
  const isRevealed = Boolean(revealed[question.id]);
  const progressPercent = lesson.questions.length ? ((index + 1) / lesson.questions.length) * 100 : 0;
  const selectedKeys = useMemo(
    () => new Set(currentAnswer.split(/[,，、\s]+/).map((item) => item.trim().toUpperCase()).filter(Boolean)),
    [currentAnswer]
  );

  const setChoiceAnswer = (option: string) => {
    const key = optionKey(option);
    setAnswers((current) => {
      if (question.type !== 'multiple_choice') return { ...current, [question.id]: key };
      const next = new Set(selectedKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, [question.id]: Array.from(next).sort().join(',') };
    });
  };

  const resetQuestion = () => {
    setAnswers((current) => ({ ...current, [question.id]: '' }));
    setRevealed((current) => ({ ...current, [question.id]: false }));
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="border-b border-[#e5e7eb] px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">AI Studio Practice</div>
        <h3 className="mt-1 text-lg font-semibold text-[#202124]">{lesson.title}</h3>
        {lesson.summary ? <p className="mt-1 text-sm leading-6 text-[#667085]">{lesson.summary}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        <div className="mx-auto max-w-5xl">
          <div className="mb-5 rounded-lg border border-[#e5e7eb] bg-white shadow-sm">
            <div className="border-b border-[#eef0f4] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-[#1f5fd0]">
                  {index + 1}/{lesson.questions.length}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#5d6472]">
                  <span className="rounded-full bg-[#eef5ff] px-2.5 py-1 text-[#1f5fd0]">{questionTypeLabel(question.type)}</span>
                  <span className="rounded-full bg-[#f3f4f6] px-2.5 py-1">{question.difficulty}</span>
                  {question.skill ? <span className="rounded-full bg-[#f3f4f6] px-2.5 py-1">{question.skill}</span> : null}
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e9edf5]">
                <div className="h-full rounded-full bg-[#1f5fd0]" style={{ width: `${Math.max(4, Math.min(100, progressPercent))}%` }} />
              </div>
            </div>

            <div className="px-4 py-5">
              <h4 className="whitespace-pre-wrap text-[15px] font-semibold leading-7 text-[#202124]">{question.question}</h4>

              {isChoiceQuestion(question.type) ? (
                <div className="mt-4 space-y-3">
                  {question.options.map((option) => {
                    const key = optionKey(option);
                    const selected = selectedKeys.has(key);
                    const correct = isRevealed && answerMatchesChoice(question.answer, option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setChoiceAnswer(option)}
                        className={`flex min-h-[52px] w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left text-sm leading-6 transition ${
                          correct
                            ? 'border-[#14b8a6] bg-[#f8fffd] text-[#202124]'
                            : selected
                              ? 'border-[#b8c4ff] bg-[#f3f5ff] text-[#202124]'
                              : 'border-[#d5dbe5] bg-white text-[#202124] hover:border-[#b8c4d6]'
                        }`}
                      >
                        <span>{option}</span>
                        {correct ? <Check className="h-4 w-4 shrink-0 text-[#14a38f]" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <textarea
                  value={currentAnswer}
                  onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                  rows={5}
                  className="mt-4 w-full resize-none rounded-lg border border-[#d5dbe5] bg-white px-4 py-3 text-sm leading-6 text-[#202124] outline-none transition placeholder:text-[#8b95a7] focus:border-[#b8c4ff]"
                  placeholder="在此填写你的答案"
                />
              )}

              {question.hint ? (
                <div className="mt-4 rounded-lg border border-[#dfe3ea] bg-[#fbfcfd] px-3 py-2 text-sm leading-6 text-[#4f5665]">
                  <span className="font-semibold text-[#343a46]">提示：</span>{question.hint}
                </div>
              ) : null}

              {isRevealed ? (
                <div className="mt-4 rounded-lg border border-[#d5dbe5] bg-[#fbfcfd] px-4 py-3 text-sm leading-6 text-[#34373c]">
                  <div><span className="font-semibold text-[#202124]">参考答案：</span>{question.answer || '暂无'}</div>
                  {(question.explanation || question.rubric) ? (
                    <div className="mt-2"><span className="font-semibold text-[#202124]">解析：</span>{question.explanation || question.rubric}</div>
                  ) : null}
                  {question.knowledgePoints?.length ? (
                    <div className="mt-2"><span className="font-semibold text-[#202124]">知识点：</span>{question.knowledgePoints.join('、')}</div>
                  ) : null}
                  {question.commonMistake ? (
                    <div className="mt-2"><span className="font-semibold text-[#202124]">常见错误：</span>{question.commonMistake}</div>
                  ) : null}
                  {question.sourceRefs?.length ? (
                    <div className="mt-3 space-y-2">
                      {question.sourceRefs.map((ref, refIndex) => (
                        <div key={`${ref.title}-${refIndex}`} className="rounded-md border border-[#eef0f4] bg-white px-3 py-2 text-xs leading-5 text-[#667085]">
                          <div className="font-semibold text-[#343a46]">{ref.title}</div>
                          {ref.snippet}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[#e5e7eb] bg-white px-5 py-3">
        <button
          type="button"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          disabled={index === 0}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dfe3ea] bg-white px-3 text-sm font-semibold text-[#343a46] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetQuestion}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dfe3ea] bg-white px-3 text-sm font-semibold text-[#343a46] transition hover:bg-[#f8fafc]"
          >
            <RotateCcw className="h-4 w-4" />
            Retry
          </button>
          <button
            type="button"
            onClick={() => setRevealed((current) => ({ ...current, [question.id]: !isRevealed }))}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#202124] px-3 text-sm font-semibold text-white transition hover:bg-[#34373c]"
          >
            {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {isRevealed ? '隐藏答案' : '查看答案'}
          </button>
          <button
            type="button"
            onClick={() => setIndex((current) => Math.min(lesson.questions.length - 1, current + 1))}
            disabled={index >= lesson.questions.length - 1}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dfe3ea] bg-white px-3 text-sm font-semibold text-[#343a46] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

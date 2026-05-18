export type PracticeQuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'short_answer'
  | 'error_analysis'
  | 'application'
  | 'coding_calculation';

export type PracticeDifficulty = 'easy' | 'medium' | 'hard' | 'adaptive';

export interface PracticeRequestContract {
  questionCount: number;
  questionTypes: PracticeQuestionType[];
  questionTypeCounts: Partial<Record<PracticeQuestionType, number>>;
  difficulty: PracticeDifficulty;
  explicit: {
    count: boolean;
    types: boolean;
    difficulty: boolean;
  };
  warnings: string[];
}

const ALL_TYPES: PracticeQuestionType[] = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'fill_blank',
  'short_answer',
  'error_analysis',
  'application',
  'coding_calculation'
];

const TYPE_PATTERNS: Array<{ type: PracticeQuestionType; pattern: RegExp }> = [
  { type: 'single_choice', pattern: /单选题?|单项选择|single[-_\s]?choice|single choice/gi },
  { type: 'multiple_choice', pattern: /多选题?|多项选择|multiple[-_\s]?choice|multiple choice/gi },
  { type: 'true_false', pattern: /判断题?|是非题|true[-_\s]?false|true false|判断正误/gi },
  { type: 'fill_blank', pattern: /填空题?|补空题?|fill[-_\s]?blank|blank/gi },
  { type: 'short_answer', pattern: /简答题?|问答题?|short[-_\s]?answer|short answer/gi },
  { type: 'error_analysis', pattern: /错因分析题?|纠错题?|错误分析题?|error[-_\s]?analysis|mistake[-_\s]?drill/gi },
  { type: 'application', pattern: /应用题?|案例题?|迁移题?|application/gi },
  { type: 'coding_calculation', pattern: /代码题?|编程题?|计算题?|coding|calculation/gi }
];

const CHINESE_NUMBERS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
};

const clampCount = (value: number, fallback: number) => {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.min(30, Math.floor(value)));
};

const numberFromText = (value: string | undefined | null) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  if (CHINESE_NUMBERS[text] !== undefined) return CHINESE_NUMBERS[text];
  const tenMatch = text.match(/^十([一二两三四五六七八九])$/);
  if (tenMatch) return 10 + CHINESE_NUMBERS[tenMatch[1]];
  const compound = text.match(/^([一二两三四五六七八九])十([一二两三四五六七八九])?$/);
  if (compound) return CHINESE_NUMBERS[compound[1]] * 10 + (compound[2] ? CHINESE_NUMBERS[compound[2]] : 0);
  return null;
};

const defaultTypesForTemplate = (templateId?: string, defaults?: Record<string, unknown>): PracticeQuestionType[] => {
  const fromDefaults = Array.isArray(defaults?.questionTypes)
    ? defaults.questionTypes.filter((type): type is PracticeQuestionType => ALL_TYPES.includes(type as PracticeQuestionType))
    : [];
  if (fromDefaults.length) return fromDefaults;
  if (templateId === 'mistake_drill') return ['error_analysis', 'short_answer', 'application'];
  if (templateId === 'mock_quiz') return ['single_choice', 'fill_blank', 'short_answer', 'application'];
  return ['single_choice', 'fill_blank', 'short_answer'];
};

const defaultCountForTemplate = (templateId?: string, defaults?: Record<string, unknown>) => {
  const configured = Number(defaults?.questionCount);
  if (Number.isFinite(configured) && configured > 0) return clampCount(configured, 6);
  if (templateId === 'tiered_practice') return 9;
  if (templateId === 'mistake_drill') return 8;
  if (templateId === 'mock_quiz') return 12;
  return 6;
};

const parseExplicitTypeCounts = (prompt: string) => {
  const counts: Partial<Record<PracticeQuestionType, number>> = {};
  for (const { type, pattern } of TYPE_PATTERNS) {
    pattern.lastIndex = 0;
    const source = pattern.source;
    const before = new RegExp(`([0-9]+|[一二两三四五六七八九十]{1,3})\\s*(?:道|个)?\\s*(?:${source})`, 'i');
    const after = new RegExp(`(?:${source})\\s*([0-9]+|[一二两三四五六七八九十]{1,3})\\s*(?:道|个)?`, 'i');
    const match = prompt.match(before) || prompt.match(after);
    const parsed = numberFromText(match?.[1]);
    if (parsed && parsed > 0) counts[type] = clampCount(parsed, 1);
  }
  return counts;
};

const parseRequestedTypes = (prompt: string) => {
  const types: PracticeQuestionType[] = [];
  for (const { type, pattern } of TYPE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(prompt) && !types.includes(type)) types.push(type);
  }
  return types;
};

const parseQuestionCount = (prompt: string) => {
  const patterns = [
    /(?:共|总共|一共|合计|生成|出|做|要|需要)?\s*([0-9]+|[一二两三四五六七八九十]{1,3})\s*(?:道|个)?\s*(?:题|练习|questions?)/i,
    /(?:question_count|题目数量|数量)\s*[:：=]\s*([0-9]+)/i
  ];
  for (const pattern of patterns) {
    const parsed = numberFromText(prompt.match(pattern)?.[1]);
    if (parsed && parsed > 0) return clampCount(parsed, 6);
  }
  return null;
};

const parseDifficulty = (prompt: string): PracticeDifficulty | null => {
  if (/困难|较难|高难|挑战|hard|advanced|进阶|拔高/i.test(prompt)) return 'hard';
  if (/简单|容易|基础|入门|初级|easy|basic/i.test(prompt)) return 'easy';
  if (/中等|适中|普通|medium|normal/i.test(prompt)) return 'medium';
  if (/自适应|adaptive/i.test(prompt)) return 'adaptive';
  return null;
};

const expandTypeSequence = (
  count: number,
  types: PracticeQuestionType[],
  typeCounts: Partial<Record<PracticeQuestionType, number>>
) => {
  const explicitEntries = Object.entries(typeCounts).flatMap(([type, amount]) =>
    Array.from({ length: clampCount(Number(amount), 0) }, () => type as PracticeQuestionType)
  );
  if (explicitEntries.length) {
    const fillTypes = types.length ? types : explicitEntries;
    while (explicitEntries.length < count) {
      explicitEntries.push(fillTypes[explicitEntries.length % fillTypes.length]);
    }
    return explicitEntries.slice(0, count);
  }
  const cycle = types.length ? types : ['single_choice', 'fill_blank', 'short_answer'] as PracticeQuestionType[];
  return Array.from({ length: count }).map((_, index) => cycle[index % cycle.length]);
};

export const parsePracticeRequestContract = (input: {
  prompt?: string | null;
  options?: Record<string, unknown> | null;
  templateId?: string;
  defaultOptions?: Record<string, unknown>;
}): PracticeRequestContract => {
  const prompt = String(input.prompt || input.options?.userRequirement || '').trim();
  const defaults = input.defaultOptions || {};
  const optionCount = Number(input.options?.questionCount || (input.options?.quiz as any)?.questionCount);
  const defaultCount = defaultCountForTemplate(input.templateId, defaults);
  const explicitTypeCounts = parseExplicitTypeCounts(prompt);
  const requestedTypes = parseRequestedTypes(prompt);
  const optionTypes = Array.isArray(input.options?.questionTypes)
    ? input.options.questionTypes.filter((type): type is PracticeQuestionType => ALL_TYPES.includes(type as PracticeQuestionType))
    : [];
  const defaultTypes = defaultTypesForTemplate(input.templateId, defaults);
  const parsedCount = parseQuestionCount(prompt);
  const typeCountTotal = Object.values(explicitTypeCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  const questionCount = clampCount(
    typeCountTotal || parsedCount || optionCount || defaultCount,
    defaultCount
  );
  const questionTypes = requestedTypes.length
    ? requestedTypes
    : optionTypes.length
      ? optionTypes
      : defaultTypes;
  const parsedDifficulty = parseDifficulty(prompt);
  const optionDifficulty = String(input.options?.difficulty || (input.options?.quiz as any)?.difficulty || '').trim();
  const difficulty = parsedDifficulty ||
    (['easy', 'medium', 'hard', 'adaptive'].includes(optionDifficulty) ? optionDifficulty as PracticeDifficulty : null) ||
    (['easy', 'medium', 'hard', 'adaptive'].includes(String(defaults.difficulty)) ? defaults.difficulty as PracticeDifficulty : 'adaptive');

  return {
    questionCount,
    questionTypes,
    questionTypeCounts: explicitTypeCounts,
    difficulty,
    explicit: {
      count: Boolean(typeCountTotal || parsedCount || optionCount),
      types: Boolean(requestedTypes.length || optionTypes.length || typeCountTotal),
      difficulty: Boolean(parsedDifficulty || optionDifficulty)
    },
    warnings: questionCount >= 30 ? ['题量已限制为最多 30 道。'] : []
  };
};

const fallbackQuestionForType = (input: {
  id: string;
  type: PracticeQuestionType;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  sourceRefs?: unknown[];
}) => {
  const base = {
    id: input.id,
    type: input.type,
    difficulty: input.difficulty,
    skill: `${input.topic}：${input.type}`,
    conceptId: input.topic,
    objectiveId: `${input.type}:${input.topic}`,
    tier: input.difficulty,
    knowledgePoints: [input.topic],
    learningObjective: `检查学生是否能围绕「${input.topic}」完成 ${input.type} 类型任务。`,
    commonMistake: '只背结论而没有结合条件、步骤或来源证据。',
    sourceRefs: input.sourceRefs || [],
    hint: '先圈出题干中的关键条件，再判断它们对应到哪一步运算或概念。'
  };
  if (['single_choice', 'multiple_choice', 'true_false'].includes(input.type)) {
    return {
      ...base,
      question: input.type === 'true_false'
        ? `判断正误：学习「${input.topic}」时，应结合来源证据说明关键条件和步骤。`
        : `关于「${input.topic}」，下面哪一项最符合当前资料支持的学习要求？`,
      options: [
        { id: 'A', text: '结合来源证据说明核心概念、条件和步骤。' },
        { id: 'B', text: '只记住标题，不需要理解过程。' },
        { id: 'C', text: '忽略前置条件，直接套用结论。' },
        { id: 'D', text: '不需要练习或复盘。' }
      ],
      answer: 'A',
      rubric: '选择 A，并能解释为什么需要结合概念、条件和来源证据。',
      explanation: '该题检查学习者是否把知识点和来源证据建立连接。'
    };
  }
  if (input.type === 'fill_blank') {
    return {
      ...base,
      question: `请填写一个与「${input.topic}」最相关的关键词、条件或步骤。`,
      answer: input.topic,
      acceptableAnswers: [input.topic],
      rubric: '答案应与当前主题、关键步骤或来源材料中的核心概念相关。',
      explanation: '填空题用于检查主动回忆。'
    };
  }
  if (input.type === 'error_analysis') {
    return {
      ...base,
      question: `某同学学习「${input.topic}」时直接套用结论，没有检查前置条件。请指出错因并说明如何纠正。`,
      answer: '错因是忽略适用条件或中间验证。纠正时应先列出输入条件，再逐步检查定义、步骤和来源依据。',
      rubric: '回答应包含错误现象、错误原因、正确步骤和防止复犯的方法。',
      explanation: '错因题重点检查能否解释错误为什么发生。'
    };
  }
  if (input.type === 'application') {
    return {
      ...base,
      question: `请设计一个关于「${input.topic}」的小场景，并说明如何用当前资料中的步骤完成判断或解释。`,
      answer: input.topic,
      rubric: '应包含场景、输入条件、判断步骤、输出结论和来源依据。',
      explanation: '应用题检查迁移能力。'
    };
  }
  if (input.type === 'coding_calculation') {
    return {
      ...base,
      question: `请围绕「${input.topic}」设计一个代码或计算步骤，并说明每一步的输入、处理和输出。`,
      answer: input.topic,
      rubric: '应包含输入、关键计算/代码步骤、输出、边界条件和来源依据。',
      explanation: '代码/计算题检查可操作推理。'
    };
  }
  return {
    ...base,
    question: `请用自己的话解释「${input.topic}」的一个关键概念，并说明它为什么重要。`,
    answer: input.topic,
    rubric: '回答应包含定义、重要性、一个条件/步骤/例子，以及来源依据。',
    explanation: '简答题用于检查语义理解。'
  };
};

export const reconcileQuizWithPracticeContract = <T extends { title?: string; questions?: any[] }>(
  payload: T,
  contract: PracticeRequestContract,
  topic: string
): T => {
  const sequence = expandTypeSequence(contract.questionCount, contract.questionTypes, contract.questionTypeCounts);
  const sourceQuestions = Array.isArray(payload.questions) ? payload.questions : [];
  const pools = new Map<PracticeQuestionType, any[]>();
  for (const type of ALL_TYPES) pools.set(type, []);
  for (const question of sourceQuestions) {
    const type = ALL_TYPES.includes(String(question?.type) as PracticeQuestionType)
      ? String(question.type) as PracticeQuestionType
      : 'short_answer';
    pools.get(type)?.push(question);
  }
  const used = new Set<any>();
  const difficulty =
    contract.difficulty === 'adaptive'
      ? undefined
      : contract.difficulty;
  const questions = sequence.map((type, index) => {
    const exact = (pools.get(type) || []).find((question) => !used.has(question));
    const next = exact || sourceQuestions.find((question) => !used.has(question));
    if (next) {
      used.add(next);
      return {
        ...next,
        id: String(next.id || `q${index + 1}`),
        type,
        difficulty: difficulty || next.difficulty || (index < 2 ? 'easy' : index < 5 ? 'medium' : 'hard')
      };
    }
    return fallbackQuestionForType({
      id: `q${index + 1}`,
      type,
      topic,
      difficulty: difficulty || (index < 2 ? 'easy' : index < 5 ? 'medium' : 'hard'),
      sourceRefs: sourceQuestions[0]?.sourceRefs
    });
  });
  return {
    ...payload,
    questions
  };
};

export const practiceContractInstruction = (contract: PracticeRequestContract) => [
  `Practice contract: generate exactly ${contract.questionCount} question(s).`,
  `Allowed/requested question type sequence: ${expandTypeSequence(contract.questionCount, contract.questionTypes, contract.questionTypeCounts).join(', ')}.`,
  `Target difficulty: ${contract.difficulty}.`,
  'If the user explicitly requested a type/count/difficulty, this contract has priority over the default template mix.',
  'Each hint must be one short solving cue for this exact question; it should point to the next reasoning step, not a generic study strategy.',
  'Do not include source, level, common mistake, answer, or full explanation in hint.',
  'Do not mention this contract or internal option names in the learner-facing quiz.'
].join('\n');

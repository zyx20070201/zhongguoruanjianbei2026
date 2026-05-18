import { StudioGenerationContext, StudioStructuredArtifact } from './types';
import { studioTemplateRegistry } from './templateRegistry';
import { normalizeStudioArtifact } from './artifactSchemas';
import { renderStudioArtifact } from './artifactRenderer';
import { reviewStudioArtifact } from './reviewAgent';
import {
  buildFallbackTeachingVisualizationIR,
  executeProcessTrace,
  inferTeachingDomain,
  validateTeachingVisualizationIR
} from './visualizationIr';

const baseCapsule: any = {
  mode: 'workbench',
  promptContextPreview: '银行家算法用于判断系统是否处于安全状态。安全序列判断需要检查 Available、Need、Allocation。',
  estimatedTokens: 128,
  citations: [
    {
      sourceId: 'S1',
      label: '操作系统课件：银行家算法',
      fileId: 'file-1',
      fileName: 'os-banker.pdf',
      confidence: 'high',
      preview: '安全序列判断需要寻找可满足 Need <= Available 的进程。'
    }
  ],
  retrievedChunks: [
    {
      content: '若存在一个进程序列，使每个进程的 Need 都能被当前 Available 加已完成进程释放的资源满足，则系统安全。',
      fileId: 'file-1',
      fileName: 'os-banker.pdf',
      score: 0.91
    }
  ],
  resources: [],
  selection: null,
  viewport: null,
  activeFile: { fileName: 'os-banker.pdf', summary: '银行家算法与安全序列。' }
};

const contextFor = (templateId: string): StudioGenerationContext => {
  const template = studioTemplateRegistry.get(templateId);
  if (!template) throw new Error(`Missing template ${templateId}`);
  return {
    input: {
      workspaceId: 'workspace-fixture',
      workbenchId: 'workbench-fixture',
      templateId,
      prompt: '银行家算法安全序列判断',
      context: { workspaceId: 'workspace-fixture', workbenchId: 'workbench-fixture' }
    },
    template,
    runId: 'run-fixture',
    capsule: baseCapsule,
    learnerContext: {
      audience: 'studio',
      summary: 'Fixture learner context',
      promptContext: [
        'Learner context for studio:',
        '- Current focus knowledge: 银行家算法, 安全序列判断',
        '- Stable weak knowledge: 安全序列判断'
      ].join('\n'),
      personalizationHints: ['Give extra support on stable weak areas: 安全序列判断.'],
      learningSignals: {
        recentTopics: ['银行家算法'],
        activeGoals: [],
        goals: [],
        focusConcepts: ['安全序列判断'],
        candidateWeaknesses: [],
        stableWeaknesses: ['安全序列判断'],
        emergingStrengths: [],
        misconceptions: [],
        preferredResourceForms: ['practice_or_quiz'],
        nextActions: ['完成基础诊断'],
        reviewPressure: [],
        corrections: [],
        downranks: []
      },
      guardrails: ['Do not present learner-state signals as fixed traits.'],
      provenance: {
        learnerStateId: 'fixture-state',
        version: 1,
        evidenceCount: 1,
        confidence: 0.7,
        pendingPatchCount: 0,
        updatedAt: new Date(0).toISOString()
      }
    },
    recommendation: {
      id: 'studio-rec-diagnostic_quiz',
      goal: 'practice',
      templateId,
      title: '推荐生成：诊断练习',
      reason: '最近错误集中在安全序列判断，建议先生成诊断练习。',
      priority: 99,
      evidence: ['近期学习证据中出现薄弱/低分信号。'],
      actions: []
    },
    trace: []
  };
};

const quizRaw = (title: string, type = 'single_choice') => JSON.stringify({
  title,
  questions: [
    {
      id: 'q1',
      type,
      question: '安全序列判断首先要比较什么？',
      options: type === 'single_choice'
        ? [
            { id: 'A', text: 'Need 与 Available' },
            { id: 'B', text: 'Max 与 Allocation' },
            { id: 'C', text: 'PID 与时间片' },
            { id: 'D', text: '页表与快表' }
          ]
        : undefined,
      answer: type === 'single_choice' ? 'A' : '先找 Need <= Available 的进程，并释放其 Allocation。',
      rubric: '能指出 Need <= Available 是可执行条件，并说明资源释放后的 Available 更新。',
      skill: '安全序列判断',
      difficulty: 'easy',
      explanation: '先找 Need 不超过 Available 的进程。',
      knowledgePoints: ['Need', 'Available', '安全序列'],
      commonMistake: '只看 Allocation，不检查 Need。',
      sourceRefs: [{ title: '操作系统课件：银行家算法', sourceId: 'S1' }]
    }
  ]
});

const mindMapRaw = (title = '银行家算法') => [
  '```mermaid',
  'mindmap',
  `  root((${title}))`,
  '    安全状态',
  '      安全序列',
  '    资源矩阵',
  '      Available',
  '      Need',
  '```',
  '',
  '```concept_graph',
  '{"nodes":[{"id":"n1","label":"银行家算法"},{"id":"n2","label":"安全序列"}],"links":[{"source":"n1","target":"n2","label":"判断"}]}',
  '```',
  '',
  '## 大纲',
  '- 安全状态',
  '- 安全序列'
].join('\n');

const textRaw = (title: string) => [
  `# ${title}`,
  '',
  '## 核心直觉',
  '银行家算法通过寻找安全序列判断系统能否让所有进程顺利完成。',
  '',
  '## 关键步骤',
  '- 比较 Need 与 Available。',
  '- 找到可执行进程后释放 Allocation。',
  '- 重复直到所有进程完成或无法继续。',
  '',
  '## 来源依据',
  '- [S1] 操作系统课件：银行家算法'
].join('\n');

const flashcardRaw = [
  '# Flashcards: 银行家算法',
  '',
  '## Card 1',
  '',
  'Front: 安全序列判断第一步是什么？',
  '',
  'Back: 比较每个进程的 Need 是否小于等于 Available。',
  '',
  'Concept: 安全序列',
  '',
  'Difficulty: medium',
  '',
  '## Card 2',
  '',
  'Front: 找到可执行进程后 Available 如何变化？',
  '',
  'Back: Available 加上该进程释放的 Allocation。',
  '',
  'Concept: Available 更新',
  '',
  'Difficulty: medium'
].join('\n');

const assertText = (artifact: StudioStructuredArtifact, rendered: string) => {
  if (artifact.artifactKind !== 'text') throw new Error(`${artifact.templateId} artifact kind mismatch`);
  if (!rendered.includes('## 来源依据')) throw new Error(`${artifact.templateId} rendered content missing sources`);
};

const assertQuiz = (artifact: StudioStructuredArtifact, rendered: string) => {
  if (artifact.artifactKind !== 'quiz') throw new Error(`${artifact.templateId} artifact kind mismatch`);
  if (!rendered.includes('"questions"')) throw new Error(`${artifact.templateId} rendered content missing questions`);
};

const assertMindMap = (artifact: StudioStructuredArtifact, rendered: string) => {
  if (artifact.artifactKind !== 'mind_map') throw new Error(`${artifact.templateId} artifact kind mismatch`);
  if (!rendered.includes('```mermaid')) throw new Error(`${artifact.templateId} rendered content missing mermaid`);
};

const assertFlashcards = (artifact: StudioStructuredArtifact, rendered: string) => {
  if (artifact.artifactKind !== 'flashcards') throw new Error(`${artifact.templateId} artifact kind mismatch`);
  if (!rendered.includes('## Card')) throw new Error(`${artifact.templateId} rendered content missing cards`);
};

const assertTeachingVisualization = (artifact: StudioStructuredArtifact<any>, rendered: string) => {
  const payload = artifact.payload || {};
  if (!payload.teachingPlan || !payload.processTrace || !payload.visualMapping) {
    throw new Error(`${artifact.templateId} missing teaching visualization IR`);
  }
  const contract = validateTeachingVisualizationIR({
    teachingPlan: payload.teachingPlan,
    processTrace: payload.processTrace,
    visualMapping: payload.visualMapping
  });
  if (!contract.valid) {
    throw new Error(`${artifact.templateId} invalid IR contract: ${contract.issues.map((issue) => issue.code).join(', ')}`);
  }
  const runtime = executeProcessTrace(payload.processTrace);
  if (runtime.frames.length !== payload.processTrace.steps.length) {
    throw new Error(`${artifact.templateId} runtime frame count mismatch`);
  }
  if (!rendered.includes('Process Trace IR')) {
    throw new Error(`${artifact.templateId} rendered content missing IR section`);
  }
};

const visualizationRaw = (templateId: string, topic: string) => {
  const context = contextFor(templateId);
  const visualization = buildFallbackTeachingVisualizationIR(
    {
      ...context,
      input: { ...context.input, prompt: topic }
    },
    topic
  );
  const domain = inferTeachingDomain(topic);
  return JSON.stringify({
    ...visualization,
    processTrace: {
      ...visualization.processTrace,
      domain,
      title: topic
    }
  }, null, 2);
};

const samples: Array<{ templateId: string; raw: string; assert: (artifact: StudioStructuredArtifact, rendered: string) => void }> = [
  {
    templateId: 'concept_explainer',
    raw: textRaw('银行家算法概念讲解'),
    assert: assertText
  },
  {
    templateId: 'comparison_guide',
    raw: [
      '# Need / Available 对比辨析',
      '',
      '## 对比表',
      '| 对比项 | Need | Available | 判断规则 |',
      '| --- | --- | --- | --- |',
      '| 含义 | 尚需资源 | 当前可用资源 | Need <= Available 时可执行 |',
      '',
      '## 来源依据',
      '- [S1] 操作系统课件：银行家算法'
    ].join('\n'),
    assert: assertText
  },
  {
    templateId: 'common_mistakes_guide',
    raw: textRaw('银行家算法易错点讲解'),
    assert: assertText
  },
  {
    templateId: 'diagnostic_quiz',
    raw: quizRaw('银行家算法诊断练习'),
    assert: assertQuiz
  },
  {
    templateId: 'tiered_practice',
    raw: quizRaw('银行家算法分层练习', 'short_answer'),
    assert: assertQuiz
  },
  {
    templateId: 'mistake_drill',
    raw: quizRaw('银行家算法错因专项训练', 'error_analysis'),
    assert: assertQuiz
  },
  {
    templateId: 'mock_quiz',
    raw: quizRaw('银行家算法模拟测验'),
    assert: assertQuiz
  },
  {
    templateId: 'mind_map',
    raw: mindMapRaw(),
    assert: assertMindMap
  },
  {
    templateId: 'knowledge_graph',
    raw: mindMapRaw('银行家算法知识图谱'),
    assert: assertMindMap
  },
  {
    templateId: 'flashcards',
    raw: flashcardRaw,
    assert: assertFlashcards
  },
  {
    templateId: 'quick_review_sheet',
    raw: textRaw('银行家算法速记清单'),
    assert: assertText
  },
  {
    templateId: 'review_plan',
    raw: textRaw('银行家算法复习计划'),
    assert: assertText
  },
  {
    templateId: 'study_plan',
    raw: JSON.stringify({
      objective: '三天内补齐银行家算法安全序列判断',
      tasks: [
        {
          day: '今天',
          title: '完成安全序列诊断',
          action: '做 5 道诊断题并记录错因。',
          resources: '操作系统课件第 3 章',
          acceptance: '能写出完整安全序列判断过程。',
          feedback: '把错因回写 learner state。'
        }
      ],
      risks: ['如果诊断错误集中，先生成易错点讲解。'],
      reflectionQuestions: ['今天的错因是什么？']
    }),
    assert: (artifact, rendered) => {
      if (artifact.artifactKind !== 'study_plan') throw new Error('study plan artifact kind mismatch');
      if (!rendered.includes('战术任务')) throw new Error('study plan rendered content missing tactical tasks');
    }
  },
  {
    templateId: 'code_lab',
    raw: [
      '# Code Lab',
      '## 实验目标',
      '实现安全序列判断。',
      '## Starter Code',
      '```ts',
      'export function isSafe() { return false; }',
      '```',
      '## 测试任务',
      '- 至少验证一个安全状态'
    ].join('\n'),
    assert: (artifact, rendered) => {
      if (artifact.artifactKind !== 'code_lab') throw new Error('code lab artifact kind mismatch');
      if (!rendered.includes('Starter Code')) throw new Error('code lab rendered content missing code section');
    }
  },
  {
    templateId: 'interactive_demo',
    raw: visualizationRaw('interactive_demo', '插入排序逐步比较与移动'),
    assert: assertTeachingVisualization
  },
  {
    templateId: 'interactive_demo',
    raw: visualizationRaw('interactive_demo', 'NFA 到 DFA 的子集构造过程'),
    assert: assertTeachingVisualization
  },
  {
    templateId: 'interactive_demo',
    raw: visualizationRaw('interactive_demo', '数据库两张表根据 id 做 inner join'),
    assert: assertTeachingVisualization
  },
  {
    templateId: 'interactive_demo',
    raw: visualizationRaw('interactive_demo', 'BFS 图遍历 frontier 和 visited 的变化'),
    assert: assertTeachingVisualization
  },
  {
    templateId: 'interactive_demo',
    raw: visualizationRaw('interactive_demo', '函数公式推导中的条件检查'),
    assert: assertTeachingVisualization
  },
  {
    templateId: 'algorithm_animation',
    raw: visualizationRaw('algorithm_animation', '图算法最短路松弛过程'),
    assert: assertTeachingVisualization
  }
];

export const runStudioContractFixtures = () => {
  const results = samples.map((sample) => {
    const context = contextFor(sample.templateId);
    const artifact = normalizeStudioArtifact(context, sample.raw);
    const rendered = renderStudioArtifact(artifact);
    const review = reviewStudioArtifact(context, artifact);
    sample.assert(artifact, rendered);
    if (!review.checks.length) throw new Error(`No review checks for ${sample.templateId}`);
    return {
      templateId: sample.templateId,
      artifactKind: artifact.artifactKind,
      renderedLength: rendered.length,
      reviewScore: review.score,
      passed: review.passed
    };
  });
  return { ok: true, results };
};

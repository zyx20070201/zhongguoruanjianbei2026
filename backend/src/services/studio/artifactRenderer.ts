import {
  StudioArtifactKind,
  StudioGenerationContext,
  StudioSourceRef,
  StudioStructuredArtifact
} from './types';

const clip = (value: string | null | undefined, maxLength = 1200) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

export const sourceRefsFromContext = (context: StudioGenerationContext): StudioSourceRef[] => {
  const capsuleRefs = context.capsule.citations.slice(0, 12).map((citation) => ({
    sourceId: citation.sourceId,
    title: citation.label,
    fileId: citation.fileId,
    fileName: citation.fileName,
    locator: citation.locator ? { ...(citation.locator as any) } : undefined,
    snippet: citation.preview || citation.supportSnippets?.[0]?.text || '',
    confidence: citation.confidence
  }));
  const externalRefs = (context.enrichment?.resourceDiscovery?.results || []).slice(0, 12).map((result, index) => ({
    sourceId: `WEB${index + 1}`,
    title: result.title,
    locator: { url: result.url, provider: result.provider },
    snippet: result.summary || result.snippet || result.contentPreview || '',
    confidence: typeof result.score === 'number' && result.score >= 0.75 ? 'high' as const : 'medium' as const
  }));
  return [...capsuleRefs, ...externalRefs].slice(0, 18);
};

const learnerHints = (context: StudioGenerationContext) =>
  (context.learnerContext?.promptContext || '')
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);

const weakConcepts = (context: StudioGenerationContext) => {
  const text = context.learnerContext?.promptContext || '';
  const matches = [
    ...text.matchAll(/(?:weak knowledge|weak areas|薄弱|短板|错因|错误)[：:\s-]*([^\n。；;]+)/gi)
  ];
  return matches.map((match) => clip(match[1], 80)).filter(Boolean).slice(0, 5);
};

export const createArtifactEnvelope = <TPayload extends Record<string, unknown>>(
  context: StudioGenerationContext,
  artifactKind: StudioArtifactKind,
  payload: TPayload,
  fallbackTitle?: string,
  fallbackSummary?: string
): StudioStructuredArtifact<TPayload> => ({
  schemaVersion: 'studio_artifact.v1',
  artifactKind,
  title: clip(fallbackTitle || context.input.prompt || context.template.title, 160),
  summary: clip(fallbackSummary || context.template.description, 400),
  goal: context.template.goal,
  templateId: context.template.id,
  templateVersion: context.template.version || '1.0.0',
  generatorKind: context.template.generator,
  generatorVersion: '1.0.0',
  renderer: context.template.renderer,
  payload,
  sourceRefs: sourceRefsFromContext(context),
  personalization: {
    learnerHints: learnerHints(context),
    targetDifficulty: String(context.input.options?.difficulty || context.template.defaultOptions?.difficulty || 'adaptive'),
    weakConcepts: weakConcepts(context),
    recommendationReason: context.recommendation?.reason
  },
  nextActions: [
    '检查资源是否覆盖当前学习目标。',
    '使用资源完成一次自测或复盘。',
    '根据结果继续生成练习、卡片或学习计划。'
  ]
});

const sourceSection = (artifact: StudioStructuredArtifact) =>
  [
    '## 来源依据',
    artifact.sourceRefs.length
      ? artifact.sourceRefs
          .map((ref) => `- ${ref.sourceId ? `[${ref.sourceId}] ` : ''}${ref.title}${ref.confidence ? ` (${ref.confidence})` : ''}`)
          .join('\n')
      : '- 当前没有可用来源编号。'
  ].join('\n');

const personalizationSection = (artifact: StudioStructuredArtifact) =>
  [
    '## 个性化依据',
    artifact.personalization.weakConcepts.length
      ? `- 重点照顾薄弱点：${artifact.personalization.weakConcepts.join('、')}`
      : '- 当前没有稳定薄弱点结论，按自适应难度生成。',
    artifact.personalization.targetDifficulty ? `- 难度：${artifact.personalization.targetDifficulty}` : '',
    artifact.personalization.recommendationReason ? `- 推荐理由：${artifact.personalization.recommendationReason}` : ''
  ].filter(Boolean).join('\n');

const renderText = (artifact: StudioStructuredArtifact<any>) => {
  const payload = artifact.payload || {};
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const trace = payload.processTrace;
  const mapping = payload.visualMapping;
  const rawContent = typeof payload.rawContent === 'string' ? payload.rawContent.trim() : '';
  if ((artifact.templateId === 'resource_to_notes' || artifact.templateId === 'pagelm_cornell_notes' || artifact.templateId === 'pure_markdown_notes' || artifact.templateId === 'resource_compare') && rawContent) {
    return [
      rawContent,
      '',
      sourceSection(artifact)
    ].filter(Boolean).join('\n');
  }
  return [
    `# ${artifact.title}`,
    '',
    artifact.summary,
    '',
    ...sections.map((section: any) =>
      [`## ${section.title || '内容'}`, section.body || '', Array.isArray(section.bullets) ? section.bullets.map((item: string) => `- ${item}`).join('\n') : '']
        .filter(Boolean)
        .join('\n')
    ),
    trace && mapping
      ? [
          '## Process Trace IR',
          `- Domain: ${trace.domain || 'unknown'}`,
          `- Steps: ${Array.isArray(trace.steps) ? trace.steps.length : 0}`,
          `- Primitives: ${Array.isArray(trace.stateModel?.primitives) ? trace.stateModel.primitives.map((primitive: any) => `${primitive.kind}:${primitive.id}`).join(', ') : 'none'}`,
          '',
          '## Visual Mapping IR',
          Array.isArray(mapping.views) ? mapping.views.map((view: any) => `- ${view.title || view.id}: ${view.kind} -> ${view.primitiveId}`).join('\n') : '- none'
        ].join('\n')
      : '',
    '',
    personalizationSection(artifact),
    '',
    sourceSection(artifact),
    '',
    '## 下一步',
    artifact.nextActions.map((action) => `- ${action}`).join('\n')
  ].filter(Boolean).join('\n');
};

const renderQuiz = (artifact: StudioStructuredArtifact<any>) =>
  JSON.stringify(
    {
      title: artifact.title,
      summary: artifact.summary,
      questions: Array.isArray(artifact.payload.questions) ? artifact.payload.questions : [],
      sourceRefs: artifact.sourceRefs,
      personalization: artifact.personalization
    },
    null,
    2
  );

const renderMindMap = (artifact: StudioStructuredArtifact<any>) => {
  const payload = artifact.payload || {};
  return [
    payload.mermaid || '',
    '',
    '```concept_graph',
    JSON.stringify(payload.conceptGraph || { nodes: [], links: [] }, null, 2),
    '```',
    '',
    '## 大纲',
    Array.isArray(payload.outline) ? payload.outline.map((item: string) => `- ${item}`).join('\n') : '',
    '',
    personalizationSection(artifact),
    '',
    sourceSection(artifact)
  ].filter(Boolean).join('\n');
};

const renderFlashcards = (artifact: StudioStructuredArtifact<any>) => {
  const cards = Array.isArray(artifact.payload.cards) ? artifact.payload.cards : [];
  return [
    `# ${artifact.title}`,
    '',
    artifact.summary,
    '',
    ...cards.map((card: any, index: number) =>
      [
        `## Card ${index + 1}: ${card.concept || card.front?.slice?.(0, 60) || 'Review'}`,
        '',
        `Front: ${card.front || ''}`,
        '',
        `Back: ${card.back || ''}`,
      ].filter(Boolean).join('\n')
    ),
    '',
    personalizationSection(artifact),
    '',
    sourceSection(artifact)
  ].join('\n');
};

const renderCodeLab = (artifact: StudioStructuredArtifact<any>) => {
  const payload = artifact.payload || {};
  const problem = payload.problem || {};
  const editor = payload.editor || {};
  const guide = payload.guide || {};
  const tests = payload.tests || {};
  const solution = payload.solution || {};
  const examples = Array.isArray(problem.examples) ? problem.examples : [];
  const cases = Array.isArray(tests.cases) ? tests.cases : [];
  return [
    `# ${artifact.title}`,
    '',
    artifact.summary,
    '',
    '## 题目',
    problem.statementMarkdown || '',
    '',
    examples.length ? '## 示例' : '',
    ...examples.map((example: any, index: number) =>
      [
        `### 示例 ${index + 1}`,
        '',
        'Input:',
        '```text',
        example.input || '',
        '```',
        '',
        'Output:',
        '```text',
        example.output || '',
        '```',
        example.explanation ? `\n${example.explanation}` : ''
      ].filter(Boolean).join('\n')
    ),
    '',
    Array.isArray(problem.constraints) && problem.constraints.length ? '## 约束' : '',
    Array.isArray(problem.constraints) ? problem.constraints.map((item: string) => `- ${item}`).join('\n') : '',
    '',
    '## Starter Code',
    '```' + (editor.language || ''),
    editor.starterCode || '',
    '```',
    '',
    cases.length ? '## Test Cases' : '',
    ...cases.map((test: any, index: number) =>
      [
        `### ${test.name || `Case ${index + 1}`}`,
        '',
        'Input:',
        '```text',
        test.stdin || '',
        '```',
        '',
        'Expected Output:',
        '```text',
        test.expectedStdout || '',
        '```',
        test.explanation ? `\n${test.explanation}` : ''
      ].filter(Boolean).join('\n')
    ),
    '',
    Array.isArray(guide.hints) && guide.hints.length ? '## 提示' : '',
    Array.isArray(guide.hints) ? guide.hints.map((hint: string) => `- ${hint}`).join('\n') : '',
    '',
    Array.isArray(guide.acceptanceCriteria) && guide.acceptanceCriteria.length ? '## 验收标准' : '',
    Array.isArray(guide.acceptanceCriteria) ? guide.acceptanceCriteria.map((item: string) => `- ${item}`).join('\n') : '',
    '',
    '## 题解',
    solution.approachMarkdown || '',
    solution.complexity ? `\nComplexity: ${solution.complexity}` : '',
    solution.referenceCode ? ['\n### Reference Code', '```' + (editor.language || ''), solution.referenceCode, '```'].join('\n') : '',
    '',
    personalizationSection(artifact),
    '',
    sourceSection(artifact)
  ].filter(Boolean).join('\n');
};

const renderSlides = (artifact: StudioStructuredArtifact<any>) => {
  const slides = Array.isArray(artifact.payload.slides) ? artifact.payload.slides : [];
  return [
    ...slides.map((slide: any) =>
      [
        `# ${slide.title || artifact.title}`,
        '',
        Array.isArray(slide.bullets) ? slide.bullets.map((item: string) => `- ${item}`).join('\n') : '',
        '',
        slide.notes ? `Notes: ${slide.notes}` : '',
        '',
        slide.visual ? `Visual: ${slide.visual}` : ''
      ].filter(Boolean).join('\n')
    ).join('\n\n---\n\n'),
    '',
    sourceSection(artifact)
  ].filter(Boolean).join('\n');
};

const renderVisualExplainer = (artifact: StudioStructuredArtifact<any>) => {
  const payload = artifact.payload || {};
  if (payload.schemaVersion === 'visual_code_lesson.v1') {
    return [
      payload.contentMarkdown || '',
      '',
      personalizationSection(artifact),
      '',
      sourceSection(artifact)
    ].filter(Boolean).join('\n');
  }
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  return [
    `# ${payload.title || artifact.title}`,
    '',
    payload.summary || artifact.summary,
    '',
    '## Markdown Draft',
    payload.markdownDraft || '',
    '',
    '## Visual Sections',
    ...sections.map((section: any, index: number) =>
      [
        `### ${index + 1}. ${section.title || 'Section'}`,
        section.focus ? `Focus: ${section.focus}` : '',
        section.visualMode ? `Visual mode: ${section.visualMode}` : '',
        '',
        'Screen text:',
        Array.isArray(section.screenText) ? section.screenText.map((item: string) => `- ${item}`).join('\n') : '',
        '',
        'Timeline:',
        Array.isArray(section.timeline)
          ? section.timeline.map((step: any, stepIndex: number) =>
              `${stepIndex + 1}. ${step.action || 'focus'} ${Array.isArray(step.targetIds) ? step.targetIds.join(', ') : ''} - ${step.narration || ''}`
            ).join('\n')
          : '',
        section.checkQuestion ? `\nCheck: ${section.checkQuestion}` : ''
      ].filter(Boolean).join('\n')
    ),
    '',
    personalizationSection(artifact),
    '',
    sourceSection(artifact)
  ].filter(Boolean).join('\n');
};

const renderVideoScript = (artifact: StudioStructuredArtifact<any>) => {
  const scenes = Array.isArray(artifact.payload.scenes) ? artifact.payload.scenes : [];
  return [
    `# ${artifact.title}`,
    '',
    artifact.summary,
    '',
    '| 时间 | 画面 | 旁白 | 互动 |',
    '| --- | --- | --- | --- |',
    ...scenes.map((scene: any) => `| ${scene.time || ''} | ${scene.visual || ''} | ${scene.narration || ''} | ${scene.interaction || ''} |`),
    '',
    personalizationSection(artifact),
    '',
    sourceSection(artifact)
  ].join('\n');
};

const renderHyperFramesVideo = (artifact: StudioStructuredArtifact<any>) => {
  const payload = artifact.payload || {};
  const scenes = Array.isArray(payload.scenes) ? payload.scenes : [];
  return [
    `# ${payload.title || artifact.title}`,
    '',
    payload.summary || artifact.summary,
    '',
    `- Duration: ${payload.durationSeconds || 60}s`,
    `- Renderer: HyperFrames`,
    '',
    '| Start | Duration | Headline | Caption | Visual |',
    '| --- | --- | --- | --- | --- |',
    ...scenes.map((scene: any) =>
      `| ${scene.start ?? ''}s | ${scene.duration ?? ''}s | ${scene.headline || scene.title || ''} | ${scene.caption || ''} | ${scene.visual || ''} |`
    ),
    '',
    personalizationSection(artifact),
    '',
    sourceSection(artifact)
  ].join('\n');
};

const renderStudyPlan = (artifact: StudioStructuredArtifact<any>) => {
  const payload = artifact.payload || {};
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  return [
    `# ${artifact.title}`,
    '',
    artifact.summary,
    '',
    payload.parentPlan?.objective ? `> 父规划：${payload.parentPlan.objective}` : '',
    payload.objective ? `> 子规划目标：${payload.objective}` : '',
    '',
    '## 战术任务',
    tasks.map((task: any, index: number) => [
      `### ${index + 1}. ${task.title || '学习任务'}`,
      task.day ? `- 时间：${task.day}` : '',
      task.action ? `- 行动：${task.action}` : '',
      task.resources ? `- 使用资源：${task.resources}` : '',
      task.acceptance ? `- 验收标准：${task.acceptance}` : '',
      task.feedback ? `- 反馈回写：${task.feedback}` : ''
    ].filter(Boolean).join('\n')).join('\n\n'),
    '',
    '## 风险与调整',
    Array.isArray(payload.risks) ? payload.risks.map((risk: string) => `- ${risk}`).join('\n') : '',
    '',
    '## 复盘问题',
    Array.isArray(payload.reflectionQuestions) ? payload.reflectionQuestions.map((question: string) => `- ${question}`).join('\n') : '',
    '',
    personalizationSection(artifact),
    '',
    sourceSection(artifact)
  ].filter(Boolean).join('\n');
};

const renderLightVisualLesson = (artifact: StudioStructuredArtifact<any>) => {
  const payload = artifact.payload || {};
  const slides = Array.isArray(payload.slides) ? payload.slides : [];
  return [
    `# ${payload.title || artifact.title}`,
    '',
    artifact.summary,
    '',
    ...slides.flatMap((slide: any, index: number) => {
      const timeline = Array.isArray(slide?.timeline) ? slide.timeline : [];
      const visuals = Array.isArray(slide?.visuals) ? slide.visuals : [];
      return [
        `## Slide ${index + 1}: ${slide?.header || `Slide ${index + 1}`}`,
        '',
        slide?.description || '',
        '',
        timeline.length ? '### Timeline' : '',
        ...timeline.map((step: any, stepIndex: number) => `${step?.kind === 'visual' ? `${stepIndex + 1}. [Visual]` : `${stepIndex + 1}.`} ${step?.content || ''}`),
        '',
        visuals.length ? '### Visuals (Mock)' : '',
        ...visuals.map((visual: any, visualIndex: number) => `- ${visualIndex}. ${visual?.type || 'diagram'}: ${visual?.content || ''}`),
        ''
      ].filter(Boolean);
    }),
    personalizationSection(artifact),
    '',
    sourceSection(artifact)
  ].join('\n');
};

export const renderStudioArtifact = (artifact: StudioStructuredArtifact) => {
  if (artifact.artifactKind === 'quiz') return renderQuiz(artifact);
  if (artifact.artifactKind === 'mind_map') return renderMindMap(artifact);
  if (artifact.artifactKind === 'flashcards') return renderFlashcards(artifact);
  if (artifact.artifactKind === 'code_lab') return renderCodeLab(artifact);
  if (artifact.artifactKind === 'slides') return renderSlides(artifact);
  if (artifact.artifactKind === 'light_visual_lesson') return renderLightVisualLesson(artifact);
  if (artifact.artifactKind === 'visual_explainer') return renderVisualExplainer(artifact);
  if (artifact.artifactKind === 'video_script') return renderVideoScript(artifact);
  if (artifact.artifactKind === 'hyperframes_video') return renderHyperFramesVideo(artifact);
  if (artifact.artifactKind === 'interactive_demo') return renderText(artifact);
  if (artifact.artifactKind === 'animation_script') return renderText(artifact);
  if (artifact.artifactKind === 'ui_video') return renderText(artifact);
  if (artifact.artifactKind === 'study_plan') return renderStudyPlan(artifact);
  return renderText(artifact);
};

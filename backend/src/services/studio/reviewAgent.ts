import { StudioGenerationContext, StudioReviewResult, StudioStructuredArtifact } from './types';
import { validateTeachingVisualizationIR } from './visualizationIr';

const check = (
  id: string,
  label: string,
  passed: boolean,
  severity: 'info' | 'warning' | 'error',
  message: string
) => ({ id, label, passed, severity, message });

const sourceRefCount = (artifact: StudioStructuredArtifact) => artifact.sourceRefs.filter((ref) => ref.title || ref.sourceId).length;

const payloadSize = (artifact: StudioStructuredArtifact) => {
  try {
    return JSON.stringify(artifact.payload || {}).length;
  } catch {
    return 0;
  }
};

const quizChecks = (artifact: StudioStructuredArtifact<any>) => {
  const questions = Array.isArray(artifact.payload.questions) ? artifact.payload.questions : [];
  const optionIssues = questions.filter((question: any) =>
    ['single_choice', 'multiple_choice', 'true_false'].includes(String(question.type)) &&
    (!Array.isArray(question.options) || question.options.length !== 4)
  ).length;
  const missingRubric = questions.filter((question: any) => !question.rubric && !question.explanation).length;
  return [
    check('quiz.questions', '题目数量', questions.length > 0, 'error', questions.length ? `包含 ${questions.length} 道题。` : '没有可用题目。'),
    check('quiz.options', '选择题选项', optionIssues === 0, 'warning', optionIssues ? `${optionIssues} 道选择题选项不足。` : '选择题选项结构正常。'),
    check('quiz.rubric', '评分说明', missingRubric === 0, 'warning', missingRubric ? `${missingRubric} 道题缺少 rubric/解析。` : '题目包含评分或解析依据。')
  ];
};

const visualizationContractChecks = (contract: ReturnType<typeof validateTeachingVisualizationIR> | null) => {
  const coverageRatio = contract?.metrics.visualElementCount
    ? contract.metrics.coveredElementCount / contract.metrics.visualElementCount
    : 0;
  const changedFrames = contract?.diff.frames.filter((frame) => frame.changes.length > 0).length || 0;
  return [
    check('ir.contract', 'IR Contract', Boolean(contract?.valid), 'error', contract ? `${contract.metrics.stepCount} steps, ${contract.metrics.primitiveCount} primitive(s), ${contract.issues.length} issue(s).` : '缺少教学可视化 IR。'),
    check('ir.runtime', 'Trace Runtime', Boolean(contract && contract.metrics.frameCount === contract.metrics.stepCount), 'warning', contract ? `${contract.metrics.frameCount} trace frame(s), ${contract.metrics.rendererFrameCount} renderer frame(s).` : '无法执行过程轨迹。'),
    check('ir.mapping', 'Renderer Mapping', Boolean(contract && contract.metrics.mappedPrimitiveCount > 0), 'warning', contract ? `覆盖 ${contract.metrics.mappedPrimitiveCount}/${contract.metrics.primitiveCount} primitive(s).` : '缺少渲染映射。'),
    check('ir.targets', 'Target Chain', Boolean(contract && contract.metrics.danglingTargetCount === 0), 'error', contract ? `${contract.metrics.danglingTargetCount} dangling target(s).` : '无法校验 targetId/sourceId 链路。'),
    check('ir.coverage', 'Visual Coverage', Boolean(contract && coverageRatio >= 0.55), 'warning', contract ? `visual element coverage=${Math.round(coverageRatio * 100)}%.` : '缺少 coverage report。'),
    check('ir.diff', 'Trace Diff', Boolean(contract && changedFrames >= Math.max(1, contract.metrics.stepCount - 1)), 'warning', contract ? `${changedFrames}/${contract.metrics.stepCount} frame(s) contain state changes.` : '缺少 trace diff。')
  ];
};

const visualizationContractFor = (artifact: StudioStructuredArtifact<any>) =>
  artifact.payload.teachingPlan && artifact.payload.processTrace && artifact.payload.visualMapping
    ? validateTeachingVisualizationIR({
        teachingPlan: artifact.payload.teachingPlan,
        processTrace: artifact.payload.processTrace,
        visualMapping: artifact.payload.visualMapping
      })
    : null;

const kindSpecificChecks = (artifact: StudioStructuredArtifact<any>) => {
  if (artifact.artifactKind === 'quiz') return quizChecks(artifact);
  if (artifact.artifactKind === 'mind_map') {
    const graph = artifact.payload.conceptGraph || {};
    const outline = Array.isArray(artifact.payload.outline) ? artifact.payload.outline : [];
    const graphEdges = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : [];
    return [
      check('mindmap.mermaid', 'Mermaid 图', Boolean(artifact.payload.mermaid), 'error', artifact.payload.mermaid ? '包含 Mermaid mindmap。' : '缺少 Mermaid mindmap。'),
      check('mindmap.graph', '概念图谱', Array.isArray(graph.nodes) && graph.nodes.length > 0, 'warning', Array.isArray(graph.nodes) ? `包含 ${graph.nodes.length} 个节点。` : '缺少 concept_graph 节点。'),
      check('mindmap.links', '横向关系', graphEdges.length >= 3, 'info', graphEdges.length ? `包含 ${graphEdges.length} 条概念关系。` : 'concept_graph 缺少概念关系。'),
      check('mindmap.outline', '层级大纲', outline.length >= 3, 'info', outline.length ? `包含 ${outline.length} 条大纲要点。` : '缺少可复习的大纲要点。')
    ];
  }
  if (artifact.artifactKind === 'code_lab') {
    const payload = artifact.payload || {};
    const editor = payload.editor || {};
    const tests = payload.tests || {};
    const cases = Array.isArray(tests.cases) ? tests.cases : [];
    return [
      check('lab.code', 'Starter Code', Boolean(editor.starterCode), 'warning', editor.starterCode ? '包含 Starter Code。' : '缺少 Starter Code。'),
      check('lab.tests', '测试用例', cases.length > 0, 'warning', cases.length ? `包含 ${cases.length} 个可执行测试用例。` : '缺少可执行测试用例。')
    ];
  }
  if (artifact.artifactKind === 'slides') {
    const slides = Array.isArray(artifact.payload.slides) ? artifact.payload.slides : [];
    const missingNotes = slides.filter((slide: any) => !slide.notes).length;
    const missingVisuals = slides.filter((slide: any) => !slide.visual).length;
    return [
      check('slides.count', '幻灯片页数', slides.length >= 3, 'warning', slides.length ? `包含 ${slides.length} 页。` : '没有可用幻灯片。'),
      check('slides.notes', '讲者备注', missingNotes === 0, 'info', missingNotes ? `${missingNotes} 页缺少讲者备注。` : '每页包含讲者备注。'),
      check('slides.visuals', '视觉建议', missingVisuals === 0, 'warning', missingVisuals ? `${missingVisuals} 页缺少视觉建议。` : '每页包含视觉建议。')
    ];
  }
  if (artifact.artifactKind === 'interactive_demo') {
    const controls = Array.isArray(artifact.payload.controls) ? artifact.payload.controls : [];
    const states = Array.isArray(artifact.payload.states) ? artifact.payload.states : [];
    const contract = visualizationContractFor(artifact);
    return [
      check('interactive.framework', '交互框架', artifact.payload.framework === 'p5.js', 'error', `framework=${artifact.payload.framework || 'unknown'}`),
      check('interactive.controls', '交互控件', controls.length >= 2, 'warning', controls.length ? `包含 ${controls.length} 个控件。` : '缺少参数控件。'),
      check('interactive.states', '状态步骤', states.length >= 3, 'warning', states.length ? `包含 ${states.length} 个状态步骤。` : '缺少状态步骤。'),
      ...visualizationContractChecks(contract)
    ];
  }
  if (artifact.artifactKind === 'animation_script') {
    const timeline = Array.isArray(artifact.payload.timeline) ? artifact.payload.timeline : [];
    const contract = visualizationContractFor(artifact);
    return [
      check('animation.framework', '动画框架', artifact.payload.framework === 'Manim', 'error', `framework=${artifact.payload.framework || 'unknown'}`),
      check('animation.scene', 'Scene 类', Boolean(artifact.payload.sceneClass), 'warning', artifact.payload.sceneClass ? `Scene=${artifact.payload.sceneClass}` : '缺少 Scene 类名。'),
      check('animation.timeline', '动画时间线', timeline.length >= 3, 'warning', timeline.length ? `包含 ${timeline.length} 个时间线片段。` : '缺少动画时间线。'),
      ...visualizationContractChecks(contract)
    ];
  }
  if (artifact.artifactKind === 'ui_video') {
    const storyboard = Array.isArray(artifact.payload.storyboard) ? artifact.payload.storyboard : [];
    const contract = visualizationContractFor(artifact);
    return [
      check('video.framework', '视频框架', artifact.payload.framework === 'Remotion', 'error', `framework=${artifact.payload.framework || 'unknown'}`),
      check('video.component', '视频组件', Boolean(artifact.payload.componentName), 'warning', artifact.payload.componentName ? `Component=${artifact.payload.componentName}` : '缺少 Remotion 组件名。'),
      check('video.storyboard', '分镜结构', storyboard.length >= 2, 'warning', storyboard.length ? `包含 ${storyboard.length} 个分镜。` : '缺少分镜结构。'),
      ...visualizationContractChecks(contract)
    ];
  }
  return [
    check('payload.content', '结构化内容', payloadSize(artifact) > 120, 'warning', payloadSize(artifact) > 120 ? '结构化内容充足。' : '结构化内容偏短。')
  ];
};

export const reviewStudioArtifact = (
  context: StudioGenerationContext,
  artifact: StudioStructuredArtifact,
  generatedWarnings: string[] = []
): StudioReviewResult => {
  const refs = sourceRefCount(artifact);
  const weakConcepts = artifact.personalization.weakConcepts.length;
  const checks = [
    check('schema.version', '结构化 Schema', artifact.schemaVersion === 'studio_artifact.v1', 'error', `schema=${artifact.schemaVersion}`),
    check('template.match', '模板一致性', artifact.templateId === context.template.id, 'error', `artifact=${artifact.templateId}, template=${context.template.id}`),
    check('source.refs', '来源覆盖', refs > 0, 'warning', refs ? `包含 ${refs} 个来源引用。` : '没有来源引用。'),
    check('personalization.hints', '个性化信号', artifact.personalization.learnerHints.length > 0 || weakConcepts > 0, 'info', weakConcepts ? `覆盖 ${weakConcepts} 个薄弱点。` : '未发现稳定个性化信号。'),
    check('next.actions', '后续行动', artifact.nextActions.length > 0, 'info', artifact.nextActions.length ? '包含后续学习建议。' : '缺少后续学习建议。'),
    ...kindSpecificChecks(artifact)
  ];
  for (const warning of generatedWarnings) {
    checks.push(check(`generator.warning.${checks.length}`, '生成器警告', false, 'warning', warning));
  }

  const failedErrors = checks.filter((item) => !item.passed && item.severity === 'error').length;
  const failedWarnings = checks.filter((item) => !item.passed && item.severity === 'warning').length;
  const metrics = {
    grounding: refs > 0 ? Math.min(1, 0.55 + refs * 0.08) : 0.28,
    schema: failedErrors ? 0.35 : 0.95,
    personalization: artifact.personalization.learnerHints.length || weakConcepts ? 0.82 : 0.55,
    pedagogicalFit: Math.max(0.4, 0.9 - failedWarnings * 0.08),
    usability: payloadSize(artifact) > 120 ? 0.86 : 0.48
  };
  const score = Math.max(
    0,
    Math.min(
      1,
      metrics.grounding * 0.24 +
        metrics.schema * 0.28 +
        metrics.personalization * 0.16 +
        metrics.pedagogicalFit * 0.2 +
        metrics.usability * 0.12
    )
  );
  const warnings = checks.filter((item) => !item.passed).map((item) => item.message);
  return {
    score,
    warnings,
    checks,
    metrics,
    passed: failedErrors === 0 && score >= 0.66,
    summary: warnings.length
      ? `Review completed: score=${score.toFixed(2)}, ${warnings.length} issue(s) need attention.`
      : `Review passed: score=${score.toFixed(2)}, schema and grounding checks look good.`
  };
};

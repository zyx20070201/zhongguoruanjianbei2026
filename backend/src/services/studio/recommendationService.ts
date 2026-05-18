import prisma from '../../config/db';
import { learnerStateContextAdapter } from '../learnerStateContextAdapter';
import { workbenchContextService } from '../contextSystemService';
import {
  StudioRecommendation,
  StudioRecommendInput,
  StudioResourceTemplate,
  StudioGoalCategory,
  StudioRecommendationFeatures
} from './types';
import { studioTemplateRegistry } from './templateRegistry';

const clip = (value: string | null | undefined, maxLength = 220) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const evidenceText = (items: Array<{ summary?: string; title?: string; payloadJson?: string; eventType?: string }>) =>
  items
    .map((item) => [item.eventType, item.title, item.summary, item.payloadJson].filter(Boolean).join(' '))
    .join('\n');

const computeTemplateScore = (
  template: StudioResourceTemplate,
  signals: Record<string, boolean>,
  features: StudioRecommendationFeatures,
  goal?: StudioGoalCategory
) => {
  let score = goal && template.goal === goal ? 30 : 0;
  for (const rule of template.recommendationRules || []) {
    const requirements = rule.when || [];
    if (!requirements.length || requirements.every((flag) => signals[flag])) {
      score += rule.priority;
    }
  }
  if (template.goal === 'practice') {
    score += Math.min(30, features.recentLowScoreCount * 8 + features.weakConceptCount * 4);
    if (features.quizRunCount === 0) score += 22;
  }
  if (template.goal === 'review') {
    score += Math.min(28, features.reviewPressureCount * 7 + features.weakConceptCount * 3);
  }
  if (template.goal === 'map') {
    score += Math.min(24, features.sourceCount * 4 + features.retrievedChunkCount);
  }
  if (template.goal === 'lab') {
    score += Math.min(32, features.codeSignalCount * 9);
  }
  if (template.goal === 'visualize') {
    score += Math.min(24, features.visualSignalCount * 8);
  }
  if (template.goal === 'understand') {
    score += Math.min(24, features.weakConceptCount * 5 + (features.thinEvidence ? 8 : 0));
  }
  if (!score) score = template.goal === 'practice' ? 20 : 10;
  return score;
};

const countMatches = (text: string, pattern: RegExp) => (text.match(pattern) || []).length;

const parseEvidencePayload = (payloadJson?: string | null) => {
  try {
    return JSON.parse(payloadJson || '{}');
  } catch {
    return {};
  }
};

const quizMasterySignals = (items: Array<{ payloadJson?: string | null }>) => {
  const quiz = items
    .map((item) => parseEvidencePayload(item.payloadJson))
    .filter((payload) => payload?.result && payload?.question);
  const scores = quiz
    .map((payload) => Number(payload.result?.score))
    .filter((score) => Number.isFinite(score));
  const concepts = quiz
    .flatMap((payload) => [
      payload.question?.conceptId,
      payload.question?.skill,
      ...(Array.isArray(payload.question?.knowledgePoints) ? payload.question.knowledgePoints : []),
      ...(Array.isArray(payload.result?.missingPoints) ? payload.result.missingPoints : [])
    ])
    .map((value) => clip(String(value || ''), 80))
    .filter(Boolean);
  const lowConcepts = quiz
    .filter((payload) => Number(payload.result?.score) < 0.66)
    .flatMap((payload) => [
      payload.question?.conceptId,
      payload.question?.skill,
      ...(Array.isArray(payload.question?.knowledgePoints) ? payload.question.knowledgePoints : [])
    ])
    .map((value) => clip(String(value || ''), 80))
    .filter(Boolean);
  const highConcepts = quiz
    .filter((payload) => Number(payload.result?.score) >= 0.82)
    .flatMap((payload) => [payload.question?.conceptId, payload.question?.skill])
    .map((value) => clip(String(value || ''), 80))
    .filter(Boolean);
  return {
    count: quiz.length,
    averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : undefined,
    weakConcepts: Array.from(new Set(lowConcepts.length ? lowConcepts : concepts)).slice(0, 8),
    masteredConcepts: Array.from(new Set(highConcepts)).slice(0, 8)
  };
};

const extractFeatures = (input: {
  evidenceText: string;
  eventText: string;
  learnerText: string;
  sourceCount: number;
  retrievedChunkCount: number;
  evidenceCount: number;
  eventCount: number;
  quizRunCount: number;
  generatedArtifactCount: number;
}): StudioRecommendationFeatures => {
  const text = [input.evidenceText, input.eventText, input.learnerText].join('\n');
  const recentLowScoreCount =
    countMatches(text, /score["=: ]+0(?:\.\d+)?|score["=: ]+0\.[0-6]|correct["=: ]+false|低分|错误|答错/gi);
  const weakConceptCount =
    countMatches(text, /weak|薄弱|短板|错因|mistake|misconception|安全序列|判断错误|不熟/gi);
  const reviewPressureCount = countMatches(text, /review|复习|遗忘|flashcard|卡片|间隔|due|retrievability|记忆/gi);
  const codeSignalCount = countMatches(text, /code|代码|debug|bug|function|class|算法|程序|typescript|java|python|starter/i);
  const visualSignalCount = countMatches(text, /visual|diagram|图|思维导图|可视化|结构|mermaid|graph/gi);
  return {
    evidenceCount: input.evidenceCount,
    eventCount: input.eventCount,
    quizRunCount: input.quizRunCount,
    generatedArtifactCount: input.generatedArtifactCount,
    sourceCount: input.sourceCount,
    retrievedChunkCount: input.retrievedChunkCount,
    weakConceptCount,
    reviewPressureCount,
    codeSignalCount,
    visualSignalCount,
    recentLowScoreCount,
    thinEvidence: input.evidenceCount < 3 && input.eventCount < 3
  };
};

const practiceScoreAdjustment = (template: StudioResourceTemplate, features: StudioRecommendationFeatures) => {
  if (template.goal !== 'practice' || typeof features.lastQuizAverageScore !== 'number') return 0;
  const score = features.lastQuizAverageScore;
  if (score < 0.55) {
    if (template.id === 'mistake_drill') return 42;
    if (template.id === 'diagnostic_quiz') return 30;
    if (template.id === 'mock_quiz') return -24;
  }
  if (score >= 0.55 && score < 0.8) {
    if (template.id === 'tiered_practice') return 38;
    if (template.id === 'mistake_drill') return features.lastQuizWeakConcepts?.length ? 22 : 0;
  }
  if (score >= 0.8) {
    if (template.id === 'mock_quiz') return 40;
    if (template.id === 'diagnostic_quiz') return -18;
  }
  return 0;
};

export class StudioRecommendationService {
  async recommend(input: StudioRecommendInput): Promise<{
    recommendations: StudioRecommendation[];
    signals: Record<string, boolean>;
    learnerContextPreview: string;
    features: StudioRecommendationFeatures;
  }> {
    const capsuleResult = await workbenchContextService.buildCapsule({
      context: {
        ...input.context,
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || input.context.workbenchId || null
      },
      messages: [{ role: 'user', content: 'Recommend the next AI Studio learning resource.' }]
    });

    const workbench = input.workbenchId
      ? await prisma.workbench.findFirst({ where: { id: input.workbenchId, workspaceId: input.workspaceId } })
      : null;
    const learnerContext = await learnerStateContextAdapter.build({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: workbench?.learningGoalId || null,
      audience: 'studio'
    });

    const [recentEvidence, recentEvents, quizRunCount, generatedArtifactCount] = await Promise.all([
      prisma.learnerEvidence.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.workbenchId ? { workbenchId: input.workbenchId } : {})
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      }).catch(() => []),
      prisma.learningEvent.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.workbenchId ? { workbenchId: input.workbenchId } : {})
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      }).catch(() => []),
      prisma.learningRun.count({
        where: {
          workspaceId: input.workspaceId,
          ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
          intent: 'ai_studio_generate',
          resultJson: { contains: 'quiz' }
        }
      }).catch(() => 0),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*) as count FROM "StudioArtifact" WHERE "workspaceId" = ? ${input.workbenchId ? 'AND "workbenchId" = ?' : ''}`,
        ...(input.workbenchId ? [input.workspaceId, input.workbenchId] : [input.workspaceId])
      ).then((rows) => Number(rows[0]?.count || 0)).catch(() => 0)
    ]);

    const eventsForText = recentEvents.map((event) => ({
      eventType: event.eventType,
      title: [event.objectType, event.objectId].filter(Boolean).join(':'),
      summary: event.cognitiveSignalsJson,
      payloadJson: event.payloadJson
    }));
    const evidenceForText = recentEvidence.map((item) => ({
      title: item.title,
      summary: item.summary,
      payloadJson: item.payloadJson
    }));
    const evidenceBlob = evidenceText(evidenceForText);
    const eventBlob = evidenceText(eventsForText);
    const features = extractFeatures({
      evidenceText: evidenceBlob,
      eventText: eventBlob,
      learnerText: learnerContext.promptContext,
      sourceCount: capsuleResult.capsule.citations.length,
      retrievedChunkCount: capsuleResult.capsule.retrievedChunks?.length || 0,
      evidenceCount: recentEvidence.length,
      eventCount: recentEvents.length,
      quizRunCount,
      generatedArtifactCount
    });
    const masterySignals = quizMasterySignals(evidenceForText);
    features.lastQuizAverageScore = masterySignals.averageScore;
    features.lastQuizWeakConcepts = masterySignals.weakConcepts;
    features.lastQuizMasteredConcepts = masterySignals.masteredConcepts;
    const signals: Record<string, boolean> = {
      no_diagnostic: features.quizRunCount === 0,
      weak_knowledge: features.weakConceptCount > 0 || features.recentLowScoreCount > 0,
      review_pressure: features.reviewPressureCount > 0,
      has_sources: capsuleResult.capsule.citations.length > 0 || (capsuleResult.capsule.retrievedChunks?.length || 0) > 0,
      code_context: features.codeSignalCount > 0,
      visual_preference: features.visualSignalCount > 0,
      thin_evidence: features.thinEvidence
    };

    const templates = studioTemplateRegistry.list(input.goal);
    const ranked = templates
      .map((template) => ({
        template,
        score: computeTemplateScore(template, signals, features, input.goal) + practiceScoreAdjustment(template, features)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const evidence: string[] = [];
    if (signals.no_diagnostic) evidence.push('还没有找到当前工作台的 AI Studio 测验生成记录。');
    if (signals.weak_knowledge) evidence.push(`近期学习证据中出现 ${features.weakConceptCount + features.recentLowScoreCount} 个薄弱/低分信号。`);
    if (signals.review_pressure) evidence.push(`学习状态中出现 ${features.reviewPressureCount} 个复习或记忆压力信号。`);
    if (signals.has_sources) evidence.push(`当前上下文包含 ${capsuleResult.capsule.citations.length} 个可引用来源。`);
    if (signals.code_context) evidence.push(`当前资料或问题包含 ${features.codeSignalCount} 个代码/算法实操信号。`);
    if (signals.visual_preference) evidence.push(`学习偏好或上下文包含 ${features.visualSignalCount} 个视觉化组织信号。`);
    if (signals.thin_evidence) evidence.push('当前学习证据较少，建议先用轻量诊断建立画像。');
    if (features.generatedArtifactCount) evidence.push(`已生成 ${features.generatedArtifactCount} 个 Studio Artifact，可继续派生资源。`);
    if (typeof features.lastQuizAverageScore === 'number') {
      evidence.unshift(`最近诊断平均得分 ${Math.round(features.lastQuizAverageScore * 100)}%，推荐会据此调整下一组练习。`);
    }
    if (features.lastQuizWeakConcepts?.length) {
      evidence.unshift(`最近诊断暴露薄弱点：${features.lastQuizWeakConcepts.slice(0, 3).join('、')}。`);
    }

    const recommendations = ranked.map(({ template, score }, index): StudioRecommendation => {
      const matchedRule = (template.recommendationRules || [])
        .filter((rule) => (rule.when || []).every((flag) => signals[flag]))
        .sort((a, b) => b.priority - a.priority)[0];
      return {
        id: `studio-rec-${template.id}`,
        goal: template.goal,
        templateId: template.id,
        title: index === 0 ? `推荐生成：${template.title}` : template.title,
        reason: matchedRule?.reason || template.recommendedUse || template.description,
        priority: score,
        evidence: evidence.slice(0, 5),
        actions: [
          { id: `generate-${template.id}`, label: `生成${template.shortTitle || template.title}`, templateId: template.id, goal: template.goal },
          ...ranked
            .filter((item) => item.template.id !== template.id)
            .slice(0, 2)
            .map((item) => ({
              id: `generate-${item.template.id}`,
              label: item.template.shortTitle || item.template.title,
              templateId: item.template.id,
              goal: item.template.goal
            }))
        ]
      };
    });

    return {
      recommendations,
      signals,
      features,
      learnerContextPreview: clip(learnerContext.promptContext, 800)
    };
  }
}

export const studioRecommendationService = new StudioRecommendationService();

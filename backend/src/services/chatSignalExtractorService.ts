import prisma from '../config/db';
import { aiModelProviderService } from './aiModelProviderService';
import { isPollutedLearningSignal, isToolGeneratedLearningRequest, sanitizeLearnerSignalText } from './learnerSignalSanitizer';
import { learnerProfileRepositoryService } from './learnerProfileRepositoryService';
import { learnerStateService, LearnerStateDimension } from './learnerStateService';
import { savedMemoryService } from './savedMemoryService';

export const CHAT_SIGNAL_EXTRACTOR_VERSION = 'chat-signal-extractor-v1.0';
export const CHAT_SIGNAL_EXTRACTOR_PROMPT_VERSION = 'chat-signal-extractor-prompt-2026-06-06';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatProfileClaim = {
  dimension:
    | 'learningBackground'
    | 'learningGoal'
    | 'knowledgeFoundation'
    | 'cognitiveStyle'
    | 'learningPreference'
    | 'errorPattern'
    | 'learningRisk'
    | 'metacognitiveStrategy'
    | 'supportNeed';
  claim: string;
  confidence: number;
  rationale: string;
  evidenceText?: string | null;
  sourceTaxonomy?: string | null;
  learnerStateDimension?: LearnerStateDimension | null;
  payload?: Record<string, unknown>;
};

export interface ChatSignalExtractionResult {
  savedMemoryCandidate: null | {
    text: string;
    category: string;
    confidence: number;
    reason: string;
    promotionPolicy: 'explicit_user_request' | 'ask_user_to_save' | 'do_not_save';
  };
  learnerStateSignals: Array<{
    taxonomy:
      | 'recent_topic'
      | 'active_learning_goal'
      | 'candidate_weak_concept'
      | 'stable_weak_concept'
      | 'explanation_preference'
      | 'review_pressure'
      | 'evidence_quality';
    value: string;
    confidence: number;
    rationale: string;
    dimension: LearnerStateDimension;
    payload: Record<string, unknown>;
  }>;
  profileClaims: ChatProfileClaim[];
  evidenceItems: Array<{ kind: string; text: string; confidence: number; rationale?: string | null }>;
  recentEventCandidates: Array<{ eventType: string; summary: string; confidence: number }>;
  conversationSummary: string;
  shouldAskUserToSave: boolean;
  askUserToSaveText?: string | null;
  rejectedCandidates: Array<{ text: string; reason: string }>;
  extractor: 'llm' | 'rules';
}

const clip = (value: string | null | undefined, maxLength = 600) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const latestUserMessage = (messages: ChatMessage[]) =>
  [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() || '';

const normalizeMemoryText = (value: string) =>
  value
    .replace(/^请你?记住[:：,，\s]*/i, '')
    .replace(/^记住[:：,，\s]*/i, '')
    .replace(/^以后(?:都|请|回答时|讲解时)?[:：,，\s]*/i, '以后')
    .replace(/[，,]?(?:请帮我|帮我|请你)?记住(?:一下)?(?:这个|该|上述|以上)?(?:讲解)?偏好?[。！？!?\s]*$/i, '')
    .replace(/(?:这个|该|上述|以上)?(?:讲解)?偏好也?请记住[。！？!?\s]*$/i, '')
    .replace(/[。！？!?\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const isUsefulMemoryText = (value: string) =>
  Boolean(value && value.length >= 4 && !/^[\s。！？!?.,，、]+$/.test(value) && !/^(这个|该|上述|以上)?(?:讲解)?偏好$/.test(value));

const explicitMemoryText = (message: string) => {
  const text = message.trim();
  const direct = text.match(/(?:请你?|帮我)?记住(?:一下)?[：:\s]*(.+)$/i);
  if (direct?.[1]) {
    const candidate = normalizeMemoryText(direct[1]);
    if (isUsefulMemoryText(candidate)) return candidate;
  }
  const sentenceBeforeRemember = text.match(/^(.{4,180}?)(?:请帮我|帮我|请你)?记住/i);
  if (sentenceBeforeRemember?.[1]) {
    const candidate = normalizeMemoryText(sentenceBeforeRemember[1]);
    if (isUsefulMemoryText(candidate)) return candidate;
  }
  if (/以后|之后|接下来|从现在开始/.test(text) && /我(?:更|比较)?喜欢|我偏好|不要再|请始终|总是|默认|最好/.test(text)) {
    return normalizeMemoryText(text);
  }
  if (/我(?:更|比较)?喜欢|我偏好/.test(text) && /记住|以后|默认|始终|最好/.test(text)) return normalizeMemoryText(text);
  return '';
};

const categorize = (text: string) => {
  if (/喜欢|偏好|prefer|例子|案例|代码|简洁|详细|不要|默认|最好/.test(text)) return 'preference';
  if (/正在|项目|使用|环境|系统|课程|专业/.test(text)) return 'background';
  return 'note';
};

const parseJsonObject = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || value;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object found in extractor response');
  return JSON.parse(raw.slice(start, end + 1));
};

const unique = (items: string[], limit = 6) => Array.from(new Set(items.map((item) => clip(item, 120)).filter(Boolean))).slice(0, limit);

const topicFromText = (text: string) => {
  const patterns = [
    /(?:讲讲|解释|介绍|说说|梳理|总结|理解|学习)\s*([^，。！？\n]{2,60})/,
    /(?:关于|围绕)\s*([^，。！？\n]{2,60})/,
    /([^，。！？\n]{2,50})(?:是什么|怎么理解|有什么区别)/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clip(match[1].replace(/的?(三个|几个|一些|例子|案例)$/g, ''), 80);
  }
  return '';
};

const preferenceSignals = (text: string) => {
  const signals: string[] = [];
  if (/例子|案例|示例|example/i.test(text)) signals.push('examples');
  if (/代码|实现|code|demo|项目/i.test(text)) signals.push('code_or_project');
  if (/图|图解|可视化|流程图|visual/i.test(text)) signals.push('visual_explanation');
  if (/题|练习|quiz|测验|刷题/i.test(text)) signals.push('practice_or_quiz');
  if (/一步一步|慢一点|详细|拆解|step/i.test(text)) signals.push('step_by_step');
  if (/简洁|快点|概括|总结|摘要/i.test(text)) signals.push('concise_summary');
  return unique(signals);
};

const learnerDimensionForTaxonomy = (taxonomy: string): LearnerStateDimension =>
  taxonomy === 'candidate_weak_concept' || taxonomy === 'stable_weak_concept'
    ? 'knowledgeState'
    : taxonomy === 'review_pressure'
      ? 'reviewPlanning'
      : taxonomy === 'explanation_preference'
        ? 'preferenceStyle'
        : 'profileBase';

const payloadForSignal = (taxonomy: string, valueText: string) =>
  taxonomy === 'recent_topic'
    ? { recentTopics: [valueText], transientTopicSignals: [{ topic: valueText, source: 'extractor' }] }
    : taxonomy === 'active_learning_goal'
      ? { activeLearningGoalSignals: [valueText] }
      : taxonomy === 'explanation_preference'
        ? { tentativeResourcePreferences: [valueText], explanationPreferenceSignals: [{ preference: valueText, source: 'extractor' }] }
        : taxonomy === 'candidate_weak_concept'
          ? { candidateWeakSkills: [valueText], weakSkillSignals: [{ concept: valueText, source: 'extractor', strength: 'weak' }] }
          : taxonomy === 'stable_weak_concept'
            ? { weakSkills: [valueText], stableWeaknessEvidence: [{ concept: valueText, source: 'extractor' }] }
            : taxonomy === 'review_pressure'
              ? { reviewPressureSignals: [valueText] }
              : { evidenceQualitySignals: [valueText] };

const profileDimensionForSignal = (taxonomy: string): ChatProfileClaim['dimension'] =>
  taxonomy === 'active_learning_goal' || taxonomy === 'recent_topic'
    ? 'learningGoal'
    : taxonomy === 'candidate_weak_concept' || taxonomy === 'stable_weak_concept'
      ? 'knowledgeFoundation'
      : taxonomy === 'explanation_preference'
        ? 'learningPreference'
        : taxonomy === 'review_pressure'
          ? 'supportNeed'
          : 'metacognitiveStrategy';

const claimFromSignal = (signal: ChatSignalExtractionResult['learnerStateSignals'][number]): ChatProfileClaim => ({
  dimension: profileDimensionForSignal(signal.taxonomy),
  claim: signal.value,
  confidence: signal.confidence,
  rationale: signal.rationale,
  evidenceText: signal.value,
  sourceTaxonomy: signal.taxonomy,
  learnerStateDimension: signal.dimension,
  payload: signal.payload
});

const buildRuleExtraction = (messages: ChatMessage[], answer?: string): ChatSignalExtractionResult => {
  const userMessage = latestUserMessage(messages);
  const signalText = sanitizeLearnerSignalText(userMessage);
  const suppressed = !signalText || isToolGeneratedLearningRequest(userMessage);
  const explicitText = suppressed ? '' : clip(explicitMemoryText(signalText), 360);
  const topic = suppressed ? '' : topicFromText(signalText);
  const prefs = suppressed ? [] : preferenceSignals(signalText);
  const strongGoal = suppressed ? false : /目标|计划|准备|考试|项目|论文|复习|我想学|我要学|希望掌握|需要掌握/i.test(signalText);
  const signals: ChatSignalExtractionResult['learnerStateSignals'] = [];

  if (topic) {
    signals.push({
      taxonomy: 'recent_topic',
      value: topic,
      confidence: 0.42,
      rationale: 'Recent chat topic; never promote to saved memory by itself.',
      dimension: 'profileBase',
      payload: { recentTopics: [topic], transientTopicSignals: [{ topic, text: clip(signalText, 180), observedAt: new Date().toISOString() }] }
    });
  }

  if (strongGoal) {
    signals.push({
      taxonomy: 'active_learning_goal',
      value: clip(signalText, 180),
      confidence: 0.46,
      rationale: 'User expressed an intent with goal-like language; keep as active goal signal until confirmed.',
      dimension: 'profileBase',
      payload: { activeLearningGoalSignals: [clip(signalText, 180)] }
    });
  }

  prefs.forEach((preference) => {
    signals.push({
      taxonomy: 'explanation_preference',
      value: preference,
      confidence: explicitText ? 0.58 : 0.36,
      rationale: explicitText ? 'Preference appeared in a memory-like instruction.' : 'Single explanation preference signal.',
      dimension: 'preferenceStyle',
      payload: { tentativeResourcePreferences: [preference], explanationPreferenceSignals: [{ preference, text: clip(signalText, 180) }] }
    });
  });

  return {
    savedMemoryCandidate: explicitText
      ? {
          text: explicitText,
          category: categorize(explicitText),
          confidence: 0.95,
          reason: 'Explicit user request to remember.',
          promotionPolicy: 'explicit_user_request'
        }
      : null,
    learnerStateSignals: signals,
    profileClaims: signals.map(claimFromSignal),
    evidenceItems: suppressed ? [] : [{ kind: 'chat_turn', text: clip(signalText, 300), confidence: 0.5, rationale: 'Latest learner chat turn.' }],
    recentEventCandidates: suppressed ? [] : [{ eventType: 'ai.chat_turn', summary: clip(signalText, 180), confidence: 0.5 }],
    conversationSummary: suppressed
      ? 'Tool-generated learning request ignored for long-term memory and learner-state extraction.'
      : clip(`User asked: ${signalText}\nAssistant answered: ${answer || ''}`, 500),
    shouldAskUserToSave: false,
    askUserToSaveText: null,
    rejectedCandidates: explicitText
      ? []
      : [{ text: clip(userMessage, 160), reason: suppressed ? 'Tool-generated prompt, not a learner memory signal.' : 'No explicit long-term memory request.' }],
    extractor: 'rules'
  };
};

const coerceExtraction = (value: any, fallback: ChatSignalExtractionResult): ChatSignalExtractionResult => {
  const learnerStateSignals = (Array.isArray(value?.learnerStateSignals) ? value.learnerStateSignals : [])
    .map((signal: any) => {
      const taxonomy = String(signal.taxonomy || '');
      const valueText = clip(signal.value, 180);
      if (!taxonomy || !valueText || isPollutedLearningSignal(valueText)) return null;
      const dimension = learnerDimensionForTaxonomy(taxonomy);
      return {
        taxonomy,
        value: valueText,
        confidence: Math.max(0, Math.min(1, Number(signal.confidence ?? 0.4))),
        rationale: clip(signal.rationale || 'Extracted by chat signal extractor.', 220),
        dimension,
        payload: payloadForSignal(taxonomy, valueText)
      };
    })
    .filter(Boolean) as ChatSignalExtractionResult['learnerStateSignals'];

  const profileClaims = (Array.isArray(value?.profileClaims) ? value.profileClaims : [])
    .map((claim: any) => {
      const dimension = String(claim.dimension || '');
      const claimText = clip(claim.claim || claim.value || claim.title, 240);
      if (!claimText || !['learningBackground','learningGoal','knowledgeFoundation','cognitiveStyle','learningPreference','errorPattern','learningRisk','metacognitiveStrategy','supportNeed'].includes(dimension)) return null;
      return {
        dimension: dimension as ChatProfileClaim['dimension'],
        claim: claimText,
        confidence: Math.max(0, Math.min(1, Number(claim.confidence ?? 0.5))),
        rationale: clip(claim.rationale || 'Extracted from learning interaction.', 220),
        evidenceText: claim.evidenceText ? clip(claim.evidenceText, 240) : claimText,
        sourceTaxonomy: claim.sourceTaxonomy ? String(claim.sourceTaxonomy) : null,
        learnerStateDimension: claim.learnerStateDimension ? learnerDimensionForTaxonomy(String(claim.learnerStateDimension)) : null,
        payload: claim.payload && typeof claim.payload === 'object' ? claim.payload : {}
      };
    })
    .filter(Boolean) as ChatProfileClaim[];

  const candidateText = clip(value?.savedMemoryCandidate?.text, 360);
  const llmPromotionPolicy = value?.savedMemoryCandidate?.promotionPolicy || value?.savedMemoryCandidate?.promotion_policy;
  const llmCategory = String(value?.savedMemoryCandidate?.category || '');
  const llmCandidate = value?.savedMemoryCandidate && typeof value.savedMemoryCandidate === 'object' && isUsefulMemoryText(candidateText) && !isToolGeneratedLearningRequest(candidateText)
    ? {
        text: candidateText,
        category: ['preference', 'background', 'note'].includes(llmCategory) ? llmCategory : categorize(String(value.savedMemoryCandidate.text || '')),
        confidence: Math.max(0, Math.min(1, Number(value.savedMemoryCandidate.confidence ?? 0.7))),
        reason: clip(value.savedMemoryCandidate.reason || 'Extractor candidate.', 180),
        promotionPolicy:
          llmPromotionPolicy === 'explicit_user_request'
            ? 'explicit_user_request' as const
            : value.shouldAskUserToSave
              ? 'ask_user_to_save' as const
              : 'do_not_save' as const
      }
    : null;
  const candidate =
    llmCandidate?.text
      ? {
          ...llmCandidate,
          promotionPolicy:
            fallback.savedMemoryCandidate?.promotionPolicy === 'explicit_user_request'
              ? 'explicit_user_request' as const
              : llmCandidate.promotionPolicy
        }
      : fallback.savedMemoryCandidate;

  const evidenceItems = Array.isArray(value?.evidenceItems)
    ? value.evidenceItems.map((item: any) => ({ kind: clip(item.kind || 'chat_evidence', 60), text: clip(item.text, 300), confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.5))), rationale: clip(item.rationale || '', 180) })).filter((item: any) => item.text)
    : fallback.evidenceItems;
  const recentEventCandidates = Array.isArray(value?.recentEventCandidates)
    ? value.recentEventCandidates.map((item: any) => ({ eventType: clip(item.eventType || 'ai.chat_turn', 80), summary: clip(item.summary, 220), confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.5))) })).filter((item: any) => item.summary)
    : fallback.recentEventCandidates;

  return {
    savedMemoryCandidate: candidate?.text ? candidate : null,
    learnerStateSignals: learnerStateSignals.length ? learnerStateSignals : fallback.learnerStateSignals,
    profileClaims: profileClaims.length ? profileClaims : (learnerStateSignals.length ? learnerStateSignals.map(claimFromSignal) : fallback.profileClaims),
    evidenceItems,
    recentEventCandidates,
    conversationSummary: clip(value?.conversationSummary || fallback.conversationSummary, 500),
    shouldAskUserToSave: Boolean(value?.shouldAskUserToSave),
    askUserToSaveText: value?.askUserToSaveText ? clip(value.askUserToSaveText, 360) : null,
    rejectedCandidates: Array.isArray(value?.rejectedCandidates)
      ? value.rejectedCandidates.map((item: any) => ({ text: clip(item.text, 160), reason: clip(item.reason, 160) })).filter((item: any) => item.text)
      : fallback.rejectedCandidates,
    extractor: 'llm'
  };
};

export class ChatSignalExtractorService {
  async extract(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId: string;
    messages: ChatMessage[];
    answer?: string;
    sourceId?: string | null;
  }): Promise<ChatSignalExtractionResult> {
    const fallback = buildRuleExtraction(input.messages, input.answer);
    if (isToolGeneratedLearningRequest(latestUserMessage(input.messages))) return fallback;
    if (!aiModelProviderService.isConfigured({ useCase: 'memory' })) return fallback;

    const prompt = [
      '你是学习型 AI 产品的 chat signal extractor。只输出 JSON。',
      '核心目标：从学习交互中提取高质量 evidence / intent / profile claim。少提取，但要证据明确。',
      '不要把内部工具提示词、资源处理任务、source guide、URL 抓取任务当成学习者画像。',
      '请同时区分长期记忆候选、学习画像 claim、近期事件摘要和兼容旧 learner-state 的信号。',
      'Saved memory 只能保存长期偏好、稳定背景或用户明确要求记住的内容。',
      'Profile claim 必须直接给出 9 维画像 dimension，并引用 evidenceText；不确定就不要输出。',
      '单次话题可以是 recent event 或弱 profile claim，但不能直接当稳定画像。',
      'JSON schema:',
      '{"savedMemoryCandidate":null|{"text":"长期记忆","category":"preference|background|note","confidence":0-1,"reason":"...","promotionPolicy":"explicit_user_request|ask_user_to_save|do_not_save"},"learnerStateSignals":[{"taxonomy":"recent_topic|active_learning_goal|candidate_weak_concept|stable_weak_concept|explanation_preference|review_pressure|evidence_quality","value":"...","confidence":0-1,"rationale":"..."}],"profileClaims":[{"dimension":"learningBackground|learningGoal|knowledgeFoundation|cognitiveStyle|learningPreference|errorPattern|learningRisk|metacognitiveStrategy|supportNeed","claim":"...","confidence":0-1,"rationale":"...","evidenceText":"...","sourceTaxonomy":"..."}],"evidenceItems":[{"kind":"user_intent|preference|knowledge_signal|risk_signal|event","text":"...","confidence":0-1,"rationale":"..."}],"recentEventCandidates":[{"eventType":"ai.chat_turn|hint.used|quiz.answer_submitted|manual.profile_event","summary":"...","confidence":0-1}],"conversationSummary":"一句话摘要","shouldAskUserToSave":false,"askUserToSaveText":null,"rejectedCandidates":[{"text":"...","reason":"..."}]}',
      '',
      `Messages:\n${input.messages.map((message) => `${message.role}: ${clip(message.content, 1000)}`).join('\n')}`,
      '',
      `Assistant answer:\n${clip(input.answer, 1200)}`
    ].join('\n');

    try {
      const response = await aiModelProviderService.chat([{ role: 'user', content: prompt }], undefined, { timeoutMs: 20000, useCase: 'memory' });
      return coerceExtraction(parseJsonObject(response.reply), fallback);
    } catch {
      return fallback;
    }
  }

  async apply(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId: string;
    messages: ChatMessage[];
    answer?: string;
    sourceId?: string | null;
  }) {
    const extraction = await this.extract(input);
    const evidence = await learnerStateService.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      evidenceType: 'chat_signal_extraction',
      sourceType: 'ai_chat',
      sourceId: input.sourceId || null,
      actor: 'system',
      title: 'Chat signal extraction result',
      summary: extraction.conversationSummary,
      payload: {
        ...extraction,
        extractorVersion: CHAT_SIGNAL_EXTRACTOR_VERSION,
        promptVersion: CHAT_SIGNAL_EXTRACTOR_PROMPT_VERSION,
        model: aiModelProviderService.isConfigured({ useCase: 'memory' })
          ? aiModelProviderService.model(aiModelProviderService.provider({ useCase: 'memory' }), undefined, 'memory')
          : 'rules-fallback'
      },
      confidence: extraction.extractor === 'llm' ? 0.55 : 0.38
    });

    const profileCandidates = extraction.profileClaims
      .filter((claim) => claim.claim && claim.confidence >= 0.3)
      .map((claim) => ({
        id: `profile-claim:${evidence.id}:${claim.dimension}:${claim.claim}`,
        dimension: claim.dimension,
        type: claim.sourceTaxonomy || 'chatProfileClaim',
        title: claim.claim,
        description: claim.rationale || 'Profile claim extracted from learning interaction.',
        polarity:
          claim.dimension === 'learningRisk' || claim.dimension === 'supportNeed' || claim.dimension === 'errorPattern'
            ? 'need'
            : claim.dimension === 'learningPreference' || claim.dimension === 'cognitiveStyle'
              ? 'preference'
              : 'neutral',
        status: claim.confidence >= 0.62 ? 'active' : 'candidate',
        confidence: claim.confidence,
        evidence: [{
          id: evidence.id,
          sourceType: 'chat_signal_extraction',
          summary: claim.evidenceText || claim.claim,
          confidence: claim.confidence,
          observedAt: new Date().toISOString()
        }],
        payload: {
          schema: 'chat_profile_claim.v1',
          dimension: claim.dimension,
          sourceTaxonomy: claim.sourceTaxonomy || null,
          learnerStateDimension: claim.learnerStateDimension || null,
          rawPayload: claim.payload || {},
          rationale: claim.rationale
        }
      }));
    await learnerProfileRepositoryService.upsertCandidates({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      candidates: profileCandidates,
      sourcePipeline: 'chat_signal_extractor'
    });

    const patches = [];
    for (const signal of extraction.learnerStateSignals.filter((signal) => signal.confidence >= 0.3)) {
      patches.push(
        await learnerStateService.proposePatch({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          targetDimension: signal.dimension,
          operation: 'merge',
          proposedBy: `ChatSignalExtractor.${signal.taxonomy}`,
          payload: signal.payload,
          evidenceId: evidence.id,
          confidence: signal.confidence,
          rationale: signal.rationale
        })
      );
    }

    let savedMemory = null;
    if (extraction.savedMemoryCandidate?.promotionPolicy === 'explicit_user_request') {
      savedMemory = await savedMemoryService.upsert({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        userId: input.userId,
        text: extraction.savedMemoryCandidate.text,
        category: extraction.savedMemoryCandidate.category,
        source: 'explicit_user_request',
        confidence: extraction.savedMemoryCandidate.confidence
      });
    } else if (extraction.shouldAskUserToSave && extraction.savedMemoryCandidate?.text) {
      await prisma.learnerEvidence.create({
        data: {
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          evidenceType: 'saved_memory_prompt_candidate',
          sourceType: 'chat_signal_extractor',
          sourceId: evidence.id,
          actor: 'system',
          title: 'Ask user before saving memory',
          summary: extraction.savedMemoryCandidate.text,
          payloadJson: JSON.stringify({
            candidate: extraction.savedMemoryCandidate,
            askUserToSaveText: extraction.askUserToSaveText,
            extractorVersion: CHAT_SIGNAL_EXTRACTOR_VERSION,
            promptVersion: CHAT_SIGNAL_EXTRACTOR_PROMPT_VERSION
          }),
          confidence: extraction.savedMemoryCandidate.confidence
        }
      });
    }

    return {
      extraction,
      evidence,
      patches,
      savedMemory,
      distributedCandidates: {
        profileCandidates: { candidates: profileCandidates },
        memoryCandidate: extraction.savedMemoryCandidate || null
      }
    };
  }
}

export const chatSignalExtractorService = new ChatSignalExtractorService();

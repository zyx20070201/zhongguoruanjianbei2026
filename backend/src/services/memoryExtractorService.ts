import prisma from '../config/db';
import { deepseekService } from './deepseekService';
import { learnerStateService, LearnerStateDimension } from './learnerStateService';
import { savedMemoryService } from './savedMemoryService';

export const MEMORY_EXTRACTOR_VERSION = 'memory-extractor-v2.1';
export const MEMORY_EXTRACTOR_PROMPT_VERSION = 'memory-extractor-prompt-2026-05-08';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export interface MemoryExtractionResult {
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
    .replace(/\s+/g, ' ')
    .trim();

const explicitMemoryText = (message: string) => {
  const text = message.trim();
  const direct = text.match(/(?:请你?|帮我)?记住(?:一下)?[：:\s]*(.+)$/i);
  if (direct?.[1]) return normalizeMemoryText(direct[1]);
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

const buildRuleExtraction = (messages: ChatMessage[], answer?: string): MemoryExtractionResult => {
  const userMessage = latestUserMessage(messages);
  const explicitText = clip(explicitMemoryText(userMessage), 360);
  const topic = topicFromText(userMessage);
  const prefs = preferenceSignals(userMessage);
  const strongGoal = /目标|计划|准备|考试|项目|论文|复习|我想学|我要学|希望掌握|需要掌握/i.test(userMessage);
  const signals: MemoryExtractionResult['learnerStateSignals'] = [];

  if (topic) {
    signals.push({
      taxonomy: 'recent_topic',
      value: topic,
      confidence: 0.42,
      rationale: 'Recent chat topic; never promote to saved memory by itself.',
      dimension: 'profileBase',
      payload: { recentTopics: [topic], transientTopicSignals: [{ topic, text: clip(userMessage, 180), observedAt: new Date().toISOString() }] }
    });
  }

  if (strongGoal) {
    signals.push({
      taxonomy: 'active_learning_goal',
      value: clip(userMessage, 180),
      confidence: 0.46,
      rationale: 'User expressed an intent with goal-like language; keep as active goal signal until confirmed.',
      dimension: 'profileBase',
      payload: { activeLearningGoalSignals: [clip(userMessage, 180)] }
    });
  }

  prefs.forEach((preference) => {
    signals.push({
      taxonomy: 'explanation_preference',
      value: preference,
      confidence: explicitText ? 0.58 : 0.36,
      rationale: explicitText ? 'Preference appeared in a memory-like instruction.' : 'Single explanation preference signal.',
      dimension: 'preferenceStyle',
      payload: { tentativeResourcePreferences: [preference], explanationPreferenceSignals: [{ preference, text: clip(userMessage, 180) }] }
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
    conversationSummary: clip(`User asked: ${userMessage}\nAssistant answered: ${answer || ''}`, 500),
    shouldAskUserToSave: false,
    askUserToSaveText: null,
    rejectedCandidates: explicitText ? [] : [{ text: clip(userMessage, 160), reason: 'No explicit long-term memory request.' }],
    extractor: 'rules'
  };
};

const coerceExtraction = (value: any, fallback: MemoryExtractionResult): MemoryExtractionResult => {
  const rawSignals = Array.isArray(value?.learnerStateSignals) ? value.learnerStateSignals : [];
  const learnerStateSignals = rawSignals
    .map((signal: any) => {
      const taxonomy = String(signal.taxonomy || '');
      const valueText = clip(signal.value, 180);
      if (!taxonomy || !valueText) return null;
      const dimension: LearnerStateDimension =
        taxonomy === 'candidate_weak_concept' || taxonomy === 'stable_weak_concept'
          ? 'knowledgeState'
          : taxonomy === 'review_pressure'
            ? 'reviewPlanning'
            : taxonomy === 'explanation_preference'
              ? 'preferenceStyle'
              : 'profileBase';
      const payload =
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
      return {
        taxonomy,
        value: valueText,
        confidence: Math.max(0, Math.min(1, Number(signal.confidence ?? 0.4))),
        rationale: clip(signal.rationale || 'Extracted by memory extractor.', 220),
        dimension,
        payload
      };
    })
    .filter(Boolean) as MemoryExtractionResult['learnerStateSignals'];

  const candidate = value?.savedMemoryCandidate && typeof value.savedMemoryCandidate === 'object'
    ? {
        text: clip(value.savedMemoryCandidate.text, 360),
        category: categorize(String(value.savedMemoryCandidate.text || '')),
        confidence: Math.max(0, Math.min(1, Number(value.savedMemoryCandidate.confidence ?? 0.7))),
        reason: clip(value.savedMemoryCandidate.reason || 'Extractor candidate.', 180),
        promotionPolicy: value.shouldAskUserToSave ? 'ask_user_to_save' as const : 'do_not_save' as const
      }
    : fallback.savedMemoryCandidate;

  return {
    savedMemoryCandidate: candidate?.text ? candidate : null,
    learnerStateSignals: learnerStateSignals.length ? learnerStateSignals : fallback.learnerStateSignals,
    conversationSummary: clip(value?.conversationSummary || fallback.conversationSummary, 500),
    shouldAskUserToSave: Boolean(value?.shouldAskUserToSave),
    askUserToSaveText: value?.askUserToSaveText ? clip(value.askUserToSaveText, 360) : null,
    rejectedCandidates: Array.isArray(value?.rejectedCandidates)
      ? value.rejectedCandidates.map((item: any) => ({ text: clip(item.text, 160), reason: clip(item.reason, 160) })).filter((item: any) => item.text)
      : fallback.rejectedCandidates,
    extractor: 'llm'
  };
};

export class MemoryExtractorService {
  async extract(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId: string;
    messages: ChatMessage[];
    answer?: string;
    sourceId?: string | null;
  }): Promise<MemoryExtractionResult> {
    const fallback = buildRuleExtraction(input.messages, input.answer);
    if (!deepseekService.isConfigured()) return fallback;

    const prompt = [
      '你是学习型 AI 产品的 memory extractor。只输出 JSON。',
      '目标：少记但记准；区分 Saved Memories、Reference chat history 和 Learner State Signals。',
      'Saved memory 只能保存长期偏好、稳定背景或用户明确要求记住的内容。',
      '单次话题必须输出为 recent_topic，不能当 learning goal；只有用户明确说目标/考试/项目/计划/希望掌握时才输出 active_learning_goal。',
      '不要把 quiz/flashcard 弱项升级成 saved memory。',
      'JSON schema:',
      '{"savedMemoryCandidate":null|{"text":"自然语言长期记忆","category":"preference|background|note","confidence":0-1,"reason":"..."},"learnerStateSignals":[{"taxonomy":"recent_topic|active_learning_goal|candidate_weak_concept|stable_weak_concept|explanation_preference|review_pressure|evidence_quality","value":"自然语言或短标签","confidence":0-1,"rationale":"..."}],"conversationSummary":"一句话历史摘要","shouldAskUserToSave":false,"askUserToSaveText":null,"rejectedCandidates":[{"text":"...","reason":"..."}]}',
      '',
      `Messages:\n${input.messages.map((message) => `${message.role}: ${clip(message.content, 1000)}`).join('\n')}`,
      '',
      `Assistant answer:\n${clip(input.answer, 1200)}`
    ].join('\n');

    try {
      const response = await deepseekService.chat([{ role: 'user', content: prompt }], undefined, { timeoutMs: 20000 });
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
      evidenceType: 'memory_extraction',
      sourceType: 'ai_chat',
      sourceId: input.sourceId || null,
      actor: 'system',
      title: 'Memory extractor result',
      summary: extraction.conversationSummary,
      payload: {
        ...extraction,
        extractorVersion: MEMORY_EXTRACTOR_VERSION,
        promptVersion: MEMORY_EXTRACTOR_PROMPT_VERSION,
        model: deepseekService.isConfigured() ? process.env.DEEPSEEK_MODEL || 'deepseek-chat' : 'rules-fallback'
      },
      // Versioning is duplicated inside payload for easy offline eval exports.
      confidence: extraction.extractor === 'llm' ? 0.55 : 0.38
    });

    const patches = [];
    for (const signal of extraction.learnerStateSignals.filter((signal) => signal.confidence >= 0.3)) {
      patches.push(
        await learnerStateService.proposePatch({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          targetDimension: signal.dimension,
          operation: 'merge',
          proposedBy: `MemoryExtractor.${signal.taxonomy}`,
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
          sourceType: 'memory_extractor',
          sourceId: evidence.id,
          actor: 'system',
          title: 'Ask user before saving memory',
          summary: extraction.savedMemoryCandidate.text,
          payloadJson: JSON.stringify({
            candidate: extraction.savedMemoryCandidate,
            askUserToSaveText: extraction.askUserToSaveText,
            extractorVersion: MEMORY_EXTRACTOR_VERSION,
            promptVersion: MEMORY_EXTRACTOR_PROMPT_VERSION
          }),
          confidence: extraction.savedMemoryCandidate.confidence
        }
      });
    }

    return { extraction, evidence, patches, savedMemory };
  }
}

export const memoryExtractorService = new MemoryExtractorService();

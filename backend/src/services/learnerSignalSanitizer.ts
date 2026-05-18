const normalizeWhitespace = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();

const toolPromptPatterns = [
  /source\s*guide/i,
  /请为这个学习资源写一段/i,
  /只输出正文/i,
  /不要标题/i,
  /资源名称\s*[:：]/,
  /\bURL\s*[:：]/i,
  /spContent\s*=/i,
  /Pages\s+indexed/i,
  /Site\s+map/i,
  /Context\s+Capsule/i,
  /\bcourse_id\b/i,
  /\bquestion_types\b/i,
  /不要使用\s*mock/i,
  /真实\s*AI/i
];

const structuredPromptMarkers = [
  /资源名称\s*[:：]/,
  /\bURL\s*[:：]/i,
  /https?:\/\//i,
  /Pages\s+indexed/i,
  /Site\s+map/i,
  /spContent\s*=/i,
  /只输出正文/i,
  /不要标题/i
];

const genericConceptStoplist = new Set([
  '做中学',
  '学习资源',
  '知识点',
  '相关内容',
  '常见问题',
  '课程内容',
  '当前学习目标',
  '核心概念',
  '核心理解',
  '学习步骤',
  'untitled',
  'untitled document',
  'untitled note',
  '新建文档',
  '未命名',
  '无标题',
  'source guide'
]);

const stripKnownFileExtension = (value: string) =>
  value.replace(/\.(pdf|docx?|pptx?|xlsx?|csv|md|markdown|txt|html?|json|ya?ml|ts|tsx|js|jsx|java|py|cpp|c|h|go|rs|zip)$/i, '');

const normalizedConceptText = (value: string | null | undefined) =>
  normalizeWhitespace(stripKnownFileExtension(String(value || '').trim()));

const hasSemanticLetter = (value: string) => /[\p{Script=Han}A-Za-z]/u.test(value);

const hasCjk = (value: string) => /[\p{Script=Han}]/u.test(value);

const isKnownSymbolicConcept = (value: string) =>
  /^(c\+\+|c#|f#|r|go|sql|nosql|html|css|http\/2|http3?|tcp\/ip|udp|ip|dns|json|xml|yaml|b\+树|b-tree|b\+tree|a\*|o\(.+\)|np|p|ml|ai|nlp|cnn|rnn|lstm|gpt|bert)$/i.test(value.trim());

const resourceLabelPatterns = [
  /^untitled(?:[-_\s]*\d+)?$/i,
  /^未命名(?:[-_\s]*\d+)?$/,
  /^无标题(?:[-_\s]*\d+)?$/,
  /^新建(?:文档|笔记|文件)?(?:[-_\s]*\d+)?$/,
  /^note[-_\s]*\d{4}[-_]\d{1,2}[-_]\d{1,2}(?:[-_\s]\d+)?$/i,
  /^notes?[-_\s]*\d{4}[-_]\d{1,2}[-_]\d{1,2}(?:[-_\s]\d+)?$/i,
  /^(?:img|image|screenshot|screen shot|截屏|截图|录屏)[-_\s]*\d+/i,
  /^(?:file|document|doc|pdf|ppt|slide|chunk|block|resource|资料|文件|文档|笔记)[-_\s]*\d+$/i,
  /^\d{4}[-_]\d{1,2}[-_]\d{1,2}(?:[-_\s]\d+)?$/,
  /^\d{8,}(?:[-_]\d+)*$/,
  /^[a-f0-9]{12,}$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^(?:page|页|第\s*\d+\s*页|chunk|block|段落|行)\s*[\d-]+$/i
];

export const isLikelyResourceLabel = (value: string | null | undefined) => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const normalized = normalizedConceptText(raw);
  const lower = normalized.toLowerCase();
  if (!normalized) return false;
  if (resourceLabelPatterns.some((pattern) => pattern.test(normalized))) return true;
  if (!hasSemanticLetter(normalized) && /[\d_-]{3,}/.test(normalized)) return true;
  if (!hasCjk(normalized) && /^[a-z]{1,4}[-_ ]?\d{3,}$/i.test(normalized) && !isKnownSymbolicConcept(normalized)) return true;
  if (/^(?:copy|副本|版本|version|v)\s*[-_]?\s*\d+$/i.test(lower)) return true;
  return false;
};

export const isProbablyKnowledgeConcept = (value: string | null | undefined) => {
  const normalized = normalizedConceptText(value);
  if (!normalized) return false;
  if (isKnownSymbolicConcept(normalized)) return true;
  if (isPollutedLearningSignal(normalized)) return false;
  if (isLikelyResourceLabel(normalized)) return false;
  if (!hasSemanticLetter(normalized)) return false;
  if (normalized.length < 2 || normalized.length > 80) return false;
  const compact = normalized.replace(/[\s\-_./()[\]{}:：]+/g, '');
  if (compact.length < 2) return false;
  return true;
};

export const filterKnowledgeConcepts = (values: Array<string | null | undefined>, limit = 8) =>
  Array.from(new Set(values.map((value) => normalizedConceptText(value)).filter(isProbablyKnowledgeConcept))).slice(0, limit);

export const isToolGeneratedLearningRequest = (text: string | null | undefined, taskType?: string | null) => {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  const type = String(taskType || '').toLowerCase();
  if (/source[_-]?guide|resource[_-]?guide|resource[_-]?summary|context[_-]?capsule/.test(type)) return true;
  if (toolPromptPatterns.some((pattern) => pattern.test(raw))) return true;
  const markerCount = structuredPromptMarkers.filter((pattern) => pattern.test(raw)).length;
  if (raw.length > 500 && markerCount >= 2) return true;
  if (/请.*(?:生成|写|总结).*(?:学习资源|资源|guide)/i.test(raw) && markerCount >= 1) return true;
  return false;
};

export const sanitizeLearnerSignalText = (text: string | null | undefined, taskType?: string | null, maxLength = 900) => {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (isToolGeneratedLearningRequest(raw, taskType)) return '';
  return raw
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
};

export const isPollutedLearningSignal = (value: string | null | undefined) => {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const normalized = normalizeWhitespace(raw).toLowerCase();
  if (genericConceptStoplist.has(normalized)) return true;
  if (isLikelyResourceLabel(raw)) return true;
  if (raw.length > 120) return true;
  if (/[\r\n]/.test(raw)) return true;
  if (/https?:\/\//i.test(raw)) return true;
  if (toolPromptPatterns.some((pattern) => pattern.test(raw))) return true;
  if (/^(请|帮我|要求|输出|不要|只输出)/.test(raw)) return true;
  if (/[{}[\]<>]/.test(raw) && raw.length > 40) return true;
  return false;
};

export const filterCleanLearningSignals = (values: Array<string | null | undefined>, limit = 8) =>
  Array.from(new Set(values.map((value) => normalizeWhitespace(value)).filter((value) => !isPollutedLearningSignal(value)))).slice(0, limit);

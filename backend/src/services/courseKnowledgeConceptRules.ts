import { isProbablyKnowledgeConcept } from './learnerSignalSanitizer';

export const normalizeCourseConceptText = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();

export const stripCourseConceptNoise = (value: string) =>
  value
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)、]\s*/, '')
    .replace(/\*\*|__|`/g, '')
    .trim();

const genericCourseGraphLabels = /^(?:name|aid|viewport|utf-?8|zh-cn|segoe ui|width\s*=|initial-scale|youtube\.com|资源|来源依据|个性化依据|适用对象|核心内容|核心直觉|关键概念|复盘问题|战术任务|事件|读者|大纲|要什么|如何做|关系|计划|写故事|盖房子|教学目标|课程目标|学习目标|例题|示例|练习|作业|题目|问题|参考资料|参考文献)$/i;

const promptOrResourcePatterns = [
  /youtube\.com|digitalocean|hugging face|google for developers/i,
  /根据当前资料生成|提取关键概念|方便我|给我|帮我|写一段|只输出|不要标题|语言：|难度：|数量：|细节：/,
  /生成.*(?:概念讲解|检查问题|知识点|学习资源)|有来源依据|个性化学习资源|学习者$/,
  /^(?:功能|代码).*(?:完成|写了)\s*\d+%$/,
  /\.(?:pdf|docx?|pptx?|xlsx?|csv|md|markdown|txt|html?|json|ya?ml)$/i,
  /^(?:resource|file|path|overview|summary|slide|page|chapter|section|chunk|block)\b/i
];

const chineseTaskPrefixes = /^(?:检索|查询|查找|找出|列出|统计|计算|求出?|判断|写出|设计|实现|完成|选择|说明|给出|证明|分析|比较|讨论|回答|简述|画出|创建|删除|插入|更新)/;
const englishTaskPrefixes = /^(?:find|list|query|retrieve|calculate|compute|write|design|implement|explain|choose|select|prove|discuss|compare|answer|create|delete|insert|update)\b/i;

const exerciseSentencePatterns = [
  /(?:学生学号|学生姓名|课程号|课程名|教师号|教师名|选修|所授课程|至少选修|平均成绩|最高成绩|最低成绩|查询.*数据)/,
  /(?:自然语言|关系代数|sql)\s*(?:查询|语句|表达式)\s*[:：]?$/i,
  /(?:query\s+(?:practice|exercise|scenario|task)|practice|exercise|homework|assignment|question|scenario|task)\b/i,
  /(?:which|what|when|where|why|how)\b.+\?/i
];

export const isCourseConceptCandidate = (value: string | null | undefined) => {
  const text = stripCourseConceptNoise(normalizeCourseConceptText(value));
  if (!isProbablyKnowledgeConcept(text)) return false;
  if (genericCourseGraphLabels.test(text)) return false;
  if (promptOrResourcePatterns.some((pattern) => pattern.test(text))) return false;
  if (/[=<>]/.test(text)) return false;
  if (/[,，]/.test(text) && text.length > 28) return false;
  if (/[。！？?]/.test(text) && text.length > 24) return false;
  return true;
};

export const isStrictCourseKnowledgeConcept = (value: string | null | undefined) => {
  const text = stripCourseConceptNoise(normalizeCourseConceptText(value));
  if (!isCourseConceptCandidate(text)) return false;

  const compact = text.replace(/\s+/g, '');
  if (compact.length > 12 && chineseTaskPrefixes.test(compact)) return false;
  if (text.length > 22 && englishTaskPrefixes.test(text)) return false;
  if (exerciseSentencePatterns.some((pattern) => pattern.test(text)) && text.length > 10) return false;
  if (/[“”"']/.test(text) && chineseTaskPrefixes.test(compact)) return false;
  if (/(?:请|要求|需要|试|将|用).*(?:查询|检索|计算|写出|设计|实现|证明|说明|回答)/.test(text) && text.length > 12) return false;

  const cjkVerbCount = (text.match(/(?:检索|查询|查找|找出|列出|统计|计算|判断|写出|设计|实现|完成|选择|说明|给出|证明|分析|比较|讨论|回答|创建|删除|插入|更新)/g) || []).length;
  if (text.length > 18 && cjkVerbCount >= 2) return false;

  return true;
};

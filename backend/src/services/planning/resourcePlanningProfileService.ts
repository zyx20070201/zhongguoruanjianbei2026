import {
  LearningPlanTeachingPhase,
  ResourceLearningUnit,
  ResourcePlanningProfile,
  ResourcePlanningTeachingRole
} from '../planningTypes';
import { resourceLearningUnitService } from './resourceLearningUnitService';

const clip = (value: unknown, maxLength = 520) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const unique = (items: Array<string | null | undefined>, limit = 12) =>
  Array.from(new Set(items.map((item) => clip(item, 140)).filter(Boolean))).slice(0, limit);

const splitTerms = (value: string) =>
  value
    .split(/\s+|、|，|,|\/|;|；|:|：|\(|\)|（|）|\[|\]|【|】|-|_/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

const conceptsFromText = (...values: unknown[]) => {
  const text = values.map((value) => String(value || '')).join(' ');
  const quoted = Array.from(text.matchAll(/[「《]([^」》]{2,40})[」》]/g)).map((match) => match[1]);
  const labeled = Array.from(text.matchAll(/(?:概念|知识点|技能|主题|keywords?|concepts?)[:：]\s*([^。；;\n]+)/gi))
    .flatMap((match) => String(match[1]).split(/[、,，/;；]/g));
  const sqlTerms = Array.from(
    text.matchAll(/\b(SQL|SELECT|FROM|WHERE|ORDER BY|GROUP BY|HAVING|JOIN|INNER JOIN|LEFT JOIN|RIGHT JOIN|子查询|CTE|窗口函数|DDL|DML|索引|事务|ACID|主键|外键|关系模型|聚合函数)\b/gi)
  ).map((match) => match[0]);
  const titleTerms = splitTerms(text).filter((term) => /[A-Za-z]{3,}|[\u4e00-\u9fa5]{2,}/.test(term));
  return unique([...sqlTerms, ...quoted, ...labeled, ...titleTerms], 10);
};

const roleForUnit = (unit: ResourceLearningUnit): ResourcePlanningTeachingRole => {
  const text = `${unit.title} ${unit.summary} ${(unit.resourceSignals || []).join(' ')}`.toLowerCase();
  if (unit.modality === 'practice' || /练习|题|exercise|practice|作业|quiz/.test(text)) return 'practice';
  if (unit.modality === 'project' || /项目|project|case|案例|实战/.test(text)) return 'project';
  if (/例题|worked|example|示例|demo|walkthrough/.test(text)) return 'worked_example';
  if (unit.difficulty >= 4 || /advanced|高级|性能|优化|执行计划|索引|事务/.test(text)) return 'advanced_extension';
  if (unit.coverage === 'overview' || /参考|reference|概览|overview|目录/.test(text)) return 'reference';
  return 'concept_explanation';
};

const stagesForRole = (role: ResourcePlanningTeachingRole): LearningPlanTeachingPhase[] => {
  if (role === 'concept_explanation') return ['concept_model', 'prerequisite_bridge'];
  if (role === 'worked_example') return ['worked_example', 'guided_practice'];
  if (role === 'practice') return ['guided_practice', 'independent_practice', 'formative_assessment'];
  if (role === 'project') return ['project_application', 'independent_practice'];
  if (role === 'advanced_extension') return ['independent_practice', 'project_application'];
  return ['resource_grounding', 'concept_model'];
};

const learnerLevelForDifficulty = (difficulty: number): ResourcePlanningProfile['targetLearnerLevel'] => {
  if (difficulty <= 1.5) return 'novice';
  if (difficulty <= 2.5) return 'beginner';
  if (difficulty <= 3.5) return 'intermediate';
  return 'advanced';
};

const riskFlagsForUnit = (unit: ResourceLearningUnit, coveredSkills: string[]) => [
  unit.summary.length < 60 ? 'thin_summary' : '',
  coveredSkills.length === 0 ? 'no_skill_tags' : '',
  unit.difficulty >= 4 ? 'advanced_material' : '',
  unit.source === 'fallback' ? 'fallback_profile' : '',
  !unit.locator && !unit.entryPoint ? 'missing_locator' : ''
].filter(Boolean);

export class ResourcePlanningProfileService {
  fromUnits(units: ResourceLearningUnit[], limit = 60): ResourcePlanningProfile[] {
    return units.slice(0, limit).map((unit): ResourcePlanningProfile => {
      const coveredSkills = unique([
        ...unit.teaches,
        ...conceptsFromText(unit.title, unit.summary, ...unit.evidenceSnippets)
      ], 10);
      const prerequisiteSkills = unique([
        ...unit.prerequisites,
        ...conceptsFromText((unit.resourceSignals || []).filter((signal) => /prereq|前置/i.test(signal)).join(' '))
      ], 8);
      const teachingRole = roleForUnit(unit);
      return {
        resourceId: unit.resourceId,
        unitId: unit.id,
        title: clip(unit.title || unit.resourceTitle, 160),
        summary: clip(unit.summary, 620),
        coveredSkills,
        prerequisiteSkills,
        targetLearnerLevel: learnerLevelForDifficulty(unit.difficulty),
        teachingRole,
        difficulty: Math.max(1, Math.min(5, Number(unit.difficulty || 2))),
        suitableStages: stagesForRole(teachingRole),
        riskFlags: riskFlagsForUnit(unit, coveredSkills),
        locator: unit.locator,
        entryPoint: unit.entryPoint,
        evidenceSnippets: unit.evidenceSnippets.slice(0, 3).map((snippet) => clip(snippet, 260)),
        sourceFileName: unit.sourceFileName || unit.resourceTitle,
        sourceFilePath: unit.sourceFilePath
      };
    });
  }

  async build(input: {
    workspaceId: string;
    workbenchId?: string | null;
    maxFiles?: number;
    maxProfiles?: number;
  }): Promise<ResourcePlanningProfile[]> {
    const units = await resourceLearningUnitService.build({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      resources: [],
      maxFiles: input.maxFiles || 18,
      maxUnits: input.maxProfiles || 60
    });
    return this.fromUnits(units, input.maxProfiles || 60);
  }
}

export const resourcePlanningProfileService = new ResourcePlanningProfileService();

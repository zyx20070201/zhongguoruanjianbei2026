import prisma from '../config/db';
import { stableHash } from './chunkSchema';
import { aiModelProviderService } from './aiModelProviderService';
import { courseKnowledgeGraphService } from './courseKnowledgeGraphService';
import { filterKnowledgeConcepts, isProbablyKnowledgeConcept } from './learnerSignalSanitizer';

type TargetNodeType = 'concept' | 'skill' | 'procedure' | 'application' | 'assessment' | 'misconception';
type TargetRelationType = 'prerequisite' | 'part_of' | 'supports' | 'assesses' | 'remediates' | 'related';
type TargetNodeStatus = 'matched' | 'new_candidate' | 'ambiguous';

export interface TargetKnowledgeNode {
  id: string;
  conceptId?: string | null;
  title: string;
  type: TargetNodeType;
  role: 'target' | 'prerequisite' | 'assessment' | 'misconception' | 'extension';
  requiredMastery: number;
  priority: number;
  difficulty: number;
  statusInCourseGraph: TargetNodeStatus;
  evidenceRequired: string[];
  acceptableEvidenceTypes: string[];
  rationale: string;
}

export interface TargetKnowledgeEdge {
  from: string;
  to: string;
  relationType: TargetRelationType;
  required: boolean;
  confidence: number;
  evidence: string[];
}

export interface TargetKnowledgeStructure {
  schema: 'target_knowledge_structure.v1';
  id: string;
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  objective: string;
  nodes: TargetKnowledgeNode[];
  edges: TargetKnowledgeEdge[];
  masteryCriteria: {
    defaultRequiredMastery: number;
    assessmentCoverageRequired: number;
    explanationRequired: boolean;
    applicationRequired: boolean;
  };
  priorityPolicy: {
    sequencing: 'prerequisite_first';
    blockerThreshold: number;
    evidenceThreshold: number;
  };
  evidenceRequirements: string[];
  assumptions: string[];
  source: 'ai' | 'fallback';
  confidence: number;
}

const TARGET_STRUCTURE_TIMEOUT_MS = Number(process.env.TARGET_STRUCTURE_TIMEOUT_MS || 45000);

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const stringify = (value: unknown, fallback: unknown = {}) => {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
};

const clip = (value: unknown, maxLength = 260) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const unique = (items: Array<string | null | undefined>, limit = 12) =>
  Array.from(new Set(items.map((item) => clip(item, 140)).filter(Boolean))).slice(0, limit);

const clamp01 = (value: unknown, fallback = 0.5) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
};

const nodeIdFor = (role: string, title: string, index: number) =>
  `${role}-${stableHash([title.toLowerCase(), index]).slice(0, 10)}`;

const overlaps = (left: string, right: string) => {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a === b || a.includes(b) || b.includes(a);
};

const defaultEvidenceTypes = (type: TargetNodeType, role: TargetKnowledgeNode['role']) => {
  if (role === 'assessment' || type === 'assessment') return ['quiz_result', 'practice_attempt', 'worked_solution'];
  if (type === 'application' || type === 'procedure') return ['practice_attempt', 'project_artifact', 'worked_solution'];
  if (role === 'misconception') return ['error_analysis', 'repair_attempt', 'quiz_result'];
  return ['concept_explanation', 'quiz_result', 'practice_attempt'];
};

export class TargetKnowledgeStructureService {
  async build(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    objective?: string;
    targetConcepts?: string[];
    persist?: boolean;
  }): Promise<{ structure: TargetKnowledgeStructure; evidenceId?: string }> {
    const [workspace, goal, graph] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { id: true, name: true, major: true } }),
      input.goalId
        ? prisma.learningGoal.findFirst({ where: { id: input.goalId, workspaceId: input.workspaceId } })
        : prisma.learningGoal.findFirst({ where: { workspaceId: input.workspaceId, status: 'active' }, orderBy: { updatedAt: 'desc' } }),
      courseKnowledgeGraphService.getGraph({ workspaceId: input.workspaceId, limit: 160 }).catch(() => ({ nodes: [], edges: [] }))
    ]);
    if (!workspace) throw new Error('Workspace not found');

    const objective = clip(input.objective || goal?.goalText || goal?.title || workspace.name, 360);
    const goalSkills = goal ? parseJson<string[]>(goal.skillsJson, []) : [];
    const goalWeaknesses = goal ? parseJson<string[]>(goal.weaknessesJson, []) : [];
    const graphNodes = Array.isArray((graph as any).nodes) ? (graph as any).nodes : [];
    const graphEdges = Array.isArray((graph as any).edges) ? (graph as any).edges : [];

    const fallback = this.fallbackStructure({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: goal?.id || input.goalId || null,
      objective,
      targetTitles: unique([...(input.targetConcepts || []), ...goalSkills, objective], 12),
      prerequisiteTitles: unique([...goalWeaknesses, ...this.prerequisitesFromGraph(graphNodes, graphEdges, [...goalSkills, ...(input.targetConcepts || [])])], 14),
      graphNodes,
      graphEdges
    });

    const structure = await this.aiStructure({
      workspace,
      objective,
      goalSkills,
      goalWeaknesses,
      graphNodes,
      graphEdges,
      fallback
    }).catch(() => fallback);

    await this.bindStructureToGraph(structure).catch((error) => console.warn('Target structure KG binding failed:', error));

    let evidenceId: string | undefined;
    if (input.persist) {
      const evidence = await prisma.learnerEvidence.create({
        data: {
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          goalId: structure.goalId || null,
          evidenceType: 'target_knowledge_structure',
          sourceType: 'target_structure_engine',
          sourceId: structure.id,
          actor: 'system',
          title: `Target knowledge structure: ${clip(structure.objective, 120)}`,
          summary: `Target nodes=${structure.nodes.length}, prerequisite nodes=${structure.nodes.filter((node) => node.role === 'prerequisite').length}.`,
          payloadJson: stringify(structure),
          confidence: structure.confidence
        }
      });
      evidenceId = evidence.id;
    }

    return { structure, evidenceId };
  }

  private fallbackStructure(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    objective: string;
    targetTitles: string[];
    prerequisiteTitles: string[];
    graphNodes: any[];
    graphEdges: any[];
  }): TargetKnowledgeStructure {
    const targetTitles = filterKnowledgeConcepts(input.targetTitles, 10);
    const prerequisiteTitles = filterKnowledgeConcepts(input.prerequisiteTitles, 12)
      .filter((title) => !targetTitles.some((target) => overlaps(target, title)));
    const nodes: TargetKnowledgeNode[] = [];
    targetTitles.forEach((title, index) => {
      nodes.push(this.nodeForTitle(title, input.graphNodes, index, 'target', 'concept', 0.78, 0.9 - index * 0.04));
    });
    prerequisiteTitles.forEach((title, index) => {
      nodes.push(this.nodeForTitle(title, input.graphNodes, index, 'prerequisite', 'concept', 0.68, 0.82 - index * 0.03));
    });
    targetTitles.slice(0, 4).forEach((title, index) => {
      nodes.push({
        id: nodeIdFor('assessment', title, index),
        conceptId: nodes.find((node) => node.title === title)?.conceptId || null,
        title: `${title} 掌握度检测`,
        type: 'assessment',
        role: 'assessment',
        requiredMastery: 0.75,
        priority: 0.76 - index * 0.03,
        difficulty: 0.55,
        statusInCourseGraph: 'new_candidate',
        evidenceRequired: ['quiz_result', 'practice_attempt'],
        acceptableEvidenceTypes: ['quiz_result', 'practice_attempt', 'worked_solution'],
        rationale: `目标「${title}」需要可观测评估证据。`
      });
    });

    const edges: TargetKnowledgeEdge[] = [];
    const targetNodes = nodes.filter((node) => node.role === 'target');
    const prereqNodes = nodes.filter((node) => node.role === 'prerequisite');
    prereqNodes.forEach((prereq) => {
      targetNodes.slice(0, 4).forEach((target) => {
        edges.push({
          from: prereq.id,
          to: target.id,
          relationType: 'prerequisite',
          required: true,
          confidence: 0.56,
          evidence: ['fallback prerequisite inferred from goal weaknesses or course graph edges']
        });
      });
    });
    nodes.filter((node) => node.role === 'assessment').forEach((assessment) => {
      const target = targetNodes.find((node) => assessment.title.includes(node.title));
      if (target) {
        edges.push({
          from: assessment.id,
          to: target.id,
          relationType: 'assesses',
          required: true,
          confidence: 0.72,
          evidence: ['assessment node generated as required mastery evidence']
        });
      }
    });

    return {
      schema: 'target_knowledge_structure.v1',
      id: stableHash([input.workspaceId, input.goalId || '', input.objective, targetTitles, prerequisiteTitles]).slice(0, 32),
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      objective: input.objective,
      nodes: nodes.slice(0, 30),
      edges: edges.slice(0, 80),
      masteryCriteria: {
        defaultRequiredMastery: 0.72,
        assessmentCoverageRequired: 0.65,
        explanationRequired: true,
        applicationRequired: true
      },
      priorityPolicy: {
        sequencing: 'prerequisite_first',
        blockerThreshold: 0.58,
        evidenceThreshold: 0.52
      },
      evidenceRequirements: ['concept_explanation', 'quiz_result', 'practice_attempt', 'resource_trace'],
      assumptions: [
        '目标结构从课程图谱、学习目标技能和薄弱点中生成。',
        '证据不足的目标节点会被标记为需要诊断，而不是直接判定不会。'
      ],
      source: 'fallback',
      confidence: Math.min(0.82, 0.42 + nodes.filter((node) => node.statusInCourseGraph === 'matched').length * 0.04)
    };
  }

  private async aiStructure(input: {
    workspace: { id: string; name: string; major?: string | null };
    objective: string;
    goalSkills: string[];
    goalWeaknesses: string[];
    graphNodes: any[];
    graphEdges: any[];
    fallback: TargetKnowledgeStructure;
  }) {
    if (!aiModelProviderService.isConfigured({ useCase: 'planner' })) return input.fallback;
    const response = await aiModelProviderService.json<Partial<TargetKnowledgeStructure>>({
      useCase: 'planner',
      timeoutMs: TARGET_STRUCTURE_TIMEOUT_MS,
      instruction: [
        'You are TargetKnowledgeStructureAgent for an evidence-grounded learning graph system.',
        'Convert the learner objective into a computable target subgraph over the course knowledge graph.',
        'Separate target concepts, prerequisites, assessment evidence, application skills, and misconception checks.',
        'Prefer existing course graph concept ids when titles match. Mark unmatched useful nodes as new_candidate.',
        'Return compact JSON only.'
      ].join('\n'),
      schema: {
        nodes: [{ id: 'string', conceptId: 'string|null', title: 'string', type: 'concept|skill|procedure|application|assessment|misconception', role: 'target|prerequisite|assessment|misconception|extension', requiredMastery: 0.72, priority: 0.8, difficulty: 0.5, statusInCourseGraph: 'matched|new_candidate|ambiguous', evidenceRequired: ['string'], acceptableEvidenceTypes: ['string'], rationale: 'string' }],
        edges: [{ from: 'node id', to: 'node id', relationType: 'prerequisite|part_of|supports|assesses|remediates|related', required: true, confidence: 0.7, evidence: ['string'] }],
        evidenceRequirements: ['string'],
        assumptions: ['string']
      },
      input: {
        objective: input.objective,
        workspace: input.workspace,
        goalSkills: input.goalSkills,
        goalWeaknesses: input.goalWeaknesses,
        courseGraphNodes: input.graphNodes.slice(0, 80).map((node) => ({
          id: node.id,
          title: node.title || node.label,
          category: node.category,
          difficulty: node.difficulty,
          learnerState: node.learnerState,
          bindings: node.bindings
        })),
        courseGraphEdges: input.graphEdges.slice(0, 120)
      }
    });
    return this.normalizeStructure(response.data, input.fallback, input.graphNodes);
  }

  private normalizeStructure(raw: Partial<TargetKnowledgeStructure> | null | undefined, fallback: TargetKnowledgeStructure, graphNodes: any[]): TargetKnowledgeStructure {
    const rawNodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
    const nodes = rawNodes
      .map((node: any, index) => this.normalizeNode(node, graphNodes, index))
      .filter((node): node is TargetKnowledgeNode => Boolean(node))
      .slice(0, 34);
    if (!nodes.length) return fallback;
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = (Array.isArray(raw?.edges) ? raw.edges : [])
      .map((edge: any) => ({
        from: String(edge?.from || ''),
        to: String(edge?.to || ''),
        relationType: (['prerequisite', 'part_of', 'supports', 'assesses', 'remediates', 'related'].includes(edge?.relationType) ? edge.relationType : 'related') as TargetRelationType,
        required: edge?.required !== false,
        confidence: clamp01(edge?.confidence, 0.58),
        evidence: unique(Array.isArray(edge?.evidence) ? edge.evidence : [], 5)
      }))
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to)
      .slice(0, 90);
    return {
      ...fallback,
      id: stableHash([fallback.workspaceId, fallback.goalId || '', fallback.objective, nodes.map((node) => node.title), edges.length]).slice(0, 32),
      nodes,
      edges: edges.length ? edges : fallback.edges,
      evidenceRequirements: unique(raw?.evidenceRequirements || fallback.evidenceRequirements, 12),
      assumptions: unique(raw?.assumptions || fallback.assumptions, 10),
      source: 'ai',
      confidence: Math.min(0.92, 0.58 + nodes.filter((node) => node.statusInCourseGraph === 'matched').length * 0.025)
    };
  }

  private normalizeNode(raw: any, graphNodes: any[], index: number): TargetKnowledgeNode | null {
    const title = clip(raw?.title, 120);
    if (!isProbablyKnowledgeConcept(title)) return null;
    const matched = this.matchConcept(title, graphNodes, raw?.conceptId);
    const role = ['target', 'prerequisite', 'assessment', 'misconception', 'extension'].includes(raw?.role) ? raw.role : 'target';
    const type = ['concept', 'skill', 'procedure', 'application', 'assessment', 'misconception'].includes(raw?.type) ? raw.type : role === 'assessment' ? 'assessment' : 'concept';
    return {
      id: clip(raw?.id, 80) || nodeIdFor(role, title, index),
      conceptId: matched?.id || null,
      title,
      type,
      role,
      requiredMastery: clamp01(raw?.requiredMastery, role === 'prerequisite' ? 0.66 : 0.74),
      priority: clamp01(raw?.priority, index < 3 ? 0.86 - index * 0.05 : 0.58),
      difficulty: clamp01(raw?.difficulty ?? matched?.difficulty, 0.5),
      statusInCourseGraph: matched ? 'matched' : raw?.statusInCourseGraph === 'ambiguous' ? 'ambiguous' : 'new_candidate',
      evidenceRequired: unique(raw?.evidenceRequired || defaultEvidenceTypes(type, role), 8),
      acceptableEvidenceTypes: unique(raw?.acceptableEvidenceTypes || defaultEvidenceTypes(type, role), 8),
      rationale: clip(raw?.rationale, 240) || `${role} node for ${title}.`
    };
  }

  private nodeForTitle(title: string, graphNodes: any[], index: number, role: TargetKnowledgeNode['role'], type: TargetNodeType, requiredMastery: number, priority: number) {
    const matched = this.matchConcept(title, graphNodes);
    return {
      id: nodeIdFor(role, title, index),
      conceptId: matched?.id || null,
      title,
      type,
      role,
      requiredMastery,
      priority: clamp01(priority, 0.6),
      difficulty: clamp01(matched?.difficulty, 0.5),
      statusInCourseGraph: matched ? 'matched' : 'new_candidate',
      evidenceRequired: defaultEvidenceTypes(type, role),
      acceptableEvidenceTypes: defaultEvidenceTypes(type, role),
      rationale: matched ? 'Matched to canonical course graph concept.' : 'Target concept candidate not yet canonicalized in course graph.'
    } as TargetKnowledgeNode;
  }

  private matchConcept(title: string, graphNodes: any[], conceptId?: string | null) {
    if (conceptId) {
      const exactById = graphNodes.find((node) => node.id === conceptId);
      if (exactById) return exactById;
    }
    return graphNodes.find((node) => overlaps(title, String(node.title || node.label || '')));
  }

  private prerequisitesFromGraph(graphNodes: any[], graphEdges: any[], targetTitles: string[]) {
    const matchedIds = new Set(
      graphNodes
        .filter((node) => targetTitles.some((title) => overlaps(title, String(node.title || node.label || ''))))
        .map((node) => node.id)
    );
    return graphEdges
      .filter((edge) => (edge.relationType || edge.relation) === 'prerequisite' && matchedIds.has(edge.to || edge.target))
      .map((edge) => graphNodes.find((node) => node.id === (edge.from || edge.source))?.title)
      .filter(Boolean)
      .slice(0, 12);
  }

  private async bindStructureToGraph(structure: TargetKnowledgeStructure) {
    for (const node of structure.nodes.filter((item) => item.statusInCourseGraph !== 'ambiguous').slice(0, 30)) {
      const concept = node.conceptId
        ? await prisma.courseKnowledgeConcept.findFirst({ where: { id: node.conceptId, workspaceId: structure.workspaceId } })
        : await courseKnowledgeGraphService.upsertConcept({
            workspaceId: structure.workspaceId,
            title: node.title,
            category: node.type,
            difficulty: node.difficulty,
            source: 'target_structure',
            evidence: {
              sourceLayer: 'target_overlay',
              targetStructureId: structure.id,
              goalId: structure.goalId || null,
              role: node.role,
              requiredMastery: node.requiredMastery,
              priority: node.priority,
              evidenceRequired: node.evidenceRequired
            }
          });
      if (!concept) continue;
      await courseKnowledgeGraphService.bindConcept({
        workspaceId: structure.workspaceId,
        conceptId: concept.id,
        bindingType: 'goal',
        targetType: 'target_knowledge_structure',
        targetId: structure.id,
        role: node.role,
        strength: node.priority,
        confidence: structure.confidence,
        workbenchId: structure.workbenchId || null,
        goalId: structure.goalId || null,
        evidence: { node }
      });
    }
  }
}

export const targetKnowledgeStructureService = new TargetKnowledgeStructureService();

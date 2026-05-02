type LearningMode = 'quick-start' | 'project' | 'review';

interface AllocationInput {
  mode: LearningMode;
  skills: string[];
}

export interface LearningResourceAllocation {
  kind: 'brief' | 'practice' | 'plan' | 'notes' | 'code-lab' | 'quiz' | 'research';
  filename: string;
  role: string;
  priority: number;
}

export class LearningResourceAllocatorService {
  allocate(input: AllocationInput): LearningResourceAllocation[] {
    const base: LearningResourceAllocation[] = [
      { kind: 'brief', filename: '01-learning-brief.md', role: 'goal_blueprint', priority: 1 },
      { kind: 'practice', filename: '02-diagnostic-practice.md', role: 'diagnosis_and_exercise', priority: 2 },
      { kind: 'plan', filename: '03-resource-plan.md', role: 'generation_strategy', priority: 3 },
      { kind: 'notes', filename: 'learning-notes.md', role: 'learner_workspace', priority: 4 }
    ];

    if (input.mode === 'project') {
      return [
        ...base,
        { kind: 'code-lab', filename: '04-project-lab.md', role: 'implementation_task', priority: 5 },
        { kind: 'research', filename: '05-reference-questions.md', role: 'source_followup', priority: 6 }
      ];
    }

    if (input.mode === 'review') {
      return [
        ...base,
        { kind: 'quiz', filename: '04-stage-quiz.md', role: 'mastery_check', priority: 5 }
      ];
    }

    return base;
  }
}

export const learningResourceAllocatorService = new LearningResourceAllocatorService();

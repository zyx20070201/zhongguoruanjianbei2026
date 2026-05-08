import prisma from './db';

const learningPlanStatements = [
  `CREATE TABLE IF NOT EXISTS "LearningPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'goal',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "objective" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "assumptionsJson" TEXT NOT NULL DEFAULT '[]',
    "constraintsJson" TEXT NOT NULL DEFAULT '[]',
    "targetSkillsJson" TEXT NOT NULL DEFAULT '[]',
    "weakSkillsJson" TEXT NOT NULL DEFAULT '[]',
    "milestonesJson" TEXT NOT NULL DEFAULT '[]',
    "stepsJson" TEXT NOT NULL DEFAULT '[]',
    "adaptationPolicyJson" TEXT NOT NULL DEFAULT '{}',
    "evidenceJson" TEXT NOT NULL DEFAULT '{}',
    "diagnosticReportJson" TEXT NOT NULL DEFAULT '{}',
    "candidateResourcesJson" TEXT NOT NULL DEFAULT '[]',
    "knowledgeGraphSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "reflectionHistoryJson" TEXT NOT NULL DEFAULT '[]',
    "constraintScoresJson" TEXT NOT NULL DEFAULT '{}',
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "nextStepId" TEXT,
    "previousPlanId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,
    "workbenchId" TEXT,
    "goalId" TEXT,
    CONSTRAINT "LearningPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearningPlan_workbenchId_fkey" FOREIGN KEY ("workbenchId") REFERENCES "Workbench" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LearningPlan_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LearningPlan_previousPlanId_fkey" FOREIGN KEY ("previousPlanId") REFERENCES "LearningPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "LearningPlan_workspaceId_status_updatedAt_idx" ON "LearningPlan"("workspaceId", "status", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "LearningPlan_goalId_status_version_idx" ON "LearningPlan"("goalId", "status", "version")`,
  `CREATE INDEX IF NOT EXISTS "LearningPlan_workbenchId_status_updatedAt_idx" ON "LearningPlan"("workbenchId", "status", "updatedAt")`
];

export const ensurePlanningSchema = async () => {
  for (const statement of learningPlanStatements) {
    await prisma.$executeRawUnsafe(statement);
  }
};

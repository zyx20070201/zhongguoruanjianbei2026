import prisma from '../../config/db';
import { normalizeAgentMessages } from './agentMessageHistory';
import type { WorkspaceAgentV2State } from './types';

const stringify = (value: unknown) => {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
};

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
};

export class WorkspaceAgentV2StateStore {
  async save(state: WorkspaceAgentV2State) {
    if (!state.sessionId || !state.userId) return null;
    const existing = await prisma.conversationSession.findUnique({
      where: { id: state.sessionId },
      select: { metadataJson: true }
    }).catch(() => null);
    const metadata = parseJson<Record<string, unknown>>(existing?.metadataJson, {});
    const v2State = {
      schema: 'workspace-agent-v2-state/v1',
      workspaceId: state.workspaceId,
      workbenchId: state.workbenchId || null,
      sessionId: state.sessionId,
      checkpointThreadId: state.checkpointThreadId,
      currentTurnId: state.currentTurnId,
      userId: state.userId,
      messages: state.messages,
      chatFiles: state.chatFiles,
      selectedFileIds: state.selectedFileIds,
      userInput: state.userInput,
      context: state.context,
      contextControl: state.contextControl,
      availableTools: state.availableTools,
      decisions: state.decisions,
      toolCalls: state.toolCalls,
      observations: state.observations,
      evidence: state.evidence,
      agentMessages: state.agentMessages || [],
      executedActions: state.executedActions || [],
      stepCount: state.stepCount,
      maxSteps: state.maxSteps,
      stopReason: state.stopReason,
      finalReply: state.finalReply,
      pendingApproval: state.pendingApproval || null,
      trace: state.trace,
      model: state.model,
      provider: state.provider,
      savedAt: new Date().toISOString()
    };
    await prisma.conversationSession.upsert({
      where: { id: state.sessionId },
      create: {
        id: state.sessionId,
        workspaceId: state.workspaceId,
        workbenchId: state.workbenchId || null,
        userId: state.userId,
        title: state.userInput.slice(0, 80) || 'Agent V2 session',
        source: 'terminal_v2',
        metadataJson: stringify({
          ...metadata,
          mode: 'new_agentic',
          checkpointThreadId: state.checkpointThreadId,
          workspaceAgentV2: v2State,
          pendingApproval: state.pendingApproval || null,
          terminalPersisted: true,
          updatedFrom: 'workspace_agent_v2_state_store'
        })
      },
      update: {
        source: 'terminal_v2',
        metadataJson: stringify({
          ...metadata,
          mode: 'new_agentic',
          checkpointThreadId: state.checkpointThreadId,
          workspaceAgentV2: v2State,
          pendingApproval: state.pendingApproval || null,
          terminalPersisted: true,
          updatedFrom: 'workspace_agent_v2_state_store'
        })
      }
    }).catch(() => undefined);
    return v2State;
  }

  async load(input: {
    workspaceId: string;
    sessionId?: string | null;
    checkpointThreadId?: string | null;
  }): Promise<WorkspaceAgentV2State | null> {
    const session = input.sessionId
      ? await prisma.conversationSession.findFirst({
          where: { id: input.sessionId, workspaceId: input.workspaceId },
          select: { metadataJson: true }
        }).catch(() => null)
      : await prisma.conversationSession.findFirst({
          where: {
            workspaceId: input.workspaceId,
            source: 'terminal_v2',
            metadataJson: { contains: input.checkpointThreadId || '__missing_checkpoint__' }
          },
          orderBy: { updatedAt: 'desc' },
          select: { metadataJson: true }
        }).catch(() => null);
    const metadata = parseJson<Record<string, any>>(session?.metadataJson, {});
    const state = metadata.workspaceAgentV2;
    if (!state || state.schema !== 'workspace-agent-v2-state/v1') return null;
    if (state.workspaceId !== input.workspaceId) return null;
    if (input.checkpointThreadId && state.checkpointThreadId !== input.checkpointThreadId) return null;
    return {
      ...state,
      messages: Array.isArray(state.messages) ? state.messages : [],
      chatFiles: Array.isArray(state.chatFiles) ? state.chatFiles : [],
      selectedFileIds: Array.isArray(state.selectedFileIds) ? state.selectedFileIds : [],
      currentTurnId: typeof state.currentTurnId === 'string' ? state.currentTurnId : state.checkpointThreadId,
      contextControl: state.contextControl || state.context?.contextControl,
      availableTools: Array.isArray(state.availableTools) ? state.availableTools : [],
      decisions: Array.isArray(state.decisions) ? state.decisions : [],
      toolCalls: Array.isArray(state.toolCalls) ? state.toolCalls : [],
      observations: Array.isArray(state.observations) ? state.observations : [],
      evidence: Array.isArray(state.evidence) ? state.evidence : [],
      agentMessages: normalizeAgentMessages(state.agentMessages),
      executedActions: Array.isArray(state.executedActions) ? state.executedActions : [],
      trace: Array.isArray(state.trace) ? state.trace : []
    } as WorkspaceAgentV2State;
  }
}

export const workspaceAgentV2StateStore = new WorkspaceAgentV2StateStore();

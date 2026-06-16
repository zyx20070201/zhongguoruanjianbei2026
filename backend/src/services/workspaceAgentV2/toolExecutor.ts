import { createId, nowIso, compactJson } from './utils';
import { workspaceAgentV2ToolRegistry, type WorkspaceAgentToolContext } from './toolRegistry';
import { validateToolInput } from './toolValidation';
import type {
  WorkspaceAgentAcquisitionConstraints,
  WorkspaceAgentDecision,
  WorkspaceAgentObservation,
  WorkspaceAgentRuntimeContextControl,
  WorkspaceAgentToolCallRecord,
  WorkspaceAgentToolPolicy,
  WorkspaceAgentV2State
} from './types';

const ORDINARY_CONTEXT_TOOLS = new Set([
  'workspace.fs.list',
  'workspace.file.search',
  'workspace.file.read',
  'workspace.files.search',
  'knowledge.search',
  'attachment.list',
  'attachment.read',
  'attachment.image.inspect',
  'web.search',
  'web.fetch'
]);

const defaultPolicyForTool = (tool: string, enabled: boolean): WorkspaceAgentToolPolicy => ({
  tool,
  enabled,
  autoApprove: ORDINARY_CONTEXT_TOOLS.has(tool),
  requiresApproval: !ORDINARY_CONTEXT_TOOLS.has(tool),
  risk: ORDINARY_CONTEXT_TOOLS.has(tool) ? 'low' : 'medium'
});

const skipped = (
  tool: string,
  summary: string,
  baseCall: { id: string; tool: string; input: Record<string, unknown>; startedAt: string }
) => {
  const observation: WorkspaceAgentObservation = {
    id: createId('obs'),
    tool: tool || 'unknown',
    status: 'skipped',
    summary,
    error: summary,
    at: nowIso()
  };
  return {
    call: {
      ...baseCall,
      status: 'skipped' as const,
      finishedAt: nowIso(),
      observationId: observation.id,
      error: summary
    },
    observation,
    evidence: []
  };
};

const isToolEnabled = (control: WorkspaceAgentRuntimeContextControl | undefined, toolName: string) =>
  !control || control.toolAvailability.enabledTools.includes(toolName);

const policyFor = (control: WorkspaceAgentRuntimeContextControl | undefined, toolName: string): WorkspaceAgentToolPolicy =>
  control?.toolPolicy?.[toolName] || defaultPolicyForTool(toolName, isToolEnabled(control, toolName));

const stringArray = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];

const scopedReadSearchTools = new Set([
  'workspace.file.search',
  'workspace.files.search',
  'knowledge.search'
]);

const externalReadTools = new Set([
  'web.search',
  'web.fetch'
]);

const violatesAcquisitionConstraints = (
  toolName: string,
  input: Record<string, unknown>,
  control: WorkspaceAgentRuntimeContextControl | undefined
) => {
  const constraints = control?.acquisitionConstraints;
  if (!constraints) return '';
  if (constraints.deniedTools.includes(toolName)) {
    return `Tool skipped: user/context constraints deny ${toolName}.`;
  }
  const requestedScope = typeof input.scope === 'string' ? input.scope : undefined;
  if (constraints.deniedScopes?.length && requestedScope && constraints.deniedScopes.includes(requestedScope as any)) {
    return `Tool skipped: requested scope "${requestedScope}" is denied by context constraints.`;
  }
  if (constraints.onlyScopes?.length && requestedScope && !constraints.onlyScopes.includes(requestedScope as any)) {
    return `Tool skipped: requested scope "${requestedScope}" violates onlyScopes=${constraints.onlyScopes.join(', ')}.`;
  }
  if (constraints.onlyScopes?.length && externalReadTools.has(toolName)) {
    return `Tool skipped: external web access is not allowed when onlyScopes=${constraints.onlyScopes.join(', ')}.`;
  }
  if (constraints.onlyScopes?.length && scopedReadSearchTools.has(toolName) && !requestedScope) {
    return `Tool skipped: this context requires an explicit scope=${constraints.onlyScopes.join('|')}.`;
  }
  if (requestedScope === 'explicit_sources') {
    const requestedFileIds = stringArray(input.fileIds);
    if (!requestedFileIds.length) return 'Tool skipped: scope explicit_sources requires explicit fileIds.';
    const allowed = [
      ...(constraints.allowedFileIds || []),
      ...(control?.contextSources.selectedResources || []).map((item) => item.id)
    ];
    if (control && !allowed.length) return 'Tool skipped: no explicit source ids are available in ContextSources.';
    if (allowed.length) {
      const allowedSet = new Set(allowed);
      const deniedIds = requestedFileIds.filter((id) => !allowedSet.has(id));
      if (deniedIds.length) return `Tool skipped: fileIds are outside allowed explicit sources: ${deniedIds.join(', ')}.`;
    }
  }
  if (toolName === 'attachment.read' || toolName === 'attachment.image.inspect') {
    const requestedFileIds = stringArray(input.fileIds);
    if (!requestedFileIds.length) return `Tool skipped: ${toolName} requires explicit fileIds.`;
    const allowed = [
      ...(constraints.allowedAttachmentIds || []),
      ...(control?.contextSources.chatAttachments || []).map((item) => item.id)
    ];
    if (control && !allowed.length) return 'Tool skipped: no chat attachment ids are available in ContextSources.';
    if (allowed.length) {
      const allowedSet = new Set(allowed);
      const deniedIds = requestedFileIds.filter((id) => !allowedSet.has(id));
      if (deniedIds.length) return `Tool skipped: fileIds are outside allowed chat attachments: ${deniedIds.join(', ')}.`;
    }
  }
  return '';
};

export const executeDecisionTool = async (
  state: WorkspaceAgentV2State,
  decision: WorkspaceAgentDecision,
  options: { approved?: boolean } = {}
): Promise<{
  call: WorkspaceAgentToolCallRecord;
  observation: WorkspaceAgentObservation;
  evidence: any[];
  raw?: unknown;
}> => {
  const startedAt = nowIso();
  const toolName = decision.tool || '';
  const input = decision.input || {};
  const baseCall = {
    id: createId('toolcall'),
    tool: toolName,
    input,
    startedAt
  };
  const tool = workspaceAgentV2ToolRegistry.get(toolName);
  if (!tool) {
    const observation: WorkspaceAgentObservation = {
      id: createId('obs'),
      tool: toolName || 'unknown',
      status: 'failed',
      summary: `Tool is not registered: ${toolName}`,
      error: `Tool is not registered: ${toolName}`,
      at: nowIso()
    };
    return {
      call: { ...baseCall, status: 'failed', finishedAt: nowIso(), observationId: observation.id, error: observation.error },
      observation,
      evidence: []
    };
  }
  const contextControl = state.contextControl || state.context.contextControl;
  if (!isToolEnabled(contextControl, toolName)) {
    const disabled = contextControl?.toolAvailability.disabledTools.find((item) => item.tool === toolName);
    return skipped(toolName, `Tool skipped: ${toolName} is not enabled by ToolAvailability${disabled ? ` (${disabled.reason})` : ''}.`, baseCall);
  }
  const policy = policyFor(contextControl, toolName);
  if (!policy.enabled) {
    return skipped(toolName, `Tool skipped: ${toolName} is disabled by ToolPolicy.`, baseCall);
  }
  const validation = validateToolInput(input, tool.inputSchema);
  if (!validation.ok) {
    const observation: WorkspaceAgentObservation = {
      id: createId('obs'),
      tool: toolName,
      status: 'failed',
      summary: `Tool ${toolName} input validation failed: ${validation.errors.join('; ')}`,
      error: validation.errors.join('; '),
      at: nowIso()
    };
    return {
      call: {
        ...baseCall,
        status: 'failed',
        finishedAt: nowIso(),
        observationId: observation.id,
        error: `${observation.error} / input=${compactJson(input, 800)}`
      },
      observation,
      evidence: []
    };
  }
  const constraintError = violatesAcquisitionConstraints(toolName, validation.input, contextControl);
  if (constraintError) {
    return skipped(toolName, constraintError, { ...baseCall, input: validation.input });
  }
  if ((policy.requiresApproval || tool.requiresApproval || tool.sideEffect) && !policy.autoApprove && !options.approved) {
    const observation: WorkspaceAgentObservation = {
      id: createId('obs'),
      tool: toolName,
      status: 'approval_required',
      summary: `Tool ${toolName} requires approval before execution.`,
      at: nowIso()
    };
    return {
      call: {
        ...baseCall,
        input: validation.input,
        status: 'approval_required',
        finishedAt: nowIso(),
        observationId: observation.id
      },
      observation,
      evidence: []
    };
  }
  try {
    const context: WorkspaceAgentToolContext = {
      ...state.context,
      selectedFileIds: state.context.selectedFileIds || state.selectedFileIds || [],
      contextSources: contextControl?.contextSources,
      acquisitionConstraints: contextControl?.acquisitionConstraints,
      contextBudget: contextControl?.contextBudget,
      contextLedger: contextControl?.contextLedger,
      contextControl,
      userInput: state.userInput,
      evidence: state.evidence || [],
      agentMessages: state.agentMessages || []
    };
    const result = await tool.execute(validation.input, context);
    return {
      call: {
        ...baseCall,
        input: validation.input,
        status: result.observation.status,
        finishedAt: nowIso(),
        observationId: result.observation.id
      },
      observation: result.observation,
      evidence: result.evidence || [],
      raw: result.raw
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const observation: WorkspaceAgentObservation = {
      id: createId('obs'),
      tool: toolName,
      status: 'failed',
      summary: `Tool ${toolName} failed: ${message}`,
      error: message,
      at: nowIso()
    };
    return {
      call: {
        ...baseCall,
        status: 'failed',
        finishedAt: nowIso(),
        observationId: observation.id,
        error: `${message} / input=${compactJson(input, 800)}`
      },
      observation,
      evidence: []
    };
  }
};

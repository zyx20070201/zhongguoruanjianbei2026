import type { AiModelProviderId } from '../aiModelProviderService';

export type WorkspaceAgentV2Mode = 'new_agentic';

export type WorkspaceAgentV2AgentMode = 'act' | 'plan' | 'search' | 'minimal';

export type WorkspaceAgentRisk = 'low' | 'medium' | 'high';

export type WorkspaceAgentDecisionType = 'tool_call' | 'ask_user' | 'final';

export interface TerminalMessageV2 {
  role: 'user' | 'assistant';
  content: string;
  files?: TerminalChatFileRefV2[];
}

export interface TerminalChatFileRefV2 {
  id: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

export interface WorkspaceAgentToolManifest {
  name: string;
  title: string;
  description: string;
  category: string;
  inputSchema: Record<string, unknown>;
  risk: WorkspaceAgentRisk;
  sideEffect: boolean;
  requiresApproval: boolean;
  approvalReason?: string;
  examples?: Array<Record<string, unknown>>;
}

export type WorkspaceAgentSourceScope = 'workspace' | 'workbench' | 'explicit_sources' | 'chat_attachments';

export interface WorkspaceAgentToolAvailability {
  enabledTools: string[];
  disabledTools: Array<{
    tool: string;
    reason:
      | 'mode'
      | 'model_capability'
      | 'global_disabled'
      | 'missing_executor'
      | 'sensitive_tool_not_enabled'
      | 'user_steering';
  }>;
}

export interface WorkspaceAgentToolPolicy {
  tool: string;
  enabled: boolean;
  autoApprove: boolean;
  requiresApproval: boolean;
  risk: WorkspaceAgentRisk;
  maxCallsPerRun?: number;
  maxResultChars?: number;
}

export interface WorkspaceAgentContextSourceCard {
  id: string;
  title?: string;
  kind?: string;
  mimeType?: string;
  mode?: string;
  size?: number;
}

export interface WorkspaceAgentContextSources {
  workspace: {
    id: string;
    title?: string;
  };
  workbench?: {
    id: string;
    title?: string;
    isCurrent: boolean;
  } | null;
  selectedResources: WorkspaceAgentContextSourceCard[];
  chatAttachments: WorkspaceAgentContextSourceCard[];
  mentions: WorkspaceAgentContextSourceCard[];
  recentObservations: Array<{
    id: string;
    tool: string;
    status: WorkspaceAgentObservation['status'];
    summary: string;
  }>;
  ignoreSummary?: string;
}

export interface WorkspaceAgentAcquisitionConstraints {
  preferredScopes: WorkspaceAgentSourceScope[];
  onlyScopes?: WorkspaceAgentSourceScope[];
  deniedScopes: WorkspaceAgentSourceScope[];
  allowedFileIds?: string[];
  deniedFileIds?: string[];
  allowedAttachmentIds?: string[];
  deniedAttachmentIds?: string[];
  allowedWorkbenchIds?: string[];
  deniedTools: string[];
  preferredTools: string[];
  userSteering: Array<{
    kind: 'prefer' | 'only' | 'deny';
    target: string;
    rawText: string;
    confidence: number;
  }>;
}

export interface WorkspaceAgentContextBudget {
  maxInitialEnvironmentChars: number;
  maxToolResultChars: number;
  maxDecisionContextChars: number;
  maxFinalContextChars: number;
  maxEvidenceItemsPerTool: number;
  maxEvidenceCharsPerItem: number;
  maxTotalEvidenceChars: number;
  maxObservationHistory: number;
  compactThresholdRatio: number;
}

export interface WorkspaceAgentContextLedgerEntry {
  id: string;
  kind: 'environment' | 'explicit_source' | 'tool_observation' | 'evidence' | 'generated_artifact' | 'compact_summary';
  sourceType:
    | 'workspace_file'
    | 'workbench_file'
    | 'chat_attachment'
    | 'knowledge_chunk'
    | 'course_graph'
    | 'learner_context'
    | 'generated_file'
    | 'unknown';
  sourceId?: string;
  toolCallId?: string;
  locator?: Record<string, unknown>;
  title: string;
  summary: string;
  contentHash?: string;
  tokenEstimate?: number;
  stale?: boolean;
  createdAt: string;
}

export type WorkspaceAgentDeliveryTarget =
  | 'inline_answer'
  | 'workspace_file'
  | 'workbench_file'
  | 'existing_workspace_file'
  | 'workbench';

export type WorkspaceAgentDeliveryAction = 'answer' | 'create' | 'update';

export type WorkspaceAgentDeliveryFormat = 'markdown' | 'json' | 'code' | 'text' | 'unknown';

export interface WorkspaceAgentDeliverySatisfiedArtifact {
  tool: string;
  artifactKind: 'file' | 'workbench' | 'preview';
  id: string;
  title?: string;
  path?: string;
}

export interface WorkspaceAgentRequiredFile {
  filename?: string;
  extension?: string;
  mimeType?: string;
  role?: 'main' | 'supporting' | 'test' | 'doc' | 'data' | 'unknown';
  optional?: boolean;
  status: 'pending' | 'satisfied';
  satisfiedBy?: WorkspaceAgentDeliverySatisfiedArtifact;
}

export interface WorkspaceAgentDeliveryContract {
  required: boolean;
  target: WorkspaceAgentDeliveryTarget;
  action: WorkspaceAgentDeliveryAction;
  format?: WorkspaceAgentDeliveryFormat;
  filenameHint?: string;
  scope?: 'workspace' | 'workbench';
  requiredFiles?: WorkspaceAgentRequiredFile[];
  rawUserText: string;
  confidence: number;
  status: 'pending' | 'satisfied' | 'blocked';
  satisfiedBy?: WorkspaceAgentDeliverySatisfiedArtifact;
}

export type WorkspaceAgentArtifactTargetHint = 'inline_answer' | 'studio_artifact';
export type WorkspaceAgentArtifactKindHint = 'practice' | 'mind_map' | 'flashcards' | 'visual_explainer';
export type WorkspaceAgentArtifactInteractivityHint = 'chat' | 'studio_renderer' | 'executable_visual';

export interface WorkspaceAgentArtifactHints {
  possibleTargets: WorkspaceAgentArtifactTargetHint[];
  possibleKinds: WorkspaceAgentArtifactKindHint[];
  possibleInteractivity: WorkspaceAgentArtifactInteractivityHint[];
  confidence: number;
  reasons: string[];
}

export interface WorkspaceAgentRuntimeContextControl {
  agentMode: WorkspaceAgentV2AgentMode;
  toolAvailability: WorkspaceAgentToolAvailability;
  toolPolicy: Record<string, WorkspaceAgentToolPolicy>;
  contextSources: WorkspaceAgentContextSources;
  acquisitionConstraints: WorkspaceAgentAcquisitionConstraints;
  contextBudget: WorkspaceAgentContextBudget;
  contextLedger: WorkspaceAgentContextLedgerEntry[];
  deliveryContract: WorkspaceAgentDeliveryContract;
  artifactHints?: WorkspaceAgentArtifactHints;
}

export interface WorkspaceAgentV2Context {
  workspaceId: string;
  workbenchId?: string | null;
  userId?: string | null;
  contextControl?: WorkspaceAgentRuntimeContextControl;
  contextSources?: WorkspaceAgentContextSources;
  acquisitionConstraints?: WorkspaceAgentAcquisitionConstraints;
  contextBudget?: WorkspaceAgentContextBudget;
  contextLedger?: WorkspaceAgentContextLedgerEntry[];
  deliveryContract?: WorkspaceAgentDeliveryContract;
  artifactHints?: WorkspaceAgentArtifactHints;
  selectedFileIds: string[];
  chatFileIds: string[];
}

export interface WorkspaceAgentDecision {
  id: string;
  type: WorkspaceAgentDecisionType;
  tool?: string;
  input?: Record<string, unknown>;
  question?: string;
  answer?: string;
  visibleMessage?: string;
  reason: string;
  at: string;
  model?: string;
  provider?: AiModelProviderId;
}

export interface WorkspaceAgentEvidence {
  id: string;
  kind: string;
  title: string;
  summary: string;
  content?: string;
  source?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceAgentModelContextBlock {
  id: string;
  kind: 'tool_result' | 'read_result' | 'file_card' | 'observation';
  title: string;
  summary: string;
  content?: string;
  source?: string;
  sourceId?: string;
  tool?: string;
  stale?: boolean;
  metadata?: Record<string, unknown>;
}

export type WorkspaceAgentHistoryBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      toolUseId: string;
      name: string;
      content: string;
      isError?: boolean;
      evidenceIds?: string[];
      locators?: Array<Record<string, unknown>>;
      sourceIds?: string[];
    };

export interface WorkspaceAgentHistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  turnId: string;
  content: string | WorkspaceAgentHistoryBlock[];
  createdAt: string;
  metadata?: {
    userVisible?: boolean;
    compacted?: boolean;
    topicKey?: string;
    sourceTurnId?: string;
  };
}

export interface WorkspaceAgentObservation {
  id: string;
  tool: string;
  status: 'success' | 'failed' | 'skipped' | 'approval_required';
  summary: string;
  evidenceIds?: string[];
  artifactRefs?: Array<{
    kind: 'file' | 'studio_artifact' | 'workbench' | 'plan' | 'job' | 'memory' | 'preview';
    id: string;
    title: string;
  }>;
  error?: string;
  at: string;
}

export interface WorkspaceAgentToolCallRecord {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  status: WorkspaceAgentObservation['status'];
  startedAt: string;
  finishedAt: string;
  observationId?: string;
  error?: string;
}

export interface WorkspaceAgentTraceEntry {
  id: string;
  node: string;
  message: string;
  at: string;
  data?: Record<string, unknown>;
}

export interface WorkspaceAgentV2State {
  workspaceId: string;
  workbenchId?: string | null;
  sessionId?: string | null;
  checkpointThreadId: string;
  currentTurnId: string;
  userId?: string | null;
  messages: TerminalMessageV2[];
  chatFiles: TerminalChatFileRefV2[];
  selectedFileIds: string[];
  userInput: string;
  context: WorkspaceAgentV2Context;
  contextControl: WorkspaceAgentRuntimeContextControl;
  availableTools: WorkspaceAgentToolManifest[];
  decisions: WorkspaceAgentDecision[];
  toolCalls: WorkspaceAgentToolCallRecord[];
  observations: WorkspaceAgentObservation[];
  evidence: WorkspaceAgentEvidence[];
  agentMessages: WorkspaceAgentHistoryMessage[];
  executedActions: any[];
  stepCount: number;
  maxSteps: number;
  stopReason?: string | null;
  finalReply?: string | null;
  sayTranscript?: string;
  answerTranscript?: string;
  pendingApproval?: WorkspaceAgentPendingApproval | null;
  trace: WorkspaceAgentTraceEntry[];
  model?: string;
  provider?: AiModelProviderId;
}

export interface WorkspaceAgentPendingApproval {
  id: string;
  decisionId: string;
  toolCallId: string;
  tool: string;
  title: string;
  input: Record<string, unknown>;
  reason: string;
  risk: WorkspaceAgentRisk;
  createdAt: string;
}

export interface WorkspaceAgentApprovalDecisionV2 {
  decision: 'approve' | 'reject';
  actionIds?: string[];
  note?: string;
}

export interface WorkspaceAgentV2RunInput {
  workspaceId: string;
  workbenchId?: string | null;
  sessionId?: string | null;
  checkpointThreadId?: string | null;
  messages: TerminalMessageV2[];
  selectedSourceIds?: string[];
  selectedSources?: Array<{ fileId: string; mode?: 'focused' | 'full_context' }>;
  chatFiles?: TerminalChatFileRefV2[];
}

export interface WorkspaceAgentV2RunResult {
  reply: string;
  mode: WorkspaceAgentV2Mode;
  sessionId: string;
  checkpointThreadId: string;
  status: 'completed' | 'approval_required';
  evidence: WorkspaceAgentEvidence[];
  proposedActions: any[];
  executedActions: any[];
  suggestedActions: any[];
  approvalRequest?: {
    proposals: any[];
    message: string;
  };
  followUps: string[];
  agentTrace: WorkspaceAgentTraceEntry[];
  agentEvents: any[];
  memoryContext: { askUserToSave: null };
  model?: string;
  provider?: AiModelProviderId;
}

export interface WorkspaceAgentV2SayEvent {
  id: string;
  kind: 'text';
  at: string;
  phase: 'interim' | 'final';
  node?: string;
  content: string;
  delta: string;
  partial: boolean;
}

export interface WorkspaceAgentV2StreamEvent {
  type: 'status' | 'ui_event' | 'say' | 'final' | 'approval_required' | 'error';
  node?: string;
  message?: string;
  status?: Record<string, unknown>;
  uiEvent?: Record<string, unknown>;
  say?: WorkspaceAgentV2SayEvent;
  result?: WorkspaceAgentV2RunResult;
}

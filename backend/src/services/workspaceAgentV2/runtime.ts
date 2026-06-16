import crypto from 'crypto';
import prisma from '../../config/db';
import { aiModelProviderService } from '../aiModelProviderService';
import {
  appendAssistantTextMessage,
  appendToolResultMessage,
  appendToolUseMessage,
  appendUserTurnMessage,
  evidenceFromAgentHistory,
  normalizeAgentMessages
} from './agentMessageHistory';
import { registerWorkspaceAgentV2ReadTools } from './adapters/readTools';
import { registerWorkspaceAgentV2SideEffectTools } from './adapters/sideEffectTools';
import { buildChatAttachmentContexts } from './attachmentContext';
import { buildWorkspaceAgentModelContext } from './contextBuilder';
import { buildWorkspaceAgentV2ContextControl, refreshWorkspaceAgentV2ContextControl } from './contextControl';
import { buildFinalAnswerMessagePayload } from './finalMessageBuilder';
import { WorkspaceAgentV2LoopGuard } from './loopGuard';
import { decideNextStep } from './modelDecision';
import { workspaceAgentV2StateStore } from './stateStore';
import { executeDecisionTool } from './toolExecutor';
import { workspaceAgentV2ToolRegistry } from './toolRegistry';
import { buildWorkspaceTreeOverviewEvidence } from './workspaceTreeOverview';
import type {
  WorkspaceAgentApprovalDecisionV2,
  WorkspaceAgentDecision,
  WorkspaceAgentObservation,
  WorkspaceAgentPendingApproval,
  WorkspaceAgentV2RunInput,
  WorkspaceAgentV2RunResult,
  WorkspaceAgentV2SayEvent,
  WorkspaceAgentV2State,
  WorkspaceAgentV2StreamEvent
} from './types';
import { clip, createId, latestUserMessage, normalizeChatFiles, normalizeMessages, nowIso, selectedFileIdsFromInput, traceEntry, unique } from './utils';

registerWorkspaceAgentV2ReadTools();
registerWorkspaceAgentV2SideEffectTools();

const toThreadId = (input: WorkspaceAgentV2RunInput) =>
  input.checkpointThreadId || input.sessionId || `workspace-agent-v2-${input.workspaceId}-${crypto.randomUUID()}`;

const toSessionId = (input: WorkspaceAgentV2RunInput) =>
  input.sessionId || `workspace-shell-${input.workspaceId}-${crypto.randomUUID()}`;

const toUiEvent = (node: string, title: string, detail?: string) => ({
  id: createId('ui'),
  kind: 'activity',
  phase: 'interim',
  node,
  title,
  detail,
  at: nowIso()
});

const normalizeSayContent = (value?: string | null) => String(value || '').trim();

const extractJsonObject = (value: string) => {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1) : value;
};

const normalizeFollowUps = (value: unknown) =>
  unique(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
      .filter((item) => item.length > 0 && item.length <= 120),
    4
  );

class WorkspaceAgentV2Runtime {
  private readonly loopGuard = new WorkspaceAgentV2LoopGuard();

  async run(input: WorkspaceAgentV2RunInput): Promise<WorkspaceAgentV2RunResult> {
    let final: WorkspaceAgentV2RunResult | null = null;
    for await (const event of this.streamRun(input)) {
      if ((event.type === 'final' || event.type === 'approval_required') && event.result) final = event.result;
    }
    if (!final) throw new Error('Workspace Agent V2 ended without a final result');
    return final;
  }

  async *streamRun(input: WorkspaceAgentV2RunInput): AsyncGenerator<WorkspaceAgentV2StreamEvent> {
    const state = await this.initialState(input);
    await workspaceAgentV2StateStore.save(state);
    yield { type: 'status', node: 'PrepareTurn', message: 'Workspace Agent V2 prepared Cline-style context control.', status: { action: 'prepare_context_control', done: true } };
    yield {
      type: 'ui_event',
      node: 'PrepareTurn',
      uiEvent: toUiEvent('PrepareTurn', 'Prepared Agent V2 context control', `${state.availableTools.length} tools available; mode=${state.contextControl.agentMode}`)
    };

    yield* this.drive(state);
  }

  async resumeApproval(
    input: WorkspaceAgentV2RunInput,
    approvalDecision: WorkspaceAgentApprovalDecisionV2
  ): Promise<WorkspaceAgentV2RunResult> {
    const state = await workspaceAgentV2StateStore.load({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      checkpointThreadId: input.checkpointThreadId
    });
    if (!state?.pendingApproval) {
      throw new Error('Workspace Agent V2 has no pending approval to resume');
    }
    await this.refreshContextControl(state);
    const pending = state.pendingApproval;
    const allowedIds = new Set((approvalDecision.actionIds || []).filter(Boolean));
    const targeted = !allowedIds.size || allowedIds.has(pending.id) || allowedIds.has(pending.toolCallId);
    if (!targeted) {
      throw new Error('Approval decision does not target the pending Workspace Agent V2 action');
    }

    state.trace.push(traceEntry('ApprovalGate', approvalDecision.decision === 'approve'
      ? `User approved ${pending.tool}.`
      : `User rejected ${pending.tool}.`, { approvalDecision, pending }));

    if (approvalDecision.decision === 'reject') {
      state.pendingApproval = null;
      state.stopReason = 'approval_rejected';
      state.finalReply = `已取消执行 ${pending.title}。我不会改动 workspace 状态。`;
      state.executedActions.push({
        id: createId('exec'),
        proposalId: pending.id,
        type: pending.tool,
        title: pending.title,
        success: false,
        summary: '用户拒绝执行该操作。',
        error: approvalDecision.note || 'rejected'
      });
      await workspaceAgentV2StateStore.save(state);
      return await this.toResult(state);
    }

    const decision = state.decisions.find((item) => item.id === pending.decisionId) || {
      id: pending.decisionId,
      type: 'tool_call' as const,
      tool: pending.tool,
      input: pending.input,
      reason: pending.reason,
      at: nowIso()
    };
    const result = await executeDecisionTool(state, decision, { approved: true });
    state.pendingApproval = null;
    state.toolCalls.push(result.call);
    state.observations.push(result.observation);
    state.evidence.push(...result.evidence);
    state.agentMessages = appendToolResultMessage(
      state.agentMessages || [],
      state.currentTurnId,
      result.call,
      result.observation,
      result.evidence || [],
      pending.decisionId
    );
    await this.refreshContextControl(state);
    const executionResult = this.executionResultFromToolResult(pending.tool, result);
    state.executedActions.push({
      id: createId('exec'),
      proposalId: pending.id,
      type: pending.tool,
      title: pending.title,
      success: result.observation.status === 'success',
      summary: result.observation.summary,
      result: executionResult,
      error: result.observation.error
    });
    state.trace.push(traceEntry('ApprovedToolExecutor', result.observation.summary, {
      tool: result.call.tool,
      status: result.observation.status
    }));
    state.stopReason = null;
    state.finalReply = null;
    await workspaceAgentV2StateStore.save(state);
    return this.runStateToCompletion(state);
  }

  private async runStateToCompletion(state: WorkspaceAgentV2State): Promise<WorkspaceAgentV2RunResult> {
    let result: WorkspaceAgentV2RunResult | null = null;
    for await (const event of this.drive(state)) {
      if ((event.type === 'final' || event.type === 'approval_required') && event.result) result = event.result;
    }
    if (!result) {
      state.finalReply = await this.composeFinalAnswer(state);
      result = await this.toResult(state);
    }
    return result;
  }

  private async *drive(state: WorkspaceAgentV2State): AsyncGenerator<WorkspaceAgentV2StreamEvent> {
    let activeSayId: string | null = null;
    while (!state.stopReason && state.stepCount < state.maxSteps) {
      state.stepCount += 1;
      yield { type: 'status', node: 'ModelDecision', message: `Agent V2 deciding step ${state.stepCount}.`, status: { action: 'model_decision', done: false, count: state.stepCount } };
      const decision = await decideNextStep(state);
      state.decisions.push(decision);
      if (decision.type === 'tool_call') {
        state.agentMessages = appendToolUseMessage(state.agentMessages || [], state.currentTurnId, decision);
      }
      if (decision.model) state.model = decision.model;
      if (decision.provider) state.provider = decision.provider;
      state.trace.push(traceEntry('ModelDecision', `${decision.type}${decision.tool ? `:${decision.tool}` : ''} - ${decision.reason}`, { decision }));
      yield { type: 'ui_event', node: 'ModelDecision', uiEvent: toUiEvent('ModelDecision', decision.type === 'tool_call' ? `Selected ${decision.tool}` : decision.type, decision.reason) };

      if (decision.type === 'final') {
        const gateObservation = this.deliveryGateObservation(state);
        if (gateObservation) {
          state.observations.push(gateObservation);
          state.trace.push(traceEntry('DeliveryGate', gateObservation.summary, {
            deliveryContract: state.contextControl.deliveryContract,
            blockedDecisionId: decision.id
          }));
          await this.refreshContextControl(state);
          yield {
            type: 'ui_event',
            node: 'DeliveryGate',
            uiEvent: toUiEvent('DeliveryGate', 'Waiting for required file delivery', gateObservation.summary)
          };
          yield {
            type: 'status',
            node: 'DeliveryGate',
            message: gateObservation.summary,
            status: { action: 'delivery_gate', description: state.contextControl.deliveryContract.target, done: true }
          };
          await workspaceAgentV2StateStore.save(state);
          continue;
        }
      }

      const visibleMessage = normalizeSayContent(decision.visibleMessage);
      if (visibleMessage) {
        activeSayId = activeSayId || createId('say');
        yield this.sayEvent(state, {
          id: activeSayId,
          node: 'ModelDecision',
          content: `${visibleMessage}\n\n`,
          phase: 'interim',
          partial: true
        });
      }

      const guard = this.loopGuard.inspect(state, decision);
      if (!guard.ok) {
        state.stopReason = guard.reason || 'loop_guard_stop';
        state.trace.push(traceEntry('LoopGuard', state.stopReason));
        await workspaceAgentV2StateStore.save(state);
        break;
      }

      if (decision.type === 'ask_user') {
        state.finalReply = decision.question || '我需要更多信息才能继续。';
        state.agentMessages = appendAssistantTextMessage(state.agentMessages || [], state.currentTurnId, state.finalReply);
        activeSayId = activeSayId || createId('say');
        yield this.sayEvent(state, {
          id: activeSayId,
          node: 'AskUser',
          content: `${state.finalReply}\n`,
          phase: 'final',
          partial: false
        });
        state.stopReason = 'ask_user';
        await workspaceAgentV2StateStore.save(state);
        break;
      }

      if (decision.type === 'final') {
        if (decision.answer) {
          state.finalReply = decision.answer;
          state.agentMessages = appendAssistantTextMessage(state.agentMessages || [], state.currentTurnId, decision.answer);
          activeSayId = activeSayId || createId('say');
          yield this.sayEvent(state, {
            id: activeSayId,
            node: 'ResponseComposer',
            content: decision.answer,
            phase: 'final',
            partial: false
          });
        } else {
          activeSayId = activeSayId || createId('say');
          yield* this.composeFinalAnswerStream(state, activeSayId);
          if (state.finalReply) {
            state.agentMessages = appendAssistantTextMessage(state.agentMessages || [], state.currentTurnId, state.finalReply);
          }
        }
        state.stopReason = 'model_final';
        await workspaceAgentV2StateStore.save(state);
        break;
      }

      yield { type: 'status', node: 'ToolExecutor', message: `Running ${decision.tool}.`, status: { action: 'tool_call', description: decision.tool, done: false } };
      const result = await executeDecisionTool(state, decision);
      state.toolCalls.push(result.call);
      state.observations.push(result.observation);
      state.evidence.push(...result.evidence);
      state.agentMessages = appendToolResultMessage(
        state.agentMessages || [],
        state.currentTurnId,
        result.call,
        result.observation,
        result.evidence || [],
        decision.id
      );
      await this.refreshContextControl(state);
      state.trace.push(traceEntry('ToolExecutor', result.observation.summary, {
        tool: result.call.tool,
        input: result.call.input,
        status: result.observation.status
      }));
      yield { type: 'ui_event', node: 'ToolExecutor', uiEvent: toUiEvent('ToolExecutor', `${result.call.tool}: ${result.observation.status}`, result.observation.summary) };
      yield { type: 'status', node: 'ToolExecutor', message: result.observation.summary, status: { action: 'tool_call', description: result.call.tool, done: true } };

      if (result.observation.status === 'approval_required') {
        state.pendingApproval = this.pendingApprovalFromDecision(state, decision, result.call.id);
        state.finalReply = `我准备执行「${state.pendingApproval.title}」，这会改变 workspace 状态，需要你确认后继续。`;
        state.agentMessages = appendAssistantTextMessage(state.agentMessages || [], state.currentTurnId, state.finalReply);
        activeSayId = activeSayId || createId('say');
        yield this.sayEvent(state, {
          id: activeSayId,
          node: 'ApprovalGate',
          content: state.finalReply,
          phase: 'final',
          partial: false
        });
        state.stopReason = 'approval_required';
        state.trace.push(traceEntry('ApprovalGate', `Pending approval for ${state.pendingApproval.tool}.`, { pendingApproval: state.pendingApproval }));
        await workspaceAgentV2StateStore.save(state);
        const approvalResult = await this.toResult(state);
        yield {
          type: 'approval_required',
          node: 'ApprovalGate',
          message: 'Workspace Agent V2 needs approval before executing this tool.',
          result: approvalResult
        };
        return;
      }

      const failures = state.observations.slice(-2).filter((item) => item.status === 'failed').length;
      if (failures >= 2) {
        state.stopReason = 'consecutive_tool_failures';
        await workspaceAgentV2StateStore.save(state);
        break;
      }
      await workspaceAgentV2StateStore.save(state);
    }

    if (!state.finalReply) {
      activeSayId = activeSayId || createId('say');
      const gateObservation = this.deliveryGateObservation(state);
      if (gateObservation) {
        state.observations.push(gateObservation);
        state.stopReason = state.stopReason || 'delivery_contract_unsatisfied';
        state.finalReply = this.deliveryBlockedFinalReply(state, gateObservation);
        state.agentMessages = appendAssistantTextMessage(state.agentMessages || [], state.currentTurnId, state.finalReply);
        state.trace.push(traceEntry('DeliveryGate', gateObservation.summary, {
          deliveryContract: state.contextControl.deliveryContract
        }));
        yield this.sayEvent(state, {
          id: activeSayId,
          node: 'DeliveryGate',
          content: state.finalReply,
          phase: 'final',
          partial: false
        });
      } else {
        yield* this.composeFinalAnswerStream(state, activeSayId);
      }
    }
    const result = await this.toResult(state);
    await workspaceAgentV2StateStore.save(state);
    yield { type: 'final', node: 'ResponseComposer', result, message: 'Workspace Agent V2 completed.' };
  }

  private sayEvent(
    state: WorkspaceAgentV2State,
    input: {
      id: string;
      node: string;
      content: string;
      phase: WorkspaceAgentV2SayEvent['phase'];
      partial: boolean;
    }
  ): WorkspaceAgentV2StreamEvent {
    const delta = input.content;
    const isAnswer = input.node === 'ResponseComposer';
    if (isAnswer) {
      state.answerTranscript = `${state.answerTranscript || ''}${delta}`;
    } else {
      state.sayTranscript = `${state.sayTranscript || ''}${delta}`;
    }
    const say: WorkspaceAgentV2SayEvent = {
      id: input.id,
      kind: 'text',
      at: nowIso(),
      phase: input.phase,
      node: input.node,
      content: isAnswer ? state.answerTranscript || '' : state.sayTranscript || delta,
      delta,
      partial: input.partial
    };
    return {
      type: 'say',
      node: input.node,
      message: delta,
      say,
      uiEvent: {
        id: input.id,
        kind: 'say',
        at: say.at,
        phase: input.phase,
        node: input.node,
        content: state.sayTranscript
      }
    };
  }

  private pendingApprovalFromDecision(
    state: WorkspaceAgentV2State,
    decision: WorkspaceAgentDecision,
    toolCallId: string
  ): WorkspaceAgentPendingApproval {
    const manifest = state.availableTools.find((tool) => tool.name === decision.tool);
    const templateId = typeof decision.input?.templateId === 'string' ? decision.input.templateId : '';
    const studioTitle = decision.tool === 'studio.generate_artifact'
      ? templateId === 'mind_map'
        ? '生成 AI Studio 思维导图'
        : templateId === 'custom_practice'
          ? '生成 AI Studio 练习题'
          : templateId === 'react_chat_visual'
            ? '生成 AI Studio 可视化讲解'
            : templateId === 'flashcards'
              ? '生成 AI Studio 复习卡片'
              : ''
      : '';
    return {
      id: createId('approval'),
      decisionId: decision.id,
      toolCallId,
      tool: decision.tool || 'unknown',
      title: studioTitle || manifest?.title || decision.tool || 'Workspace Agent V2 tool',
      input: decision.input || {},
      reason: manifest?.approvalReason || decision.reason || 'This tool may change workspace state.',
      risk: manifest?.risk || 'medium',
      createdAt: nowIso()
    };
  }

  private deliveryGateObservation(state: WorkspaceAgentV2State): WorkspaceAgentObservation | null {
    const contract = state.contextControl?.deliveryContract;
    if (!contract?.required || contract.status === 'satisfied') return null;
    if (!['workspace_file', 'workbench_file', 'existing_workspace_file'].includes(contract.target)) return null;

    const requiredFiles = contract.requiredFiles || [];
    const expectedTool = requiredFiles.length > 1
      ? 'file.write_many'
      : contract.format === 'markdown'
        ? 'markdown_note.create or file.write'
        : 'file.write';
    const availableToolNames = new Set(state.availableTools.map((tool) => tool.name));
    const expectedAvailable = expectedTool.split(' or ').some((tool) => availableToolNames.has(tool));
    const targetLabel = contract.target === 'workbench_file' ? 'workbench' : 'workspace';
    const formatLabel = contract.format === 'markdown' ? 'Markdown' : contract.format === 'code' ? 'code' : 'file';
    const missingFiles = requiredFiles
      .filter((file) => !file.optional && file.status !== 'satisfied')
      .map((file) => file.filename || (file.extension ? `*.${file.extension}` : 'file'));
    const missingSummary = missingFiles.length ? ` 缺少文件：${missingFiles.join(', ')}。` : '';
    const unavailable = expectedAvailable
      ? ''
      : ` 当前 ${expectedTool} 不在 available tools 中；如果模式限制了写入，需要询问用户或说明无法落库。`;
    return {
      id: createId('obs'),
      tool: 'delivery.gate',
      status: 'skipped',
      summary: `用户要求把结果交付为 ${targetLabel} ${formatLabel} 文件，但尚未看到足够的成功写入 artifact。${missingSummary}请像 Cline write_to_file 一样调用 ${expectedTool}，并提供完整最终文件内容；代码文件必须写 raw code，不要用聊天区 Markdown 替代文件写入。${unavailable}`.trim(),
      at: nowIso()
    };
  }

  private deliveryBlockedFinalReply(state: WorkspaceAgentV2State, observation: WorkspaceAgentObservation) {
    const contract = state.contextControl?.deliveryContract;
    if (contract?.format === 'markdown') {
      return [
        '这轮还没有完成你要求的 Markdown 文件写入。',
        '',
        observation.summary,
        '',
        '我没有把聊天区里的 Markdown 当作已保存文件。'
      ].join('\n');
    }
    return observation.summary;
  }

  private executionResultFromToolResult(tool: string, result: Awaited<ReturnType<typeof executeDecisionTool>>) {
    const raw = result as any;
    const payload: Record<string, unknown> = {
      observationId: result.observation.id,
      evidenceIds: result.observation.evidenceIds || [],
      artifactRefs: result.observation.artifactRefs || []
    };
    if (tool === 'workbench.create') {
      const workbench = raw.raw || {};
      if (typeof workbench.id === 'string') payload.workbenchId = workbench.id;
      if (typeof workbench.title === 'string') payload.title = workbench.title;
      if (typeof workbench.rootPath === 'string') payload.rootPath = workbench.rootPath;
    }
    if (tool === 'folder.create') {
      const folder = raw.raw?.folder || {};
      if (typeof folder.id === 'string') payload.folderId = folder.id;
      if (typeof folder.path === 'string') payload.path = folder.path;
      if (typeof folder.name === 'string') payload.name = folder.name;
    }
    if (tool === 'markdown_note.create' || tool === 'file.write' || tool === 'file.replace') {
      const file = raw.raw?.file || raw.raw?.delivery || {};
      if (typeof file.id === 'string') payload.fileObjectId = file.id;
      if (typeof file.fileObjectId === 'string') payload.fileObjectId = file.fileObjectId;
      if (typeof file.path === 'string') payload.path = file.path;
      if (typeof file.name === 'string') payload.name = file.name;
    }
    if (tool === 'file.write_many') {
      const files = Array.isArray(raw.raw?.files) ? raw.raw.files : [];
      payload.files = files.map((file: any) => ({
        fileObjectId: file.id || file.fileObjectId,
        path: file.path,
        name: file.name
      })).filter((file: any) => file.fileObjectId || file.path || file.name);
    }
    if (tool === 'resource.import_web') {
      const files = Array.isArray(raw.raw?.files) ? raw.raw.files : [];
      payload.files = files.map((file: any) => ({
        fileObjectId: file.id || file.fileObjectId,
        path: file.path,
        name: file.name
      })).filter((file: any) => file.fileObjectId || file.path || file.name);
    }
    if (tool === 'studio.generate_artifact') {
      const studio = raw.raw?.studio || {};
      const file = raw.raw?.file || raw.raw?.delivery || {};
      const artifact = raw.raw?.artifact || {};
      const renderJob = raw.raw?.renderJob || {};
      const delivery = raw.raw?.delivery || {};
      payload.studio = studio;
      payload.studioCard = {
        templateId: studio.templateId,
        templateTitle: studio.templateTitle,
        goal: studio.goal,
        renderer: studio.renderer,
        runId: studio.runId,
        sourceMode: studio.sourceMode,
        fileObjectId: file.id || file.fileObjectId || delivery.fileObjectId,
        filename: file.name || delivery.filename,
        path: file.path || delivery.path,
        artifactId: artifact.id,
        artifactKey: artifact.artifactKey,
        renderJobId: renderJob.id,
        renderJobStatus: renderJob.status,
        renderJobKind: renderJob.kind,
        deliveryKind: delivery.kind,
        framework: delivery.framework,
        reviewScore: studio.review?.score,
        reviewPassed: studio.review?.passed,
        reviewSummary: studio.review?.summary,
        previewContent: raw.raw?.contentPreview,
        usedContextSummary: studio.usedContextSummary,
        evidenceIds: studio.evidenceIds,
        sourceFileIds: studio.sourceFileIds
      };
    }
    return payload;
  }

  private async initialState(input: WorkspaceAgentV2RunInput): Promise<WorkspaceAgentV2State> {
    const messages = normalizeMessages(input.messages);
    const userInput = latestUserMessage(messages);
    if (!userInput) throw new Error('A user message is required');
    const sessionId = toSessionId(input);
    const checkpointThreadId = toThreadId({ ...input, sessionId });
    const currentTurnId = createId('turn');
    const previousState = await workspaceAgentV2StateStore.load({
      workspaceId: input.workspaceId,
      sessionId,
      checkpointThreadId
    }).catch(() => null);
    const chatFiles = normalizeChatFiles([
      ...normalizeChatFiles(input.chatFiles),
      ...messages.slice(-12).flatMap((message) => normalizeChatFiles(message.files))
    ]);
    const selectedFileIds = selectedFileIdsFromInput({
      selectedSourceIds: input.selectedSourceIds,
      selectedSources: input.selectedSources,
      chatFiles,
      messages
    });
    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { userId: true } }).catch(() => null);
    const contextControl = await buildWorkspaceAgentV2ContextControl({
      runInput: input,
      messages,
      userInput,
      chatFiles,
      previousState
    });
    const inheritedEvidence = previousState ? evidenceFromAgentHistory(previousState.agentMessages || []) : [];
    const environmentEvidence = await buildWorkspaceTreeOverviewEvidence(input.workspaceId, {
      limit: Number(process.env.WORKSPACE_AGENT_V2_TREE_OVERVIEW_LIMIT || 160)
    }).catch(() => null);
    const evidence = [
      ...(environmentEvidence ? [environmentEvidence] : []),
      ...inheritedEvidence.slice(-40)
    ];
    const agentMessages = appendUserTurnMessage(
      normalizeAgentMessages(previousState?.agentMessages),
      currentTurnId,
      messages
    );
    const context = {
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      userId: workspace?.userId || null,
      contextControl,
      contextSources: contextControl.contextSources,
      acquisitionConstraints: contextControl.acquisitionConstraints,
      contextBudget: contextControl.contextBudget,
      contextLedger: contextControl.contextLedger,
      deliveryContract: contextControl.deliveryContract,
      artifactHints: contextControl.artifactHints,
      selectedFileIds,
      chatFileIds: unique(chatFiles.map((file) => file.id), 24)
    };
    const availableTools = await workspaceAgentV2ToolRegistry.manifest({ ...context, contextControl, userInput });
    return {
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      sessionId,
      checkpointThreadId,
      currentTurnId,
      userId: workspace?.userId || null,
      messages,
      chatFiles,
      selectedFileIds,
      userInput,
      context,
      contextControl,
      availableTools,
      decisions: [],
      toolCalls: [],
      observations: [],
      evidence,
      agentMessages,
      executedActions: [],
      stepCount: 0,
      maxSteps: Number(process.env.WORKSPACE_AGENT_V2_MAX_STEPS || 6),
      stopReason: null,
      finalReply: null,
      sayTranscript: '',
      answerTranscript: '',
      pendingApproval: null,
      trace: [traceEntry('PrepareTurn', 'Initialized Workspace Agent V2 context control.', {
        selectedFileIds,
        agentMode: contextControl.agentMode,
        toolAvailability: contextControl.toolAvailability,
        acquisitionConstraints: contextControl.acquisitionConstraints,
        contextSources: contextControl.contextSources,
        artifactHints: contextControl.artifactHints,
        inheritedEvidence: evidence.map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          source: item.source,
          contentLength: item.content?.length || 0
        })).slice(-12),
        availableTools: availableTools.map((tool) => tool.name)
      })]
    };
  }

  private async refreshContextControl(state: WorkspaceAgentV2State) {
    const contextControl = await refreshWorkspaceAgentV2ContextControl(state);
    state.contextControl = contextControl;
    state.context = {
      ...state.context,
      contextControl,
      contextSources: contextControl.contextSources,
      acquisitionConstraints: contextControl.acquisitionConstraints,
      contextBudget: contextControl.contextBudget,
      contextLedger: contextControl.contextLedger,
      deliveryContract: contextControl.deliveryContract,
      artifactHints: contextControl.artifactHints
    };
    state.availableTools = await workspaceAgentV2ToolRegistry.manifest({
      ...state.context,
      contextControl,
      userInput: state.userInput
    });
    state.trace.push(traceEntry('ContextControl', 'Refreshed context control after observation.', {
      agentMode: contextControl.agentMode,
      enabledTools: contextControl.toolAvailability.enabledTools,
      deniedTools: contextControl.acquisitionConstraints.deniedTools,
      ledgerItems: contextControl.contextLedger.length,
      deliveryContract: contextControl.deliveryContract,
      artifactHints: contextControl.artifactHints
    }));
  }

  private finalAnswerEvidence(state: WorkspaceAgentV2State) {
    return buildWorkspaceAgentModelContext(state, { phase: 'final' });
  }

  private latestUserAttachmentIds(state: WorkspaceAgentV2State) {
    const latestUser = [...(state.messages || [])].reverse().find((message) => message.role === 'user');
    return unique(normalizeChatFiles(latestUser?.files).map((file) => file.id), 12);
  }

  private async buildFinalAnswerAttachments(state: WorkspaceAgentV2State) {
    const latestIds = this.latestUserAttachmentIds(state);
    return buildChatAttachmentContexts(state.context, latestIds.length ? latestIds : undefined);
  }

  private async *composeFinalAnswerStream(state: WorkspaceAgentV2State, sayId: string): AsyncGenerator<WorkspaceAgentV2StreamEvent> {
    const evidence = this.finalAnswerEvidence(state);
    const fallback = async () => {
      const answer = await this.composeFinalAnswer(state);
      return answer.trim();
    };

    if (!aiModelProviderService.isConfigured({ useCase: 'learning' })) {
      const answer = await fallback();
      yield this.sayEvent(state, {
        id: sayId,
        node: 'ResponseComposer',
        content: answer,
        phase: 'final',
        partial: false
      });
      state.finalReply = answer.trim();
      return;
    }

    try {
      const attachments = await this.buildFinalAnswerAttachments(state);
      const hasImages = attachments.some((attachment) => attachment.kind === 'image' && (attachment.dataUrl || attachment.base64Data));
      const provider = hasImages ? aiModelProviderService.configuredVisionProvider({ useCase: 'learning' }) : undefined;
      if (hasImages && !provider) {
        const answer = '当前模型不支持图片输入，且没有配置可用的多模态模型，因此我不能可靠读取这张图片。';
        yield this.sayEvent(state, {
          id: sayId,
          node: 'ResponseComposer',
          content: answer,
          phase: 'final',
          partial: false
        });
        state.finalReply = answer.trim();
        return;
      }

      state.provider = provider || aiModelProviderService.provider({ useCase: 'learning' });
      state.model = aiModelProviderService.model(state.provider, undefined, 'learning');
      let streamed = '';
      const payload = buildFinalAnswerMessagePayload(state, evidence);
      for await (const delta of aiModelProviderService.chatStream(payload.messages, {
        provider,
        useCase: 'learning',
        timeoutMs: 60000,
        attachments,
        systemPrompt: payload.systemPrompt
      })) {
        streamed += delta;
        yield this.sayEvent(state, {
          id: sayId,
          node: 'ResponseComposer',
          content: delta,
          phase: 'interim',
          partial: true
        });
      }

      if (!streamed.trim()) {
        const answer = await fallback();
        yield this.sayEvent(state, {
          id: sayId,
          node: 'ResponseComposer',
          content: answer,
          phase: 'final',
          partial: false
        });
        state.finalReply = answer.trim();
      } else {
        yield {
          ...this.sayEvent(state, {
            id: sayId,
            node: 'ResponseComposer',
            content: '',
            phase: 'final',
            partial: false
          }),
          message: 'Workspace Agent V2 final answer completed.'
        };
        state.finalReply = streamed.trim();
      }
    } catch {
      const answer = await fallback();
      yield this.sayEvent(state, {
        id: sayId,
        node: 'ResponseComposer',
        content: answer,
        phase: 'final',
        partial: false
      });
      state.finalReply = answer.trim();
    }
  }

  private async composeFinalAnswer(state: WorkspaceAgentV2State) {
    const evidence = this.finalAnswerEvidence(state);
    if (!aiModelProviderService.isConfigured({ useCase: 'learning' })) {
      if (!evidence.length) return '我已经启动 Agent V2，但当前没有检索到足够的 workspace 证据。你可以指定资料、文件或更明确的问题继续。';
      return [
        'Agent V2 已根据当前 workspace 资料完成检索。关键依据如下：',
        ...evidence.slice(0, 5).map((item, index) => `${index + 1}. ${item.title}: ${item.summary}`),
        '',
        '如果你希望我继续生成产物、保存 Markdown 文件或创建学习现场，可以切到后续副作用工具阶段确认执行。'
      ].join('\n');
    }
    try {
      const attachments = await this.buildFinalAnswerAttachments(state);
      const hasImages = attachments.some((attachment) => attachment.kind === 'image' && (attachment.dataUrl || attachment.base64Data));
      const provider = hasImages ? aiModelProviderService.configuredVisionProvider({ useCase: 'learning' }) : undefined;
      if (hasImages && !provider) {
        return '当前模型不支持图片输入，且没有配置可用的多模态模型，因此我不能可靠读取这张图片。';
      }
      const payload = buildFinalAnswerMessagePayload(state, evidence);
      const response = await aiModelProviderService.chat(payload.messages, {
        provider,
        useCase: 'learning',
        timeoutMs: 60000,
        attachments,
        systemPrompt: payload.systemPrompt
      });
      state.model = response.model;
      state.provider = response.provider;
      return response.reply;
    } catch {
      return evidence.length
        ? `我完成了 Agent V2 检索，但最终回答模型暂不可用。最相关依据：\n${evidence.slice(0, 5).map((item, index) => `${index + 1}. ${item.title}: ${item.summary}`).join('\n')}`
        : '我完成了 Agent V2 流程，但没有获得足够证据生成可靠回答。';
    }
  }

  private fallbackFollowUps(state: WorkspaceAgentV2State, reply: string) {
    const latest = latestUserMessage(state.messages || []);
    const evidenceTitle = state.evidence.find((item) => item.title)?.title;
    const successfulAction = [...(state.executedActions || [])].reverse().find((action) => action.success);
    const lower = `${latest}\n${reply}`.toLowerCase();
    const items: string[] = [];

    if (successfulAction?.title) {
      items.push(`继续完善「${successfulAction.title}」`);
    }
    if (/代码|算法|python|java|c\+\+|javascript|typescript|复杂度|实现|debug|bug|error|报错/i.test(lower)) {
      items.push('给我一版可直接运行的代码');
      items.push('用一个具体样例走一遍执行过程');
    }
    if (/复习|考试|学习|知识点|课程|资料|笔记|提纲/i.test(lower)) {
      items.push(evidenceTitle ? `基于「${evidenceTitle}」整理复习重点` : '把这次内容整理成复习提纲');
      items.push('出几道针对性的练习题');
    }
    if (/比较|区别|优缺点|方案|选择/i.test(lower)) {
      items.push('把几个方案做成对比表');
    }
    if (evidenceTitle) {
      items.push(`继续追问「${evidenceTitle}」里的细节`);
    }
    items.push('把结论压缩成一份行动清单');

    return normalizeFollowUps(items);
  }

  private async generateFollowUps(state: WorkspaceAgentV2State, reply: string) {
    if (process.env.WORKSPACE_AGENT_V2_FOLLOW_UPS_ENABLED === 'false') return [];
    const fallback = () => this.fallbackFollowUps(state, reply);
    if (!reply.trim() || !aiModelProviderService.isConfigured({ useCase: 'learning' })) return fallback();

    const history = [
      ...state.messages.slice(-4).map((message) => `${message.role}: ${clip(message.content, 900)}`),
      `assistant: ${clip(reply, 1200)}`
    ].join('\n\n');
    const evidence = state.evidence.slice(-6).map((item, index) => `${index + 1}. ${item.title}: ${item.summary}`).join('\n');
    const actions = (state.executedActions || [])
      .slice(-4)
      .map((action) => `${action.success ? 'done' : 'failed'}: ${action.title} - ${action.summary || ''}`)
      .join('\n');

    try {
      const result = await aiModelProviderService.chat(
        [{
          role: 'user',
          content: [
            'Suggest 3 concise follow-up prompts the user might naturally click next.',
            'Rules: use the conversation primary language; write as user prompts to the assistant; be specific to the latest answer, evidence, and completed actions; do not repeat the exact answered request.',
            'Return only JSON: {"follow_ups":["...","...","..."]}',
            '',
            'Conversation:',
            history,
            evidence ? `\nEvidence:\n${evidence}` : '',
            actions ? `\nActions:\n${actions}` : ''
          ].join('\n')
        }],
        {
          useCase: 'learning',
          timeoutMs: Number(process.env.WORKSPACE_AGENT_V2_FOLLOW_UP_TIMEOUT_MS || 30000)
        }
      );
      const parsed = JSON.parse(extractJsonObject(result.reply));
      const generated = normalizeFollowUps(parsed?.follow_ups);
      return generated.length ? generated : fallback();
    } catch {
      return fallback();
    }
  }

  private async toResult(state: WorkspaceAgentV2State): Promise<WorkspaceAgentV2RunResult> {
    const proposedActions = state.pendingApproval ? [this.proposalFromPendingApproval(state.pendingApproval)] : [];
    const reply = state.finalReply || '';
    const followUps = await this.generateFollowUps(state, reply);
    const traceEvents = state.trace.slice(-20).map((item) => ({
      id: item.id,
      kind: 'activity' as const,
      phase: 'done' as const,
      node: item.node,
      title: item.node,
      detail: item.message,
      at: item.at
    }));
    const finalSayEvents = reply.trim()
      ? [{
          id: createId('say'),
          kind: 'say' as const,
          phase: state.pendingApproval ? 'interim' as const : 'final' as const,
          node: state.pendingApproval ? 'ApprovalGate' : 'ResponseComposer',
          content: reply,
          at: nowIso()
        }]
      : [];
    return {
      reply,
      mode: 'new_agentic',
      sessionId: state.sessionId || toSessionId({ workspaceId: state.workspaceId, messages: state.messages }),
      checkpointThreadId: state.checkpointThreadId,
      status: state.pendingApproval ? 'approval_required' : 'completed',
      evidence: state.evidence,
      proposedActions,
      executedActions: state.executedActions || [],
      suggestedActions: proposedActions.map((proposal) => ({
        id: proposal.id,
        label: proposal.title,
        description: proposal.description
      })),
      approvalRequest: state.pendingApproval ? {
        proposals: proposedActions,
        message: '这一步需要你确认后才能继续执行。'
      } : undefined,
      followUps,
      agentTrace: state.trace,
      agentEvents: [...traceEvents, ...finalSayEvents],
      memoryContext: { askUserToSave: null },
      model: state.model,
      provider: state.provider
    };
  }

  private proposalFromPendingApproval(pending: WorkspaceAgentPendingApproval) {
    const templateId = typeof pending.input.templateId === 'string' ? pending.input.templateId : '';
    const studioTemplateLabel = templateId === 'mind_map'
      ? '思维导图'
      : templateId === 'custom_practice'
        ? '练习题'
        : templateId === 'react_chat_visual'
          ? '可视化讲解'
          : templateId === 'flashcards'
            ? '复习卡片'
            : '';
    const title = pending.tool === 'studio.generate_artifact' && studioTemplateLabel
      ? `生成 AI Studio ${studioTemplateLabel}`
      : pending.title;
    const description = pending.tool === 'studio.generate_artifact' && studioTemplateLabel
      ? `将调用 AI Studio 生成 ${studioTemplateLabel}，并在 workspace${pending.input.sourceMode === 'model_knowledge' ? ' 中基于模型知识' : ' 中基于 Agent V2 已读取证据'}发布资源。`
      : pending.tool === 'resource.import_web'
        ? '将把已找到的网页资料导入 workspace/workbench，保存为可复用的 source 资源。'
      : pending.reason;
    return {
      id: pending.id,
      type: pending.tool,
      title,
      description,
      risk: pending.risk,
      requiresConfirmation: true,
      payload: {
        tool: pending.tool,
        input: pending.input,
        toolCallId: pending.toolCallId
      },
      changeSet: {
        id: createId('changeset'),
        title,
        summary: description,
        risk: pending.risk,
        requiresApproval: true,
        items: [{
          id: pending.toolCallId,
          actionType: pending.tool,
          title,
          description,
          operation: 'create',
          risk: pending.risk,
          target: {
            tool: pending.tool,
            input: pending.input
          },
          reversible: false
        }]
      }
    };
  }
}

export const workspaceAgentV2Runtime = new WorkspaceAgentV2Runtime();

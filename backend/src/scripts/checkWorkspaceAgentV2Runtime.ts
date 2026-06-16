import assert from 'assert';
import prisma from '../config/db';
import { aiModelProviderService } from '../services/aiModelProviderService';
import { registerWorkspaceAgentV2ReadTools } from '../services/workspaceAgentV2/adapters/readTools';
import { registerWorkspaceAgentV2SideEffectTools } from '../services/workspaceAgentV2/adapters/sideEffectTools';
import { appendToolResultMessage, appendToolUseMessage, appendUserTurnMessage } from '../services/workspaceAgentV2/agentMessageHistory';
import { buildWorkspaceAgentModelContext } from '../services/workspaceAgentV2/contextBuilder';
import { buildWorkspaceAgentV2ContextControl } from '../services/workspaceAgentV2/contextControl';
import { buildFinalAnswerMessagePayload, buildFinalAnswerMessages } from '../services/workspaceAgentV2/finalMessageBuilder';
import { WorkspaceAgentV2LoopGuard } from '../services/workspaceAgentV2/loopGuard';
import { decideNextStep, fallbackDecision } from '../services/workspaceAgentV2/modelDecision';
import { buildStudioContextFromAgentEvidence } from '../services/workspaceAgentV2/studioContextCapsule';
import { executeDecisionTool } from '../services/workspaceAgentV2/toolExecutor';
import { workspaceAgentV2ToolRegistry } from '../services/workspaceAgentV2/toolRegistry';
import { validateToolInput } from '../services/workspaceAgentV2/toolValidation';
import type { WorkspaceAgentDecision, WorkspaceAgentRuntimeContextControl, WorkspaceAgentV2State } from '../services/workspaceAgentV2/types';

const makeContextControl = (): WorkspaceAgentRuntimeContextControl => ({
  agentMode: 'act',
  toolAvailability: {
    enabledTools: [
      'workbench.create',
      'folder.create',
      'file.write',
      'file.write_many',
      'file.replace',
      'markdown_note.create',
      'test.approval_tool',
      'workspace.fs.list',
      'workspace.file.search',
      'workspace.file.read',
      'knowledge.search',
      'attachment.list',
      'attachment.read',
      'attachment.image.inspect',
      'web.search',
      'web.fetch',
      'studio.generate_artifact'
    ],
    disabledTools: []
  },
  toolPolicy: {
    'workbench.create': { tool: 'workbench.create', enabled: true, autoApprove: false, requiresApproval: true, risk: 'medium' },
    'folder.create': { tool: 'folder.create', enabled: true, autoApprove: false, requiresApproval: true, risk: 'medium' },
    'file.write': { tool: 'file.write', enabled: true, autoApprove: false, requiresApproval: true, risk: 'medium' },
    'file.write_many': { tool: 'file.write_many', enabled: true, autoApprove: false, requiresApproval: true, risk: 'medium' },
    'file.replace': { tool: 'file.replace', enabled: true, autoApprove: false, requiresApproval: true, risk: 'medium' },
    'markdown_note.create': { tool: 'markdown_note.create', enabled: true, autoApprove: false, requiresApproval: true, risk: 'medium' },
    'test.approval_tool': { tool: 'test.approval_tool', enabled: true, autoApprove: false, requiresApproval: true, risk: 'medium' },
    'workspace.fs.list': { tool: 'workspace.fs.list', enabled: true, autoApprove: true, requiresApproval: false, risk: 'low' },
    'workspace.file.search': { tool: 'workspace.file.search', enabled: true, autoApprove: true, requiresApproval: false, risk: 'low' },
    'workspace.file.read': { tool: 'workspace.file.read', enabled: true, autoApprove: true, requiresApproval: false, risk: 'low' },
    'knowledge.search': { tool: 'knowledge.search', enabled: true, autoApprove: true, requiresApproval: false, risk: 'low' },
    'attachment.list': { tool: 'attachment.list', enabled: true, autoApprove: true, requiresApproval: false, risk: 'low' },
    'attachment.read': { tool: 'attachment.read', enabled: true, autoApprove: true, requiresApproval: false, risk: 'low' },
    'attachment.image.inspect': { tool: 'attachment.image.inspect', enabled: true, autoApprove: true, requiresApproval: false, risk: 'low' },
    'web.search': { tool: 'web.search', enabled: true, autoApprove: true, requiresApproval: false, risk: 'low' },
    'web.fetch': { tool: 'web.fetch', enabled: true, autoApprove: true, requiresApproval: false, risk: 'low' },
    'studio.generate_artifact': { tool: 'studio.generate_artifact', enabled: true, autoApprove: false, requiresApproval: true, risk: 'medium' }
  },
  contextSources: {
    workspace: { id: 'workspace-test', title: 'Test Workspace' },
    workbench: null,
    selectedResources: [],
    chatAttachments: [],
    mentions: [],
    recentObservations: []
  },
  acquisitionConstraints: {
    preferredScopes: [],
    deniedScopes: [],
    allowedFileIds: ['file-allowed'],
    allowedAttachmentIds: ['attachment-allowed'],
    deniedTools: [],
    preferredTools: [],
    userSteering: []
  },
  contextBudget: {
    maxInitialEnvironmentChars: 6000,
    maxToolResultChars: 6000,
    maxDecisionContextChars: 18000,
    maxFinalContextChars: 32000,
    maxEvidenceItemsPerTool: 8,
    maxEvidenceCharsPerItem: 1400,
    maxTotalEvidenceChars: 14000,
    maxObservationHistory: 8,
    compactThresholdRatio: 0.72
  },
  contextLedger: [],
  deliveryContract: {
    required: false,
    target: 'inline_answer',
    action: 'answer',
    format: 'unknown',
    rawUserText: 'test',
    confidence: 0.5,
    status: 'satisfied'
  }
});

const makeState = (): WorkspaceAgentV2State => {
  const contextControl = makeContextControl();
  return {
    workspaceId: 'workspace-test',
    workbenchId: null,
    sessionId: 'session-test',
    checkpointThreadId: 'thread-test',
    currentTurnId: 'turn-test',
    userId: 'user-test',
    messages: [{ role: 'user', content: 'test' }],
    chatFiles: [],
    selectedFileIds: [],
    userInput: 'test',
    context: {
      workspaceId: 'workspace-test',
      workbenchId: null,
      userId: 'user-test',
      contextControl,
      contextSources: contextControl.contextSources,
      acquisitionConstraints: contextControl.acquisitionConstraints,
      contextBudget: contextControl.contextBudget,
      contextLedger: contextControl.contextLedger,
      deliveryContract: contextControl.deliveryContract,
      selectedFileIds: [],
      chatFileIds: []
    },
    contextControl,
    availableTools: [],
    decisions: [],
    toolCalls: [],
    observations: [],
    evidence: [],
    agentMessages: [],
    executedActions: [],
    stepCount: 0,
    maxSteps: 6,
    stopReason: null,
    finalReply: null,
    pendingApproval: null,
    trace: []
  };
};

const main = async () => {
  const schema = {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number', minimum: 1, maximum: 5 }
    },
    required: ['query'],
    additionalProperties: false
  };
  assert.deepEqual(validateToolInput({ query: 'abc', limit: '3' }, schema).input, { query: 'abc', limit: 3 });
  assert.equal(validateToolInput({ limit: 3 }, schema).ok, false);
  assert.equal(validateToolInput({ query: 'abc', extra: true }, schema).ok, false);

  workspaceAgentV2ToolRegistry.register({
    name: 'test.approval_tool',
    title: 'Approval Tool',
    description: 'A test side-effect tool.',
    category: 'test',
    inputSchema: schema,
    risk: 'medium',
    sideEffect: true,
    requiresApproval: true,
    approvalReason: 'Test approval is required.',
    execute: async () => ({
      observation: {
        id: 'obs-approved',
        tool: 'test.approval_tool',
        status: 'success',
        summary: 'approved execution completed',
        at: new Date().toISOString()
      },
      evidence: [],
      raw: { artifactId: 'artifact-test' }
    })
  });

  registerWorkspaceAgentV2ReadTools();
  registerWorkspaceAgentV2SideEffectTools();

  const state = makeState();
  state.availableTools = await workspaceAgentV2ToolRegistry.manifest({ ...state.context, contextControl: state.contextControl, userInput: state.userInput });
  const workbenchTool = state.availableTools.find((tool) => tool.name === 'workbench.create');
  const folderTool = state.availableTools.find((tool) => tool.name === 'folder.create');
  const fileWriteTool = state.availableTools.find((tool) => tool.name === 'file.write');
  const fileWriteManyTool = state.availableTools.find((tool) => tool.name === 'file.write_many');
  const fileReplaceTool = state.availableTools.find((tool) => tool.name === 'file.replace');
  const markdownTool = state.availableTools.find((tool) => tool.name === 'markdown_note.create');
  const studioTool = state.availableTools.find((tool) => tool.name === 'studio.generate_artifact');
  const expectedReadTools = [
    'workspace.fs.list',
    'workspace.file.search',
    'workspace.file.read',
    'knowledge.search',
    'attachment.list',
    'attachment.read',
    'attachment.image.inspect',
    'web.search',
    'web.fetch'
  ];
  for (const toolName of expectedReadTools) {
    const tool = state.availableTools.find((item) => item.name === toolName);
    assert.ok(tool, `${toolName} should be registered and available`);
    assert.equal(tool?.sideEffect, false);
    assert.equal(tool?.requiresApproval, false);
    assert.equal(tool?.risk, 'low');
  }
  assert.equal(workbenchTool?.sideEffect, true);
  assert.equal(workbenchTool?.requiresApproval, true);
  assert.equal(folderTool?.sideEffect, true);
  assert.equal(folderTool?.requiresApproval, true);
  assert.equal(fileWriteTool?.sideEffect, true);
  assert.equal(fileWriteTool?.requiresApproval, true);
  assert.equal(fileWriteManyTool?.sideEffect, true);
  assert.equal(fileWriteManyTool?.requiresApproval, true);
  assert.equal(fileReplaceTool?.sideEffect, true);
  assert.equal(fileReplaceTool?.requiresApproval, true);
  assert.equal(markdownTool?.sideEffect, true);
  assert.equal(markdownTool?.requiresApproval, true);
  assert.equal(studioTool?.sideEffect, true);
  assert.equal(studioTool?.requiresApproval, true);
  assert.equal(validateToolInput({ templateId: 'mind_map', prompt: '生成思维导图', sourceMode: 'model_knowledge' }, studioTool!.inputSchema).ok, true);
  assert.equal(validateToolInput({ templateId: 'mind_map', prompt: '根据刚才内容生成思维导图', contextRefs: [{ type: 'evidence', evidenceId: 'ev-1' }] }, studioTool!.inputSchema).ok, true);
  assert.equal(validateToolInput({ templateId: 'code_lab', prompt: '生成一个带测试用例的代码实验', sourceMode: 'model_knowledge' }, studioTool!.inputSchema).ok, true);
  assert.equal(validateToolInput({ templateId: 'light_visual_lesson', prompt: '基于资料生成轻量可视化讲解', contextRefs: [{ type: 'evidence', evidenceId: 'ev-1' }] }, studioTool!.inputSchema).ok, true);
  assert.equal(validateToolInput({ templateId: 'legacy_report', prompt: '生成报告', sourceMode: 'model_knowledge' }, studioTool!.inputSchema).ok, false);
  assert.equal(validateToolInput({ parentPath: 'course-report' }, folderTool!.inputSchema).ok, false);
  assert.equal(validateToolInput({ name: 'assets', parentPath: 'course-report', target: 'workspace' }, folderTool!.inputSchema).ok, true);
  assert.equal(validateToolInput({ filename: 'hello.c' }, fileWriteTool!.inputSchema).ok, false);
  assert.equal(validateToolInput({ filename: 'hello.c', content: 'int main(void) { return 0; }' }, fileWriteTool!.inputSchema).ok, true);
  assert.equal(validateToolInput({ files: [{ filename: 'main.c', content: 'int main(void){return 0;}' }] }, fileWriteManyTool!.inputSchema).ok, true);
  assert.equal(validateToolInput({ fileId: 'file-id', replacements: [{ search: 'a', replace: 'b' }] }, fileReplaceTool!.inputSchema).ok, true);
  assert.equal(validateToolInput({ filename: 'summary.md' }, markdownTool!.inputSchema).ok, false);
  assert.equal(validateToolInput({ filename: 'summary.md', content: '# Summary\n\nBody.' }, markdownTool!.inputSchema).ok, true);

  const workbenchPending = await executeDecisionTool(state, {
    id: 'decision-workbench',
    type: 'tool_call',
    tool: 'workbench.create',
    input: { title: '测试学习现场', description: '用于验证审批拦截。' },
    reason: 'test real side-effect registration',
    at: new Date().toISOString()
  });
  assert.equal(workbenchPending.observation.status, 'approval_required');

  const folderPending = await executeDecisionTool(state, {
    id: 'decision-folder-create-pending',
    type: 'tool_call',
    tool: 'folder.create',
    input: { name: 'assets', parentPath: 'course-report', target: 'workspace' },
    reason: 'test approval for folder create',
    at: new Date().toISOString()
  });
  assert.equal(folderPending.observation.status, 'approval_required');

  const decision: WorkspaceAgentDecision = {
    id: 'decision-test',
    type: 'tool_call',
    tool: 'test.approval_tool',
    input: { query: 'abc', limit: 2 },
    reason: 'test',
    at: new Date().toISOString()
  };

  const pending = await executeDecisionTool(state, decision);
  assert.equal(pending.observation.status, 'approval_required');
  assert.equal(pending.call.input.limit, 2);

  const approved = await executeDecisionTool(state, decision, { approved: true });
  assert.equal(approved.observation.status, 'success');
  assert.deepEqual(approved.raw, { artifactId: 'artifact-test' });

  const bad = await executeDecisionTool(state, {
    ...decision,
    input: { limit: 2 }
  });
  assert.equal(bad.observation.status, 'failed');
  assert.match(bad.observation.summary, /validation failed/);

  const attachmentWithoutIds = await executeDecisionTool(state, {
    id: 'decision-attachment',
    type: 'tool_call',
    tool: 'attachment.read',
    input: {},
    reason: 'test explicit attachment ids',
    at: new Date().toISOString()
  });
  assert.equal(attachmentWithoutIds.observation.status, 'failed');
  assert.match(attachmentWithoutIds.observation.summary, /Missing required field: scope/);
  assert.match(attachmentWithoutIds.observation.summary, /Missing required field: fileIds/);
  assert.match(attachmentWithoutIds.observation.summary, /Missing required field: limit/);

  const attachmentWrongScope = await executeDecisionTool(state, {
    id: 'decision-attachment-wrong-scope',
    type: 'tool_call',
    tool: 'attachment.read',
    input: { scope: 'workspace', fileIds: ['attachment-allowed'], limit: 1 },
    reason: 'test explicit attachment scope',
    at: new Date().toISOString()
  });
  assert.equal(attachmentWrongScope.observation.status, 'failed');
  assert.match(attachmentWrongScope.observation.summary, /chat_attachments/);

  const searchWithoutScope = await executeDecisionTool(state, {
    id: 'decision-search-missing-scope',
    type: 'tool_call',
    tool: 'workspace.file.search',
    input: { query: 'abc', limit: 3 },
    reason: 'test explicit search scope',
    at: new Date().toISOString()
  });
  assert.equal(searchWithoutScope.observation.status, 'failed');
  assert.match(searchWithoutScope.observation.summary, /Missing required field: scope/);

  const searchOutsideExplicitSources = await executeDecisionTool(state, {
    id: 'decision-search-denied-file',
    type: 'tool_call',
    tool: 'workspace.file.search',
    input: { query: 'abc', scope: 'explicit_sources', fileIds: ['file-denied'], limit: 3 },
    reason: 'test explicit source guard',
    at: new Date().toISOString()
  });
  assert.equal(searchOutsideExplicitSources.observation.status, 'skipped');
  assert.match(searchOutsideExplicitSources.observation.summary, /outside allowed explicit sources/);

  const fsListTool = state.availableTools.find((tool) => tool.name === 'workspace.fs.list');
  assert.ok(fsListTool, 'workspace.fs.list manifest should exist');
  assert.equal(validateToolInput({ scope: 'workspace', query: 'pdf ppt 教学', limit: 10 }, fsListTool!.inputSchema).ok, false);
  assert.match(validateToolInput({ scope: 'workspace', query: 'pdf ppt 教学', limit: 10 }, fsListTool!.inputSchema).errors.join('\n'), /Unknown field: query/);

  const user = await prisma.user.upsert({
    where: { email: 'workspace-agent-v2-runtime-check@example.local' },
    update: {},
    create: {
      username: 'workspace-agent-v2-runtime-check',
      email: 'workspace-agent-v2-runtime-check@example.local',
      password: 'runtime-check'
    }
  });
  await prisma.fileSystemObject.deleteMany({
    where: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      id: { in: ['runtime-check-pdf', 'runtime-check-md'] }
    }
  });
  await prisma.workspace.upsert({
    where: { id: 'workspace-agent-v2-runtime-check' },
    update: {
      name: 'Workspace Agent V2 Runtime Check',
      userId: user.id
    },
    create: {
      id: 'workspace-agent-v2-runtime-check',
      name: 'Workspace Agent V2 Runtime Check',
      userId: user.id
    }
  });
  await prisma.fileSystemObject.createMany({
    data: [
      {
        id: 'runtime-check-pdf',
        workspaceId: 'workspace-agent-v2-runtime-check',
        name: '04-Constraints.pdf',
        nodeType: 'file',
        path: '/Sources/04-Constraints.pdf',
        extension: 'pdf',
        mimeType: 'application/pdf',
        resourceType: 'source',
        fileCategory: 'document',
        scope: 'workspace',
        origin: 'upload',
        metadataJson: '{}',
        tags: '[]',
        isBinary: true,
        size: 1234
      },
      {
        id: 'runtime-check-md',
        workspaceId: 'workspace-agent-v2-runtime-check',
        name: 'notes.md',
        nodeType: 'file',
        path: '/Files/notes.md',
        extension: 'md',
        mimeType: 'text/markdown',
        resourceType: 'note',
        fileCategory: 'note',
        scope: 'workspace',
        origin: 'user',
        metadataJson: '{}',
        tags: '[]',
        content: '# Notes',
        size: 7
      }
    ]
  });
  const fsListState = makeState();
  fsListState.workspaceId = 'workspace-agent-v2-runtime-check';
  fsListState.context.workspaceId = fsListState.workspaceId;
  fsListState.contextControl.contextSources.workspace.id = fsListState.workspaceId;
  fsListState.availableTools = state.availableTools;
  const pdfList = await executeDecisionTool(fsListState, {
    id: 'decision-fs-list-pdf',
    type: 'tool_call',
    tool: 'workspace.fs.list',
    input: { scope: 'workspace', extensions: ['pdf'], limit: 10 },
    reason: 'test structured list filters',
    at: new Date().toISOString()
  });
  assert.equal(pdfList.observation.status, 'success');
  assert.match(pdfList.observation.summary, /Listed 1 of 1 entries in \//);
  assert.equal(pdfList.evidence.length, 1);
  assert.equal(pdfList.evidence[0].title, '04-Constraints.pdf');
  assert.equal((pdfList.raw as any)?.currentFolder?.path, '/');
  assert.equal((pdfList.raw as any)?.files?.length, 1);

  const fileWriteState = makeState();
  fileWriteState.workspaceId = 'workspace-agent-v2-runtime-check';
  fileWriteState.context.workspaceId = fileWriteState.workspaceId;
  fileWriteState.contextControl.contextSources.workspace.id = fileWriteState.workspaceId;
  fileWriteState.availableTools = state.availableTools;
  const folderName = `assets-${Date.now()}`;
  const folderApproved = await executeDecisionTool(fileWriteState, {
    id: 'decision-folder-create-approved',
    type: 'tool_call',
    tool: 'folder.create',
    input: { name: folderName, parentPath: 'course-report', target: 'workspace' },
    reason: 'test folder create',
    at: new Date().toISOString()
  }, { approved: true });
  assert.equal(folderApproved.observation.status, 'success');
  assert.equal((folderApproved.raw as any)?.folder?.path, `/course-report/${folderName}`);
  assert.equal(folderApproved.evidence[0].metadata?.path, `/course-report/${folderName}`);

  const fileWritePending = await executeDecisionTool(fileWriteState, {
    id: 'decision-file-write-pending',
    type: 'tool_call',
    tool: 'file.write',
    input: {
      filename: 'hello.c',
      content: '#include <stdio.h>\n\nint main(void) {\n  printf("Hello\\n");\n  return 0;\n}\n'
    },
    reason: 'test approval for generic write file',
    at: new Date().toISOString()
  });
  assert.equal(fileWritePending.observation.status, 'approval_required');
  const fileWriteApproved = await executeDecisionTool(fileWriteState, {
    id: 'decision-file-write-approved',
    type: 'tool_call',
    tool: 'file.write',
    input: {
      filename: 'hello.c',
      content: '#include <stdio.h>\n\nint main(void) {\n  printf("Hello\\n");\n  return 0;\n}\n'
    },
    reason: 'test generic write file',
    at: new Date().toISOString()
  }, { approved: true });
  assert.equal(fileWriteApproved.observation.status, 'success');
  assert.equal(fileWriteApproved.observation.artifactRefs?.[0]?.title.endsWith('.c'), true);
  assert.equal(fileWriteApproved.evidence[0].metadata?.extension, 'c');
  assert.match(String(fileWriteApproved.evidence[0].content), /#include <stdio\.h>/);
  const helloFileId = fileWriteApproved.observation.artifactRefs?.[0]?.id || '';
  assert.ok(helloFileId, 'file.write should return a file artifact');

  const fileWriteManyApproved = await executeDecisionTool(fileWriteState, {
    id: 'decision-file-write-many-approved',
    type: 'tool_call',
    tool: 'file.write_many',
    input: {
      targetDir: 'c-project',
      files: [
        { filename: 'main.c', content: '#include "utils.h"\n\nint main(void) { return answer(); }\n' },
        { filename: 'utils.h', content: 'int answer(void);\n' },
        { filename: 'utils.c', content: '#include "utils.h"\n\nint answer(void) { return 42; }\n' }
      ]
    },
    reason: 'test multiple file write',
    at: new Date().toISOString()
  }, { approved: true });
  assert.equal(fileWriteManyApproved.observation.status, 'success');
  assert.equal(fileWriteManyApproved.observation.artifactRefs?.length, 3);
  assert.deepEqual(
    fileWriteManyApproved.observation.artifactRefs?.map((item) => item.title.replace(/\(\d+\)(\.[^.]+)$/g, '$1')).sort(),
    ['main.c', 'utils.c', 'utils.h']
  );

  const replaceFailed = await executeDecisionTool(fileWriteState, {
    id: 'decision-file-replace-failed',
    type: 'tool_call',
    tool: 'file.replace',
    input: {
      fileId: helloFileId,
      replacements: [{ search: 'printf("Missing\\n");', replace: 'printf("Hi\\n");' }]
    },
    reason: 'test exact replace failure',
    at: new Date().toISOString()
  }, { approved: true });
  assert.equal(replaceFailed.observation.status, 'failed');
  assert.match(replaceFailed.observation.summary, /exactly once/);

  const replaceApproved = await executeDecisionTool(fileWriteState, {
    id: 'decision-file-replace-approved',
    type: 'tool_call',
    tool: 'file.replace',
    input: {
      fileId: helloFileId,
      replacements: [{ search: 'printf("Hello\\n");', replace: 'printf("Hi\\n");' }]
    },
    reason: 'test exact replace',
    at: new Date().toISOString()
  }, { approved: true });
  assert.equal(replaceApproved.observation.status, 'success');
  assert.match(String(replaceApproved.raw && (replaceApproved.raw as any).finalContent), /printf\("Hi\\n"\);/);

  const guard = new WorkspaceAgentV2LoopGuard();
  const repeatedState = makeState();
  repeatedState.stepCount = 5;
  repeatedState.maxSteps = 5;
  assert.equal(guard.inspect(repeatedState, { ...decision, id: 'last-step' }).ok, true);
  repeatedState.stepCount = 6;
  assert.equal(guard.inspect(repeatedState, { ...decision, id: 'over-step' }).ok, false);

  const imageAttachmentState = makeState();
  imageAttachmentState.contextControl.contextSources.chatAttachments = [{
    id: 'attachment-allowed',
    title: 'diagram.jpg',
    mimeType: 'image/jpeg',
    size: 1234,
    kind: 'chat_attachment'
  }];
  imageAttachmentState.availableTools = state.availableTools;
  const imageFallback = fallbackDecision(imageAttachmentState);
  assert.notEqual(imageFallback.tool, 'attachment.image.inspect');

  const textAttachmentState = makeState();
  textAttachmentState.contextControl.contextSources.chatAttachments = [{
    id: 'attachment-allowed',
    title: '1.py',
    mimeType: 'text/x-python',
    size: 234,
    kind: 'chat_attachment'
  }];
  textAttachmentState.availableTools = state.availableTools;
  const textFallback = fallbackDecision(textAttachmentState);
  assert.equal(textFallback.type, 'tool_call');
  assert.equal(textFallback.tool, 'attachment.read');
  assert.deepEqual(textFallback.input?.fileIds, ['attachment-allowed']);

  const explicitPreferredWithoutSources = makeState();
  explicitPreferredWithoutSources.availableTools = state.availableTools;
  explicitPreferredWithoutSources.contextControl.acquisitionConstraints.preferredScopes = ['explicit_sources'];
  const explicitPreferredFallback = fallbackDecision(explicitPreferredWithoutSources);
  assert.equal(explicitPreferredFallback.type, 'tool_call');
  assert.equal(explicitPreferredFallback.tool, 'workspace.file.search');
  assert.equal(explicitPreferredFallback.input?.scope, 'workspace');

  const webSearchFallbackState = makeState();
  webSearchFallbackState.userInput = '帮我联网搜索一下最新的数据库事务隔离级别官方教程。';
  webSearchFallbackState.availableTools = state.availableTools;
  webSearchFallbackState.contextControl.acquisitionConstraints.preferredTools = ['web.search'];
  const webSearchFallback = fallbackDecision(webSearchFallbackState);
  assert.equal(webSearchFallback.type, 'tool_call');
  assert.equal(webSearchFallback.tool, 'web.search');
  assert.equal(webSearchFallback.input?.provider, 'auto');

  const webFetchFallbackState = makeState();
  webFetchFallbackState.userInput = '读一下这个网页 https://example.com/course/txn 然后总结。';
  webFetchFallbackState.availableTools = state.availableTools;
  const webFetchFallback = fallbackDecision(webFetchFallbackState);
  assert.equal(webFetchFallback.type, 'tool_call');
  assert.equal(webFetchFallback.tool, 'web.fetch');
  assert.equal(webFetchFallback.input?.url, 'https://example.com/course/txn');

  const retryDecisionState = makeState();
  retryDecisionState.availableTools = state.availableTools;
  const originalIsConfigured = aiModelProviderService.isConfigured.bind(aiModelProviderService);
  const originalJson = aiModelProviderService.json.bind(aiModelProviderService);
  let decisionAttempts = 0;
  (aiModelProviderService as any).isConfigured = () => true;
  (aiModelProviderService as any).json = async () => {
    decisionAttempts += 1;
    if (decisionAttempts === 1) throw new Error('fetch failed');
    return {
      data: { type: 'final', answer: 'retry ok', reason: 'Recovered after transient model failure.' },
      model: 'test-model',
      provider: 'openai',
      usage: null
    };
  };
  try {
    const recoveredDecision = await decideNextStep(retryDecisionState);
    assert.equal(decisionAttempts, 2);
    assert.equal(recoveredDecision.type, 'final');
    assert.equal(recoveredDecision.answer, 'retry ok');
    assert.equal(recoveredDecision.model, 'test-model');
    assert.ok(retryDecisionState.trace.some((item) => /retrying/.test(item.message)));
    assert.ok(retryDecisionState.trace.some((item) => /recovered/.test(item.message)));
  } finally {
    (aiModelProviderService as any).isConfigured = originalIsConfigured;
    (aiModelProviderService as any).json = originalJson;
  }

  const readContextState = makeState();
  readContextState.evidence = [
    {
      id: 'ev-old',
      kind: 'workspace_file_content',
      title: 'schema.sql',
      summary: 'old read',
      content: 'SELECT 1;',
      source: '/schema.sql',
      metadata: { fileObjectId: 'file-sql', path: '/schema.sql', locator: { textLength: 9 } }
    },
    {
      id: 'ev-latest',
      kind: 'workspace_file_content',
      title: 'schema.sql',
      summary: 'latest read',
      content: 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT\n);',
      source: '/schema.sql',
      metadata: { fileObjectId: 'file-sql', path: '/schema.sql', locator: { textLength: 61 } }
    },
    {
      id: 'ev-card',
      kind: 'workspace_file_card',
      title: 'schema.sql',
      summary: '/schema.sql application/sql',
      source: '/schema.sql',
      metadata: { fileObjectId: 'file-sql', path: '/schema.sql' }
    }
  ];
  const modelContext = buildWorkspaceAgentModelContext(readContextState, { phase: 'decision', maxChars: 4000 });
  assert.equal(modelContext[0].kind, 'read_result');
  assert.equal(modelContext[0].id, 'ev-latest');
  assert.match(modelContext[0].content || '', /CREATE TABLE users \(\n  id INTEGER PRIMARY KEY/);
  assert.equal(modelContext.some((item) => item.id === 'ev-old'), false);

  const historyState = makeState();
  historyState.userInput = '把里面所有概念细化成 md';
  const previousReadDecision: WorkspaceAgentDecision = {
    id: 'decision-read-pdf',
    type: 'tool_call',
    tool: 'workspace.file.read',
    input: { scope: 'workspace', fileIds: ['file-pdf'], limit: 1, maxCharsPerFile: 8000 },
    reason: 'read prior pdf',
    at: new Date().toISOString()
  };
  const previousReadCall = {
    id: 'toolcall-read-pdf',
    tool: 'workspace.file.read',
    input: previousReadDecision.input || {},
    status: 'success' as const,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    observationId: 'obs-read-pdf'
  };
  const previousReadObservation = {
    id: 'obs-read-pdf',
    tool: 'workspace.file.read',
    status: 'success' as const,
    summary: 'Read 1 workspace files in scope=workspace.',
    evidenceIds: ['ev-pdf-read'],
    at: new Date().toISOString()
  };
  const previousReadEvidence = [{
    id: 'ev-pdf-read',
    kind: 'workspace_file_content',
    title: '06-SQL-1_2026.pdf',
    summary: 'SQL constraints and SELECT basics',
    content: '完整性约束包括实体完整性、参照完整性和用户定义完整性。\nSQL SELECT 包括 SELECT FROM WHERE。',
    source: '/SQL与关系代数整理/Sources/06-SQL-1_2026.pdf',
    metadata: { fileObjectId: 'file-pdf', path: '/SQL与关系代数整理/Sources/06-SQL-1_2026.pdf', locator: { textLength: 80 } }
  }];
  historyState.agentMessages = appendUserTurnMessage([], 'turn-1', [{ role: 'user', content: '阅读一下06pdf文件，总结一下内容' }]);
  historyState.agentMessages = appendToolUseMessage(historyState.agentMessages, 'turn-1', previousReadDecision);
  historyState.agentMessages = appendToolResultMessage(historyState.agentMessages, 'turn-1', previousReadCall, previousReadObservation, previousReadEvidence);
  const inheritedContext = buildWorkspaceAgentModelContext(historyState, { phase: 'decision', maxChars: 8000 });
  assert.equal(inheritedContext[0].kind, 'read_result');
  assert.equal(inheritedContext[0].title, '06-SQL-1_2026.pdf');
  assert.match(inheritedContext[0].content || '', /实体完整性/);

  const studioCapsuleState = makeState();
  studioCapsuleState.workspaceId = 'workspace-agent-v2-runtime-check';
  studioCapsuleState.context.workspaceId = studioCapsuleState.workspaceId;
  studioCapsuleState.contextControl.contextSources.workspace.id = studioCapsuleState.workspaceId;
  studioCapsuleState.evidence = [{
    id: 'ev-studio-read',
    kind: 'workspace_file_content',
    title: 'notes.md',
    summary: '关系代数和 SQL 复习证据',
    content: '选择运算对应 WHERE，投影运算对应 SELECT 列表，连接运算对应 JOIN。',
    source: '/Files/notes.md',
    metadata: { fileObjectId: 'runtime-check-md', path: '/Files/notes.md', locator: { lineStart: 1, lineEnd: 3 } }
  }];
  const studioCapsule = await buildStudioContextFromAgentEvidence({
    context: {
      ...studioCapsuleState.context,
      userInput: '根据刚才读到的内容生成思维导图',
      contextControl: studioCapsuleState.contextControl,
      evidence: studioCapsuleState.evidence,
      agentMessages: studioCapsuleState.agentMessages
    },
    prompt: '根据刚才读到的内容生成思维导图',
    refs: [
      { type: 'workspace_file', fileId: 'runtime-check-md' },
      { type: 'evidence', evidenceId: 'ev-studio-read' }
    ],
    sourceMode: 'evidence'
  });
  assert.equal(studioCapsule.capsule.resources?.[0]?.fileId, 'runtime-check-md');
  assert.equal(studioCapsule.capsule.retrievedChunks?.[0]?.chunkId, 'ev-studio-read');
  assert.match(studioCapsule.capsule.retrievedChunks?.[0]?.content || '', /投影运算对应 SELECT/);
  assert.equal(studioCapsule.capsule.citations.some((citation) => citation.fileId === 'runtime-check-md'), true);
  assert.match(studioCapsule.capsule.promptContextPreview || '', /Agent-built Context Capsule/);

  const changedTopicState = makeState();
  changedTopicState.userInput = '搜索一下网上关于 iPhone 17 Pro 的最新信息';
  changedTopicState.agentMessages = historyState.agentMessages;
  const changedTopicContext = buildWorkspaceAgentModelContext(changedTopicState, { phase: 'decision', maxChars: 8000 });
  assert.ok(changedTopicContext.some((item) => item.title === '06-SQL-1_2026.pdf'));
  assert.equal(changedTopicContext.find((item) => item.title === '06-SQL-1_2026.pdf')?.stale, true);

  const finalDialogueState = makeState();
  finalDialogueState.userInput = '[4, 10, 3, 5, 1]';
  finalDialogueState.messages = [
    { role: 'user', content: '堆排序是什么东西，你用一个数组例子解释一下' },
    { role: 'assistant', content: '可以，用数组 [4, 10, 3, 5, 1] 解释堆排序。' },
    { role: 'user', content: '画一张树形图吧，就用刚才的例子解释' },
    { role: 'assistant', content: '可以，我会用刚才的数组画成堆结构来解释。' },
    { role: 'user', content: '[4, 10, 3, 5, 1]' }
  ];
  finalDialogueState.agentMessages = finalDialogueState.messages.map((message, index) => ({
    id: `hist-final-dialogue-${index}`,
    role: message.role,
    turnId: index === finalDialogueState.messages.length - 1 ? finalDialogueState.currentTurnId : `turn-final-dialogue-${index}`,
    content: message.content,
    createdAt: new Date().toISOString(),
    metadata: { userVisible: true }
  }));
  finalDialogueState.evidence = [{
    id: 'ev-noisy-file-card',
    kind: 'workspace_file_card',
    title: 'unrelated-folder',
    summary: 'A noisy workspace folder listing that should not replace dialogue intent.',
    source: '/unrelated-folder',
    metadata: { path: '/unrelated-folder' }
  }];
  const finalMessages = buildFinalAnswerMessages(
    finalDialogueState,
    buildWorkspaceAgentModelContext(finalDialogueState, { phase: 'final', maxChars: 8000 }),
    { maxTotalChars: 12000, maxToolContextChars: 5000 }
  );
  assert.ok(finalMessages.some((message) => message.role === 'user' && /画一张树形图/.test(message.content)));
  assert.ok(finalMessages.some((message) => message.role === 'assistant' && /刚才的数组/.test(message.content)));
  assert.match(finalMessages[finalMessages.length - 1].content, /\[4, 10, 3, 5, 1\]/);
  assert.equal(finalMessages.some((message) => /DeliveryContract|Evidence\/context blocks|Current user input/.test(message.content)), false);
  const finalPayload = buildFinalAnswerMessagePayload(
    finalDialogueState,
    buildWorkspaceAgentModelContext(finalDialogueState, { phase: 'final', maxChars: 8000 }),
    { maxTotalChars: 12000, maxToolContextChars: 5000 }
  );
  assert.match(finalPayload.systemPrompt, /unrelated-folder/);

  const imageFinalState = makeState();
  imageFinalState.userInput = '给我讲讲这个，没看懂';
  imageFinalState.messages = [
    {
      role: 'user',
      content: '给我讲讲这个，没看懂',
      files: [{ id: 'image-current', name: 'screenshot.png', mimeType: 'image/png', size: 1234 }]
    }
  ];
  imageFinalState.agentMessages = appendUserTurnMessage([], imageFinalState.currentTurnId, imageFinalState.messages);
  imageFinalState.observations = [{
    id: 'obs-image',
    tool: 'attachment.image.inspect',
    status: 'success',
    summary: 'Read 1 image attachments as multimodal context.',
    evidenceIds: ['ev-image'],
    at: new Date().toISOString()
  }];
  const imagePayload = buildFinalAnswerMessagePayload(
    imageFinalState,
    [{
      id: 'ev-image',
      kind: 'read_result',
      title: 'screenshot.png',
      summary: 'Image attachment was read successfully.',
      metadata: { fileObjectId: 'image-current', hasImagePayload: true }
    }],
    { maxTotalChars: 8000, maxToolContextChars: 3000 }
  );
  assert.equal(imagePayload.messages.length, 1);
  assert.equal(imagePayload.messages[0].content, '给我讲讲这个，没看懂');
  assert.equal(/DeliveryContract|Evidence\/context blocks|Current user input/.test(imagePayload.messages[0].content), false);
  assert.match(imagePayload.systemPrompt, /If the visible conversation asks about an attached image/);

  const listOnlyControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '先不要读正文，帮我看看 workspace 里有哪些 SQL 相关的 pdf 或 markdown 资料。' }]
    },
    messages: [{ role: 'user', content: '先不要读正文，帮我看看 workspace 里有哪些 SQL 相关的 pdf 或 markdown 资料。' }],
    userInput: '先不要读正文，帮我看看 workspace 里有哪些 SQL 相关的 pdf 或 markdown 资料。',
    chatFiles: []
  });
  assert.ok(listOnlyControl.toolAvailability.enabledTools.includes('workspace.fs.list'));
  assert.ok(listOnlyControl.toolAvailability.enabledTools.includes('workspace.file.search'));
  assert.ok(listOnlyControl.acquisitionConstraints.deniedTools.includes('workspace.file.read'));
  assert.ok(listOnlyControl.acquisitionConstraints.deniedTools.includes('attachment.read'));

  const onlineSearchControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '帮我联网搜索一下最新的 TypeScript 官方文档和教程。' }]
    },
    messages: [{ role: 'user', content: '帮我联网搜索一下最新的 TypeScript 官方文档和教程。' }],
    userInput: '帮我联网搜索一下最新的 TypeScript 官方文档和教程。',
    chatFiles: []
  });
  assert.ok(onlineSearchControl.toolAvailability.enabledTools.includes('web.search'));
  assert.ok(onlineSearchControl.toolAvailability.enabledTools.includes('web.fetch'));
  assert.ok(onlineSearchControl.acquisitionConstraints.preferredTools.includes('web.search'));

  const noWebControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '不要联网，只根据当前 workspace 回答。' }]
    },
    messages: [{ role: 'user', content: '不要联网，只根据当前 workspace 回答。' }],
    userInput: '不要联网，只根据当前 workspace 回答。',
    chatFiles: []
  });
  assert.ok(noWebControl.toolAvailability.disabledTools.some((item) => item.tool === 'web.search' && item.reason === 'user_steering'));
  assert.ok(noWebControl.toolAvailability.disabledTools.some((item) => item.tool === 'web.fetch' && item.reason === 'user_steering'));

  const inlineMarkdownControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '用 Markdown 格式回答我数据库事务的概念。' }]
    },
    messages: [{ role: 'user', content: '用 Markdown 格式回答我数据库事务的概念。' }],
    userInput: '用 Markdown 格式回答我数据库事务的概念。',
    chatFiles: []
  });
  assert.equal(inlineMarkdownControl.deliveryContract.required, false);
  assert.equal(inlineMarkdownControl.deliveryContract.target, 'inline_answer');

  const interactivePracticeHintControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '很好，给我出几道可交互的关于排序算法的选择题，不只是堆排序，方便我辨析概念' }]
    },
    messages: [{ role: 'user', content: '很好，给我出几道可交互的关于排序算法的选择题，不只是堆排序，方便我辨析概念' }],
    userInput: '很好，给我出几道可交互的关于排序算法的选择题，不只是堆排序，方便我辨析概念',
    chatFiles: []
  });
  assert.equal(interactivePracticeHintControl.deliveryContract.required, false);
  assert.equal(interactivePracticeHintControl.deliveryContract.target, 'inline_answer');
  assert.ok(interactivePracticeHintControl.artifactHints?.possibleTargets.includes('studio_artifact'));
  assert.ok(interactivePracticeHintControl.artifactHints?.possibleTargets.includes('inline_answer'));
  assert.ok(interactivePracticeHintControl.artifactHints?.possibleKinds.includes('practice'));
  assert.ok(interactivePracticeHintControl.artifactHints?.possibleInteractivity.includes('studio_renderer'));
  assert.ok(interactivePracticeHintControl.artifactHints?.possibleInteractivity.includes('chat'));
  assert.ok((interactivePracticeHintControl.artifactHints?.confidence || 0) < 0.86);

  const pdfReadControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '阅读一下06-SQL-1_2026.pdf，给我讲讲具体的内容' }]
    },
    messages: [{ role: 'user', content: '阅读一下06-SQL-1_2026.pdf，给我讲讲具体的内容' }],
    userInput: '阅读一下06-SQL-1_2026.pdf，给我讲讲具体的内容',
    chatFiles: []
  });
  assert.equal(pdfReadControl.deliveryContract.required, false);
  assert.equal(pdfReadControl.deliveryContract.target, 'inline_answer');

  const markdownDeliveryControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '把刚才整理的内容生成 md 文件，放进 workspace。' }]
    },
    messages: [{ role: 'user', content: '把刚才整理的内容生成 md 文件，放进 workspace。' }],
    userInput: '把刚才整理的内容生成 md 文件，放进 workspace。',
    chatFiles: []
  });
  assert.equal(markdownDeliveryControl.deliveryContract.required, true);
  assert.equal(markdownDeliveryControl.deliveryContract.target, 'workspace_file');
  assert.equal(markdownDeliveryControl.deliveryContract.format, 'markdown');
  assert.equal(markdownDeliveryControl.deliveryContract.status, 'pending');

  const markdownNoteDeliveryControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '继续深入分析这份资料，并给我整理成一份md笔记，放进workspace根目录' }]
    },
    messages: [{ role: 'user', content: '继续深入分析这份资料，并给我整理成一份md笔记，放进workspace根目录' }],
    userInput: '继续深入分析这份资料，并给我整理成一份md笔记，放进workspace根目录',
    chatFiles: []
  });
  assert.equal(markdownNoteDeliveryControl.deliveryContract.required, true);
  assert.equal(markdownNoteDeliveryControl.deliveryContract.target, 'workspace_file');
  assert.equal(markdownNoteDeliveryControl.deliveryContract.format, 'markdown');
  assert.equal(markdownNoteDeliveryControl.deliveryContract.status, 'pending');

  const codeDeliveryControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '生成 hello.c 放到 workspace。' }]
    },
    messages: [{ role: 'user', content: '生成 hello.c 放到 workspace。' }],
    userInput: '生成 hello.c 放到 workspace。',
    chatFiles: []
  });
  assert.equal(codeDeliveryControl.deliveryContract.required, true);
  assert.equal(codeDeliveryControl.deliveryContract.format, 'code');
  assert.equal(codeDeliveryControl.deliveryContract.requiredFiles?.[0]?.filename, 'hello.c');
  assert.equal(codeDeliveryControl.deliveryContract.requiredFiles?.[0]?.extension, 'c');

  const projectDeliveryControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '生成一个 C 项目，包括 main.c、utils.c、utils.h，放进 workspace。' }]
    },
    messages: [{ role: 'user', content: '生成一个 C 项目，包括 main.c、utils.c、utils.h，放进 workspace。' }],
    userInput: '生成一个 C 项目，包括 main.c、utils.c、utils.h，放进 workspace。',
    chatFiles: []
  });
  assert.equal(projectDeliveryControl.deliveryContract.required, true);
  assert.equal(projectDeliveryControl.deliveryContract.requiredFiles?.length, 3);
  assert.deepEqual(projectDeliveryControl.deliveryContract.requiredFiles?.map((file) => file.filename), ['main.c', 'utils.c', 'utils.h']);

  const threeMarkdownControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '生成三个 md 文件放进 workspace。' }]
    },
    messages: [{ role: 'user', content: '生成三个 md 文件放进 workspace。' }],
    userInput: '生成三个 md 文件放进 workspace。',
    chatFiles: []
  });
  assert.equal(threeMarkdownControl.deliveryContract.required, true);
  assert.equal(threeMarkdownControl.deliveryContract.format, 'markdown');
  assert.equal(threeMarkdownControl.deliveryContract.requiredFiles?.length, 3);
  assert.equal(threeMarkdownControl.deliveryContract.requiredFiles?.every((file) => file.extension === 'md'), true);

  const markdownDeliveryState = makeState();
  markdownDeliveryState.userInput = '很好，把上面的这份你给我的深度整理，变成md文件放入我的课程空间';
  markdownDeliveryState.availableTools = state.availableTools;
  markdownDeliveryState.contextControl.deliveryContract = markdownDeliveryControl.deliveryContract;
  markdownDeliveryState.context.deliveryContract = markdownDeliveryControl.deliveryContract;
  markdownDeliveryState.agentMessages = [
    {
      id: 'hist-user-previous',
      role: 'user',
      turnId: 'turn-previous',
      content: '请你给我对PPT中的具体内容详细展开解释一下',
      createdAt: new Date().toISOString()
    },
    {
      id: 'hist-assistant-previous',
      role: 'assistant',
      turnId: 'turn-previous',
      content: [
        '# SQL 完整性约束深度整理',
        '',
        '这份 PPT 主要在讲 SQL 中的数据完整性约束，以及如何在 CREATE TABLE 中定义 PRIMARY KEY、FOREIGN KEY、UNIQUE、CHECK 等约束。',
        '',
        '## 实体完整性',
        '实体完整性要求主键唯一且不能为空。',
        '',
        '## 参照完整性',
        '参照完整性要求外键引用已经存在的主表记录。'
      ].join('\n'),
      createdAt: new Date().toISOString()
    },
    {
      id: 'hist-user-current',
      role: 'user',
      turnId: markdownDeliveryState.currentTurnId,
      content: markdownDeliveryState.userInput,
      createdAt: new Date().toISOString()
    }
  ];
  const markdownFallback = fallbackDecision(markdownDeliveryState);
  assert.equal(markdownFallback.type, 'tool_call');
  assert.equal(markdownFallback.tool, 'markdown_note.create');
  assert.match(String(markdownFallback.input?.filename), /\.md$/);
  assert.match(String(markdownFallback.input?.content), /SQL 完整性约束深度整理/);
  assert.match(String(markdownFallback.input?.content), /参照完整性/);

  const markdownNoteDeliveryState = makeState();
  markdownNoteDeliveryState.userInput = '继续深入分析这份资料，并给我整理成一份md笔记，放进workspace根目录';
  markdownNoteDeliveryState.availableTools = state.availableTools;
  markdownNoteDeliveryState.contextControl.deliveryContract = markdownNoteDeliveryControl.deliveryContract;
  markdownNoteDeliveryState.context.deliveryContract = markdownNoteDeliveryControl.deliveryContract;
  markdownNoteDeliveryState.agentMessages = [
    {
      id: 'hist-user-note-previous',
      role: 'user',
      turnId: 'turn-note-previous',
      content: '阅读一下06-SQL-1_2026.pdf，给我讲讲具体的内容',
      createdAt: new Date().toISOString()
    },
    {
      id: 'hist-assistant-note-previous',
      role: 'assistant',
      turnId: 'turn-note-previous',
      content: [
        '# SQL 查询与完整性约束分析',
        '',
        '这份资料涵盖 CREATE TABLE 约束、PRIMARY KEY、FOREIGN KEY、CHECK，以及 SELECT 查询、聚合函数和 GROUP BY。',
        '',
        '## 重点',
        '需要把表级约束、列级约束和聚合查询放在一起理解。'
      ].join('\n'),
      createdAt: new Date().toISOString()
    },
    {
      id: 'hist-user-note-current',
      role: 'user',
      turnId: markdownNoteDeliveryState.currentTurnId,
      content: markdownNoteDeliveryState.userInput,
      createdAt: new Date().toISOString()
    }
  ];
  const markdownNoteFallback = fallbackDecision(markdownNoteDeliveryState);
  assert.equal(markdownNoteFallback.type, 'tool_call');
  assert.equal(markdownNoteFallback.tool, 'markdown_note.create');
  assert.match(String(markdownNoteFallback.input?.filename), /\.md$/);
  assert.match(String(markdownNoteFallback.input?.content), /SQL 查询与完整性约束分析/);

  const deliverySatisfiedState = makeState();
  deliverySatisfiedState.userInput = '把刚才整理的内容生成 md 文件，放进 workspace。';
  deliverySatisfiedState.contextControl.deliveryContract = markdownDeliveryControl.deliveryContract;
  deliverySatisfiedState.observations = [{
    id: 'obs-markdown-created',
    tool: 'markdown_note.create',
    status: 'success',
    summary: 'Created Markdown file "summary.md".',
    artifactRefs: [{ kind: 'file', id: 'file-summary', title: 'summary.md' }],
    at: new Date().toISOString()
  }];
  deliverySatisfiedState.evidence = [{
    id: 'ev-markdown-created',
    kind: 'markdown_file',
    title: 'summary.md',
    summary: '已创建 Markdown 文件：/summary.md',
    source: '/summary.md',
    metadata: { fileObjectId: 'file-summary' }
  }];
  const satisfiedControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: deliverySatisfiedState.userInput }]
    },
    messages: [{ role: 'user', content: deliverySatisfiedState.userInput }],
    userInput: deliverySatisfiedState.userInput,
    chatFiles: [],
    previousState: deliverySatisfiedState,
    allowPreviousDeliveryArtifacts: true
  });
  assert.equal(satisfiedControl.deliveryContract.status, 'satisfied');
  assert.equal(satisfiedControl.deliveryContract.satisfiedBy?.tool, 'markdown_note.create');
  assert.equal(satisfiedControl.deliveryContract.satisfiedBy?.id, 'file-summary');

  const unrelatedInlineAfterSatisfiedControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '你好' }]
    },
    messages: [{ role: 'user', content: '你好' }],
    userInput: '你好',
    chatFiles: [],
    previousState: deliverySatisfiedState
  });
  assert.equal(unrelatedInlineAfterSatisfiedControl.deliveryContract.required, false);
  assert.equal(unrelatedInlineAfterSatisfiedControl.deliveryContract.target, 'inline_answer');
  assert.equal(unrelatedInlineAfterSatisfiedControl.deliveryContract.status, 'satisfied');

  const pendingPreviousState = makeState();
  pendingPreviousState.userInput = '阅读一下06-SQL-1_2026.pdf，给我讲讲具体的内容';
  pendingPreviousState.contextControl.deliveryContract = {
    required: true,
    target: 'workspace_file',
    action: 'create',
    format: 'unknown',
    filenameHint: '阅读一下06-SQL-1_2026.pdf',
    requiredFiles: [{ filename: '阅读一下06-SQL-1_2026.pdf', extension: 'pdf', role: 'main', status: 'pending' }],
    scope: 'workspace',
    rawUserText: pendingPreviousState.userInput,
    confidence: 0.94,
    status: 'pending'
  };
  const unrelatedInlineAfterPendingControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: '你好' }]
    },
    messages: [{ role: 'user', content: '你好' }],
    userInput: '你好',
    chatFiles: [],
    previousState: pendingPreviousState
  });
  assert.equal(unrelatedInlineAfterPendingControl.deliveryContract.required, false);
  assert.equal(unrelatedInlineAfterPendingControl.deliveryContract.target, 'inline_answer');
  assert.equal(unrelatedInlineAfterPendingControl.deliveryContract.status, 'satisfied');

  const projectSatisfiedState = makeState();
  projectSatisfiedState.userInput = '生成一个 C 项目，包括 main.c、utils.c、utils.h，放进 workspace。';
  projectSatisfiedState.contextControl.deliveryContract = projectDeliveryControl.deliveryContract;
  projectSatisfiedState.observations = [{
    id: 'obs-project-created',
    tool: 'file.write_many',
    status: 'success',
    summary: 'Created 3 files: main.c, utils.c, utils.h.',
    artifactRefs: [
      { kind: 'file', id: 'file-main', title: 'main.c' },
      { kind: 'file', id: 'file-utils-c', title: 'utils.c' },
      { kind: 'file', id: 'file-utils-h', title: 'utils.h' }
    ],
    at: new Date().toISOString()
  }];
  projectSatisfiedState.evidence = [
    { id: 'ev-main', kind: 'generated_file', title: 'main.c', summary: 'main', source: '/main.c', metadata: { fileObjectId: 'file-main' } },
    { id: 'ev-utils-c', kind: 'generated_file', title: 'utils.c', summary: 'utils c', source: '/utils.c', metadata: { fileObjectId: 'file-utils-c' } },
    { id: 'ev-utils-h', kind: 'generated_file', title: 'utils.h', summary: 'utils h', source: '/utils.h', metadata: { fileObjectId: 'file-utils-h' } }
  ];
  const projectSatisfiedControl = await buildWorkspaceAgentV2ContextControl({
    runInput: {
      workspaceId: 'workspace-agent-v2-runtime-check',
      messages: [{ role: 'user', content: projectSatisfiedState.userInput }]
    },
    messages: [{ role: 'user', content: projectSatisfiedState.userInput }],
    userInput: projectSatisfiedState.userInput,
    chatFiles: [],
    previousState: projectSatisfiedState,
    allowPreviousDeliveryArtifacts: true
  });
  assert.equal(projectSatisfiedControl.deliveryContract.status, 'satisfied');
  assert.equal(projectSatisfiedControl.deliveryContract.requiredFiles?.every((file) => file.status === 'satisfied'), true);

  console.log('Workspace Agent V2 runtime checks passed.');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

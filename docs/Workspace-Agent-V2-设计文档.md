# Workspace Agent V2 设计文档

## 1. 背景与目标

当前项目已经有一套 `workspaceAgent` 实现，位于 `backend/src/services/workspaceAgent/`。它使用 LangGraph 搭建了可运行的 agentic terminal 架构，并且已经接入了部分业务能力，例如知识检索、课程图谱、学习计划、AI Studio 产物生成、资源分析、文件索引等。

但现有实现的问题也很明确：工具选择和业务路由大量集中在 `strategyForRoute`、`executeTool`、`buildProposal`、`normalizeActionKind`、`inferActionKindsFromRequest` 等硬编码分支中。随着 Workbench、AI Studio、资源发现、知识图谱治理、学习记忆、视频/音频分析等能力继续增加，这种“中央 switch”会越来越难维护，也会偏离 Codex/Cline 这类 agent 的核心设计。

Workspace Agent V2 的目标不是重写业务函数，而是重建一套干净的 agent runtime 外壳：

- 保留现有业务 service。
- 保留旧 `agentic` 实现作为 legacy runtime。
- 新增 `new_agentic` 模式用于 V2。
- 将业务能力声明成工具目录。
- 让模型根据工具说明、当前上下文和执行观察决定下一步。
- 让系统负责 schema 校验、审批、安全、循环控制、状态记录和结果压缩。

一句话目标：

```text
Graph 管流程，Model 选工具，Registry 管能力声明，Executor 跑工具，Policy 管审批，Reducer 管 observation，LoopGuard 管失控防护。
```

## 2. 参照模式

### 2.1 Cline 模式

Cline 的公开文档和源码体现的是长生命周期 session runtime，而不是单步 planner。

关键特征：

- session 可 `start`、`send`、`abort`、`stop`、`restore`。
- agent 执行过程中会持续产生事件。
- 用户中途输入可以进入 pending prompt / steering 队列。
- 工具执行前有 approval/safety 层。
- 重复工具调用有 loop detection。
- 工具结果会回到模型上下文，模型继续决定下一步。

相关源码参考：

- `ClineCore.ts`: https://github.com/cline/cline/blob/main/sdk/packages/core/src/ClineCore.ts
- `session-runtime-orchestrator.ts`: https://github.com/cline/cline/blob/main/sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
- `tool-approval.ts`: https://github.com/cline/cline/blob/main/sdk/packages/core/src/runtime/tools/tool-approval.ts
- `loop-detection.ts`: https://github.com/cline/cline/blob/main/sdk/packages/core/src/runtime/safety/loop-detection.ts
- `pending-prompt-service.ts`: https://github.com/cline/cline/blob/main/sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts

V2 不复制 Cline 源码，但采纳它的核心控制回路：

```text
Model decision -> Tool execution -> Observation -> Model decision -> ...
```

### 2.2 Codex 模式

Codex 的内部实现不开源，但官方公开描述表明它是任务环境中的 coding agent：能够读取代码、编辑文件、运行命令/测试，并将结果交给用户审查。它同样不是“单次判断后结束”的架构，而是围绕任务目标持续行动、观察、调整、再行动。

参考：

- Introducing Codex: https://openai.com/index/introducing-codex/
- Introducing GPT-5.3-Codex: https://openai.com/index/introducing-gpt-5-3-codex/

V2 采纳的 Codex/Cline 共通思想：

```text
模型不是只负责回答文本，而是在受控环境里选择下一步行动。
系统不是替模型写死业务分支，而是提供工具、约束、审批和可审计执行。
```

### 2.3 与 LangGraph 的关系

Codex/Cline 思想与 LangGraph 不冲突。

LangGraph 适合做：

- 状态机。
- 循环控制。
- 条件跳转。
- approval interrupt / resume。
- trace 记录。
- checkpoint。
- 并行或分阶段调度。

LangGraph 不应该做：

- 用大量 if/switch 写死业务意图。
- 替模型决定所有业务工具。
- 把所有业务函数塞进一个巨大的 runtime 文件。

V2 中，LangGraph 是外层可靠控制流；模型是每一步工具选择器；工具 registry 是能力目录。

## 3. 核心原则

### 3.1 持续循环，而非单步 planner

V2 不设计成：

```text
User -> AgentPlanner -> Tool -> Final
```

而设计成：

```text
User/Resume
  -> Build ContextSources
  -> Build Available Tool Catalog
  -> Model Decision
  -> Safety / Approval / Execution
  -> Observation
  -> Model Decision
  -> ...
  -> Final Response
```

每一次 `ModelDecision` 都重新看当前状态和已有观察，再决定下一步。

### 3.2 模型选择工具，系统执行工具

模型可以决定：

- 是否需要调用工具。
- 调用哪个工具。
- 用什么输入调用工具。
- 是否需要向用户澄清。
- 是否已经可以 final。

系统必须决定：

- 工具是否存在。
- 输入是否符合 schema。
- 当前用户/上下文是否有权限。
- 工具是否有副作用。
- 是否需要用户确认。
- 是否命中循环/预算/风险限制。
- 工具结果如何压缩成 observation。

### 3.3 工具声明优先于业务正则

新能力接入 V2 的方式应该是注册工具：

```ts
{
  name: "studio.generate_artifact",
  title: "生成 AI Studio 产物",
  description: "当用户希望基于 workspace/workbench 资料生成笔记、测验、思维导图、课件、可视化、代码实验等学习产物时使用。",
  inputSchema: {...},
  risk: "medium",
  sideEffect: true,
  requiresApproval: true,
  execute: async (input, context) => ...
}
```

不应该继续扩张这类逻辑：

```ts
if (/测验|练习|quiz/.test(text)) ...
if (/思维导图|mind.?map/.test(text)) ...
```

规则仍然存在，但规则用于安全、权限、审批、预算、循环控制，而不是替模型做业务语义路由。

### 3.4 读工具直接执行，写工具先审批

工具分三类：

| 类型 | 说明 | 是否直接执行 |
| --- | --- | --- |
| Read Tool | 无副作用，只读取或检索上下文 | 是 |
| Proposal Tool | 有副作用，先生成 proposal | 否 |
| Execution Tool | 用户确认后执行 | 仅由 ApprovalGate 调用 |

模型可以选择一个有副作用的业务意图，但系统不能在未经确认的情况下直接写入数据。

这里的“读工具直接执行”指普通 workspace / workbench / attachment 读取与搜索工具的默认策略。学习画像、长期记忆、课程图谱等会显著改变个性化建议或学习路径判断的工具，不应简单并入普通 read tool，而应通过独立工具组、入口配置、用户表达和 approval/auto-approve 策略控制。

### 3.5 业务 service 不重写

V2 不重写：

- `studioV2Service`
- `aiStudioService`
- `knowledgeSearchService`
- `courseKnowledgeGraphService`
- `resourceDiscoveryService`
- `learningMemoryService`
- `workbenchService`
- `FileSystemService`
- 其他已存在业务 service

V2 只为这些 service 写 adapter，把它们变成统一工具。

### 3.6 新旧并存

旧路径保留：

```text
mode = "chat"      -> workspaceTerminalChatService
mode = "agentic"   -> legacy workspaceAgentRuntime
mode = "new_agentic" -> workspaceAgentV2Runtime
```

前端先展示三种模式：

```text
Chat / Agentic / New Agentic
```

V2 稳定前不替换旧 `agentic`。

### 3.7 可审计与可恢复

每一轮都要记录：

- 模型决策。
- 工具调用。
- 工具输入摘要。
- 工具输出摘要。
- approval 状态。
- loop guard 判断。
- final response 依据。

这不仅是调试需要，也是后续毕业设计/系统说明中的亮点。

### 3.8 上下文获取采用 Cline 式工具策略

V2 不再以 `model_knowledge_only`、`explicit_context_only`、`workspace_search_allowed`、`personalized_workspace` 这类上下文模式作为核心控制器。这些最多是用户 steering 或工具策略的派生结果。

核心思路改为：

```text
轻量环境信息 / ContextSources manifest
  + 默认可见的普通 read/search/list tools
  + 用户 steering 形成 prefer / only / deny 约束
  + ToolPolicy / AcquisitionConstraints / budget / ignore / ledger 在执行前后约束
```

初始上下文只放轻量 manifest，例如 workspace、workbench、selected resources、chat attachments、mentions、recent observations 和 budget hints，不默认展开 workspace 全文、选中资源全文、学习画像、课程图谱或 AI Studio source context。

selected resources / chat attachments / mentions 是高优先级线索，不是默认排他边界。只有用户明确说“只根据这些资料”“不要查别的”时，才转成 `onlyScopes` / `deniedTools` 这类硬约束。

实现上应保持 `ContextSources` 分层：`selectedResources` 表示 workspace 内已选中或显式引用的资源，`chatAttachments` 表示当前聊天上传附件，`mentions` 表示文本 mention 解析结果。需要“用户显式给出的所有资料”时，可以在 decision context 中派生聚合视图，但不要把 attachment 直接混入 selected resources。

写入工具也不应自行获取上下文。正确路径是：

```text
read/search/extract/query
  -> observation / evidence / ledger
  -> proposal/write tool 引用已记录 evidence 或声明 model_knowledge sourceMode
  -> approval
  -> execute
```

### 3.9 tool result 必须作为跨 turn 消息历史

V2 的跨 turn 上下文不能只继承用户/assistant 的自然语言文本。Cline 的 session history 包含 user messages、assistant responses 和 tool interactions；工具结果会作为 `tool_result` 继续进入后续模型请求，并由 MessageBuilder 做截断、read locator 去重、旧读取过期替换和 compaction。

因此 V2 需要区分两条历史：

```text
Conversation transcript
  面向 UI 展示：用户文本、assistant 可见回复、附件展示信息。

Agent message history
  面向 agent 推理：user text、assistant text、tool_use、tool_result、evidence refs、read locators、compact summaries。
```

新一轮用户消息开始时，应按 sessionId/checkpointThreadId 恢复 agent history，而不是重新初始化一个空 state。上一轮搜索、读取、网页抓取、附件读取等工具结果应以可预算化的结构进入本轮：

- 与当前任务明显相关或被“刚才/这个文件/里面/继续/基于这些”引用的结果，标记为 `active`。
- 历史上可用但当前话题未引用的结果，标记为 `available`，只给摘要、sourceId、locator。
- 被新读取覆盖、文件变化、预算不足或话题明显切换的结果，标记为 `stale` 或 compact summary。

换话题不应立即删除旧搜索结果，但旧结果也不能自动污染新话题。模型可以看到它们是历史观察；是否复用必须由当前用户请求、source/locator、recency、relevance 和 constraints 决定。

写入工具尤其依赖这条规则：用户说“把刚才找到的资料整理成 md”时，runtime 必须能恢复“刚才找到/读过”的 evidenceId、sourceId 和 locator；如果只有文件卡没有正文，应继续 read，而不是从 workspace 全量 list 重新开始，也不能假装已经读过全文。

## 4. 模块设计

建议新增目录：

```text
backend/src/services/workspaceAgentV2/
  runtime.ts
  state.ts
  contextControl.ts
  toolRegistry.ts
  toolCatalog.ts
  modelDecision.ts
  toolExecutor.ts
  approvalPolicy.ts
  observationReducer.ts
  loopGuard.ts
  trace.ts
  adapters/
    knowledgeTools.ts
    workspaceFileTools.ts
    courseGraphTools.ts
    learnerContextTools.ts
    studioTools.ts
    workbenchTools.ts
    fileTools.ts
    memoryTools.ts
    planningTools.ts
```

### 4.1 `runtime.ts`

职责：

- 定义 LangGraph 流程。
- 管理 turn/run lifecycle。
- 处理 stream events。
- 支持 approval interrupt / resume。
- 控制最大步数。
- 输出兼容旧 terminal 的结果结构。

不做：

- 不写业务正则。
- 不直接 import 大量业务 service。
- 不直接知道每个业务工具细节。

### 4.2 `state.ts`

定义 V2 状态。

建议结构：

```ts
interface WorkspaceAgentV2State {
  workspaceId: string;
  workbenchId?: string | null;
  sessionId?: string | null;
  checkpointThreadId: string;
  userId?: string | null;

  messages: TerminalMessage[];
  userInput: string;

  context: WorkspaceAgentV2Context;
  availableTools: WorkspaceAgentToolManifest[];

  decisions: WorkspaceAgentDecision[];
  toolCalls: WorkspaceAgentToolCallRecord[];
  observations: WorkspaceAgentObservation[];
  evidence: WorkspaceAgentEvidence[];

  pendingApproval?: WorkspaceAgentApprovalRequest | null;
  approvalDecision?: WorkspaceAgentApprovalDecision | null;
  executedActions: WorkspaceAgentExecutedAction[];

  stepCount: number;
  maxSteps: number;
  stopReason?: string | null;
  finalReply?: string | null;
  trace: WorkspaceAgentTraceEntry[];
}
```

### 4.3 `contextControl.ts`

负责把每轮用户输入、UI 状态和运行配置解析成上下文控制对象。它不做业务路由，只决定工具可见性、工具执行约束和上下文预算。

建议结构：

```ts
type WorkspaceAgentV2Mode = "act" | "plan" | "search" | "minimal";

interface RuntimeContextControl {
  agentMode: WorkspaceAgentV2Mode;
  toolAvailability: ToolAvailability;
  toolPolicy: ToolPolicySet;
  contextSources: ContextSources;
  acquisitionConstraints: AcquisitionConstraints;
  contextBudget: ContextBudget;
  contextLedger: ContextLedger;
}
```

职责：

- 构造轻量 `ContextSources` manifest。
- 解析用户 steering，例如“只根据上传文件”“不要用学习画像”“只用模型知识”。
- 构造 `ToolAvailability`，普通 read/search/list 在 agentic 模式下默认可见。
- 对 `learner_context.read`、`course_graph.query`、saved memory 等敏感工具做独立启停。
- 构造 `AcquisitionConstraints`，表达 prefer / only / deny / allowed ids。
- 管理 context budget 和 ledger summary。

不做：

- 不判断用户要不要生成测验、笔记、workbench 或学习计划。
- 不用语义 mode 隐藏普通 workspace read/search。
- 不替写入工具自动检索上下文。

### 4.4 `toolRegistry.ts`

统一工具注册表。

建议接口：

```ts
type WorkspaceAgentRisk = "low" | "medium" | "high";

interface WorkspaceAgentToolDefinition<I = unknown, O = unknown> {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: WorkspaceAgentRisk;
  sideEffect: boolean;
  requiresApproval: boolean | ((input: I, context: ToolContext) => boolean);
  enabled?: (context: ToolContext) => boolean | Promise<boolean>;
  summarizeInput?: (input: I) => string;
  summarizeOutput?: (output: O) => WorkspaceAgentObservation;
  execute: (input: I, context: ToolContext) => Promise<O>;
}
```

Registry 只做：

- 注册工具。
- 按 `ToolAvailability` 和工具自身 enabled 条件过滤可用工具。
- 查找工具定义。
- 输出给模型看的 manifest。

### 4.5 `toolCatalog.ts`

根据上下文构造当前可用工具列表。

示例规则：

- 没有 `workbenchId` 时，不暴露只适用于当前 workbench 的局部工具。
- 没有选中 quiz question 时，不暴露 `studio.quiz_judge`，或将其标记为需要完整输入。
- 用户权限不足时，不暴露写工具。
- `new_agentic` 初期只暴露已实现的 V2 tools。
- 普通 workspace/workbench/attachment read/search/list 工具在 agentic 模式下默认暴露。
- `learner_context.read`、`course_graph.query`、saved memory 等敏感工具根据入口、用户表达、配置和工具策略单独启用。
- 用户明确禁止上下文时，可隐藏 read/search 工具，或保留工具但由 executor 返回 skipped observation。

### 4.6 `modelDecision.ts`

每轮让模型输出结构化决策。

建议 schema：

```ts
type WorkspaceAgentDecision =
  | {
      type: "tool_call";
      tool: string;
      input: Record<string, unknown>;
      reason: string;
    }
  | {
      type: "ask_user";
      question: string;
      reason: string;
    }
  | {
      type: "final";
      answer: string;
      reason: string;
    };
```

Prompt 必须强调：

- 你可以连续调用多个工具。
- 每次只选择一个下一步。
- 不要假设工具已经执行。
- 需要上下文时主动使用 read/search/list 工具补充证据，不要假装已经看过资料。
- 优先使用用户显式提供的 selected resources / attachments / mentions，但除非用户说“只根据这些”，不要把它们当成唯一可用来源。
- 如果用户明确限制来源或禁止上下文，必须遵守 constraints。
- 写工具会进入审批。
- 如果缺少关键参数，先问用户或调用读取工具补充。
- 如果已有足够证据，输出 final。

### 4.7 `toolExecutor.ts`

职责：

- 校验 tool name。
- 校验 input schema。
- 检查 tool availability。
- 检查 acquisition constraints，例如 onlyScopes / deniedScopes / deniedTools / allowed ids。
- 检查 ignore 规则、预算和重复调用。
- 检查敏感工具组策略。
- 调用 approval policy。
- 执行 read tool。
- 对副作用工具生成 approval request。
- 将结果交给 observation reducer。

不做：

- 不根据用户文本猜业务意图。
- 不写业务 if/switch。
- 不绕过 policy 直接自动搜索或读取 selected resources。

### 4.8 `approvalPolicy.ts`

职责：

- 判断工具是否需要审批。
- 将副作用工具调用转为 proposal。
- 处理用户 approve/reject。
- 确认后执行原工具。

审批判断依据：

- `sideEffect`
- `requiresApproval`
- `risk`
- 工具输入
- 用户权限
- 是否涉及删除、覆盖、外部执行、批量写入

默认策略：

| 风险 | 默认行为 |
| --- | --- |
| low + no sideEffect | 直接执行 |
| low + sideEffect | 需要确认 |
| medium | 需要确认 |
| high | 需要确认，并在 UI 中突出风险 |

### 4.9 `observationReducer.ts`

工具结果不能原样塞回模型。

职责：

- 把工具输出转为短 observation。
- 提取 evidence。
- 将 raw result 留在 trace/cache/debug，不直接进入下一轮模型上下文。
- 记录 evidence locator、content hash、source id 和 stale 标记。
- 保留 artifact/job/file id。
- 控制上下文长度。
- 将大对象落在 trace/result 中，给模型只看摘要和关键字段。

建议 observation：

```ts
interface WorkspaceAgentObservation {
  id: string;
  tool: string;
  status: "success" | "failed" | "skipped" | "approval_required";
  summary: string;
  evidenceIds?: string[];
  artifactRefs?: Array<{
    kind: "file" | "studio_artifact" | "workbench" | "plan" | "job" | "memory";
    id: string;
    title: string;
  }>;
  error?: string;
}
```

### 4.10 `loopGuard.ts`

参考 Cline 的 repeated tool-call detection，V2 需要至少支持：

- 最大步数，例如 8。
- 同一 tool + 同一 input 连续调用软警告。
- 同一 tool + 同一 input 连续调用硬停止。
- 连续失败次数限制。
- 无新增 observation 的循环停止。
- 超时控制。

默认建议：

```text
maxSteps = 8
softRepeatThreshold = 3
hardRepeatThreshold = 5
maxConsecutiveFailures = 2
```

## 5. 首批工具设计

阶段 2 先实现普通 read/search/list 工具。普通工具默认可用于 agentic 探索；敏感工具组只在配置、入口或用户表达允许时启用。

### 5.1 普通 Read / Search Tools

```text
workspace.fs.list
workspace.file.search
workspace.file.read
workspace.file.extract
knowledge.search
attachment.list
attachment.read
attachment.image.inspect
studio.artifacts.list
```

这些工具只负责读取、搜索或列出信息；是否允许读取、读取范围、结果大小、是否进入下一轮模型上下文，由 `ToolPolicy`、`AcquisitionConstraints`、ignore 规则、budget 和 `observationReducer` 管理。

### 5.2 敏感或半敏感 Read Tools

```text
course_graph.query
learner_context.read
saved_memory.read
conversation_history.search
external_resources.discover
```

这些工具不和普通 workspace search 绑定：

- `course_graph.query` 只有在课程图谱、学习路径、诊断入口，或用户明确需要概念关系/前置知识/知识图谱时启用。
- `learner_context.read`、`saved_memory.read`、`conversation_history.search` 读取个性化信息或历史记忆，应由 UI 设置、入口或用户明确表达开启。
- `external_resources.discover` 涉及外部资源，应受网络/来源策略和用户意图约束。

### 5.3 Proposal / Side-effect Tools

阶段 3 接入：

```text
studio.generate_artifact
studio.recommend
file.save_generated
workbench.create
memory.save
resource.bind_to_workbench
course_graph.build
code_lab.run
```

Proposal / side-effect tools 不应自行搜索 workspace、读取 selected resources、调用 learner context 或查询 course graph。它们只能消费当前 ledger 中已有 evidence，或明确声明 `sourceMode = "model_knowledge"`。

### 5.4 后续扩展工具

阶段 4 接入：

```text
workbench.table.summarize
workbench.clone
workbench.move
file.rename
file.move
file.copy
file.delete
file.revert_revision
resource.import_url
resource.analyze
video.analyze
audio_note.analyze
learning_plan.apply
learning_plan.update_step
learning_plan.review
learning_plan.rollback
course_graph.add_concept
course_graph.add_relation
course_graph.add_tag
learner_memory.control
learner_state.govern
flashcard.review
flashcard.explain
```

## 6. 与现有接口兼容

V2 对前端返回结构应尽量兼容现有 terminal：

```ts
interface LearningTerminalResponse {
  reply: string;
  sessionId?: string;
  status: "completed" | "approval_required";
  evidence: TerminalEvidence[];
  suggestedActions: SuggestedAction[];
  proposedActions?: WorkspaceAgentProposal[];
  executedActions?: WorkspaceAgentExecutedAction[];
  approvalRequest?: WorkspaceAgentApprovalRequest;
  followUps: string[];
  trace?: AgentUiEvent[];
  model?: string;
  provider?: string;
}
```

前端新增 mode：

```ts
type TerminalChatMode = "chat" | "agentic" | "new_agentic";
```

后端路由：

```text
POST /api/learning/terminal/chat
POST /api/learning/terminal/chat/stream
POST /api/learning/terminal/approval
```

仍复用这三类接口，只按 mode 分流。

## 7. 不做事项

V2 初期不做：

- 不删除 legacy runtime。
- 不改写业务 service。
- 不重构前端 AI Studio 页面。
- 不把所有业务 API 一次性接完。
- 不追求自主长任务后台执行。
- 不让模型绕过 approval 直接写数据库。
- 不把工具输出完整大对象塞进模型上下文。

## 8. 阶段计划

### 阶段 1：设计冻结

产物：

- 本文档。
- V2 state schema 确认。
- tool definition schema 确认。
- decision schema 确认。
- approval/loop/observation 规则确认。
- `new_agentic` 并存策略确认。

### 阶段 2：最小 V2 骨架

目标：

- 跑通完整 loop。
- 接入少量 read tools。
- 前端可选择 `New Agentic`。

验收：

- 能连续调用 1-3 个读工具后回答。
- 旧 `agentic` 不受影响。
- trace 中能看到每一步 decision/tool/observation。

### 阶段 3：副作用工具与审批

目标：

- 接入核心写工具。
- 用户确认后执行。
- 支持 reject 后继续回答。

验收：

- “生成测验并保存”会先 proposal。
- 用户 approve 后才调用 Studio 生成。
- 用户 reject 后不写入。

### 阶段 4：扩展工具面与收敛旧逻辑

目标：

- 将更多业务 API 逐步注册为 V2 tools。
- 旧 runtime 不再新增能力。
- V2 稳定后考虑成为默认 agentic。

验收：

- 新业务能力只需注册 tool。
- runtime 主流程不新增业务 switch。
- 每个工具都有 schema、risk、approval、summary。

## 9. 后续 Agentic 模式整体流程

后续 `new_agentic` 的整体流程应与 Cline/Codex 的 agent loop 思想一致：不是单步 planner，而是持续行动循环。

完整流程如下：

```text
1. 用户在 Terminal 选择 New Agentic，发送消息。

2. 后端创建或恢复 V2 session。
   - 读取 workspaceId、workbenchId、sessionId。
   - 读取历史消息、chat files、selected sources 的 manifest。
   - 建立 checkpoint thread。

3. PrepareTurn / ContextControl 节点构建轻量上下文控制对象。
   - workspace 基本信息。
   - 当前 workbench 信息。
   - 最近对话。
   - 已选文件/附件/mention 的 manifest，而不是默认全文。
   - recent observations / ledger summary。
   - 用户 steering 约束，例如 prefer / only / deny。
   - context budget / ignore summary。
   - 不默认读取学习画像、长期记忆、课程图谱或 AI Studio source context。

4. ToolCatalog 节点生成当前可用工具。
   - 按 agent mode / product config / model capability / disabled tools 过滤工具。
   - 按权限过滤工具。
   - 普通 read/search/list tools 在 agentic 模式下默认可见。
   - 敏感工具组按入口、用户表达和 tool policy 单独启用。
   - 生成给模型看的工具 manifest。

5. ModelDecision 节点调用模型。
   模型只能输出三类结构化决策：
   - tool_call：下一步调用某个工具。
   - ask_user：缺少关键输入，询问用户。
   - final：已有足够信息，完成回答。

6. DecisionRouter 根据模型决策分流。
   - final -> ResponseComposer。
   - ask_user -> 等待用户输入。
   - tool_call -> ToolExecutor。

7. ToolExecutor 校验并处理工具调用。
   - 检查工具是否存在。
   - 校验 input schema。
   - 检查 tool availability。
   - 检查 acquisition constraints，例如 onlyScopes / deniedTools / allowed ids。
   - 检查 ignore、budget、重复调用和敏感工具策略。
   - 检查 risk / sideEffect / approval policy。
   - 低风险 read tool 直接执行。
   - 副作用 tool 转入 ApprovalGate。

8. ApprovalGate 处理确认。
   - 如果工具需要确认，返回 approval_required。
   - 前端展示 proposal。
   - 用户 approve 后 resume。
   - 用户 reject 后生成 observation，回到模型或 final。

9. 工具执行完成后进入 ObservationReducer。
   - 把工具输出压缩成 observation。
   - 提取 evidence / artifact refs。
   - raw result 只进入 trace/cache/debug。
   - evidence 记录 locator / source id / content hash / stale 信息。
   - 记录 trace。
   - 控制上下文长度。

10. LoopGuard 判断是否继续。
   - 未超 maxSteps。
   - 未重复调用同一 tool+input。
   - 未连续失败。
   - 仍有收益则回到 ModelDecision。

11. ModelDecision 再次运行。
   - 模型看到新的 observation。
   - 决定继续查资料、生成产物、请求审批、询问用户或 final。

12. ResponseComposer 输出最终回复。
   - 汇总证据。
   - 汇总执行过的动作。
   - 标明生成文件/artifact/job/workbench。
   - 给出下一步建议。

13. Conversation persistence 保存本轮结果。
   - 保存消息。
   - 保存 trace。
   - 保存 tool calls。
   - 保存 approval/execution 结果。
```

这个流程与 Cline 类似的地方在于：

- 它是 session 级、可持续运行的 agent runtime。
- 模型每一步根据工具说明和观察结果选择下一步。
- 工具调用结果会回流到下一轮模型决策。
- 用户可以在过程中确认、拒绝或追加输入。
- 系统有审批、循环检测、停止条件和可审计 trace。

这个流程与当前 legacy runtime 的关键区别在于：

- 不再由大型 if/switch 负责主要业务路由。
- 不再一次性把 intent 固定死。
- 不再把“模型决策”和“工具执行”混在同一个巨大文件里。
- 新能力通过注册 tool 接入，而不是修改 runtime 主流程。

最终目标：

```text
用户表达目标，模型逐步选择工具，系统安全执行工具，观察结果回到模型，直到任务完成。
```

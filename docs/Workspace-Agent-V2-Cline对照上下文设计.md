# Workspace Agent V2 Cline 对照上下文设计

## 1. 结论

Workspace Agent V2 的上下文策略应改为更贴近 Cline/Codex 的 agent runtime 设计：

```text
给 agent 默认的搜索/读取/查看工具
  -> 模型根据任务自主决定是否探索上下文
  -> runtime 用 tool policy、ignore、scope、预算、ledger、approval、compaction 管住成本和风险
```

而不是：

```text
先推导一个 ContextPolicyMode
  -> 根据 mode 隐藏 read/search 工具
  -> 模型只能在 mode 预设的范围内行动
```

之前的 `model_knowledge_only`、`explicit_context_only`、`workspace_search_allowed`、`personalized_workspace` 不应该再作为核心上下文模式。它们最多作为用户 steering 或工具策略的派生结果出现。

新的核心对象应是：

```text
AgentMode
ToolAvailability
ToolPolicy
ContextSources
AcquisitionConstraints
ContextBudget
ContextLedger
ContextCompaction
```

这份文档是对原 `Workspace-Agent-V2-上下文策略设计.md` 的重新设计。它不再从隐私隔离角度设计上下文，而是从 Cline 式自主 agent 上下文获取角度设计。

实现时应尽量贴近 Cline 的代码结构，不要重新发明一套语义路由系统：

| V2 设计对象 | Cline 对照 | 本项目落点 |
| --- | --- | --- |
| `ToolAvailability` | `extensions/tools/runtime.ts` 中的 catalog / preset / disabled tools | `toolRegistry.manifest()` 前增加 mode/config/model 过滤 |
| `ToolPolicy` | `toolPolicies`、CLI safe auto approve、approval callback | `toolExecutor` 执行前统一判断 auto approve / approval |
| `ContextSources` | `environment_details`、mention enricher、open tabs/current context | `initialState` 构造轻量 manifest |
| `AcquisitionConstraints` | 用户 prompt steering + `.clineignore`/executor guard | executor scope/deny/only 检查，不参与业务路由 |
| `ContextBudget` | `MessageBuilder` tool result truncation / total text budget | `observationReducer` 和 decision context 构造 |
| `ContextLedger` | read locator、latest read、outdated content replacement | evidence locator/hash/stale/compact summary |

其中 `AcquisitionConstraints` 是最容易跑偏的一层。它只能表达 `prefer`、`only`、`deny`，不能承担“判断用户意图并决定业务路径”的职责。

## 2. Cline 的实际上下文机制

本节基于本地临时仓库 `/private/tmp/cline-reference` 中的 Cline 文档和源码整理。

### 2.1 Cline 默认给 agent 工具，而不是按任务语义先关工具

Cline 文档明确说，工具是模型可以调用的 executable functions，模型决定调用哪个工具，Cline 执行并把结果返回给模型。

参考：

- `/private/tmp/cline-reference/docs/tools-reference/all-cline-tools.mdx`
- `/private/tmp/cline-reference/sdk/packages/core/src/extensions/tools/runtime.ts`

ClineCore 的当前工具 catalog 主要包括：

```text
read_files
search_codebase
run_commands
editor
fetch_web_content
skills
ask_question
```

这些不是根据每轮语义判断才临时出现。工具可用性主要由以下因素决定：

- agent mode，例如 act / plan / yolo。
- provider / model routing，例如某些模型或 headless 运行形态会把 editor 路由成 apply_patch。
- 用户或全局配置 disabled tools。
- preset / allowlist。

这意味着 Cline 的默认心智模型是：

```text
agent 有探索环境的能力；
是否探索由模型决定；
runtime 管执行边界。
```

### 2.2 read/search 通常可配置为安全自动执行工具

Cline 的 SDK permission 文档和 CLI tool policy 都把 `read_files`、`search_codebase`、`fetch_web_content` 这类工具作为可自动批准的低风险工具示例。写文件、编辑、命令执行才更接近需要审批的工具。

但这不是所有 Cline surface 都无条件自动执行。VS Code / JetBrains 等交互式产品仍可以通过用户设置或 approval handler 要求确认；SDK/CLI 只是提供了常见的 tiered permission 路径。因此 V2 应把 read/search 的自动执行做成 `ToolPolicy` 默认值，而不是写死在工具实现里。

参考：

- `/private/tmp/cline-reference/docs/sdk/guides/permission-handling.mdx`
- `/private/tmp/cline-reference/apps/cli/src/runtime/tool-policies.ts`

对应到本项目：

```text
workspace.fs.list
workspace.file.search
workspace.file.read
workspace.file.extract
knowledge.search
attachment.read
attachment.image.inspect
```

这些应默认是 agentic 模式的普通 read tools。但 `learner_context.read` 和 `course_graph.query` 都应单独谨慎处理：

- `learner_context.read` 读取个人学习画像、记忆、偏好。
- `course_graph.query` 当前即使不包含掌握度和薄弱点，也属于课程知识结构的专项上下文，容易强烈影响学习建议和生成结果。

因此它们应作为敏感或半敏感 read tool group 单独配置，而不是跟普通 workspace file search 绑在一起。

### 2.3 Cline 的 mode / preset 是工具组合，不是上下文授权模式

Cline 交互 prompt 主要围绕 act / plan，SDK/core 还支持 yolo；源码里的 `ToolPresets` 也定义了 search / minimal 等 preset。需要注意：当前 core runtime 的 preset resolver 只对 plan / yolo 做显式选择，其余 mode 会落到 act。因此 search / minimal 更适合作为可借鉴的工具组合，而不是等同于当前 Cline 产品的一线用户模式。

源码里的 tool preset 大致是：

- act：读、搜、命令、web、编辑、技能、问用户等。
- plan：读、搜、web、问用户等，不启用编辑。
- search：读和搜为主。
- minimal：较少工具。
- yolo：自动化工具组合。

参考：

- `/private/tmp/cline-reference/sdk/packages/core/src/extensions/tools/presets.ts`

这些 mode / preset 的语义是“工具组合和审批策略”，不是“这轮任务是否可以读取 workspace”。因此 V2 不应把 `explicit_context_only` 这类上下文 mode 当成核心控制器。

### 2.4 Cline 的显式上下文是强信号，不是唯一授权来源

Cline 支持 `@file`、`@folder`、拖拽文件、编辑器选区、terminal output、git changes 等方式给上下文。

参考：

- `/private/tmp/cline-reference/docs/core-workflows/working-with-files.mdx`
- `/private/tmp/cline-reference/sdk/packages/core/src/services/workspace/mention-enricher.ts`
- `/private/tmp/cline-reference/apps/vscode/src/shared/context-mentions.ts`

但 Cline 并不是只有显式 mention 才能搜索或读取。文档里甚至写到，其他上下文可以直接自然语言描述，Cline 会自己运行 git、fetch URL 或读取输出。

因此，本项目中的 selected resources / chatFiles / mentions 应作为：

```text
高优先级线索
搜索/read 的候选种子
最终回答和写入工具的 evidence source
```

实现上应保持 scope 分层：

```text
selectedResources = workspace 内已选中/显式引用的资源
chatAttachments = 当前聊天上传附件
mentions = 文本 mention 解析结果
```

如果产品需要“用户显式给出的所有资料”这种聚合概念，可以在 decision context 中派生 `explicitSources` 视图；不要把 chat attachment 直接混入 `selectedResources`，否则 `explicit_sources` 和 `chat_attachments` 的校验边界会变模糊。

而不是默认变成“只允许读取这些”的授权边界。

只有当用户明确说“只根据这些资料”“不要查别的”时，explicit context 才变成 `only` 约束。

### 2.5 Cline 用 ignore 控制噪声、成本和边界

Cline 的 `.clineignore` 控制自动扫描、file listing、search results。它的作用不是每轮语义授权，而是稳定的 workspace 访问边界和噪声过滤。Cline 文档同时说明，用户仍可以通过显式 `@mention` 引用 ignored 文件；也就是说 ignore 规则控制自动加载和自动搜索，不等于绝对禁止显式访问。

参考：

- `/private/tmp/cline-reference/docs/customization/clineignore.mdx`
- `/private/tmp/cline-reference/apps/vscode/src/core/prompts/responses.ts`

对应到本项目，需要类似：

```text
.workspaceignore / workspace resource ignore rules
resource kind filters
large file / binary / generated artifact exclusion
chat scoped resource visibility
workbench scoped listing rules
```

这比把搜索工具隐藏起来更贴近 Cline。

### 2.6 Cline 管上下文窗口，而不是阻止 agent 获取上下文

Cline 的 task 文档说明，上下文窗口会包含：

- 用户 prompt。
- assistant responses。
- 文件内容。
- command outputs。
- tool results。
- system instructions。

接近窗口限制时，Cline 会自动压缩旧对话或工具结果。

参考：

- `/private/tmp/cline-reference/docs/core-workflows/task-management.mdx`
- `/private/tmp/cline-reference/docs/features/auto-compact.mdx`
- `/private/tmp/cline-reference/sdk/packages/core/src/session/services/message-builder.ts`

源码里的 `MessageBuilder` 会：

- 截断 tool result。
- 记录 read locator。
- 替换过期文件内容。
- 修复 missing tool result pairing。
- 控制总文本预算。

对应到本项目，重点应是：

```text
工具结果不全量进下一轮 prompt；
evidence 有 locator / hash / summary；
旧 evidence 可压缩；
重复 read/search 可缓存或 loop guard；
写入工具只消费 ledger 中已确认 evidence。
```

其中 `ContextLedger` 和写入工具引用 `evidenceIds` 是 V2 面向学习产物生成的产品化扩展，并不是 Cline 源码中已经存在的同名机制。它借鉴的是 Cline `MessageBuilder` 里 read locator、latest read、outdated replacement 和 tool result truncation 的上下文管理思想。

### 2.7 Cline 的 environment_details 是引导，不是用户请求

Cline 在每轮 user message 后提供 environment details，例如当前 mode、文件结构、open tabs、active terminals。prompt 明确要求模型把这些当作环境信息，用来辅助行动，不要误认为用户显式要求。

参考：

- `/private/tmp/cline-reference/apps/vscode/src/core/prompts/system-prompt/components/capabilities.ts`
- `/private/tmp/cline-reference/apps/vscode/src/core/prompts/system-prompt/components/rules.ts`

对应到本项目，初始上下文应该包含轻量环境信息：

```text
workspace id / title
workbench id / title
selected resources manifest
chat attachments manifest
current terminal mode
available tools
ignore / budget hints
recent observations
```

它不应默认塞入大量全文。

### 2.8 Cline 把 tool result 作为消息历史的一部分

Cline 的一个关键点是：工具调用和工具结果不是只存在于某次 turn 的临时 state 里，而是作为会话消息历史的一部分继续参与后续模型请求。

源码依据：

- `/private/tmp/cline-reference/sdk/packages/core/src/session/services/message-builder.ts`
- `/private/tmp/cline-reference/sdk/packages/core/src/extensions/context/basic-compaction.ts`
- `/private/tmp/cline-reference/sdk/packages/core/src/services/session-data.ts`
- `/private/tmp/cline-reference/sdk/packages/core/src/ClineCore.ts`

在 Cline 的消息轨道里，常见结构是：

```text
user: 用户请求
assistant: text + tool_use(read/search/bash/...)
user: tool_result(...)
assistant: 根据 tool_result 继续决定下一步或回答
user: 下一轮用户追问
...
```

因此，前一轮搜索过什么、读过什么、命令输出是什么，默认不会在下一轮立即消失。它们仍然是历史消息，只是在进入 provider 请求前由 `MessageBuilder` 做预算化处理。

`MessageBuilder` 的关键行为：

- 遍历完整 messages，构造 API-safe messages。
- 对 `read` / `read_files` / `search` / `search_codebase` / `bash` / `run_commands` 等目标工具结果做截断。
- 默认单个工具结果最大约 `50_000` 字符，总文本预算约 `6_000_000` 字节。
- 记录 read locator，包括 path、startLine、endLine。
- 如果同一文件后来被重新读取，旧 read result 会被替换为 `[outdated - see the latest file content]`。
- 如果 assistant 发出了 tool_use 但缺少对应 tool_result，会补一个 synthetic error tool_result，保证工具调用/结果配对完整。

这意味着 Cline 对“旧搜索结果”的策略不是：

```text
每轮只保留最新搜索结果
```

也不是：

```text
所有旧搜索结果永远无条件作为当前话题依据
```

而是：

```text
旧 tool_result 作为会话历史保留
  -> MessageBuilder 按工具类型、预算、read locator、最新读取状态处理
  -> compaction 在上下文压力下移除/截断旧消息
  -> 最新 turn 通常受保护，旧 turn 可被压缩
```

如果用户换了话题，旧搜索结果仍可能存在于上下文窗口里，但模型应把它们视为历史观察，而不是当前任务的默认证据。是否复用旧结果取决于当前 user request、工具结果的 source/locator、recency 和 relevance。runtime 负责在上下文中保留足够元数据，让模型能判断“这是旧话题搜索结果”还是“当前任务的来源”。

`basic-compaction` 进一步说明了 Cline 的压缩倾向：

- 最新 turn 会作为 protected tail 保留。
- 更旧的 assistant / user messages 会按候选逐步删除或截断。
- tool_use 和 tool_result 会按 pair 原子处理，避免只删一半导致消息不合法。
- tool_result 内容会先做压缩截断，再参与整体 compaction。

对应到 V2，不能只把上一轮 assistant 自然语言回复带进下一轮。必须把工具调用、工具结果、read locator、evidence/sourceId 也作为可恢复的消息历史或等价结构进入下一轮。

目标形态：

```text
ConversationMessage / AgentTurnMessage
  user text
  assistant text
  tool_use records
  tool_result records
  evidence refs
  read locators
  compact summaries
```

其中自然语言 transcript 面向 UI 展示；tool_result history 面向 agent 继续推理。二者不能混为一谈。

## 3. 对旧上下文策略的修正

### 3.1 不再以 `ContextPolicyMode` 为中心

旧设计：

```ts
type ContextPolicyMode =
  | "model_knowledge_only"
  | "explicit_context_only"
  | "workspace_search_allowed"
  | "personalized_workspace"
  | "diagnostic_deep_context";
```

问题：

- 把工具能力和上下文来源混在一起。
- 容易过早隐藏 read/search，削弱 agent 自主探索。
- 和 Cline 默认提供 read/search 工具的设计相反。
- fallback 或 model decision 一旦被 mode 限制，很难自我恢复。

新设计：

```ts
type AgentMode = "plan" | "act" | "search" | "minimal" | "yolo";

interface RuntimeContextControl {
  agentMode: AgentMode;
  toolAvailability: ToolAvailability;
  toolPolicy: ToolPolicySet;
  contextSources: ContextSources;
  acquisitionConstraints: AcquisitionConstraints;
  contextBudget: ContextBudget;
  contextLedger: ContextLedger;
}
```

### 3.2 `model_knowledge_only` 改成用户 steering，不是默认 mode

当用户明确说：

```text
不要查上下文
不要读资料
只用模型知识
直接写通用解释
```

runtime 可以生成：

```ts
acquisitionConstraints = {
  denyTools: [
    "workspace.fs.list",
    "workspace.file.search",
    "workspace.file.read",
    "workspace.file.extract",
    "knowledge.search",
    "attachment.read",
    "attachment.image.inspect",
    "course_graph.query",
    "learner_context.read"
  ],
  reason: "user_requested_model_knowledge_only"
}
```

但这只是特殊 hard steering，不是常规上下文模式。

### 3.3 `explicit_context_only` 改成 `onlyScopes`

当用户说：

```text
只根据这两个 PDF
不要查别的，只总结我上传的文件
```

runtime 生成：

```ts
acquisitionConstraints = {
  onlyScopes: ["explicit_sources"],
  allowedFileIds: [...],
  allowedAttachmentIds: [...]
}
```

当用户只是说：

```text
根据这个 PDF 总结
```

不应默认禁止 workspace search。更合理的是：

```ts
preferredSources = ["explicit_sources"];
```

模型通常会先读 PDF；如果任务需要补充背景，可以搜索 workspace，除非用户说“只”或“不要查别的”。

### 3.4 `workspace_search_allowed` 变成默认 agentic 能力

在 `new_agentic` 的 act/plan/search 这类 agentic 工具组合下，应默认暴露：

```text
workspace.fs.list
workspace.file.search
workspace.file.read
workspace.file.extract
knowledge.search
```

搜索范围由工具输入和 executor 控制：

```ts
type SourceScope =
  | "workspace"
  | "workbench"
  | "explicit_sources"
  | "chat_attachments";
```

runtime 可以根据自然语言和 UI 状态给模型提示 preferred scope：

- “当前学习现场” -> prefer `workbench`
- “整个课程空间” -> prefer `workspace`
- “这个 PDF / 我上传的文件” -> prefer `explicit_sources`

但默认不隐藏 workspace search。

### 3.5 `personalized_workspace` 改成敏感工具组开关

`learner_context.read` 和 `course_graph.query` 都不应与 workspace search 绑定。它们应该有独立工具组策略：

```ts
interface SensitiveToolPolicy {
  tool: "learner_context.read" | "course_graph.query";
  enabled: boolean;
  autoApprove: boolean;
  requiresIntent: boolean;
  allowedAudiences: Array<"general" | "planner" | "tutor" | "diagnosis">;
}
```

`learner_context.read` 的开启条件可以是：

- UI 启用个性化。
- 产品入口是个性化学习规划或诊断。
- 用户明确说“根据我的学习情况/薄弱点/偏好/记忆”。

`course_graph.query` 的开启条件可以是：

- 用户明确要求课程知识结构、概念关系、前置知识、知识图谱。
- 产品入口是课程图谱、学习路径、诊断或复习规划。
- 模型已通过 workspace/knowledge search 发现需要图谱关系补充，并且当前 agent mode 允许 graph read。

如果后续 course graph 返回个人掌握度或弱点，则应进一步拆成：

```text
course_graph.query
learner_mastery.read
```

原则：

- workspace search/read 默认可用。
- `learner_context.read` 和 `course_graph.query` 独立配置。
- LLM hint 不能自动开启这两个工具；最多建议 ask user 或说明需要图谱/画像上下文。

## 4. 新核心对象设计

### 4.1 `AgentMode`

参考 Cline 的 act / plan / yolo 和源码中的 search / minimal presets，本项目建议：

```ts
type WorkspaceAgentV2Mode = "plan" | "act" | "search" | "minimal";
```

映射：

| Mode | 语义 | 工具 |
| --- | --- | --- |
| `act` | 默认 agentic 模式，可读可写，写入需审批 | read/search + proposal/write tools |
| `plan` | 只分析和规划，不执行写入 | read/search + ask_user |
| `search` | 资料探索和证据收集 | list/search/read/extract |
| `minimal` | 仅模型回答或非常少工具 | ask_user / pure generation |

`new_agentic` 默认应映射到 `act`，但写工具走 approval。

### 4.2 `ToolAvailability`

决定模型能看到哪些工具。它应该主要由 agent mode、产品配置、模型能力和全局 disabled tools 决定。

```ts
interface ToolAvailability {
  enabledTools: string[];
  disabledTools: Array<{
    tool: string;
    reason:
      | "mode"
      | "model_capability"
      | "global_disabled"
      | "missing_executor"
      | "sensitive_tool_not_enabled"
      | "user_steering";
  }>;
}
```

默认 agentic read tools：

```text
workspace.fs.list
workspace.file.search
workspace.file.read
workspace.file.extract
knowledge.search
attachment.list
attachment.read
attachment.image.inspect
ask_user
```

默认 proposal/write tools：

```text
workbench.create
markdown_note.create
studio.generate_artifact
plan.create
```

`learner_context.read` 默认不必总是 enabled。它属于 sensitive read tool，可根据 UI/入口/用户意图启用。

`course_graph.query` 也不应无条件默认 enabled。建议作为 `course_graph` 工具组，由 UI/入口/任务语义显式开启，或者由 executor 在模型调用时根据当前工具策略返回 skipped observation。

### 4.3 `ToolPolicy`

决定工具是否自动执行、是否需要审批、是否可以被 executor 拒绝。

```ts
interface ToolPolicy {
  tool: string;
  enabled: boolean;
  autoApprove: boolean;
  requiresApproval: boolean;
  risk: "low" | "medium" | "high";
  maxCallsPerRun?: number;
  maxResultChars?: number;
}
```

建议默认：

| 工具类型 | enabled | autoApprove | requiresApproval |
| --- | --- | --- | --- |
| list/search/read/extract | true | true | false |
| attachment read | true | true | false |
| image inspect | true | true | false |
| course graph query | 条件启用 | 可配置 | 可配置 |
| learner context read | 条件启用 | 可配置 | 可配置 |
| write/proposal tools | true | false | true |
| destructive tools | false 或审批 | false | true |

### 4.4 `ContextSources`

记录 runtime 起步时知道哪些上下文来源。它是模型的环境摘要和搜索线索，不是全文上下文包。

```ts
interface ContextSources {
  workspace: {
    id: string;
    title?: string;
  };
  workbench?: {
    id: string;
    title?: string;
    isCurrent: boolean;
  };
  selectedResources: Array<ResourceCard>;
  chatAttachments: Array<AttachmentCard>;
  mentions: Array<ResolvedMention>;
  openResources?: Array<ResourceCard>;
  recentObservations: Array<ObservationSummary>;
  ignoreSummary?: string;
}
```

原则：

- 小文本可以给 preview。
- 大文件只给 manifest。
- 附件和 workspace 文件分开。
- selected/open/mention 是强提示，不是默认排他边界。

### 4.5 `AcquisitionConstraints`

这是旧 ContextPolicy 中真正有价值的部分。它不决定“是否有搜索工具”，而决定“工具调用是否合法、优先、受限或禁止”。

```ts
interface AcquisitionConstraints {
  preferredScopes: SourceScope[];
  onlyScopes?: SourceScope[];
  deniedScopes: SourceScope[];

  allowedFileIds?: string[];
  deniedFileIds?: string[];
  allowedAttachmentIds?: string[];
  deniedAttachmentIds?: string[];
  allowedWorkbenchIds?: string[];

  deniedTools: string[];
  preferredTools: string[];

  userSteering: Array<{
    kind: "prefer" | "only" | "deny";
    target: string;
    rawText: string;
    confidence: number;
  }>;
}
```

约束：

- 不做业务路由。
- 不决定是否生成笔记、创建 workbench 或查询图谱。
- 不从自然语言中扩张工具权限。
- 只收敛工具调用边界，例如 prefer、only、deny、allowed ids。
- 每次工具调用仍由 executor 根据它做二次检查。

示例：

| 用户表达 | constraints |
| --- | --- |
| “根据这个 PDF” | `preferredScopes = ["explicit_sources"]` |
| “只根据这个 PDF” | `onlyScopes = ["explicit_sources"]` |
| “在当前学习现场找” | `preferredScopes = ["workbench"]` |
| “整个课程空间都搜一下” | `preferredScopes = ["workspace"]` |
| “不要用我的学习画像” | `deniedTools += ["learner_context.read"]` |
| “不要查课程图谱” | `deniedTools += ["course_graph.query"]` |
| “不要检索上下文，只用模型知识” | `deniedTools += all read/search tools` |

### 4.6 `ContextBudget`

预算由 runtime 管，不交给模型自觉。

```ts
interface ContextBudget {
  maxInitialEnvironmentChars: number;
  maxToolResultChars: number;
  maxEvidenceItemsPerTool: number;
  maxEvidenceCharsPerItem: number;
  maxTotalEvidenceChars: number;
  maxObservationHistory: number;
  compactThresholdRatio: number;
}
```

read/search 工具返回：

```text
raw result -> trace/cache
evidence -> clipped content + locator
observation -> 下一轮模型优先看到的摘要
```

### 4.7 `ContextLedger`

记录 agent 实际用过哪些上下文。它对应 Cline message builder 中对 read locator、最新读取、旧内容替换、tool result pairing 的管理思想。

```ts
interface ContextLedgerEntry {
  id: string;
  kind:
    | "environment"
    | "explicit_source"
    | "tool_observation"
    | "evidence"
    | "generated_artifact"
    | "compact_summary";
  sourceType:
    | "workspace_file"
    | "workbench_file"
    | "chat_attachment"
    | "knowledge_chunk"
    | "course_graph"
    | "learner_context"
    | "generated_file";
  sourceId?: string;
  toolCallId?: string;
  locator?: EvidenceLocator;
  title: string;
  summary: string;
  contentHash?: string;
  tokenEstimate?: number;
  stale?: boolean;
  createdAt: string;
}
```

用途：

- 去重 read/search。
- 判断 evidence 是否 stale。
- final 能说明依据。
- 写入工具只能引用 ledger 中已有 evidence。
- compact 后仍保留可恢复 locator。

### 4.8 `AgentMessageHistory`

V2 需要补上一个与 Cline messages 对齐的历史层。它不是 UI 聊天 transcript 的简单副本，而是 agent runtime 的可恢复消息历史。

建议结构：

```ts
interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  turnId: string;
  content: string | AgentContentBlock[];
  createdAt: string;
  metadata?: {
    userVisible?: boolean;
    compacted?: boolean;
    topicKey?: string;
    sourceTurnId?: string;
  };
}

type AgentContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      name: string;
      content: string | ToolResultPayload;
      isError?: boolean;
      evidenceIds?: string[];
      locators?: EvidenceLocator[];
      sourceIds?: string[];
    }
  | {
      type: "file";
      sourceId: string;
      path?: string;
      content: string;
      locator?: EvidenceLocator;
    };
```

保存原则：

- 每次 `ModelDecision` 产生 tool call 时，追加 assistant `tool_use` block。
- 每次工具执行完成时，追加 tool/user-side `tool_result` block。
- 最终回答作为 assistant text block 保存。
- UI 展示用的 `ConversationMessage` 可以继续保存自然语言，但不能替代 agent message history。
- `ConversationSession.metadataJson.workspaceAgentV2` 可以保存最新运行状态，但不能作为唯一跨 turn 记忆；否则新 turn 会覆盖旧 turn 的 tool results。

恢复原则：

```text
new user turn
  -> load previous AgentMessageHistory by sessionId/checkpointThreadId
  -> append new user message
  -> MessageBuilder 构造 provider messages
  -> build ContextSources / ContextLedger from history tail + latest state
```

这才接近 Cline 的 `readMessages(sessionId)` / `restore(messages)` 语义。

### 4.9 旧搜索结果的继承与话题切换

旧搜索结果应该“可被继承”，但不应“自动污染新话题”。

V2 应把 tool result 分成三类状态：

| 状态 | 含义 | 进入下一轮方式 |
| --- | --- | --- |
| `active` | 当前用户仍在追问同一来源/同一任务，例如“继续细化里面的概念” | 保留完整或较高预算内容，作为优先 evidence |
| `available` | 历史上用过，但当前任务没有明显引用 | 只保留摘要、sourceId、locator，必要时可重新 read/fetch |
| `stale` | 被更新读取覆盖、文件已变更、或话题明显切换且预算紧张 | 内容替换为 stale marker 或 compact summary |

判断 active 的信号：

- 当前用户使用“刚才/这个文件/里面/继续/基于这些/把刚才找到的资料”等指代表达。
- 上一轮或最近几轮只有一个强 source，比如一个 PDF、一份附件、一个 URL。
- 当前任务是上一轮结果的后续动作，例如“生成 md”“出题”“继续讲”“做成表格”。
- delivery contract / write request 引用“刚才找到/刚才整理/里面”的内容。

判断 available 或 stale 的信号：

- 当前用户明确换了主题，例如从数据库资料切到 iPhone 新闻。
- 当前用户明确要求“不要参考刚才/重新搜索/只用新资料”。
- 旧 tool result 与当前 query 的 source/type/topic 不相关。
- 预算不足，需要保留最新 turn 和当前显式来源。

重要边界：

- 换话题不等于立刻删除旧搜索结果；它只是降低优先级。
- 旧搜索结果不应被 final composer 当作当前问题依据，除非当前请求引用它或模型明确选择复用。
- 写入工具引用旧 evidence 时，必须能在 ledger/history 中找到 sourceId/evidenceId；否则应先重新 read/search。
- 对 web.search 这种候选结果，跨 turn 默认只保留候选摘要和 URL；若要引用网页正文，应重新或继续使用 `web.fetch` 的结果。
- 对 workspace.file.read 这种 source-locator 明确的结果，跨 turn 可保留 read locator；如果内容被压缩，应允许模型用 fileId/path 重新 read。

这套规则对应 Cline 的实际行为：旧 tool_result 仍在 messages 中，但 MessageBuilder/compaction 会按预算处理；模型需要结合当前 user prompt 判断是否继续使用。

## 5. 新运行流程

```text
User / Resume
  -> Normalize Messages
  -> Load AgentMessageHistory
      previous user / assistant / tool_use / tool_result / compact summaries
  -> Resolve Environment Details
      workspace / workbench / selected / attachments / mentions / open resources
  -> Build ContextSources Manifest
  -> Resolve AgentMode
      act / plan / search / minimal
  -> Build ToolAvailability
      mode + model capability + global disabled + sensitive tool settings
  -> Build ToolPolicy
      autoApprove read/search, approve writes, conditional learner context
  -> Parse User Steering Constraints
      prefer / only / deny scopes and tools
  -> Build DecisionContext
      system prompt + message history + environment details + constraints + available tools + ledger summary
  -> ModelDecision
      final / ask_user / tool_call
  -> ToolPolicy + AcquisitionConstraints Check
      enabled? schema valid? scope allowed? budget ok? approval needed?
  -> Execute Tool
  -> ObservationReducer
      raw -> evidence -> observation -> ledger -> tool_result message
  -> ContextCompactor if needed
  -> next ModelDecision
  -> Final / Approval Required
```

核心变化：

- `ToolAvailability` 在 `ModelDecision` 之前构造。
- read/search 默认可用，不因普通任务语义隐藏。
- 用户约束由 `AcquisitionConstraints` 执行。
- executor 必须二次检查，不只靠 prompt。
- 写入工具不自行搜索上下文。
- 跨 turn 不能只继承 assistant 文本；必须继承 tool_result history 或等价 ledger/locator。

## 6. Read Tools 设计

### 6.1 工具分层

参考 Cline 的 list/search/read 路径，本项目 read tools 应拆成：

```text
workspace.fs.list
workspace.file.search
workspace.file.read
workspace.file.extract
knowledge.search
attachment.list
attachment.read
attachment.image.inspect
course_graph.query
learner_context.read
```

### 6.2 `workspace.fs.list`

用于查看 workspace / workbench 资源结构，不读取正文。

```ts
interface WorkspaceFsListInput {
  scope: "workspace" | "workbench";
  workbenchId?: string;
  path?: string;
  depth?: number;
  limit?: number;
}
```

默认可用。

### 6.3 `workspace.file.search`

用于在 workspace / workbench / explicit sources 范围内搜索。

```ts
interface WorkspaceFileSearchInput {
  scope: "workspace" | "workbench" | "explicit_sources";
  workbenchId?: string;
  query: string;
  fileIds?: string[];
  mode?: "metadata" | "semantic_chunks" | "text_match";
  limit: number;
}
```

默认行为：

- 如果用户说“当前学习现场”，prefer `workbench`。
- 如果用户说“这个 PDF”，prefer `explicit_sources`。
- `scope` 和 `limit` 必须由 model/runtime 显式给出；fallback 可以选择 `workspace`，但不能绕过 executor。
- `chat_attachments` 不走 `workspace.file.search`，应使用 `attachment.list` / `attachment.read` / `attachment.image.inspect`，或使用支持附件索引的 `knowledge.search`。
- 如果 `onlyScopes` 存在，executor 强制 scope 必须匹配。

### 6.4 `workspace.file.read`

读取已定位的明确文件或范围。

```ts
interface WorkspaceFileReadInput {
  files: Array<{
    fileId?: string;
    path?: string;
    ranges?: Array<{
      startLine?: number;
      endLine?: number;
      page?: number;
      blockId?: string;
    }>;
  }>;
  mode?: "preview" | "structure" | "range" | "full";
  maxCharsPerFile?: number;
}
```

约束：

- path/fileId 必须属于当前 workspace。
- 自动 list/search/read 命中 ignore 的文件时，默认跳过或返回 blocked observation。
- 用户显式 mention / attachment / 指定 fileId 命中 ignore 时，可按产品安全策略允许读取、要求审批或返回 blocked observation；无论哪种，都必须在 trace 中标记 ignore override / blocked reason。
- full read 只适合小文件。
- 大文件返回 clipped evidence。

### 6.5 `knowledge.search`

用于索引 chunk / semantic retrieval。它不应隐式只搜 selectedFileIds，除非 constraints 或工具 input 指定。

```ts
interface KnowledgeSearchInput {
  query: string;
  scope: "workspace" | "workbench" | "explicit_sources" | "chat_attachments";
  workbenchId?: string;
  fileIds?: string[];
  limit: number;
}
```

### 6.6 `course_graph.query`

课程图谱查询工具。虽然当前 course graph 不包含掌握度和薄弱点，也不应把它当作普通 workspace search 的一部分，因为它会给模型提供结构化课程关系，显著影响规划和解释。

```ts
interface CourseGraphQueryInput {
  query: string;
  audience?: "general" | "planner" | "tutor" | "diagnosis";
  limit?: number;
}
```

建议策略：

```text
默认可在课程图谱/学习路径/诊断入口 enabled
普通 workspace agentic 中可 hidden 或 conditional enabled
用户明确要求概念关系/前置知识/知识图谱时 enabled
不由 workspace_search_allowed 之类 mode 间接开启
```

executor 必须记录：

- 查询理由。
- 返回节点/边数量。
- 是否包含个人化字段。
- evidence locator，例如 concept id / relation id。

### 6.7 `learner_context.read`

敏感 read tool。建议单独工具策略：

```text
默认 hidden 或 disabled
用户明确个性化 / UI 开启 / 个性化入口 -> enabled
可配置 autoApprove 或 requiresApproval
```

它不应由 `workspace_search_allowed` 之类 mode 间接开启。

## 7. 写入工具和 Evidence

写入工具必须符合 Cline/Codex 的 agent loop：

```text
先 read/search 获取 evidence
  -> ledger 记录 evidence
  -> model 选择写入工具
  -> runtime 展示 proposal / approval
  -> 用户确认后执行
```

禁止：

- `markdown_note.create` 内部自行调用 workspace search。
- AI Studio adapter 自己开启 auto context。
- 写入工具根据 selected resources 隐式补上下文。

建议写入工具输入：

```ts
interface MarkdownNoteCreateInput {
  title: string;
  outline?: string[];
  evidenceIds?: string[];
  sourceMode: "ledger_evidence" | "model_knowledge";
}
```

runtime 注入或校验：

- `sourceMode = "ledger_evidence"` 时，`evidenceIds` 必须来自当前 ledger。
- `sourceMode = "model_knowledge"` 时，不允许工具内部检索。
- 所有写入仍需 approval。

## 8. Prompt 设计

### 8.1 System Prompt 要表达 Cline 式能力

应告诉模型：

```text
你有 workspace 读取、搜索、附件读取和写入 proposal 工具；如果 available tools 中出现图谱/画像工具，也可以在任务需要且约束允许时使用。
需要上下文时主动使用 read/search/list 工具，不要假装已经看过资料。
优先使用用户显式给出的资料，但如果任务需要，可以搜索 workspace。
如果用户说“只使用/不要使用”某类资料，必须遵守 constraints。
写入工具会改变 workspace，系统会请求用户确认。
```

### 8.2 Environment Details

每轮给模型：

```text
当前 workspace / workbench
selected resources manifest
chat attachment manifest
mention resolution
current constraints
available tools
recent observations
ledger summary
budget reminder
```

不要给模型：

- 自动全文拼接的大量 workspace 内容。
- 未经工具调用的 AI Studio source context。
- 未启用的 learner profile。

### 8.3 User Steering

用户自然语言 steering 应变成显式约束：

```text
只/仅/不要查别的 -> onlyScopes
不要用学习画像 -> deny learner_context.read
不要检索上下文 -> deny read/search tools
当前学习现场 -> preferred scope workbench
整个课程空间 -> preferred scope workspace
```

LLM 可以辅助识别模糊 steering，但不能覆盖 deterministic hard constraints。

## 9. Executor 二次检查

每个工具执行前必须检查：

```text
tool enabled?
policy autoApprove / requiresApproval?
input schema valid?
scope 是否违反 onlyScopes / deniedScopes?
fileId / attachmentId 是否属于当前 workspace/session?
是否命中 ignore?
预计结果是否超预算?
是否重复 search/read?
```

失败时返回 observation，而不是静默跳过：

```text
Tool skipped: user constraint says only explicit attachments may be used.
Tool blocked: file is ignored by workspace ignore rules.
Tool truncated: result exceeded max evidence chars.
```

这与 Cline 的工具结果进入下一轮模型上下文一致，模型可以调整策略。

## 10. 与当前 V2 实现的差距

当前实现中需要后续修正：

### 10.1 `modelDecision` fallback 不应无策略地自动 search

当前 fallback 在没有 evidence 时直接调用 `workspace.files.search` 或 `knowledge.search`。新设计下可以保留 fallback 搜索倾向，但必须经过：

```text
ToolAvailability
AcquisitionConstraints
ToolPolicy
Budget
```

也就是说，fallback 可以像 Cline 一样主动探索，但不能绕过 executor。具体实现上，fallback 不应该直接形成一个“已授权工具调用”的捷径，而应该只产生普通 `WorkspaceAgentDecision`：

```ts
{
  type: "tool_call",
  tool: "workspace.file.search",
  input: { query, scope, limit },
  reason: "Fallback: explore workspace evidence before answering."
}
```

随后必须走同一条执行链：

```text
normalize decision
  -> validate schema
  -> check tool availability
  -> check tool policy
  -> check acquisition constraints
  -> check budget / duplicate guard
  -> execute or skipped observation
```

这保持了 Cline 的“主动探索”精神，同时避免 fallback 成为绕过策略层的后门。

### 10.2 read tools 不应隐式套 `selectedFileIds`

当前 `knowledge.search` 和 `workspace.files.search` 内部用 `context.selectedFileIds` 自动限制 fileIds。这和 Cline 风格不一致。

应改为：

- selected resources 进入 `ContextSources`。
- model 或 runtime 可以把它们作为 preferred fileIds。
- 只有 `onlyScopes = explicit_sources` 或工具 input 指定 fileIds 时才限制。

更具体地说：

```text
selectedFileIds 是线索，不是隐式过滤器。
```

read/search adapter 不应再读取 `context.selectedFileIds` 后自行拼进 service input。正确路径是：

```text
ContextSources.selectedResources
  -> DecisionContext 中提示模型这些资源是 high-priority context
  -> 模型选择 scope/fileIds
  -> executor 校验 fileIds 是否属于 allowed set
  -> adapter 执行明确输入
```

如果要在用户说“根据选中文件”时自动偏向这些文件，应由 `AcquisitionConstraints.preferredScopes/preferredTools` 或 decision prompt 表达，而不是由 tool adapter 悄悄改变检索范围。

### 10.3 executor 需要 policy / constraints check

当前 executor 主要做：

- tool exists。
- schema validation。
- side effect approval。
- execute。

新设计需要增加：

- enabled tool check。
- scope check。
- ignore check。
- budget check。
- sensitive tool check。
- duplicate/loop check。

### 10.4 写入工具必须 source/evidence 化

当前所有生成类工具都要避免内部自行构造上下文。新设计下：

```text
read/search/extract/query
  -> evidence
  -> ledger
  -> write/proposal tool references evidenceIds
```

`markdown_note.create`、AI Studio adapter、workbench 资源绑定等工具都必须满足：

- 不内部发起 workspace search。
- 不内部读取 selected resources。
- 不自行调用 learner context 或 course graph。
- 只能使用 runtime 传入的 `evidenceIds` / `sourceMode`。
- `sourceMode = model_knowledge` 时不得读取外部资料。
- approval UI 展示 evidence 来源。

这对应 Cline/Codex 的核心 loop：模型先观察环境，再提出修改；系统审批后执行修改。

### 10.5 跨 turn 不能只继承自然语言回复

当前 V2 容易出现：

```text
第一轮：workspace.file.read 读到了 06-SQL-1_2026.pdf，并生成总结
第二轮：用户说“把里面所有概念细化成 md”
新 run：只从 messages 继承上一轮 assistant 的自然语言文本
      没继承 read evidence / fileId / read locator / tool_result
      于是只能看到“上一轮文本提到过 06-SQL-1_2026.pdf”
      但不能把它当成已读上下文可靠使用
```

这与 Cline 不一致。Cline 的历史包括 user messages、assistant responses 和 tool interactions。V2 也应保存并恢复：

- 上一轮 `tool_use`。
- 上一轮 `tool_result`。
- `workspace.file.read` / `attachment.read` / `web.fetch` 的正文或压缩正文。
- read locator：fileId/path/page/line/chunk。
- `workspace.file.search` / `web.search` 的候选结果、URL、sourceId。
- evidenceId 与 sourceId 的映射。
- compact summary 和 stale marker。

当前新 turn 能继承的内容应明确分层：

| 内容 | 当前可继承性 | 设计目标 |
| --- | --- | --- |
| 用户/assistant 自然语言文本 | 可以，通过 `messages` | 保留 |
| 消息附件 `files` | 取决于前端是否回传 | 后端也应可从 history/session 恢复 |
| selectedSources/chatFiles | 当前请求级输入 | 继续作为强线索 |
| 上一轮 toolCalls/observations/evidence | 当前容易丢失或只保存在最新 state | 必须进入 AgentMessageHistory |
| 上一轮 read_result 正文 | 当前不能稳定跨 turn | 作为 tool_result/content block 保留并预算化 |
| 上一轮确认的当前 source | 当前只可能出现在自然语言里 | 以 focused source/read locator 形式保留 |

实现原则：

```text
Conversation transcript != Agent message history
```

UI transcript 可以只展示人类可读文本；agent history 必须保存工具交互。新 turn 初始化时应：

```text
load previous state/history
append new user message
restore recent tool_results and read locators
mark old unrelated results as available/stale
build provider messages through MessageBuilder-like budget layer
```

如果历史中只有搜索候选、没有读取正文，模型不应声称已经读过文件；但它应能看到候选 fileId/path，并直接继续 read，而不是重新从全 workspace list 开始。

## 11. 最小落地顺序

### 阶段 A：重命名和只读 trace

- 新增 `RuntimeContextControl` 类型。
- 保留旧工具行为，但在 trace 里记录：
  - toolAvailability
  - toolPolicy
  - contextSources
  - acquisitionConstraints
  - contextBudget

### 阶段 B：工具目录 Cline 化

- read/search/list 默认出现在 `new_agentic`。
- 写入工具仍需要 approval。
- `learner_context.read` 和 `course_graph.query` 单独配置。
- 删除 `ContextPolicyMode` 对工具目录的主导地位。

### 阶段 C：read tools 显式 scope 化

- `workspace.files.search` 改为 `workspace.file.search`。
- 增加 `scope`。
- 不再隐式使用 `selectedFileIds`。
- 增加 `workspace.fs.list`、`workspace.file.read`、`workspace.file.extract`。

### 阶段 D：executor 约束检查

- 加 `AcquisitionConstraints` 检查。
- 加 ignore 规则。
- 加 budget truncate。
- 加重复 read/search guard。
- 加 sensitive tool group check：`learner_context.read` / `course_graph.query`。

### 阶段 E：ledger 和 compaction

- 增加 `ContextLedger`。
- 工具结果 raw/evidence/observation 三层化。
- 增加 stale/locator/contentHash。
- 增加 compact summary。

### 阶段 F：写入工具 evidence 化

- `markdown_note.create` / AI Studio adapter 只消费 ledger evidence。
- 禁止写入工具内部 auto context。
- approval UI 展示 evidence 来源。

## 12. 验收标准

### 12.1 默认自主搜索

输入：

```text
帮我整理数据库事务隔离级别相关复习资料
```

期望：

- read/search 工具默认可见。
- 模型可以先 `workspace.file.search` 或 `knowledge.search`。
- trace 记录 search query、scope、evidence。
- 不需要先推导 `workspace_search_allowed`。

### 12.2 显式资料优先但不硬禁止探索

输入：

```text
根据这个 PDF 整理实验要求
```

期望：

- selected/chat attachment 是 preferred source。
- 模型通常先 read attachment / explicit file。
- workspace search 仍可见。
- 除非用户说“只根据这个 PDF”，否则不强制隐藏 workspace search。

### 12.3 只使用显式资料

输入：

```text
只根据我上传的这个 PDF 总结，不要查别的资料
```

期望：

- `onlyScopes = ["explicit_sources"]`。
- 如果模型尝试 workspace search，executor 返回 skipped observation。
- 模型改为读取 explicit source 或 final。

### 12.4 模型知识 only

输入：

```text
不要检索上下文，只用模型知识写一份通用笔记
```

期望：

- read/search tools 可被隐藏，或 executor 按 `deniedTools` 拒绝。
- 写入工具只能使用 `sourceMode = "model_knowledge"`。
- trace 中没有实际 read/search evidence。

### 12.5 个性化学习建议

输入：

```text
根据我的学习情况安排数据库复习
```

期望：

- `learner_context.read` 由 UI/入口/用户表达启用。
- workspace search/read 仍是普通工具。
- learner context evidence 与 workspace evidence 分开记录。

### 12.6 课程图谱查询

输入：

```text
帮我梳理事务隔离级别和并发控制之间的前置关系
```

期望：

- `course_graph.query` 只有在工具策略允许时可用。
- 如果未启用，模型可以先用 workspace/knowledge search，或 ask user 是否允许查询课程图谱。
- 图谱 evidence 与 workspace evidence 分开记录。
- trace 中记录 graph query reason 和 returned concept ids。

### 12.7 写入工具不偷上下文

输入：

```text
把刚才找到的资料生成一份 Markdown 笔记
```

期望：

- `markdown_note.create` 输入引用 ledger evidence ids。
- 工具内部不再自动搜索。
- approval 中能看到将使用哪些 evidence。

## 13. 总结

新的上下文设计应服从 Cline 的核心原则：

```text
read/search 是 agent 的默认能力；
显式上下文是强信号，不是唯一授权；
用户 steering 控制 preferred / only / denied scopes；
runtime 用 tool policy、ignore、预算、ledger、compaction 管住执行；
写入工具只消费已记录 evidence，不自行获取上下文。
```

这样 V2 后续可以更直接借鉴 Cline 的代码结构：

- tool catalog / presets。
- tool policies / approval。
- mention enricher。
- ignore rules。
- message builder。
- compaction。
- read locator / stale evidence。
- task/session persistence。

这比基于 `ContextPolicyMode` 的上下文授权设计更简单，也更符合 Codex/Cline 式自主 agent。

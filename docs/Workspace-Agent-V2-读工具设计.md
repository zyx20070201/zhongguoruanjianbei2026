# Workspace Agent V2 读工具设计

## 1. 目标

Workspace Agent V2 的读工具应贴近 Cline/Codex 的 agent runtime 思路：

```text
模型看到稳定、清晰的读工具
  -> 自主决定是否探索上下文
  -> runtime / executor 负责 scope、ignore、预算、审批、ledger
```

读工具不负责业务路由，也不负责写入 workspace。它们只做一件事：把模型需要的环境、资料、网页、附件或知识证据读出来，并转成可审计的 observation / evidence。

## 2. 首批读工具目录

首批建议暴露给模型的读工具：

```text
workspace.fs.list
workspace.file.search
workspace.file.read
knowledge.search
attachment.list
attachment.read
attachment.image.inspect
web.search
web.fetch
```

这些工具覆盖 Cline 中 `list_files`、`search_files/search_codebase`、`read_files`、`web_fetch` 的核心能力，同时适配本项目的 workspace、workbench、知识索引、聊天附件和外部学习资源场景。

## 3. 工具职责与边界

### 3.1 `workspace.fs.list`

职责：

- 列出 workspace / workbench / explicit sources 范围内的文件、文件夹、资源卡片。
- 返回轻量 manifest，例如 id、name、path、mimeType、size、scope、indexStatus、resourceType、updatedAt。
- 帮助模型判断“有哪些资料可读”“下一步应该搜索还是读取哪个文件”。

边界：

- 不返回大段正文。
- 不做语义检索。
- 不触发索引。
- 不创建、移动、删除或绑定资源。

### 3.2 `workspace.file.search`

职责：

- 在 workspace / workbench / explicit sources 中查找相关文件。
- 返回文件级结果为主，例如 file cards、路径、摘要、主题、索引状态、chunk 覆盖情况。
- 适合回答“哪些文件相关”“这个主题在哪些资料里”“当前学习现场有哪些可用资料”。

边界：

- 它是“找文件/定位资源”的工具，不是最终的精确证据检索工具。
- 可以返回少量 top chunks 作为线索，但不应替代 `knowledge.search`。
- 不读取完整文件正文。
- 不自动写入索引；如需索引，应由独立索引流程或后台任务处理。

### 3.3 `workspace.file.read`

职责：

- 根据明确的 fileIds 读取文件内容。
- 对纯文本、Markdown、代码、CSV、JSON、SQL 等文本资源返回 clipped text evidence。
- 对已抽取/已索引的文档资源，可以返回可读文本片段、页/段落 locator 或已有 chunk 摘要。
- 支持 maxChars、lineRange、pageRange、locator 等受控读取参数。

边界：

- 它是“读取已定位文件”的工具，不负责搜索。
- 不应在没有 fileIds 的情况下扫描整个 workspace。
- 不应悄悄创建索引、写入 chunks 或修改文件。
- 对图片、扫描件、复杂视觉页面，不应硬塞进文本 read；应交给视觉类工具。

说明：

不建议单独暴露 `workspace.file.extract`。文档文本抽取可以作为 `workspace.file.read` 的内部 reader 能力；视觉理解应由 `attachment.image.inspect` 或后续 `workspace.visual.inspect` 负责；索引写入应属于独立 job，不属于普通 read tool。

### 3.4 `knowledge.search`

职责：

- 在已索引的 workspace knowledge chunks 中检索可直接支撑回答的知识证据。
- 返回 chunk 级 evidence，例如 chunkId、fileObjectId、title、summary、content excerpt、locator、score、retrievalReason。
- 适合回答定义、概念、步骤、例子、事实依据、跨文件知识点等问题。

边界：

- 它是“找证据段落”的工具，不是“列文件”的工具。
- 不返回完整文件列表。
- 不读取未索引文件全文。
- 不触发索引或外部搜索。
- 不替代 `workspace.file.read`：当模型需要核对完整上下文、连续段落或指定文件时，应继续调用 `workspace.file.read`。

与 `workspace.file.search` 的区别：

```text
workspace.file.search  -> 找相关文件 / 资源卡片 / 可读材料入口
knowledge.search       -> 找可引用的知识 chunk / 事实证据 / grounded answer 依据
```

`knowledge.search` 是 V2 最重要的读工具之一，因为学习 agent 的回答、计划和生成产物都需要可追踪的知识依据。

### 3.5 `attachment.list`

职责：

- 列出当前聊天轮次显式上传的附件。
- 返回附件 manifest，例如 id、name、mimeType、size、kind。

边界：

- 不读取正文。
- 不分析图片。
- 只作用于当前 chat attachments，不混入 workspace selected resources。

### 3.6 `attachment.read`

职责：

- 根据 fileIds 读取当前聊天附件中的文本内容。
- 适合读取用户刚上传的 txt、md、csv、json、代码、可抽取文本的文档等。

边界：

- 只能读取当前聊天附件。
- 需要显式 fileIds。
- 不读取 workspace 普通文件；workspace 文件使用 `workspace.file.read`。
- 不做图片视觉理解；图片使用 `attachment.image.inspect`。

### 3.7 `attachment.image.inspect`

职责：

- 对当前聊天附件中的图片调用视觉模型进行读取。
- 返回视觉 evidence，例如图片描述、可见文字/OCR、图表结构、公式、代码截图、界面元素、与用户问题相关的观察。

边界：

- 只能处理当前聊天附件中的图片。
- 不处理 workspace 内图片；后续可增加 `workspace.visual.inspect`。
- 不保存图片分析结果为长期记忆或索引，除非后续有单独写入工具和用户确认。
- 不替代 `attachment.read`；文本附件仍走 `attachment.read`。

### 3.8 `web.search`

职责：

- 根据 query 搜索外部学习资源、网页、文档或资料来源。
- 可复用现有 Exa / Tavily 的 `resourceDiscoveryService`。
- 返回候选 URL 列表、标题、snippet、summary、provider、score、publishedAt 等。

边界：

- 它是“发现 URL”的工具，不是“读取 URL 正文”的工具。
- 搜索结果摘要只能作为候选线索，不应直接当成完整网页证据。
- 若需要引用或深入理解某个网页，应继续调用 `web.fetch`。
- 受网络/API key/来源策略控制。

### 3.9 `web.fetch`

职责：

- 根据明确 URL 抓取网页内容。
- 可复用现有 `webSourceExtractionService.extract`。
- 返回网页标题、URL、站点信息、正文 markdown、excerpt、links、images 等。
- 适合读取用户给出的 URL，或读取 `web.search` 发现后的候选 URL。

边界：

- 它是“读取指定 URL”的工具，不负责搜索新 URL。
- 不导入网页为 workspace 资源；导入应由单独写工具处理并需要确认。
- 不递归爬站，除非后续单独设计 `web.crawl`。
- 不绕过网络、robots、大小、content-type、超时等限制。

`web.search` 与 `web.fetch` 的区别：

```text
web.search -> 我不知道该看哪个网页，先找候选来源
web.fetch  -> 我已经知道 URL，读取这个网页正文
```

## 4. 暂不作为首批读工具的能力

以下能力可以保留在后续阶段或条件启用：

```text
course_graph.query
learner_context.read
saved_memory.read
conversation_history.search
studio.artifacts.list
workspace.visual.inspect
web.crawl
mcp.resource.read
```

原因：

- `course_graph.query`、`learner_context.read`、`saved_memory.read`、`conversation_history.search` 会显著影响个性化和学习路径判断，应作为敏感/半敏感工具组单独启用。
- `studio.artifacts.list` 是 AI Studio 产物视图，不是基础上下文探索工具。
- `workspace.visual.inspect` 很有价值，但应在 `attachment.image.inspect` 稳定后扩展到 workspace 图片、PDF 页面截图、视频帧、PPT 页面等视觉来源。
- `web.crawl` 和 `mcp.resource.read` 涉及更强外部访问边界，后续再做。

## 5. 通用执行原则

所有读工具都应遵守：

- 默认低风险、可自动执行，但仍受 ToolPolicy 控制。
- 必须经过 ToolAvailability、schema validation、AcquisitionConstraints、scope guard。
- 工具结果进入 observation / evidence / context ledger。
- 大结果必须截断或摘要化，不直接塞入完整上下文。
- selected resources / chat attachments / mentions 是高优先级线索，不是默认唯一来源。
- 只有用户明确说“只根据这些资料”“不要查别的”时，才转成 onlyScopes / deniedTools。
- 读工具不产生写入副作用，不保存文件，不创建索引，不更新记忆，不绑定资源。

### 5.1 读工具结果的跨 turn 生命周期

读工具结果不能只作为本轮临时 evidence 存在。参考 Cline，工具结果应进入 agent message history，后续 turn 仍可被模型看到和复用，但必须受预算、话题相关性和 stale 规则控制。

读工具执行后应同时产生：

```text
tool_result message
  面向下一轮模型继续推理，包含工具名、输入、结果正文/摘要、evidenceIds、locators。

observation
  面向当前 loop 的简短状态说明。

evidence
  面向 final / write tool 的可引用证据块。

ledger entry
  面向跨 turn 恢复、去重、stale 判断和写入工具引用。
```

不同读工具的继承策略：

| 工具 | 跨 turn 保留内容 | 换话题后默认状态 |
| --- | --- | --- |
| `workspace.fs.list` | 文件卡、fileId、path、mimeType、scope、filters | `available`，通常不作为内容证据 |
| `workspace.file.search` | 命中文件、chunk 摘要、fileId、path、score | `available`，若当前请求引用“刚才找到的资料”可升为 `active` |
| `workspace.file.read` | 正文片段/full read、fileId、path、line/page locator、contentHash | 若被指代则 `active`；被新读取覆盖则旧结果 `stale` |
| `knowledge.search` | chunk 内容、chunkId、fileObjectId、locator、score | `available`，同话题追问可 `active` |
| `attachment.read` | 附件正文、attachmentId、name、mimeType | 同一附件追问时 `active` |
| `attachment.image.inspect` | 图片视觉观察、attachmentId、image metadata | 同一图片追问时 `active` |
| `web.search` | URL 候选、title、snippet、provider、publishedAt | `available`，不等同于已读取网页正文 |
| `web.fetch` | 网页正文/markdown、URL、title、fetch metadata | 同一 URL/话题追问时 `active` |

状态规则：

- `active`：当前 turn 明显引用该结果，例如“继续”“刚才那个文件”“里面”“基于这些资料”。应优先进入模型上下文。
- `available`：历史结果仍可用，但当前任务未明确引用。只给摘要和 locator，必要时重新 read/fetch。
- `stale`：结果被更新读取覆盖、源文件变化、话题明显切换且预算不足，或被 compaction 替换。保留 locator，不保留旧正文。

特别注意：

- `workspace.fs.list` 和 `workspace.file.search` 只能证明“发现过文件/候选资料”，不能证明“读过全文”。
- 如果下一轮要基于文件内容生成笔记，而历史里只有 file card，没有 `workspace.file.read` 的正文结果，模型必须继续调用 `workspace.file.read`。
- 如果历史里有 read result，但被压缩掉正文，模型可以用保留的 fileId/path/locator 继续读取。
- web 搜索候选不能直接作为事实依据；需要引用网页内容时应有 `web.fetch` 的 tool_result。
- 旧搜索结果不会因为用户换话题立刻删除，但会降级为 `available` 或 `stale`，不能自动污染新话题。

## 6. 写工具消费边界

读工具的最终价值是为后续回答和写工具提供 evidence。

后续 side-effect / proposal tools 应逐步改成：

```text
read/search/list/inspect/fetch
  -> observation / evidence / ledger
  -> write/proposal tool 引用 evidenceIds 或声明 sourceMode=model_knowledge
  -> approval
  -> execute
```

写工具不应自行调用旧的 `contextMode:auto` 去重新搜索上下文。需要资料时，应先由模型显式调用读工具，让 runtime 记录证据链。

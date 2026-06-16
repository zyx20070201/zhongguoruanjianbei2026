# Workspace Agent V2 写工具设计

## 1. 结论

当前 V2 的最小写入闭环已经跑通，但它还不是完整的 Cline 式写文件能力。

当前实现更准确地说是：

```text
Markdown-specific write_to_file
```

也就是 `markdown_note.create`：

- 模型必须在 `content` 中给出完整 Markdown 内容。
- 工具只负责校验、审批、保存、返回 artifact。
- 写工具本身不读取上下文、不生成内容。
- `DeliveryGate` 防止用户要求保存文件时，模型用聊天区 Markdown 冒充文件交付。

但它还不能覆盖 Cline 的完整写工具语义：

```text
write_to_file      -> 写任意文本文件，创建或覆盖，content 是完整文件内容
replace_in_file    -> 对已有文件做精确局部替换
多文件任务          -> 多个文件写入/替换动作全部完成后才允许 completion
```

因此下一步建议把写工具分为三层：

```text
file.write          通用单文件创建/覆盖
file.replace        通用已有文件局部替换
file.write_many     多文件创建/覆盖的批量 convenience 工具
```

`markdown_note.create` 可以保留为 Markdown 友好别名或向后兼容工具，但不应继续承担通用文件写入职责。

## 2. Cline 对照

本节基于本地临时仓库 `/private/tmp/cline-reference` 中的 Cline 代码整理。

### 2.1 Cline 的旧工具：`write_to_file`

参考：

- `/private/tmp/cline-reference/apps/vscode/src/core/prompts/system-prompt/tools/write_to_file.ts`
- `/private/tmp/cline-reference/apps/vscode/src/core/task/tools/handlers/WriteToFileToolHandler.ts`

Cline 对 `write_to_file` 的定义非常直接：

```text
path: 要写入的文件路径，相对当前工作目录
content: 完整的目标文件内容
```

关键规则：

- 如果文件不存在，创建文件。
- 如果文件存在，用完整 content 覆盖。
- 自动创建必要目录。
- content 必须是完整文件内容，不能省略未修改部分。
- 工具不关心文件格式；`.ts`、`.c`、`.md`、`.json` 都是同一个写文件语义。

这点对 V2 很重要：Cline 的 `write_to_file` 不是 Markdown 工具，也不是学习笔记工具。它是一个文件系统写入工具。

### 2.2 Cline 的旧工具：`replace_in_file`

参考：

- `/private/tmp/cline-reference/apps/vscode/src/core/prompts/system-prompt/tools/replace_in_file.ts`
- `/private/tmp/cline-reference/apps/vscode/src/core/task/tools/handlers/WriteToFileToolHandler.ts`

`replace_in_file` 用于已有文件的局部编辑。它不要求模型提供完整文件，而是提供一个或多个 SEARCH/REPLACE block。

关键规则：

- SEARCH 必须和文件原文精确匹配。
- 每个 block 只替换第一个匹配。
- 多处修改可以使用多个 block，并按文件出现顺序排列。
- 大改动应拆成多个小 block。
- 如果来自带行号的 read result，不能把行号前缀放进 SEARCH。

这说明 Cline 区分两类写入：

```text
新建/整体覆盖 -> write_to_file
已有文件小改 -> replace_in_file
```

V2 也应保持这个区分，不要用一个“生成文件”工具同时承担所有创建、覆盖、patch、append、局部替换语义。

### 2.3 Cline 的新 SDK 工具：`editor`

参考：

- `/private/tmp/cline-reference/sdk/packages/core/src/extensions/tools/schemas.ts`
- `/private/tmp/cline-reference/sdk/packages/core/src/extensions/tools/definitions.ts`
- `/private/tmp/cline-reference/sdk/packages/core/src/extensions/tools/executors/editor.ts`

SDK 新工具 `editor` 把创建、替换、插入合到一个结构化工具里：

```text
path
old_text?
new_text
insert_line?
```

执行语义：

- 文件不存在时，用 `new_text` 创建文件。
- 文件存在且没有 `insert_line` 时，必须提供 `old_text`，并且 old_text 必须精确匹配一次。
- 有 `insert_line` 时，在指定行边界插入 `new_text`。

这个设计比旧 XML 工具更统一，但它仍然是单文件 action，不是一个业务生成器。

V2 可以借鉴它的思想，但由于当前 V2 已经有 tool registry + JSON schema + approval gate，更自然的落点是：

```text
file.write      对齐 write_to_file
file.replace    对齐 replace_in_file/editor replace
file.insert     可选，对齐 editor insert_line
```

或者先只实现前两个。

### 2.4 Cline 的多文件方式

Cline 并没有把 `write_to_file` 设计成 `files: []` 批量工具。多文件通常通过多个 tool use 完成。

参考：

- `/private/tmp/cline-reference/apps/vscode/src/core/api/adapters/__tests__/adapters.test.ts`

测试中存在一个 assistant message 里同时包含多个 tool use 的情况，例如一个 `write_to_file` 加一个 `replace_in_file`，adapter 会把它们分别转换成对应 patch。

这给 V2 两个启发：

1. 核心能力仍应是“单文件写/改”。
2. 产品层可以提供 `file.write_many` 作为 convenience 工具，减少多文件任务的审批和轮数。

V2 当前模型决策接口一次只返回一个 `WorkspaceAgentDecision`，所以如果完全复刻 Cline 的“一个 assistant message 多个 tool_use”，需要改决策协议。短期更实际的方案是新增 `file.write_many`。

## 3. 当前 V2 状态

当前代码重点位置：

- `backend/src/services/workspaceAgentV2/adapters/sideEffectTools.ts`
- `backend/src/services/workspaceAgentV2/contextControl.ts`
- `backend/src/services/workspaceAgentV2/deliveryPlanner.ts`
- `backend/src/services/workspaceAgentV2/runtime.ts`
- `backend/src/services/fileSystemService.ts`

### 3.1 已完成能力

V2 已经完成从 Markdown-only 写入到 Cline-style 文件写入的第一轮升级：

```text
file.write        -> 通用单文件创建/保存
file.write_many   -> 多文件/小项目批量创建
file.replace      -> 已有文本文件精确局部替换
markdown_note.create -> Markdown 兼容工具，内部复用通用保存逻辑
```

`markdown_note.create` 仍具备 Cline `write_to_file` 的关键形态：

```json
{
  "filename": "summary.md",
  "content": "# 完整 Markdown 内容"
}
```

它的边界也基本正确：

- 工具不负责生成内容。
- 工具不负责搜索/读取上下文。
- 工具保存完整 content。
- 工具产生 `artifactRefs` 和 evidence。
- side effect 需要审批。

`DeliveryContract` 和 `DeliveryGate` 解决了一个重要问题：

```text
当用户要求保存文件时，final answer 不能替代文件写入。
```

这与 Cline 的 `attempt_completion` 语义一致：任务要求写文件时，文件必须真的写完，不能只在回答里展示代码块。

### 3.2 已解决的问题

这轮升级已经解决：

1. `markdown_note.create` 只能写 `.md/.markdown` 的问题：新增 `file.write` 支持任意文本扩展名。
2. 非 Markdown 文件会被包进 Markdown 的问题：prompt 和 gate 都明确代码文件必须走 raw code。
3. 多文件任务缺少稳定交付的問題：新增 `file.write_many` 和 `requiredFiles` 检查。
4. `file.save_generated` 只在 allowlist 中出现但未注册的问题：实现路径改为真实注册的 `file.write` / `file.write_many`。
5. 局部替换缺失的问题：新增 `file.replace`，要求 search 精确匹配一次。

### 3.3 仍需继续观察的缺口

当前仍需继续观察：

1. `file.replace` 第一版基于 `getFileContent + saveFileContent`，还不是完整的 revision-aware patch 工具。
2. `file.write_many` 不是事务写入；中途失败时需要依赖 observation 表达 partial failure。
3. `DeliveryContract.requiredFiles` 是保守启发式识别，不追求完美理解所有文件结构。
4. 后续如果要完全贴近 Cline 多 tool_use，需要升级 `WorkspaceAgentDecision` 协议，而不仅是 `file.write_many`。

因此：

```text
生成一个 Markdown 文件 -> 当前可以
生成 hello.c -> 当前通过 file.write 支持
生成一个包含 main.c/utils.c/utils.h 的项目 -> 当前通过 file.write_many 支持
修改已有文件的一小段 -> 当前通过 file.replace 支持
```

## 4. 设计原则

### 4.1 写工具不是内容生成器

写工具只做：

```text
validate input
apply product boundary
approval
persist content
return observation/artifact/evidence
```

内容生成仍然由模型在决策阶段完成。模型可以先用读工具获取上下文，再把完整内容放进写工具 input。

这点必须坚持，否则会回到之前错误的设计：工具内部再调用模型生成内容，导致 agent 决策链路和工具执行链路错位。

### 4.2 文件格式不由 prompt 硬编码

`file.write` 不应告诉模型“这是学习笔记”“这是 Markdown”。它只描述文件系统语义。

格式相关事情主要由：

- 用户请求。
- 文件扩展名。
- mimeType 推断。
- 模型自己的内容生成能力。
- 少量工具说明中的完整性要求。

决定。

### 4.3 单文件工具是基础，多文件工具是产品优化

为了贴合 Cline，基础能力应优先是单文件 action：

```text
file.write
file.replace
```

但由于 V2 当前一次 decision 只能调用一个工具，且用户场景里“生成项目/多份材料”很常见，所以可以额外提供：

```text
file.write_many
```

它不是 Cline 旧工具的原样复制，而是适配 V2 当前决策协议和审批体验的产品化扩展。

### 4.4 DeliveryContract 管完成条件，不替模型做业务路由

`DeliveryContract` 应回答：

```text
这轮结果必须交付到哪里？
需要哪些 artifact 才算完成？
```

它不应回答：

```text
内容怎么写？
先读哪些资料？
业务上应该做成什么结构？
```

这些仍然由模型根据 read/search observations 决定。

## 5. 单文件工具设计

### 5.1 `file.write`

定位：

```text
Cline write_to_file 的 V2 对应工具。
```

用途：

- 创建任意文本文件。
- 覆盖已有 generated 文件。
- 保存代码、Markdown、JSON、CSV、TXT、配置文件等。

建议 schema：

```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string" },
    "filename": { "type": "string" },
    "targetDir": { "type": "string" },
    "content": { "type": "string" },
    "mimeType": { "type": "string" },
    "sourceFileIds": { "type": "array" },
    "overwrite": { "type": "boolean" }
  },
  "required": ["content"],
  "additionalProperties": false
}
```

说明：

- `path` 和 `filename + targetDir` 二选一。
- 第一版可以只支持 `filename + targetDir`，避免路径穿越和复杂目录语义。
- JSON schema 第一版可以保持简单，但 executor 必须做运行时校验：`path` 或 `filename` 至少存在一个。
- `content` 必须是完整文件内容。
- `overwrite` 第一版建议默认为 `false`，如果同名存在则沿用 `generateUniqueFilename`，更符合当前 `saveGeneratedContent` 习惯。
- 真正覆盖已有文件应走 `file.replace` 或后续明确的 `file.overwrite`。

工具说明应接近 Cline：

```text
Save complete content to a text file in the workspace or current workbench.
Use this like Cline write_to_file: provide the complete intended file content in input.content.
This tool does not generate, search, or read context by itself.
```

不要写：

```text
创建学习笔记
整理学习资料
生成 Markdown
```

执行逻辑：

```text
validate filename/path
infer extension
infer mimeType if missing
FileSystemService.saveGeneratedContent(...)
return observation with artifactRefs[0].kind=file
return evidence kind=generated_file
```

MIME 推断第一版可以简单映射：

```text
.md       text/markdown
.txt      text/plain
.json     application/json
.csv      text/csv
.c        text/x-c
.h        text/x-c
.cpp      text/x-c++
.py       text/x-python
.js       text/javascript
.ts       text/typescript
.html     text/html
.css      text/css
.sql      application/sql
fallback  text/plain
```

### 5.2 `file.replace`

定位：

```text
Cline replace_in_file 的 V2 对应工具。
```

用途：

- 修改已有 workspace/workbench 文件的一小段。
- 避免为了小修改重写整文件。
- 支持多个 SEARCH/REPLACE block。

建议 schema：

```json
{
  "type": "object",
  "properties": {
    "fileId": { "type": "string" },
    "path": { "type": "string" },
    "replacements": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "search": { "type": "string" },
          "replace": { "type": "string" }
        },
        "required": ["search", "replace"],
        "additionalProperties": false
      }
    },
    "sourceObservationIds": { "type": "array" }
  },
  "required": ["replacements"],
  "additionalProperties": false
}
```

规则：

- `fileId` 优先，`path` 作为后续可选能力。
- 每个 `search` 必须精确匹配一次。
- 如果匹配 0 次或多次，整个工具失败，不写入。
- 多个 replacement 按输入顺序执行。
- 成功后返回最终文件摘要、diff summary、artifactRef。

重要约束：

```text
file.replace 应要求模型先 read 文件，或至少提供 sourceObservationIds。
```

Cline 的 `replace_in_file` 能成功，是因为模型通常先 `read_file`，然后用读到的精确文本构造 SEARCH block。V2 也应该鼓励这条路径。

### 5.3 `markdown_note.create` 的位置

`markdown_note.create` 不建议立刻删除。

它可以作为：

```text
file.write 的 Markdown 兼容别名
面向已有前端文案/测试的稳定接口
DeliveryPlanner 保存历史整理内容的快捷工具
```

但新能力不应继续叠在它上面。

长期可以有两种选择：

1. 保留 `markdown_note.create`，但内部复用 `file.write` 的保存逻辑。
2. 在 prompt/manifest 中逐步弱化它，让模型默认使用 `file.write`，只有明确 Markdown 时才用它。

## 6. 多文件工具设计

### 6.1 为什么需要 `file.write_many`

严格贴合 Cline 的方式是多个单文件 tool use：

```text
write_to_file main.c
write_to_file utils.c
write_to_file utils.h
attempt_completion
```

但 V2 当前决策协议一次只返回一个 `tool_call`，如果生成 3 个文件，需要 3 轮模型决策和 3 次 approval。这会带来：

- 延迟变高。
- 用户确认次数多。
- delivery gate 难以判断“多文件全部完成”。
- 模型可能写完一个文件就 final。

所以 V2 适合增加一个批量 convenience 工具：

```text
file.write_many
```

它不是替代 `file.write`，而是多文件任务的省轮数工具。

### 6.2 `file.write_many`

用途：

- 生成小型代码项目。
- 一次生成多份 Markdown/JSON/CSV 资料。
- 一次保存主文件 + 配套索引/说明。

建议 schema：

```json
{
  "type": "object",
  "properties": {
    "targetDir": { "type": "string" },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "filename": { "type": "string" },
          "path": { "type": "string" },
          "content": { "type": "string" },
          "mimeType": { "type": "string" }
        },
        "required": ["filename", "content"],
        "additionalProperties": false
      }
    },
    "sourceFileIds": { "type": "array" },
    "overwrite": { "type": "boolean" }
  },
  "required": ["files"],
  "additionalProperties": false
}
```

限制建议：

- `files.length` 第一版限制 1 到 8。
- 单文件 content 限制，例如 60k chars。
- 总 content 限制，例如 160k chars。
- 每个 file 必须有 `filename`，第一版不建议开放任意 `path`。
- 默认不覆盖已有文件，同名自动去重。
- 路径必须限制在 workspace/workbench generated 区域。
- 不支持 binary。

审批：

```text
一次 approval，展示所有将创建的文件名、扩展名、大小预估。
```

执行：

```text
for each file:
  validate filename/path
  infer mimeType
  saveGeneratedContent
  collect artifactRefs/evidence

if any file fails:
  第一版建议 fail-fast，不部分写入？
```

关于事务：

当前 `FileSystemService.saveGeneratedContent` 是逐个创建文件，并且会写本地 storage + DB。严格事务很难，因为文件存储和 DB 不是一个事务域。

第一版建议采用：

```text
预校验全部文件
再逐个写入
如果中途失败，observation 明确 partial failure 和已写入 artifactRefs
DeliveryContract 不标记 satisfied
```

后续再考虑补偿删除或 draft/staging 机制。

### 6.3 不建议把多文件塞进 `markdown_note.create`

不要把 `markdown_note.create` 改成：

```json
{
  "files": [...]
}
```

原因：

- 名字和语义都偏 Markdown。
- 会继续混淆“Markdown 文件”和“任意文件”。
- 未来生成代码项目时会显得很别扭。
- Cline 的写文件语义本来就是文件系统级，不是 Markdown 级。

## 7. DeliveryContract 扩展设计

当前 `WorkspaceAgentDeliveryContract` 只能表达单个交付目标：

```ts
required
target
action
format
filenameHint
status
satisfiedBy
```

为了支持任意文件和多文件，建议扩展为：

```ts
interface WorkspaceAgentDeliveryContract {
  required: boolean;
  target: 'inline_answer' | 'workspace_file' | 'workbench_file' | 'existing_workspace_file' | 'workbench';
  action: 'answer' | 'create' | 'update';
  format?: 'markdown' | 'json' | 'code' | 'text' | 'unknown';
  filenameHint?: string;
  scope?: 'workspace' | 'workbench';
  requiredFiles?: WorkspaceAgentRequiredFile[];
  rawUserText: string;
  confidence: number;
  status: 'pending' | 'satisfied' | 'blocked';
  satisfiedBy?: WorkspaceAgentSatisfiedArtifact[];
}

interface WorkspaceAgentRequiredFile {
  filename?: string;
  extension?: string;
  mimeType?: string;
  role?: 'main' | 'supporting' | 'test' | 'doc' | 'data' | 'unknown';
  optional?: boolean;
  status: 'pending' | 'satisfied';
  satisfiedBy?: WorkspaceAgentSatisfiedArtifact;
}

interface WorkspaceAgentSatisfiedArtifact {
  tool: string;
  artifactKind: 'file' | 'workbench' | 'preview';
  id: string;
  title?: string;
  path?: string;
}
```

识别示例：

```text
生成 hello.c 放到 workspace
  -> requiredFiles: [{ filename: "hello.c", extension: "c", role: "main" }]

生成一个 C 项目，包括 main.c、utils.c、utils.h
  -> requiredFiles:
     main.c
     utils.c
     utils.h

生成三份 md 文件
  -> requiredFiles: 3 个 markdown unknown filename slots
```

注意：

`DeliveryContract` 不需要完美理解所有文件名。它可以只在用户明确给出文件名时填 requiredFiles；否则填数量和格式线索。模型仍然负责具体命名。

## 8. DeliveryGate 扩展设计

当前 gate 只看：

```text
有没有一个 markdown_note.create 成功 artifact
```

扩展后应看：

```text
contract.requiredFiles 中每个必需文件是否有匹配 artifact
```

匹配规则第一版：

```text
如果 requiredFile.filename 存在：
  artifact.title/path basename 必须匹配

否则如果 extension 存在：
  任意同 extension artifact 可满足一个 pending slot

否则：
  任意 file artifact 可满足一个 pending slot
```

可满足工具：

```text
file.write
file.write_many
markdown_note.create
file.replace
```

但要区分 action：

```text
create -> file.write / file.write_many / markdown_note.create
update -> file.replace
```

gate summary 应明确告诉模型缺什么：

```text
用户要求生成 3 个 workspace 文件，但目前只看到 1 个成功写入 artifact。
还缺：utils.c, utils.h。
请调用 file.write 或 file.write_many，提供完整文件内容。
```

## 9. ToolPolicy 与审批

写工具都属于 side effect：

```text
risk: medium
requiresApproval: true
autoApprove: false
```

建议策略：

| 工具 | 风险 | 默认审批 | maxCallsPerRun |
| --- | --- | --- | --- |
| `file.write` | medium | yes | 6 |
| `file.write_many` | medium | yes | 2 |
| `file.replace` | medium/high | yes | 6 |
| `markdown_note.create` | medium | yes | 2 |

`file.replace` 对已有文件修改风险更高，如果未来支持覆盖用户上传源文件，应提高到 high 或增加二次确认。第一版可以只允许修改 agent 生成文件，降低风险。

## 10. 与现有 FileSystemService 的关系

`FileSystemService.saveGeneratedContent` 已经能承担 `file.write` / `file.write_many` 的大部分底层能力：

- 生成唯一文件名。
- 保存文本 content。
- 设置 mimeType、extension、scope、ownerWorkbenchId。
- 绑定 workbench。
- 调度知识索引。

因此第一阶段不需要重写文件系统服务。

需要补的是 V2 adapter：

```text
tool schema
filename/path 安全校验
mimeType 推断
多文件预校验
artifact/evidence 组装
DeliveryContract satisfied 判断
```

`file.replace` 可能需要新增 FileSystemService 方法，例如：

```ts
replaceGeneratedFileContent(fileId, replacements, metadata)
```

或者复用已有 revision/update 能力，如果当前项目已有文件编辑 API，应优先复用。

## 11. Prompt 设计

系统 prompt 不应写成“生成学习笔记”。建议加入类似 Cline 的工具说明：

```text
For file.write:
Use this like Cline write_to_file. Provide the complete intended content of the file.
If the file is code, write raw code directly in content. Do not wrap it in Markdown fences unless the target file itself is Markdown.
This tool does not gather context by itself.
```

对于多文件：

```text
For file.write_many:
Use this when the user asks for multiple files or a small project. Provide each file as raw final content.
Do not combine multiple requested files into one Markdown file unless the user explicitly asks for a single bundled document.
```

对于 completion：

```text
If DeliveryContract requires workspace/workbench files, final answer cannot satisfy it.
Only final after observations/artifactRefs show required files were written.
```

## 12. 实施顺序

建议分四步做，不要一次把所有编辑能力做完。

### Phase 1: 通用单文件创建

实现：

```text
file.write
```

配套：

- 注册工具。
- 加入 DEFAULT_WRITE_TOOLS。
- ToolPolicy。
- mimeType 推断。
- DeliveryContract 对 `.c/.py/.json/.txt` 等 filenameHint 的识别。
- DeliveryGate 支持 `file.write` artifact。
- 测试：生成 `hello.c` 不应保存成 Markdown。

### Phase 2: 多文件创建

实现：

```text
file.write_many
```

配套：

- schema 限制 files 数量和总内容大小。
- approval 展示多个文件。
- observation 返回多个 artifactRefs。
- DeliveryContract.requiredFiles。
- DeliveryGate 检查 requiredFiles 全部 satisfied。
- 测试：`main.c/utils.c/utils.h` 三文件全部写入才 final。

### Phase 3: 局部替换

实现：

```text
file.replace
```

配套：

- 要求 fileId 或安全 path。
- 要求 exact single match。
- 失败时 observation 告诉模型重新 read。
- 成功后记录 revision / evidence / final content preview。
- 测试：0 match、多 match、成功替换。

### Phase 4: 工具收敛

收敛：

- `markdown_note.create` 内部复用 `file.write` helper。
- prompt 中默认推荐 `file.write`，Markdown 明确任务可用 `markdown_note.create`。
- 如果 `file.write` 足够稳定，可以把 `markdown_note.create` 降为 compatibility alias。

## 13. 关键测试用例

必须覆盖：

```text
用 Markdown 格式回答我事务概念
  -> inline answer，不触发文件 delivery

生成 summary.md 放到 workspace
  -> markdown_note.create 或 file.write，文件扩展名 .md

生成 hello.c 放到 workspace
  -> file.write，文件扩展名 .c，content 是 raw C code，不是 Markdown fence

生成一个 C 项目，包含 main.c、utils.c、utils.h
  -> file.write_many 或三次 file.write，三个 artifact 都存在才 satisfied

生成三个 md 文件
  -> 三个 Markdown 文件，不是一个合并 Markdown

修改刚才生成的 hello.c，把输出改成 Hi
  -> 先 read，再 file.replace，exact match 成功

replace search 0 match
  -> failed observation，不写入

replace search 多 match
  -> failed observation，不写入
```

## 14. 最终目标

最终 V2 写工具应达到：

```text
模型像 Cline 一样决定：
  是否需要写文件
  写哪个文件
  写完整文件还是局部替换
  一次写一个还是多个

runtime 像 Cline 一样保证：
  写入前审批
  输入 schema 正确
  路径/范围安全
  写入真的发生
  artifact 可审计
  completion 只能在交付满足后发生
```

这样，Workspace Agent V2 才会从“能生成 Markdown 文件”升级为真正的“能在 workspace 中生产和维护文件”的 agent。

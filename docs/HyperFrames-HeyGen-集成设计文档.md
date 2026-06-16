# HyperFrames（HeyGen）集成设计文档

## 一、结论

HyperFrames 可以加入当前项目，但它不是传统意义上的浏览器插件，更像一个“HTML 驱动的视频生成引擎”。

根据官方文档，HyperFrames 的核心能力是：

- 用 HTML / CSS / JS 编排视频
- 以确定性方式渲染成 MP4
- 提供 CLI 预览、渲染、lint、诊断能力
- 提供浏览器可嵌入的播放器
- 提供可交互预览编辑器
- 提供基于 Chrome 的逐帧捕获引擎

这意味着，它非常适合接入我们现有的智能学习助手，用来把课程资料、实验报告、转写内容和知识图谱自动变成短视频或演示视频。

它**适合加入**的部分：

- AI Studio 生成的课程讲解视频
- BearPi-HM Micro 实验演示视频
- 答辩演示短视频
- 知识图谱/流程图动画视频
- 由资料摘要自动生成的讲解视频

它**不擅长直接替代**的部分：

- 纯数字人直播式口播
- 复杂云端头像驱动的托管视频服务
- 需要大量手工剪辑的传统视频后期

因此，HyperFrames 更适合做成我们项目里的“视频生产与渲染层”，而不是单独当成一个功能点。

## 二、HyperFrames 的关键能力

### 2.1 核心特点

HyperFrames 官方定位是“让 AI agents 用 HTML、CSS、JS 编排视频”，并且输出确定性的逐帧 MP4。也就是说，同样输入、同样素材，输出结果一致，适合自动化生成和回归渲染。

对我们项目最有价值的点有四个：

1. **HTML 就是视频脚本**  
   我们可以把视频当成网页布局来写，而不是进入复杂的传统剪辑软件。

2. **预览和渲染分离**  
   开发时可以浏览器预览，交付时输出 MP4。

3. **适合 AI Agent 生成**  
   它本身就是为 agent 设计的，和我们当前的 AI Studio 工作流天然契合。

4. **支持网页界面与 3D / Canvas 效果**  
   这很适合把课程知识图谱、代码流程、实验步骤可视化。

### 2.2 官方组件

官方文档提到的几个关键组件如下：

- `hyperframes` CLI：创建、预览、渲染、lint、诊断视频项目。
- `@hyperframes/studio`：浏览器端可视化编辑器，支持实时预览和时间轴。
- `@hyperframes/player`：可嵌入任意网页的播放器。
- `@hyperframes/engine`：底层逐帧捕获引擎。
- HTML-in-Canvas：可以把 DOM 渲染到 canvas，再映射到 WebGL / 3D 场景。

## 三、与当前项目的契合点

当前项目已经有：

- `AI Studio` 资源生成
- `render job` 渲染任务
- `artifact` 产物保存
- `videoAnalysisService` 视频分析
- `Workbench` 级别的资源预览
- 支持 HTML、PPTX、TSX、交互式资源等输出

这说明我们并不是从零开始接视频能力，而是只需要把 HyperFrames 作为新的渲染后端接进来。

最适合的接入位置有两个：

1. **AI Studio 新增视频模板**
   - 例如 `bearpi_intro_video`
   - `experiment_summary_video`
   - `knowledge_graph_explainer_video`
   - `presentation_demo_video`

2. **Workbench 新增视频资源预览**
   - 生成后保存成 MP4
   - 预览时用播放器播放
   - 必要时同时保留 HTML composition 作为可编辑源文件

## 四、建议的集成方案

### 4.1 产线设计

建议把 HyperFrames 作为一条独立的视频生产产线：

```text
课程资料 / BearPi 录音 / 转写文本 / 知识图谱
    -> AI Studio 生成视频脚本
    -> HyperFrames composition（HTML/CSS/JS）
    -> 预览与迭代
    -> 渲染为 MP4
    -> 保存到 Workspace / Workbench
    -> 在前端播放或下载
```

### 4.2 具体接入点

#### 1. 新增模板类别

在 `backend/src/services/studio/templateRegistry.ts` 里新增一组视频模板，例如：

- `bearpi_lab_video`
- `lecture_highlight_video`
- `quiz_review_video`
- `knowledge_map_video`
- `demo_promo_video`

这些模板的输出不只是 Markdown，而是 HyperFrames 可执行的 HTML composition。

#### 2. 新增 renderer

在 `studio` 渲染体系中新增一个 renderer，例如：

- `hyperframes_html`
- 或 `hyperframes_video`

它的职责是：

- 接收结构化视频脚本
- 生成 HyperFrames composition 文件
- 调用 CLI 渲染 MP4

#### 3. 接入渲染任务

当前项目已经有 `StudioRenderJobService`，因此可以直接复用它的任务模型，只需要增加 HyperFrames 的执行逻辑：

- 生成 composition HTML
- 调用 `npx hyperframes render --output xxx.mp4`
- 记录进度、日志、失败原因
- 把生成的 MP4 作为文件资源保存

#### 4. 增加播放器预览

前端可以用两种方式预览：

- 开发态：使用 `@hyperframes/studio` 做交互式预览
- 阅读态：使用 `@hyperframes/player` 在 Workbench 中直接播放

### 4.3 推荐的目录结构

```text
backend/src/services/studio/hyperframes/
  - compositionBuilder.ts
  - hyperframesRenderer.ts
  - hyperframesTemplates.ts
  - hyperframesPrompting.ts

frontend/src/components/workbench/
  - HyperFramesPreviewPanel.tsx
  - HyperFramesPlayer.tsx
```

## 五、适合本项目的应用场景

### 5.1 BearPi 实验视频

把 BearPi-HM Micro 的实验过程做成 30 到 60 秒的演示视频：

- 实验目标
- 硬件组成
- 关键步骤
- 常见错误
- 结果总结

这比静态截图更适合答辩展示。

### 5.2 课程知识讲解视频

把 AI Studio 生成的学习资料转成视频，例如：

- 数据结构与算法概念讲解
- 编译原理词法分析流程
- 数据库事务隔离演示
- UDP 通信排错流程

### 5.3 答辩演示视频

我们当前项目本身就有答辩需求，HyperFrames 很适合生成：

- 项目简介视频
- 5 分钟演示版视频
- 课程作业展示视频
- 软件杯答辩开场视频

### 5.4 知识图谱动画

项目里已经有知识图谱能力，如果把节点、关系和步骤动画化，会比静态图更直观。

HyperFrames 的 HTML-in-Canvas 和 3D/Canvas 能力，适合把知识图谱、流程图和数据流做成动画。

## 六、实现步骤

### 阶段 1：最小接入

目标：先让系统能输出一个 HyperFrames composition 文件。

实现内容：

1. 新增一个视频模板。
2. 让 AI Studio 产出结构化视频脚本。
3. 生成 HTML composition。
4. 保存为可预览资源。

验收标准：

- 能生成 HTML 视频脚本。
- 浏览器里能打开预览。

### 阶段 2：渲染 MP4

实现内容：

1. 接入 `hyperframes` CLI。
2. 调用 `npx hyperframes render --output`.
3. 保存 MP4 到文件系统。
4. 在 Studio 结果页显示渲染状态。

验收标准：

- 视频能导出 MP4。
- 结果可下载、可播放。

### 阶段 3：播放器集成

实现内容：

1. 在 Workbench 中嵌入 `@hyperframes/player`。
2. 支持播放、暂停、进度查看。
3. 允许把视频插入课程资源流。

验收标准：

- 用户在网页里能直接播放生成的视频。

### 阶段 4：增强交互

实现内容：

1. 加入时间轴编辑。
2. 支持课程资料驱动的镜头分镜。
3. 支持从知识图谱自动生成动效。
4. 支持视频脚本与语音转写联动。

## 七、风险与限制

### 7.1 适合做“生成视频”，不等于完整视频剪辑平台

HyperFrames 更像代码驱动的视频生成引擎，不是给人手工剪辑的传统 NLE。

### 7.2 依赖浏览器与渲染环境

它需要 Chrome / Headless Chrome / CLI 环境，部署时要注意：

- Node 版本
- Chrome 运行环境
- 资产路径
- 字体和外链资源稳定性

### 7.3 长视频成本较高

对于长视频或大规模特效，渲染时间和资源占用会明显上升。  
所以更适合：

- 15 到 90 秒的短视频
- 实验说明视频
- 课程片段视频
- 答辩短片

### 7.4 如果要数字人，需要额外方案

HyperFrames 本身更偏向“代码驱动的视频合成”，如果后面要加真人口播或数字人形象，需要另外接：

- TTS
- 头像/数字人引擎
- 口型同步服务

这部分不应和 HyperFrames 混为一谈。

## 八、建议结论

如果我们的目标是：

- 让 AI 学习助手输出更直观的演示视频
- 让 BearPi 实验变成可以自动生成的短片
- 让知识图谱、流程图、实验步骤更适合答辩展示

那么 HyperFrames 是值得接入的，而且和当前项目的 `AI Studio` 结构非常契合。

最合理的路线是：

1. 先把它作为 `AI Studio` 的新视频模板接入。
2. 先做 HTML composition 预览。
3. 再接 MP4 渲染。
4. 最后加播放器和图形化编辑。

## 九、官方参考

- [HyperFrames 首页](https://hyperframes.heygen.com/)
- [HyperFrames Introduction](https://hyperframes.heygen.com/introduction)
- [HyperFrames Quickstart](https://hyperframes.heygen.com/quickstart)
- [HyperFrames CLI](https://hyperframes.heygen.com/packages/cli)
- [HyperFrames Studio](https://hyperframes.heygen.com/packages/studio)
- [HyperFrames Player](https://hyperframes.heygen.com/packages/player)
- [HyperFrames Engine](https://hyperframes.heygen.com/packages/engine)
- [HTML-in-Canvas](https://hyperframes.heygen.com/guides/html-in-canvas)
- [Pipeline](https://hyperframes.heygen.com/guides/pipeline)

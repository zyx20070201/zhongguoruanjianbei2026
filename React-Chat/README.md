# React Chat — React Sandbox

一个轻量级的 AI 聊天界面，内置 React / HTML 可视化沙盒。无需 Tool Use，通过标记约定让 AI 直接在对话中生成可交互的 React 组件和 HTML 可视化。

## ✨ 特性

- **双模式可视化** — 支持 `~~~REACT_VIZ` 和 `~~~HTML_VIZ` 两种标记，AI 的回复可直接渲染为可交互的组件
- **React 沙盒** — 预装 React 18、Recharts、Tailwind CSS，支持所有 Hooks，即写即渲染
- **HTML 沙盒** — 支持 Chart.js、Canvas、D3 等任意前端库
- **多 API 兼容** — 同时支持 Anthropic 和 OpenAI 格式，兼容各类中转站（OpenRouter、One API 等）
- **多模态输入** — 支持上传图片、粘贴图片，发送给视觉模型
- **多配置管理** — 保存多套 API 配置，一键切换
- **聊天记录持久化** — 多会话管理，支持导出/导入 JSON
- **联网搜索** — 可选的 DuckDuckGo 搜索集成
- **源码下载** — 每个可视化组件都可单独下载为 `.html` 或 `.jsx` 文件

## 🚀 快速开始

```bash
# 克隆仓库
git clone https://github.com/kjnjckx/React-Chat.git
cd React-Chat

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

打开浏览器访问 `http://localhost:5173/`，点击右上角 **设置** 按钮，填入你的 API Key 即可开始使用。

### 生产构建

```bash
npm run build    # 输出到 dist/
npm run preview  # 预览构建产物
```

## ⚙️ 配置说明

### 快速预设

| 预设 | 端点 | 默认模型 | API 格式 |
|------|------|----------|----------|
| Anthropic | `https://api.anthropic.com` | `claude-sonnet-4-20250514` | Anthropic |
| OpenRouter | `https://openrouter.ai/api` | `anthropic/claude-sonnet-4` | Anthropic |
| One API | 自定义域名 | `claude-sonnet-4-20250514` | Anthropic |
| OpenAI 兼容 | `https://api.openai.com` | `gpt-4o` | OpenAI |

### 自定义配置

1. 填写 **API 端点**、**API Key** 和 **模型名称**
2. 选择 **API 格式**（Anthropic 或 OpenAI）
3. 输入 **配置名称** 后点击 **保存配置**，方便后续切换

## 📖 使用方法

### 基本对话

直接输入文字即可与 AI 对话，和普通聊天工具无异。

### 生成可视化

向 AI 提出包含可视化需求的请求，它会自动使用标记生成可交互的组件：

- "用 React 做一个待办事项应用"
- "用 Recharts 画一个折线图展示数据趋势"
- "做一个交互式的颜色调色板工具"
- "用 Chart.js 画一个柱状图展示季度销售"

### 图片输入

- 点击图片按钮上传图片
- 或直接 **Ctrl+V** 粘贴剪贴板中的图片
- 支持多张图片同时发送

### 聊天记录

- 侧边栏多会话管理，可随时切换
- **导出 JSON** — 将当前对话导出为 JSON 文件
- **导入 JSON** — 从 JSON 文件恢复对话

## 🏗️ 技术架构

```
Vite + React 18 + TypeScript
├── UI 层 — React 组件，CSS 变量主题
├── 状态管理 — React Context (Config / Session / Chat)
├── API 层 — 支持 Anthropic / OpenAI 两种协议
├── 解析器 — 正则提取 ~~~HTML_VIZ / ~~~REACT_VIZ 标记
├── HTML 沙盒 — Blob URL + iframe 隔离渲染
└── React 沙盒 — CDN 加载 React 18 + Babel 实时编译
     ├── React 18 + ReactDOM
     ├── Babel Standalone (JSX → JS)
     ├── Recharts 2.x
     ├── Tailwind CSS 2.x
     └── PropTypes
```

**工作原理：** 通过 System Prompt 约定标记格式，AI 在普通文本中嵌入 `~~~REACT_VIZ` 或 `~~~HTML_VIZ` 代码块。前端解析器提取这些代码块，在 iframe 沙盒中安全渲染，实现无需 Tool Use 的可视化生成。

### 项目结构

```
src/
├── main.tsx                    # 入口
├── App.tsx                     # 根组件
├── types/index.ts              # TypeScript 类型
├── constants/                  # 系统提示词、API 预设
├── styles/                     # CSS 变量 + 全局样式
├── context/                    # Config / Session / Chat 状态
├── hooks/                      # useWebSearch / useImageUpload
├── utils/                      # API、解析器、沙箱模板、文本格式化
└── components/
    ├── Sidebar/                # 侧边栏 + 会话列表
    ├── Header/                 # 顶部栏
    ├── Chat/                   # 消息区（气泡、提示面板、加载动画）
    ├── InputArea/              # 输入框 + 图片预览
    ├── ConfigPanel/            # API 配置面板
    ├── Sandbox/                # iframe 渲染容器
    └── Toast/                  # 通知提示
```

## 🔒 安全

- 所有可视化代码在 **iframe 沙盒** 中隔离运行
- API Key 仅存储在浏览器本地 localStorage 中
- 不会将 Key 发送到除配置端点以外的任何服务器

## 📄 License

MIT

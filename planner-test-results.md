# LLM-only Planner 测试结果

生成时间：2026-05-17T14:48:59.582Z

说明：这 5 个结果来自本地已启动 backend 的 `POST /api/mcl/execute` 真实 HTTP API 路径，参数为 `intent=planning`、`sync=true`。

## 1. 普通学习型

输入：

```text
我要学习数据结构排序算法
```

输出失败：

```markdown
TypeError: fetch failed
    at node:internal/deps/undici/undici:14902:13
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async runOne (/private/tmp/run-planner-api-tests.js:15:19)
    at async main (/private/tmp/run-planner-api-tests.js:35:42)
```

## 2. 有基础补弱型

输入：

```text
我已经会 SELECT、WHERE 和 ORDER BY，但 JOIN 和 GROUP BY 很差，帮我做一个 SQL 学习计划
```

输出失败：

```markdown
TypeError: fetch failed
    at node:internal/deps/undici/undici:14902:13
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async runOne (/private/tmp/run-planner-api-tests.js:15:19)
    at async main (/private/tmp/run-planner-api-tests.js:35:42)
```

## 3. 备考冲刺型

输入：

```text
我两周后要考数据库，但我每天只有 40 分钟，SQL 查询比较弱，帮我安排复习计划
```

输出失败：

```markdown
TypeError: fetch failed
    at node:internal/deps/undici/undici:14902:13
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async runOne (/private/tmp/run-planner-api-tests.js:15:19)
    at async main (/private/tmp/run-planner-api-tests.js:35:42)
```

## 4. 项目导向型

输入：

```text
我想两周内做一个简单的 Django 博客系统，主要学习 ORM 和数据库设计
```

输出失败：

```markdown
TypeError: fetch failed
    at node:internal/deps/undici/undici:14902:13
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async runOne (/private/tmp/run-planner-api-tests.js:15:19)
    at async main (/private/tmp/run-planner-api-tests.js:35:42)
```

## 5. 时间受限型

输入：

```text
我想一个月内提高英语四级阅读能力，但我每天最多只能学 30 分钟
```

输出失败：

```markdown
TypeError: fetch failed
    at node:internal/deps/undici/undici:14902:13
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async runOne (/private/tmp/run-planner-api-tests.js:15:19)
    at async main (/private/tmp/run-planner-api-tests.js:35:42)
```

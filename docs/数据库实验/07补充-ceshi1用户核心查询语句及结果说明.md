# 7. 数据查询功能补充：ceshi1 用户核心模块查询

本节选取系统中最能体现数据库关联查询能力的三个模块：学习现场查询、课程资源查询和知识图谱查询。查询对象使用测试用户 `ceshi1` 的课程数据，查询语句采用 SQL Server 风格编写。实际截图时，可先执行建表和测试数据插入语句，再运行本节查询语句，将查询结果贴入文档。

## 7.1 查询 ceshi1 用户的学习现场

### 业务含义

学习现场是用户围绕某一具体学习任务建立的工作台，例如“SQL 与关系代数整理”“数据库范式复习”等。该查询用于展示 `ceshi1` 用户在指定课程空间下创建的学习现场，并统计每个学习现场绑定的课程资源数量、学习计划数量和学习事件数量。该功能对应系统中的 Workbench 列表页面。

### 查询语句

```sql
DECLARE @username NVARCHAR(50)=N'ceshi1';
DECLARE @workspace_name NVARCHAR(120)=N'数据库系统';

SELECT
    wb.id AS workbench_id,
    wb.title AS workbench_title,
    wb.status,
    wb.last_opened_at,
    COUNT(DISTINCT wr.file_id) AS resource_count,
    COUNT(DISTINCT lp.id) AS plan_count,
    COUNT(DISTINCT le.id) AS event_count
FROM dbo.Users u
INNER JOIN dbo.Workspaces w ON w.user_id=u.id
INNER JOIN dbo.Workbenches wb ON wb.workspace_id=w.id
LEFT JOIN dbo.WorkbenchResources wr ON wr.workbench_id=wb.id
LEFT JOIN dbo.LearningPlans lp ON lp.workbench_id=wb.id
LEFT JOIN dbo.LearningEvents le ON le.workbench_id=wb.id
WHERE u.username=@username
AND w.name=@workspace_name
AND wb.status<>N'deleted'
GROUP BY wb.id,wb.title,wb.status,wb.last_opened_at
ORDER BY wb.last_opened_at DESC,wb.title ASC;
```

### 查询结果说明

该查询结果中每一行表示一个学习现场。以 `ceshi1` 的演示数据为例，课程空间“数据库系统”下包含“SQL与关系代数整理”“围绕整理”“一个学习计划”等学习现场。结果中的 `resource_count` 可以说明该学习现场已经绑定了多少课程资料，`plan_count` 表示该学习现场下生成或维护的学习计划数量，`event_count` 表示相关学习行为记录数量。

截图时可重点展示 `workbench_title`、`resource_count`、`plan_count` 三列，用于说明系统能够按照用户和课程空间隔离学习任务数据。

## 7.2 查询 ceshi1 用户的课程资源

### 业务含义

课程资源包括用户上传的课件、文档、网页资料、学习笔记以及 AI 生成的复习资料。该查询用于展示 `ceshi1` 用户在“数据库系统”课程空间中的资源列表，并通过学习现场资源绑定表查询这些资源是否已经加入某个 Workbench。该功能对应系统中的课程资料管理页面和 Workbench 资源列表。

### 查询语句

```sql
DECLARE @username NVARCHAR(50)=N'ceshi1';
DECLARE @workspace_name NVARCHAR(120)=N'数据库系统';

SELECT
    f.id AS file_id,
    f.name AS file_name,
    f.file_type,
    f.resource_type,
    f.path,
    wb.title AS workbench_title,
    wr.role AS workbench_resource_role,
    wr.order_index,
    f.created_at
FROM dbo.Users u
INNER JOIN dbo.Workspaces w ON w.user_id=u.id
INNER JOIN dbo.FileObjects f ON f.workspace_id=w.id
LEFT JOIN dbo.WorkbenchResources wr ON wr.file_id=f.id
LEFT JOIN dbo.Workbenches wb ON wb.id=wr.workbench_id
WHERE u.username=@username
AND w.name=@workspace_name
ORDER BY f.created_at DESC,wb.title ASC,f.name ASC;
```

### 查询结果说明

该查询结果可以同时说明两层信息：第一，课程空间中保存了哪些资料；第二，某个资料是否被加入具体学习现场。以 `ceshi1` 的演示数据为例，“SQL与关系代数整理”学习现场下包含 `DBMS文字复习.docx`、`04-Constraints.pdf`、`05-relationAlgebra20260416.pdf`、`06-SQL-1_2026.pdf`、`07-SQL-2-2026.pdf` 等课程资料，也包含 `resource-understand-notes.md`、`review-flashcards.md`、`map-mind-map.md` 等 AI 生成资源。

截图时可选取“SQL与关系代数整理”相关记录，展示原始课件、学习笔记和生成资料能够统一存入课程资源表，并通过 `WorkbenchResources` 表关联到具体学习任务。

## 7.3 查询 ceshi1 用户的课程知识图谱

### 业务含义

知识图谱用于保存课程中的知识概念以及概念之间的关系，例如“关系代数”包含“选择”“投影”“连接”，或者“SQL 数据操作”关联 `SELECT`、`INSERT`、`UPDATE`、`DELETE` 等操作。该查询用于展示 `ceshi1` 用户在“数据库系统”课程空间中的知识图谱边数据。该功能对应系统中的知识图谱可视化页面。

### 查询语句

```sql
DECLARE @username NVARCHAR(50)=N'ceshi1';
DECLARE @workspace_name NVARCHAR(120)=N'数据库系统';

SELECT
    c1.title AS from_concept,
    kr.relation_type,
    c2.title AS to_concept,
    kr.weight,
    kr.created_at
FROM dbo.Users u
INNER JOIN dbo.Workspaces w ON w.user_id=u.id
INNER JOIN dbo.KnowledgeRelations kr ON kr.workspace_id=w.id
INNER JOIN dbo.KnowledgeConcepts c1 ON c1.id=kr.from_concept_id
INNER JOIN dbo.KnowledgeConcepts c2 ON c2.id=kr.to_concept_id
WHERE u.username=@username
AND w.name=@workspace_name
ORDER BY kr.weight DESC,kr.relation_type ASC,c1.title ASC,c2.title ASC;
```

### 查询结果说明

该查询结果中每一行表示知识图谱中的一条边，`from_concept` 是起点概念，`to_concept` 是终点概念，`relation_type` 表示两者之间的关系类型，`weight` 表示关系权重。以 `ceshi1` 的演示数据为例，知识图谱中包含“关系代数”“选择”“投影”“连接”“除运算”“SQL data manipulation”“SELECT”“INSERT”“DELETE”“UPDATE”等概念，并保存了 `supports`、`related` 等关系。

截图时可展示若干条权重较高的关系，例如 `SQL data manipulation` 与 `SELECT/INSERT/DELETE/UPDATE` 的关系，或“关系代数”与“选择、投影、连接”等概念的关系，用于说明系统可以把课程资料中的知识点组织成可查询、可视化的图结构。

## 7.4 查询结果小结

以上三个查询分别对应系统原型中的三个核心页面：Workbench 列表、课程资源管理和知识图谱。三组 SQL 都从 `Users` 表出发，根据 `username=N'ceshi1'` 定位测试用户，再通过 `Workspaces` 表限定课程空间，最后关联具体业务表。这样既能体现用户数据隔离，也能体现课程空间作为系统核心数据边界的设计思想。

import { FileSystemService } from '../../fileSystemService';
import { studioV2Service } from '../../studio/studioV2Service';
import type { StudioContextRef } from '../../studio/types';
import { webSourceExtractionService } from '../../webSourceExtractionService';
import { workbenchService } from '../../workbenchService';
import { buildStudioContextFromAgentEvidence } from '../studioContextCapsule';
import { createId, nowIso, clip, clipPreserveWhitespace } from '../utils';
import { workspaceAgentV2ToolRegistry } from '../toolRegistry';
import type { WorkspaceAgentEvidence, WorkspaceAgentObservation } from '../types';

const stringInput = (input: Record<string, unknown>, key: string, fallback = '') =>
  typeof input[key] === 'string' && String(input[key]).trim() ? String(input[key]).trim() : fallback;

const stringArrayInput = (input: Record<string, unknown>, key: string) =>
  Array.isArray(input[key])
    ? (input[key] as unknown[]).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 24)
    : [];

const objectArrayInput = (input: Record<string, unknown>, key: string) =>
  Array.isArray(input[key])
    ? (input[key] as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];

const recordInput = (input: Record<string, unknown>, key: string): Record<string, unknown> =>
  input[key] && typeof input[key] === 'object' && !Array.isArray(input[key])
    ? input[key] as Record<string, unknown>
    : {};

const safeFilename = (value: string, fallback = 'generated.txt') => {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120)
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
};

const markdownFilename = (value: string, fallback = 'generated.md') => {
  const filename = safeFilename(value, fallback);
  return /\.(md|markdown)$/i.test(filename) ? filename : `${filename}.md`;
};

const normalizeMarkdownContent = (value: string) => {
  const text = String(value || '').trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] || text).trim();
};

const sourceFilename = (title: string, fallback: string) => {
  const safeBase = (title || fallback)
    .trim()
    .replace(/\.[^./]+$/, '')
    .replace(/[\\/:*?"<>|#{}[\]`]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim() || fallback;
  return `${safeBase}.md`;
};

const buildCrawledSourceMarkdown = (source: {
  title: string;
  url: string;
  siteName?: string;
  pages: Array<{ title: string; url: string; contentMarkdown: string; depth: number }>;
}) => {
  const tableOfContents = source.pages
    .map((page, index) => {
      const indent = '  '.repeat(Math.max(0, page.depth));
      return `${indent}- ${index + 1}. [${page.title}](${page.url})`;
    })
    .join('\n');

  const pages = source.pages
    .map((page, index) => {
      const content = page.contentMarkdown
        .replace(/^#\s+.+$/m, '')
        .replace(/^Source type:\s*.+$/gim, '')
        .replace(/^URL:\s*.+$/gim, '')
        .replace(/^Site:\s*.+$/gim, '')
        .replace(/^Byline:\s*.+$/gim, '')
        .replace(/^Excerpt:\s*.+$/gim, '')
        .trim();
      return [
        `## ${index + 1}. ${page.title}`,
        '',
        `URL: ${page.url}`,
        `Depth: ${page.depth}`,
        '',
        content
      ].join('\n');
    })
    .join('\n\n---\n\n');

  return [
    `# ${source.title}`,
    '',
    'Source type: website',
    `URL: ${source.url}`,
    source.siteName ? `Site: ${source.siteName}` : '',
    `Pages indexed: ${source.pages.length}`,
    '',
    '## Site map',
    '',
    tableOfContents,
    '',
    '---',
    '',
    pages
  ].filter((line) => line !== '').join('\n');
};

const extensionOf = (filename: string) => filename.match(/\.([a-zA-Z0-9]{1,12})$/)?.[1]?.toLowerCase() || '';

const mimeTypeForFilename = (filename: string, explicit?: string) => {
  if (explicit && explicit.trim()) return explicit.trim();
  const extension = extensionOf(filename);
  const map: Record<string, string> = {
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    json: 'application/json',
    csv: 'text/csv',
    c: 'text/x-c',
    h: 'text/x-c',
    cpp: 'text/x-c++',
    cc: 'text/x-c++',
    cxx: 'text/x-c++',
    hpp: 'text/x-c++',
    py: 'text/x-python',
    js: 'text/javascript',
    jsx: 'text/javascript',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    html: 'text/html',
    css: 'text/css',
    sql: 'application/sql',
    yaml: 'application/yaml',
    yml: 'application/yaml',
    xml: 'application/xml',
    sh: 'application/x-sh'
  };
  return map[extension] || 'text/plain';
};

const observation = (
  tool: string,
  summary: string,
  artifactRefs: WorkspaceAgentObservation['artifactRefs'] = [],
  evidenceIds: string[] = []
): WorkspaceAgentObservation => ({
  id: createId('obs'),
  tool,
  status: 'success',
  summary,
  artifactRefs,
  evidenceIds,
  at: nowIso()
});

const STUDIO_AGENT_TEMPLATE_IDS = new Set([
  'mind_map',
  'custom_practice',
  'react_chat_visual',
  'flashcards',
  'code_lab',
  'light_visual_lesson'
]);

const studioGoalForTemplate = (templateId: string) => {
  if (templateId === 'mind_map') return 'map' as const;
  if (templateId === 'custom_practice') return 'practice' as const;
  if (templateId === 'flashcards') return 'review' as const;
  if (templateId === 'code_lab') return 'lab' as const;
  return 'visualize' as const;
};

const templateLabel = (templateId: string) => {
  if (templateId === 'mind_map') return '思维导图';
  if (templateId === 'custom_practice') return '练习题';
  if (templateId === 'react_chat_visual') return '可视化讲解';
  if (templateId === 'flashcards') return '复习卡片';
  return templateId;
};

const studioSourceEvidence = (
  input: Record<string, unknown>,
  contextEvidence: WorkspaceAgentEvidence[] = []
) => {
  const requestedIds = new Set(stringArrayInput(input, 'evidenceIds'));
  const candidates = requestedIds.size
    ? contextEvidence.filter((item) => requestedIds.has(item.id))
    : contextEvidence.filter((item) => item.content || item.metadata?.fileObjectId).slice(-8);
  return candidates.slice(-12);
};

const normalizeStudioContextRefs = (
  input: Record<string, unknown>,
  sourceEvidence: WorkspaceAgentEvidence[]
): StudioContextRef[] => {
  const refs: StudioContextRef[] = objectArrayInput(input, 'contextRefs')
    .flatMap((item): StudioContextRef[] => {
      const type = stringInput(item, 'type') as StudioContextRef['type'];
      if (type !== 'workspace_file' && type !== 'evidence' && type !== 'conversation' && type !== 'inline') return [];
      return [{
        type,
        fileId: stringInput(item, 'fileId') || undefined,
        evidenceId: stringInput(item, 'evidenceId') || undefined,
        messageId: stringInput(item, 'messageId') || undefined,
        turnId: stringInput(item, 'turnId') || undefined,
        title: stringInput(item, 'title') || undefined,
        content: typeof item.content === 'string' ? String(item.content).trim() : undefined,
        locator: item.locator && typeof item.locator === 'object' && !Array.isArray(item.locator)
          ? item.locator as any
          : undefined
      }];
    });
  for (const fileId of stringArrayInput(input, 'sourceFileIds')) {
    refs.push({ type: 'workspace_file', fileId });
  }
  for (const item of sourceEvidence) {
    refs.push({ type: 'evidence', evidenceId: item.id });
    const fileId = typeof item.metadata?.fileObjectId === 'string' ? item.metadata.fileObjectId : '';
    if (fileId) refs.push({ type: 'workspace_file', fileId, title: item.title });
  }
  return refs.slice(0, 32);
};

const failedObservation = (tool: string, summary: string): {
  observation: WorkspaceAgentObservation;
  evidence: WorkspaceAgentEvidence[];
  raw: Record<string, unknown>;
} => ({
  observation: {
    id: createId('obs'),
    tool,
    status: 'failed',
    summary,
    error: summary,
    at: nowIso()
  },
  evidence: [],
  raw: { error: summary }
});

const targetDirInput = (input: Record<string, unknown>) => {
  const raw = stringInput(input, 'targetDir', '');
  const cleaned = raw
    .replace(/[\\:*?"<>|]/g, ' ')
    .split('/')
    .map((part) => part.trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .slice(0, 4)
    .join('/');
  return cleaned;
};

const normalizeUrl = (value: string) => {
  const url = value.trim();
  if (!url) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
};

const webEvidenceUrl = (item: WorkspaceAgentEvidence) => {
  const metadataUrl = typeof item.metadata?.url === 'string' ? item.metadata.url : '';
  return normalizeUrl(metadataUrl || item.source || '');
};

const importWebResource = async (input: {
  workspaceId: string;
  workbenchId?: string | null;
  url: string;
  title?: string;
  targetDir?: string;
  scope?: string;
  maxPages?: number;
  maxDepth?: number;
}) => {
  const extracted = await webSourceExtractionService.crawl({
    url: input.url,
    title: input.title,
    maxPages: input.maxPages || 1,
    maxDepth: input.maxDepth ?? 0
  });
  const file = await FileSystemService.createFileOrReturnExisting({
    workspaceId: input.workspaceId,
    name: sourceFilename(extracted.title, 'web-source'),
    content: buildCrawledSourceMarkdown(extracted),
    parentPath: input.targetDir || undefined,
    fileCategory: 'web',
    mimeType: 'text/markdown; charset=utf-8',
    tags: ['source', 'web', 'site'],
    workbenchId: input.workbenchId || undefined,
    resourceRole: 'source',
    resourceType: 'source',
    scope: input.scope,
    origin: 'web',
    metadata: {
      sourceUrl: extracted.url,
      siteName: extracted.siteName,
      pageCount: extracted.pages.length,
      coverImageUrl: extracted.images?.[0]?.src,
      importedBy: 'workspace-agent-v2'
    },
    indexInBackground: true
  });
  const evidence: WorkspaceAgentEvidence = {
    id: createId('ev'),
    kind: 'workspace_web_resource',
    title: file.name,
    summary: clip(`已导入网页资料：${file.path}`, 420),
    content: clipPreserveWhitespace(buildCrawledSourceMarkdown(extracted), 1800),
    source: file.path,
    metadata: {
      fileObjectId: file.id,
      path: file.path,
      filename: file.name,
      sourceUrl: extracted.url,
      siteName: extracted.siteName,
      pageCount: extracted.pages.length
    }
  };
  return { file, evidence, source: extracted };
};

const saveTextFile = async (input: {
  tool: string;
  workspaceId: string;
  workbenchId?: string | null;
  filename: string;
  content: string;
  targetDir?: string;
  mimeType?: string;
  sourceFileIds?: string[];
}) => {
  const filename = safeFilename(input.filename, 'generated.txt');
  const content = String(input.content ?? '');
  const selectedResourceIds = (input.sourceFileIds || []).slice(0, 12);
  const file = await FileSystemService.saveGeneratedContent({
    workspaceId: input.workspaceId,
    workbenchId: input.workbenchId || undefined,
    targetDir: input.targetDir || undefined,
    filename,
    category: 'generated',
    mimeType: mimeTypeForFilename(filename, input.mimeType),
    isBinary: false,
    resourceRole: 'generated',
    resourceType: 'generated',
    scope: input.workbenchId ? 'workbench' : 'workspace',
    origin: 'agent',
    metadata: {
      generator: 'workspace-agent-v2',
      tool: input.tool,
      selectedResourceIds
    },
    content
  });
  const extension = extensionOf(file.name);
  const evidence: WorkspaceAgentEvidence = {
    id: createId('ev'),
    kind: extension === 'md' || extension === 'markdown' ? 'markdown_file' : 'generated_file',
    title: file.name,
    summary: clip(`已创建文件：${file.path}`, 420),
    content: clipPreserveWhitespace(content, 1800),
    source: file.path,
    metadata: {
      fileObjectId: file.id,
      path: file.path,
      filename: file.name,
      extension,
      selectedResourceIds
    }
  };
  return { file, evidence };
};

let registered = false;

export const registerWorkspaceAgentV2SideEffectTools = () => {
  if (registered) return;
  registered = true;

  workspaceAgentV2ToolRegistry.register({
    name: 'workbench.create',
    title: 'Create Workbench',
    description: [
      'Create a new learning workbench for a concrete learning task, project, experiment, review session, or study scene.',
      'Use this only when the user asks to create/open a new learning workspace or when a new workbench is clearly needed to organize the next action.',
      'Prefer short user-facing titles and bind explicitly provided resourceIds when relevant.'
    ].join(' '),
    category: 'workspace_write',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        resourceIds: { type: 'array' }
      },
      required: ['title'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffect: true,
    requiresApproval: true,
    approvalReason: '创建新的学习现场会写入 workspace，并可能绑定工具输入中显式提供的资源。',
    examples: [{
      title: '数据库事务复习现场',
      description: '围绕事务、隔离级别和并发控制整理资料并安排练习。',
      resourceIds: []
    }],
    execute: async (input, context) => {
      const title = stringInput(input, 'title', '新的学习现场');
      const description = stringInput(input, 'description', context.userInput);
      const explicitResourceIds = stringArrayInput(input, 'resourceIds');
      const resourceIds = explicitResourceIds.slice(0, 12);
      const workbench = await workbenchService.create(context.workspaceId, {
        title,
        description,
        resourceIds
      });
      const evidence: WorkspaceAgentEvidence[] = [{
        id: createId('ev'),
        kind: 'workbench',
        title: workbench.title,
        summary: clip(`已创建学习现场：${workbench.title}${workbench.description ? `。${workbench.description}` : ''}`, 420),
        metadata: {
          workbenchId: workbench.id,
          rootPath: workbench.rootPath,
          resourceIds
        }
      }];
      return {
        observation: observation(
          'workbench.create',
          `Created workbench "${workbench.title}".`,
          [{ kind: 'workbench', id: workbench.id, title: workbench.title }],
          evidence.map((item) => item.id)
        ),
        evidence,
        raw: workbench
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'folder.create',
    title: 'Create Folder',
    description: [
      'Create an empty folder in the workspace or current workbench.',
      'Use this when the user explicitly asks to create a directory, organize files under a named folder, or prepare a project/report folder before writing files.',
      'For writing files into a folder, file.write and file.write_many can also create targetDir automatically; use this tool only when an explicit folder artifact is useful by itself.'
    ].join(' '),
    category: 'workspace_write',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parentPath: { type: 'string' },
        target: { type: 'string', enum: ['workspace', 'workbench'] }
      },
      required: ['name'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffect: true,
    requiresApproval: true,
    approvalReason: '创建文件夹会改变 workspace/workbench 的文件结构。',
    examples: [{
      parentPath: '软件项目管理课程报告',
      name: '图片素材',
      target: 'workspace'
    }],
    execute: async (input, context) => {
      const name = safeFilename(stringInput(input, 'name'), 'New Folder');
      if (!name) return failedObservation('folder.create', 'name is required.');
      const target = stringInput(input, 'target', 'workspace');
      const parentPath = targetDirInput({ targetDir: stringInput(input, 'parentPath') });
      const folder = await FileSystemService.createFolder({
        workspaceId: context.workspaceId,
        name,
        parentPath,
        workbenchId: target === 'workbench' ? context.workbenchId || undefined : undefined,
        scope: target === 'workbench' ? 'workbench' : 'workspace',
        resourceRole: 'folder'
      });
      const evidence: WorkspaceAgentEvidence[] = [{
        id: createId('ev'),
        kind: 'folder',
        title: folder.name,
        summary: clip(`已创建文件夹：${folder.path}`, 420),
        source: folder.path,
        metadata: {
          fileObjectId: folder.id,
          path: folder.path,
          name: folder.name
        }
      }];
      return {
        observation: observation(
          'folder.create',
          `Created folder "${folder.path}".`,
          [{ kind: 'file', id: folder.id, title: folder.name }],
          evidence.map((item) => item.id)
        ),
        evidence,
        raw: { folder }
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'resource.import_web',
    title: 'Import Web Resource',
    description: [
      'Import already discovered web resources into the workspace or current workbench as source resources.',
      'Use this only after the user explicitly asks to save/import/add found web resources, or approves importing selected URLs.',
      'This tool does not search the web. It only consumes explicit urls or existing web_search_result/web_page evidenceIds from prior Agent context.',
      'Prefer evidenceIds when importing resources that were just shown to the user; use urls only when the user gave explicit URLs.'
    ].join(' '),
    category: 'workspace_write',
    inputSchema: {
      type: 'object',
      properties: {
        evidenceIds: { type: 'array' },
        urls: { type: 'array' },
        target: { type: 'string', enum: ['workspace', 'workbench'] },
        targetDir: { type: 'string' },
        maxPages: { type: 'number' },
        maxDepth: { type: 'number' }
      },
      additionalProperties: false
    },
    risk: 'medium',
    sideEffect: true,
    requiresApproval: true,
    approvalReason: '导入网页资料会在 workspace/workbench 中创建 source 资源并触发后台索引。',
    examples: [{
      evidenceIds: ['ev-...'],
      target: 'workspace'
    }, {
      urls: [{ url: 'https://docs.example.com/intro', title: 'Example docs' }],
      target: 'workbench'
    }],
    execute: async (input, context) => {
      const stateEvidence = Array.isArray((context as any).evidence)
        ? (context as any).evidence as WorkspaceAgentEvidence[]
        : [];
      const requestedIds = new Set(stringArrayInput(input, 'evidenceIds'));
      const urlsFromEvidence = stateEvidence
        .filter((item) => requestedIds.size ? requestedIds.has(item.id) : false)
        .filter((item) => item.kind === 'web_search_result' || item.kind === 'web_page')
        .map((item) => ({
          url: webEvidenceUrl(item),
          title: item.title,
          evidenceId: item.id
        }))
        .filter((item) => item.url);
      const urlsFromInput = objectArrayInput(input, 'urls')
        .map((item) => ({
          url: normalizeUrl(stringInput(item, 'url')),
          title: stringInput(item, 'title')
        }))
        .filter((item) => item.url);
      const seen = new Set<string>();
      const candidates = [...urlsFromEvidence, ...urlsFromInput]
        .filter((item) => {
          if (seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        })
        .slice(0, 8);
      if (!candidates.length) {
        return failedObservation('resource.import_web', 'Provide evidenceIds for existing web evidence or explicit urls to import.');
      }
      const target = stringInput(input, 'target', 'workspace');
      const targetWorkbenchId = target === 'workbench' ? context.workbenchId || null : null;
      const targetDir = targetDirInput(input);
      const maxPages = Math.min(Math.max(Number(input.maxPages || 1), 1), 5);
      const maxDepth = Math.min(Math.max(Number(input.maxDepth || 0), 0), 1);
      const evidence: WorkspaceAgentEvidence[] = [];
      const artifactRefs: NonNullable<WorkspaceAgentObservation['artifactRefs']> = [];
      const files: unknown[] = [];
      for (const candidate of candidates) {
        const imported = await importWebResource({
          workspaceId: context.workspaceId,
          workbenchId: targetWorkbenchId,
          url: candidate.url,
          title: candidate.title,
          targetDir,
          scope: targetWorkbenchId ? 'workbench' : 'workspace',
          maxPages,
          maxDepth
        });
        evidence.push(imported.evidence);
        artifactRefs.push({ kind: 'file', id: imported.file.id, title: imported.file.name });
        files.push(imported.file);
      }
      return {
        observation: observation(
          'resource.import_web',
          `Imported ${artifactRefs.length} web resource${artifactRefs.length === 1 ? '' : 's'} into ${targetWorkbenchId ? 'the current workbench' : 'the workspace'}.`,
          artifactRefs,
          evidence.map((item) => item.id)
        ),
        evidence,
        raw: { files }
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'file.write',
    title: 'Write File',
    description: [
      'Save complete content to a text file in the workspace or current workbench.',
      'Use this like Cline write_to_file: provide the complete intended file content in input.content.',
      'If the target file is code, put raw code directly in content; do not wrap it in Markdown fences unless the target file itself is Markdown.',
      'This tool does not generate, search, or read context by itself; it only validates, requests approval, saves the file, and returns the saved file state.'
    ].join(' '),
    category: 'workspace_write',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        targetDir: { type: 'string' },
        content: { type: 'string' },
        mimeType: { type: 'string' },
        sourceFileIds: { type: 'array' }
      },
      required: ['filename', 'content'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffect: true,
    requiresApproval: true,
    approvalReason: '写入文件会把工具输入中的完整内容保存到 workspace/workbench。',
    examples: [{
      targetDir: 'c-project',
      filename: 'hello.c',
      content: '#include <stdio.h>\n\nint main(void) {\n  printf("Hello\\n");\n  return 0;\n}\n'
    }],
    execute: async (input, context) => {
      const content = String(input.content ?? '');
      const filename = safeFilename(stringInput(input, 'filename'), 'generated.txt');
      if (!filename) return failedObservation('file.write', 'filename is required.');
      const saved = await saveTextFile({
        tool: 'file.write',
        workspaceId: context.workspaceId,
        workbenchId: context.workbenchId || undefined,
        targetDir: targetDirInput(input),
        filename,
        content,
        mimeType: stringInput(input, 'mimeType'),
        sourceFileIds: stringArrayInput(input, 'sourceFileIds')
      });
      return {
        observation: observation(
          'file.write',
          `Created file "${saved.file.name}".`,
          [{ kind: 'file', id: saved.file.id, title: saved.file.name }],
          [saved.evidence.id]
        ),
        evidence: [saved.evidence],
        raw: { file: saved.file, finalContent: content, contentPreview: clipPreserveWhitespace(content, 2400) }
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'file.write_many',
    title: 'Write Multiple Files',
    description: [
      'Save multiple complete text files in the workspace or current workbench in one approved action.',
      'Use this when the user asks for multiple files, a small project, or several companion resources.',
      'Provide each file as raw final content. Do not combine multiple requested files into one Markdown file unless the user explicitly asks for a single bundled document.'
    ].join(' '),
    category: 'workspace_write',
    inputSchema: {
      type: 'object',
      properties: {
        targetDir: { type: 'string' },
        files: { type: 'array' },
        sourceFileIds: { type: 'array' }
      },
      required: ['files'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffect: true,
    requiresApproval: true,
    approvalReason: '批量写入文件会把多个工具输入内容保存到 workspace/workbench。',
    examples: [{
      targetDir: 'c-project',
      files: [
        { filename: 'main.c', content: '#include "utils.h"\n\nint main(void) { return answer(); }\n' },
        { filename: 'utils.h', content: 'int answer(void);\n' },
        { filename: 'utils.c', content: '#include "utils.h"\n\nint answer(void) { return 42; }\n' }
      ]
    }],
    execute: async (input, context) => {
      const files = objectArrayInput(input, 'files').slice(0, 8);
      if (!files.length) return failedObservation('file.write_many', 'files must contain at least one file.');
      const totalChars = files.reduce((sum, file) => sum + String(file.content || '').length, 0);
      if (totalChars > 160000) return failedObservation('file.write_many', 'Total file content is too large for one batch write.');
      for (const file of files) {
        if (!stringInput(file, 'filename')) return failedObservation('file.write_many', 'Every file requires filename.');
        if (file.content === undefined || file.content === null) return failedObservation('file.write_many', `File ${stringInput(file, 'filename')} requires content.`);
      }
      const evidence: WorkspaceAgentEvidence[] = [];
      const artifactRefs: NonNullable<WorkspaceAgentObservation['artifactRefs']> = [];
      const rawFiles: unknown[] = [];
      const sharedSourceFileIds = stringArrayInput(input, 'sourceFileIds');
      for (const fileInput of files) {
        const content = String(fileInput.content ?? '');
        if (content.length > 60000) return failedObservation('file.write_many', `File ${stringInput(fileInput, 'filename')} content is too large.`);
        const saved = await saveTextFile({
          tool: 'file.write_many',
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId || undefined,
          targetDir: targetDirInput(input),
          filename: safeFilename(stringInput(fileInput, 'filename'), 'generated.txt'),
          content,
          mimeType: stringInput(fileInput, 'mimeType'),
          sourceFileIds: sharedSourceFileIds
        });
        evidence.push(saved.evidence);
        artifactRefs.push({ kind: 'file', id: saved.file.id, title: saved.file.name });
        rawFiles.push(saved.file);
      }
      return {
        observation: observation(
          'file.write_many',
          `Created ${artifactRefs.length} files: ${artifactRefs.map((item) => item.title).join(', ')}.`,
          artifactRefs,
          evidence.map((item) => item.id)
        ),
        evidence,
        raw: { files: rawFiles }
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'file.replace',
    title: 'Replace In File',
    description: [
      'Replace exact text in an existing workspace file, similar to Cline replace_in_file.',
      'Use this for targeted edits after reading the file. Each search string must match exactly once; otherwise the tool fails without writing.',
      'Do not use this to create new files; use file.write for complete new files.'
    ].join(' '),
    category: 'workspace_write',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        replacements: { type: 'array' },
        sourceObservationIds: { type: 'array' }
      },
      required: ['fileId', 'replacements'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffect: true,
    requiresApproval: true,
    approvalReason: '替换已有文件内容会修改 workspace/workbench 中的文件。',
    examples: [{
      fileId: 'file-id',
      replacements: [{ search: 'printf("Hello\\n");', replace: 'printf("Hi\\n");' }]
    }],
    execute: async (input, context) => {
      const fileId = stringInput(input, 'fileId');
      const replacements = objectArrayInput(input, 'replacements').slice(0, 12);
      if (!fileId) return failedObservation('file.replace', 'fileId is required.');
      if (!replacements.length) return failedObservation('file.replace', 'replacements must contain at least one replacement.');
      let content = await FileSystemService.getFileContent(context.workspaceId, fileId);
      const beforeContent = content;
      for (const replacement of replacements) {
        const search = typeof replacement.search === 'string' ? replacement.search : '';
        const replace = typeof replacement.replace === 'string' ? replacement.replace : '';
        if (!search) return failedObservation('file.replace', 'Each replacement requires a non-empty search string.');
        const occurrences = content.split(search).length - 1;
        if (occurrences !== 1) {
          return failedObservation('file.replace', `Search text must match exactly once; found ${occurrences}.`);
        }
        content = content.replace(search, replace);
      }
      const file = await FileSystemService.saveFileContent(context.workspaceId, fileId, content);
      const evidence: WorkspaceAgentEvidence[] = [{
        id: createId('ev'),
        kind: 'generated_file_edit',
        title: file.name,
        summary: clip(`已修改文件：${file.path}`, 420),
        content: clipPreserveWhitespace(content, 1800),
        source: file.path,
        metadata: {
          fileObjectId: file.id,
          path: file.path,
          filename: file.name,
          replacements: replacements.length,
          beforeLength: beforeContent.length,
          afterLength: content.length
        }
      }];
      return {
        observation: observation(
          'file.replace',
          `Updated file "${file.name}" with ${replacements.length} replacement${replacements.length === 1 ? '' : 's'}.`,
          [{ kind: 'file', id: file.id, title: file.name }],
          evidence.map((item) => item.id)
        ),
        evidence,
        raw: { file, beforeContentPreview: clipPreserveWhitespace(beforeContent, 1200), finalContent: content, contentPreview: clipPreserveWhitespace(content, 2400) }
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'markdown_note.create',
    title: 'Create Markdown File',
    description: [
      'Save a complete Markdown file in the workspace or current workbench.',
      'Use this like Cline write_to_file for Markdown: first use read/search/fetch tools when context is needed, then provide the complete final Markdown content in the content field.',
      'This tool does not generate, search, or read context by itself; it only validates, requests approval, saves the file, and returns the saved file state.'
    ].join(' '),
    category: 'workspace_write',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        filename: { type: 'string' },
        targetDir: { type: 'string' },
        content: { type: 'string' },
        sourceFileIds: { type: 'array' }
      },
      required: ['filename', 'content'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffect: true,
    requiresApproval: true,
    approvalReason: '创建 Markdown 文件会把工具输入中的完整内容保存到 workspace/workbench。',
    examples: [{
      title: 'API Usage Guide',
      filename: 'api-usage-guide.md',
      content: '# API Usage Guide\n\nComplete Markdown content goes here.'
    }],
    execute: async (input, context) => {
      const title = stringInput(input, 'title', stringInput(input, 'filename', 'Generated Markdown'));
      const content = normalizeMarkdownContent(stringInput(input, 'content'));
      const saved = await saveTextFile({
        tool: 'markdown_note.create',
        workspaceId: context.workspaceId,
        workbenchId: context.workbenchId || undefined,
        targetDir: targetDirInput(input),
        filename: markdownFilename(stringInput(input, 'filename', title)),
        mimeType: 'text/markdown',
        sourceFileIds: stringArrayInput(input, 'sourceFileIds'),
        content
      });
      return {
        observation: observation(
          'markdown_note.create',
          `Created Markdown file "${saved.file.name}".`,
          [{ kind: 'file', id: saved.file.id, title: saved.file.name }],
          [saved.evidence.id]
        ),
        evidence: [saved.evidence],
        raw: { file: saved.file, finalContent: content, contentPreview: clipPreserveWhitespace(content, 2400) }
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'studio.generate_artifact',
    title: 'Generate AI Studio Resource',
    description: [
      'Generate one AI Studio learning resource and publish it back to the workspace or current workbench.',
      'Template capabilities: custom_practice creates an AI Studio quiz/practice artifact with interactive answer checking, scoring and explanations; use it for choice questions, quizzes, drills, concept discrimination and practice sets.',
      'Template capabilities: mind_map creates Mermaid/concept map resources; flashcards creates active recall cards; react_chat_visual creates Markdown with executable REACT_VIZ/HTML_VIZ visual explanations for algorithms, process animation and interactive demos.',
      'Template capabilities: code_lab creates a runnable coding lab with problem statement, starter code, tests and solution; light_visual_lesson creates a lightweight teacher-style slide/timeline lesson from explicit sources.',
      'Available templateId values for Agent V2 are: mind_map, custom_practice, react_chat_visual, flashcards, code_lab, light_visual_lesson.',
      'The model should choose the templateId from the user goal and observations; runtime does not route by regex.',
      'When source grounding is needed, first use reader/search tools, then pass evidenceIds and/or sourceFileIds from existing observations. This tool should not be used as a hidden context search shortcut.',
      'Use sourceMode=model_knowledge only when the user asks for a general model-knowledge resource or there is no workspace evidence to read.'
    ].join(' '),
    category: 'studio_write',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', enum: ['mind_map', 'custom_practice', 'react_chat_visual', 'flashcards', 'code_lab', 'light_visual_lesson'] },
        prompt: { type: 'string' },
        contextRefs: { type: 'array' },
        evidenceIds: { type: 'array' },
        sourceFileIds: { type: 'array' },
        sourceMode: { type: 'string', enum: ['evidence', 'model_knowledge'] },
        options: { type: 'object' }
      },
      required: ['templateId', 'prompt'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffect: true,
    requiresApproval: true,
    approvalReason: '生成 AI Studio 资源会调用模型并在 workspace/workbench 中发布一个可打开的学习产物。',
    examples: [{
      templateId: 'mind_map',
      prompt: '基于刚才读取的数据库事务资料生成复习用思维导图。',
      evidenceIds: ['ev-...'],
      sourceMode: 'evidence'
    }, {
      templateId: 'custom_practice',
      prompt: '基于这些 SQL 资料生成 6 道中等难度练习题，包含解析。',
      evidenceIds: ['ev-...'],
      options: { questionCount: 6, difficulty: 'medium' }
    }],
    execute: async (input, context) => {
      const templateId = stringInput(input, 'templateId');
      if (!STUDIO_AGENT_TEMPLATE_IDS.has(templateId)) {
        return failedObservation('studio.generate_artifact', `templateId must be one of: ${Array.from(STUDIO_AGENT_TEMPLATE_IDS).join(', ')}.`);
      }
      const prompt = stringInput(input, 'prompt', context.userInput);
      if (!prompt) return failedObservation('studio.generate_artifact', 'prompt is required.');
      const stateEvidence = Array.isArray((context as any).evidence)
        ? (context as any).evidence as WorkspaceAgentEvidence[]
        : [];
      const sourceEvidence = studioSourceEvidence(input, stateEvidence);
      const contextRefs = normalizeStudioContextRefs(input, sourceEvidence);
      const sourceFileIds = Array.from(new Set(contextRefs.map((ref) => ref.fileId).filter((item): item is string => Boolean(item)))).slice(0, 12);
      const sourceMode = stringInput(input, 'sourceMode', sourceEvidence.length || sourceFileIds.length || contextRefs.length ? 'evidence' : 'model_knowledge');
      if (sourceMode !== 'model_knowledge' && !contextRefs.length) {
        return failedObservation(
          'studio.generate_artifact',
          'studio.generate_artifact requires contextRefs/evidenceIds/sourceFileIds from prior Agent context, or sourceMode=model_knowledge.'
        );
      }
      const studioContext = await buildStudioContextFromAgentEvidence({
        context,
        prompt,
        refs: contextRefs,
        sourceMode: sourceMode === 'model_knowledge' ? 'model_knowledge' : 'evidence'
      });
      const options = {
        ...recordInput(input, 'options'),
        workspaceAgentV2: {
          sourceMode,
          evidenceIds: sourceEvidence.map((item) => item.id),
          evidenceTitles: sourceEvidence.map((item) => item.title).slice(0, 12),
          contextRefs: studioContext.contextRefs.map((ref) => ({
            type: ref.type,
            fileId: ref.fileId,
            evidenceId: ref.evidenceId,
            messageId: ref.messageId,
            turnId: ref.turnId,
            title: ref.title
          })),
          capsuleId: studioContext.capsule.capsuleId
        }
      };
      const result = await studioV2Service.generate({
        workspaceId: context.workspaceId,
        workbenchId: context.workbenchId || null,
        goal: studioGoalForTemplate(templateId),
        templateId,
        prompt,
        options,
        contextRefs: studioContext.contextRefs,
        prebuiltContextCapsule: studioContext.capsule,
        prebuiltContextPolicy: studioContext.policy,
        context: {
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId || null,
          contextMode: sourceMode === 'model_knowledge' ? 'model_knowledge' : 'selection_only',
          selectedResourceIds: []
        } as any
      });
      const file = result.file || {};
      const artifactRefs: NonNullable<WorkspaceAgentObservation['artifactRefs']> = [];
      if (file.id) artifactRefs.push({ kind: 'file', id: file.id, title: file.name || result.delivery?.filename || templateLabel(templateId) });
      if (result.artifact?.id) artifactRefs.push({ kind: 'studio_artifact', id: result.artifact.id, title: result.artifact.title || result.template.title });
      if (result.renderJob?.id) artifactRefs.push({ kind: 'job', id: result.renderJob.id, title: `${result.template.title} render job` });
      const evidence: WorkspaceAgentEvidence[] = [{
        id: createId('ev'),
        kind: 'studio_artifact',
        title: result.template.title,
        summary: clip(`已生成 ${templateLabel(templateId)}：${result.delivery?.filename || file.name || result.template.title}。${result.review?.summary || ''}`, 640),
        content: clipPreserveWhitespace(result.delivery?.previewContent || result.content || '', 2200),
        source: file.path || result.delivery?.path,
        metadata: {
          templateId,
          goal: result.goal,
          renderer: result.renderer,
          runId: result.runId,
          fileObjectId: file.id || result.delivery?.fileObjectId,
          path: file.path || result.delivery?.path,
          artifactId: result.artifact?.id,
          artifactKey: result.artifact?.artifactKey,
          renderJobId: result.renderJob?.id,
          renderJobStatus: result.renderJob?.status,
          sourceMode,
          evidenceIds: sourceEvidence.map((item) => item.id),
          sourceFileIds,
          contextRefs: studioContext.contextRefs,
          capsuleId: studioContext.capsule.capsuleId,
          capsuleSourceIds: studioContext.capsule.citations.map((citation) => citation.sourceId).filter(Boolean),
          reviewScore: result.review?.score
        }
      }];
      return {
        observation: observation(
          'studio.generate_artifact',
          `Generated AI Studio ${templateLabel(templateId)} "${result.delivery?.filename || file.name || result.template.title}".`,
          artifactRefs,
          evidence.map((item) => item.id)
        ),
        evidence,
        raw: {
          studio: {
            templateId,
            templateTitle: result.template.title,
            goal: result.goal,
            renderer: result.renderer,
            runId: result.runId,
            source: result.source,
            review: result.review ? {
              score: result.review.score,
              passed: result.review.passed,
              summary: result.review.summary,
              warnings: result.review.warnings
            } : null,
            qualityReport: result.qualityReport,
            usedContextSummary: result.usedContextSummary,
            sourceMode,
            evidenceIds: sourceEvidence.map((item) => item.id),
            sourceFileIds,
            contextRefs: studioContext.contextRefs,
            capsuleId: studioContext.capsule.capsuleId
          },
          file,
          artifact: result.artifact,
          renderJob: result.renderJob,
          delivery: result.delivery,
          contentPreview: clipPreserveWhitespace(result.delivery?.previewContent || result.content || '', 2800)
        }
      };
    }
  });
};

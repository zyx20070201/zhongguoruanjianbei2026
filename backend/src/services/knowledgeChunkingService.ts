import { spawnSync } from 'child_process';
import ts from 'typescript';
import { ContextLocator } from '../types/contextSystem';
import { KnowledgeChunkType, buildChunkId, estimateChunkTokens, normalizeHeadingPath, sourceHashForChunk } from './chunkSchema';
import { DocumentChunkInput, documentChunkStore } from './documentChunkStore';

interface IndexFileInput {
  workspaceId: string;
  fileObjectId: string;
  content?: string | null;
  source?: string;
  purpose?: string;
  metadata?: Record<string, unknown>;
}

interface DraftChunk {
  parentKey?: string | null;
  localKey: string;
  chunkType: KnowledgeChunkType;
  text: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  locator: ContextLocator;
  headingPath: string[];
}

const MAX_CHILD_LENGTH = 1400;
const MIN_CHILD_LENGTH = 160;
const MAX_PARENT_LENGTH = 4200;
const CODE_WINDOW_LINES = 120;

interface CodeRange {
  name: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
  container?: string;
}

const clip = (value: string, limit: number) => (value.length > limit ? `${value.slice(0, limit)}...` : value);

const summarizeChunk = (text: string, headingPath: string[] = []) => {
  const heading = headingPath[headingPath.length - 1];
  if (heading) return heading.slice(0, 180);
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || text.slice(0, 120)).slice(0, 180);
};

const normalizeContent = (content: string) => content.replace(/\r\n/g, '\n').trim();

const chunkTypeFromText = (text: string, fallback: KnowledgeChunkType = 'text'): KnowledgeChunkType => {
  const trimmed = text.trim();
  if (/^```/.test(trimmed)) return 'code';
  if (/^\|.+\|\n\|[-:\s|]+\|/m.test(trimmed)) return 'table';
  if (/^(\s*[-*+]\s+|\s*\d+\.\s+)/m.test(trimmed)) return 'list';
  return fallback;
};

const pushSizedTextChunks = (input: {
  drafts: DraftChunk[];
  text: string;
  localKeyPrefix: string;
  parentKey?: string | null;
  headingPath?: string[];
  locator?: ContextLocator;
  chunkType?: KnowledgeChunkType;
  metadata?: Record<string, unknown>;
}) => {
  const text = input.text.trim();
  if (!text) return;

  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  let current = '';
  let currentStart = input.locator?.charStart || 0;
  let cursor = input.locator?.charStart || 0;
  let partIndex = 0;

  const push = (value: string, charStart: number) => {
    const chunkType = input.chunkType || chunkTypeFromText(value);
    input.drafts.push({
      parentKey: input.parentKey || null,
      localKey: `${input.localKeyPrefix}:child:${partIndex}`,
      chunkType,
      text: value,
      summary: summarizeChunk(value, input.headingPath),
      metadata: input.metadata,
      headingPath: input.headingPath || [],
      locator: {
        ...input.locator,
        charStart,
        charEnd: charStart + value.length,
        textLength: value.length,
        headingPath: input.headingPath || []
      }
    });
    partIndex += 1;
  };

  for (const paragraph of paragraphs) {
    const paragraphStart = text.indexOf(paragraph, Math.max(0, cursor - (input.locator?.charStart || 0)));
    const safeParagraphStart = paragraphStart >= 0 ? (input.locator?.charStart || 0) + paragraphStart : cursor;
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= MAX_CHILD_LENGTH) {
      if (!current) currentStart = safeParagraphStart;
      current = next;
      cursor = safeParagraphStart + paragraph.length;
      continue;
    }

    if (current) push(current, currentStart);

    if (paragraph.length <= MAX_CHILD_LENGTH) {
      current = paragraph;
      currentStart = safeParagraphStart;
      cursor = safeParagraphStart + paragraph.length;
      continue;
    }

    for (let offset = 0; offset < paragraph.length; offset += MAX_CHILD_LENGTH) {
      push(paragraph.slice(offset, offset + MAX_CHILD_LENGTH), safeParagraphStart + offset);
    }
    current = '';
    cursor = safeParagraphStart + paragraph.length;
  }

  if (current) push(current, currentStart);

  const startIndex = Math.max(0, input.drafts.length - partIndex);
  if (partIndex > 1) return;
  const only = input.drafts[startIndex];
  if (only && only.text.length < MIN_CHILD_LENGTH && input.drafts.length > 1) {
    only.metadata = { ...(only.metadata || {}), shortChunk: true };
  }
};

const markdownHeadingLevel = (line: string) => /^(#{1,6})\s+(.+)$/.exec(line.trim());

const splitMarkdown = (content: string): DraftChunk[] => {
  const normalized = normalizeContent(content);
  if (!normalized) return [];

  const drafts: DraftChunk[] = [];
  const lines = normalized.split('\n');
  const headingStack: Array<{ level: number; title: string }> = [];
  let sectionLines: string[] = [];
  let sectionStartLine = 1;
  let sectionStartChar = 0;
  let charCursor = 0;
  let sectionIndex = 0;

  const currentHeadingPath = () => headingStack.map((item) => item.title);

  const flushSection = (lineEnd: number, charEnd: number) => {
    const text = sectionLines.join('\n').trim();
    if (!text) {
      sectionLines = [];
      return;
    }
    const headingPath = currentHeadingPath();
    const parentKey = `md:section:${sectionIndex}`;
    drafts.push({
      localKey: parentKey,
      chunkType: 'parent',
      text: clip(text, MAX_PARENT_LENGTH),
      summary: summarizeChunk(text, headingPath),
      headingPath,
      locator: {
        headingPath,
        lineStart: sectionStartLine,
        lineEnd,
        charStart: sectionStartChar,
        charEnd,
        textLength: text.length
      },
      metadata: {
        strategy: 'markdown-heading-tree',
        childPolicy: 'small-to-big'
      }
    });
    pushSizedTextChunks({
      drafts,
      text,
      parentKey,
      localKeyPrefix: parentKey,
      headingPath,
      locator: {
        headingPath,
        lineStart: sectionStartLine,
        lineEnd,
        charStart: sectionStartChar,
        charEnd
      },
      metadata: { strategy: 'markdown-heading-tree' }
    });
    sectionIndex += 1;
    sectionLines = [];
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const lineStartChar = charCursor;
    const lineEndChar = lineStartChar + line.length;
    const heading = markdownHeadingLevel(line);
    if (heading) {
      flushSection(lineNumber - 1, lineStartChar);
      const level = heading[1].length;
      headingStack.splice(level - 1);
      headingStack[level - 1] = { level, title: heading[2].trim() };
      sectionStartLine = lineNumber;
      sectionStartChar = lineStartChar;
      sectionLines = [line];
    } else {
      if (sectionLines.length === 0) {
        sectionStartLine = lineNumber;
        sectionStartChar = lineStartChar;
      }
      sectionLines.push(line);
    }
    charCursor = lineEndChar + 1;
  });

  flushSection(lines.length, normalized.length);
  return drafts;
};

const codeLanguageFromExtension = (extension?: string | null) => {
  const normalized = (extension || '').toLowerCase();
  const aliases: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    kt: 'kotlin',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    sql: 'sql'
  };
  return aliases[normalized] || normalized || 'text';
};

const codeSymbolForLine = (line: string) => {
  const patterns = [
    /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?/,
    /^\s*def\s+([A-Za-z_]\w*)\s*\(/,
    /^\s*class\s+([A-Za-z_]\w*)/,
    /^\s*(?:public|private|protected|static|\s)*[\w<>\[\]]+\s+([A-Za-z_]\w*)\s*\(/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
};

const tsScriptKind = (extension?: string | null) => {
  switch ((extension || '').toLowerCase()) {
    case 'tsx':
      return ts.ScriptKind.TSX;
    case 'jsx':
      return ts.ScriptKind.JSX;
    case 'js':
    case 'mjs':
    case 'cjs':
      return ts.ScriptKind.JS;
    case 'ts':
    default:
      return ts.ScriptKind.TS;
  }
};

const lineAndChar = (sourceFile: ts.SourceFile, position: number) => {
  const location = sourceFile.getLineAndCharacterOfPosition(position);
  return { line: location.line + 1, character: location.character + 1 };
};

const nodeName = (node: ts.Node) => {
  const named = node as ts.Node & { name?: ts.Node };
  if (!named.name) return null;
  return named.name.getText().replace(/^['"`]|['"`]$/g, '');
};

const splitTypeScriptAst = (content: string, extension?: string | null): CodeRange[] => {
  const sourceFile = ts.createSourceFile(
    `source.${extension || 'ts'}`,
    content,
    ts.ScriptTarget.Latest,
    true,
    tsScriptKind(extension)
  );
  const ranges: CodeRange[] = [];

  const visit = (node: ts.Node, container?: string) => {
    let kind: string | null = null;
    let name: string | null = null;

    if (ts.isClassDeclaration(node)) {
      kind = 'class';
      name = nodeName(node) || 'default class';
    } else if (ts.isInterfaceDeclaration(node)) {
      kind = 'interface';
      name = nodeName(node);
    } else if (ts.isTypeAliasDeclaration(node)) {
      kind = 'type';
      name = nodeName(node);
    } else if (ts.isEnumDeclaration(node)) {
      kind = 'enum';
      name = nodeName(node);
    } else if (ts.isFunctionDeclaration(node)) {
      kind = 'function';
      name = nodeName(node) || 'anonymous function';
    } else if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      kind = ts.isMethodDeclaration(node) ? 'method' : 'accessor';
      name = nodeName(node);
    } else if (ts.isVariableStatement(node)) {
      const declarations = node.declarationList.declarations;
      const declaration = declarations.find((item) => item.initializer && (
        ts.isArrowFunction(item.initializer) ||
        ts.isFunctionExpression(item.initializer) ||
        ts.isClassExpression(item.initializer)
      ));
      if (declaration?.name) {
        kind = ts.isClassExpression(declaration.initializer!) ? 'class' : 'function';
        name = declaration.name.getText();
      }
    }

    if (kind && name) {
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      const startLocation = lineAndChar(sourceFile, start);
      const endLocation = lineAndChar(sourceFile, end);
      ranges.push({
        name,
        kind,
        lineStart: startLocation.line,
        lineEnd: endLocation.line,
        charStart: start,
        charEnd: end,
        container
      });
    }

    const nextContainer = kind === 'class' && name ? name : container;
    ts.forEachChild(node, (child) => visit(child, nextContainer));
  };

  visit(sourceFile);
  return ranges
    .filter((range, index, all) =>
      all.findIndex((item) => item.charStart === range.charStart && item.charEnd === range.charEnd && item.name === range.name) === index
    )
    .sort((left, right) => left.charStart - right.charStart);
};

const splitPythonAst = (content: string): CodeRange[] => {
  const script = `
import ast, json, sys
source = sys.stdin.read()
tree = ast.parse(source)
lines = source.splitlines()
items = []
def end_line(node):
    return getattr(node, "end_lineno", getattr(node, "lineno", 1))
def end_col(node):
    return getattr(node, "end_col_offset", 0)
def offset(line, col):
    return sum(len(item) + 1 for item in lines[:max(0, line - 1)]) + col
def visit(node, container=None):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        kind = "class" if isinstance(node, ast.ClassDef) else "function"
        start_line = getattr(node, "lineno", 1)
        start_col = getattr(node, "col_offset", 0)
        stop_line = end_line(node)
        stop_col = end_col(node)
        items.append({
            "name": node.name,
            "kind": kind,
            "lineStart": start_line,
            "lineEnd": stop_line,
            "charStart": offset(start_line, start_col),
            "charEnd": offset(stop_line, stop_col),
            "container": container
        })
        next_container = node.name if isinstance(node, ast.ClassDef) else container
    else:
        next_container = container
    for child in ast.iter_child_nodes(node):
        visit(child, next_container)
visit(tree)
print(json.dumps(items, ensure_ascii=False))
`;

  for (const command of ['python3', 'python']) {
    const result = spawnSync(command, ['-c', script], {
      input: content,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024
    });
    if (result.status === 0 && result.stdout.trim()) {
      try {
        return JSON.parse(result.stdout) as CodeRange[];
      } catch {
        return [];
      }
    }
  }

  return [];
};

const fallbackCodeRanges = (content: string) => {
  const lines = content.split('\n');
  let charCursor = 0;
  const symbols: Array<{ name: string; line: number; charStart: number }> = [];

  lines.forEach((line, index) => {
    const symbol = codeSymbolForLine(line);
    if (symbol) symbols.push({ name: symbol, line: index + 1, charStart: charCursor });
    charCursor += line.length + 1;
  });

  const ranges: CodeRange[] =
    symbols.length > 0
      ? symbols.map((symbol, index) => ({
          name: symbol.name,
          kind: 'symbol',
          lineStart: symbol.line,
          lineEnd: (symbols[index + 1]?.line || lines.length + 1) - 1,
          charStart: symbol.charStart,
          charEnd: lines.slice(0, (symbols[index + 1]?.line || lines.length + 1) - 1).join('\n').length
        }))
      : [];

  if (ranges.length === 0) {
    for (let start = 1; start <= lines.length; start += CODE_WINDOW_LINES) {
      const lineEnd = Math.min(lines.length, start + CODE_WINDOW_LINES - 1);
      const before = lines.slice(0, start - 1).join('\n');
      const text = lines.slice(start - 1, lineEnd).join('\n');
      ranges.push({
        name: `lines ${start}-${lineEnd}`,
        kind: 'window',
        lineStart: start,
        lineEnd,
        charStart: before ? before.length + 1 : 0,
        charEnd: (before ? before.length + 1 : 0) + text.length
      });
    }
  }

  return ranges;
};

const splitCode = (content: string, extension?: string | null): DraftChunk[] => {
  const normalized = normalizeContent(content);
  if (!normalized) return [];

  const drafts: DraftChunk[] = [];
  const lines = normalized.split('\n');
  const language = codeLanguageFromExtension(extension);
  const extensionKey = (extension || '').toLowerCase();
  const astRanges =
    ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(extensionKey)
      ? splitTypeScriptAst(normalized, extension)
      : extensionKey === 'py'
        ? splitPythonAst(normalized)
        : [];
  const ranges = astRanges.length ? astRanges : fallbackCodeRanges(normalized);

  ranges.forEach((range, index) => {
    const lineSlice = lines.slice(range.lineStart - 1, range.lineEnd);
    const text = lineSlice.join('\n').trimEnd();
    if (!text.trim()) return;
    const charStart = range.charStart;
    const charEnd = Math.max(range.charEnd, charStart + lineSlice.join('\n').length);
    const headingPath = range.container ? [range.container, range.name] : [range.name];
    drafts.push({
      localKey: `code:block:${index}`,
      chunkType: 'code',
      text,
      summary: `${language}: ${range.kind} ${range.name}`,
      headingPath,
      locator: {
        headingPath,
        lineStart: range.lineStart,
        lineEnd: range.lineEnd,
        startLine: range.lineStart,
        endLine: range.lineEnd,
        charStart,
        charEnd,
        textLength: text.length
      },
      metadata: {
        strategy: astRanges.length ? (extensionKey === 'py' ? 'python-ast' : 'typescript-ast') : 'code-fallback',
        language,
        symbolName: range.name,
        symbolKind: range.kind,
        container: range.container
      }
    });
  });

  return drafts;
};

const metadataChunks = (metadata?: Record<string, unknown>): DraftChunk[] | null => {
  const rawChunks = metadata?.chunks;
  if (!Array.isArray(rawChunks)) return null;

  const drafts = rawChunks
    .map((chunk: any, index) => {
      const text = String(chunk?.text || '').trim();
      const headingPath = normalizeHeadingPath(chunk?.headingPath);
      const page = typeof chunk?.page === 'number' ? chunk.page : undefined;
      const locator: ContextLocator = {
        chunkIndex: typeof chunk?.chunkIndex === 'number' ? chunk.chunkIndex : index,
        page,
        pageStart: chunk?.pageStart || page,
        pageEnd: chunk?.pageEnd || page,
        lineStart: chunk?.lineStart,
        lineEnd: chunk?.lineEnd,
        blockId: chunk?.blockId,
        blockIndex: chunk?.blockIndex,
        blockIds: chunk?.blockIds,
        headingPath,
        paragraphIndex: chunk?.paragraphIndex,
        charStart: chunk?.charStart,
        charEnd: chunk?.charEnd,
        rects: Array.isArray(chunk?.rects) ? chunk.rects : undefined,
        bbox: chunk?.bbox
      };
      return {
        localKey: `metadata:${index}`,
        parentKey: null,
        chunkType: (chunk?.chunkType || (page ? 'text' : chunkTypeFromText(text))) as KnowledgeChunkType,
        text,
        summary: summarizeChunk(text, headingPath),
        headingPath,
        locator,
        metadata: {
          strategy: page ? 'pdf-page-block' : 'extractor-structured',
          pageBlockIndex: typeof chunk?.blockIndex === 'number' ? chunk.blockIndex : undefined,
          bbox: chunk?.bbox,
          html: chunk?.html
        }
      } satisfies DraftChunk;
    })
    .filter((chunk) => chunk.text);

  return drafts.length ? drafts : null;
};

const splitPlainText = (content: string): DraftChunk[] => {
  const drafts: DraftChunk[] = [];
  pushSizedTextChunks({
    drafts,
    text: normalizeContent(content),
    localKeyPrefix: 'text:root',
    locator: { charStart: 0, charEnd: content.length },
    metadata: { strategy: 'plain-text' }
  });
  return drafts;
};

const fileExtension = (metadata?: Record<string, unknown>) =>
  typeof metadata?.extension === 'string' ? metadata.extension.toLowerCase() : '';

export class KnowledgeChunkingService {
  async indexFile(input: IndexFileInput) {
    const extension = fileExtension(input.metadata);
    const drafts =
      metadataChunks(input.metadata) ||
      (extension === 'md' || extension === 'markdown'
        ? splitMarkdown(input.content || '')
        : splitCodeLike(extension)
          ? splitCode(input.content || '', extension)
          : splitPlainText(input.content || ''));

    if (drafts.length === 0) return [];

    const localKeyToChunkId = new Map<string, string>();
    const localKeyToSourceHash = new Map<string, string>();
    drafts.forEach((draft, index) => {
      const headingPath = normalizeHeadingPath(draft.headingPath || draft.locator.headingPath);
      const locator = { ...draft.locator, headingPath, chunkIndex: index };
      const sourceHash = sourceHashForChunk({
        fileId: input.fileObjectId,
        chunkType: draft.chunkType,
        text: draft.text,
        locator,
        headingPath
      });
      localKeyToSourceHash.set(draft.localKey, sourceHash);
      localKeyToChunkId.set(
        draft.localKey,
        buildChunkId({
          workspaceId: input.workspaceId,
          fileId: input.fileObjectId,
          chunkType: draft.chunkType,
          sourceHash
        })
      );
    });

    const chunks: DocumentChunkInput[] = drafts.map((draft, index) => {
      const headingPath = normalizeHeadingPath(draft.headingPath || draft.locator.headingPath);
      const locator = { ...draft.locator, headingPath, chunkIndex: index };
      const sourceHash =
        localKeyToSourceHash.get(draft.localKey) ||
        sourceHashForChunk({
          fileId: input.fileObjectId,
          chunkType: draft.chunkType,
          text: draft.text,
          locator,
          headingPath
        });
      const parentChunkId = draft.parentKey ? localKeyToChunkId.get(draft.parentKey) : null;
      return {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId,
        fileId: input.fileObjectId,
        chunkIndex: index,
        parentId: parentChunkId || null,
        chunkType: draft.chunkType,
        text: draft.text,
        summary: draft.summary || summarizeChunk(draft.text, headingPath),
        tokenEstimate: estimateChunkTokens(draft.text),
        sourceHash,
        headingPath,
        source: input.source || 'workspace-file',
        purpose: input.purpose || 'grounding',
        metadata: {
          ...(input.metadata || {}),
          ...(draft.metadata || {}),
          sourceFileObjectId: input.fileObjectId,
          parentChunkId: parentChunkId || null,
          smallToBig: Boolean(parentChunkId)
        },
        locator
      };
    });

    return documentChunkStore.replaceFileChunks({
      workspaceId: input.workspaceId,
      fileObjectId: input.fileObjectId,
      chunks
    });
  }

  async indexGeneratedResources(resources: Array<{ id: string; workspaceId: string; content?: string | null; fileCategory?: string | null }>) {
    const indexed = [];

    for (const resource of resources) {
      if (!resource.content) continue;
      indexed.push(
        ...(await this.indexFile({
          workspaceId: resource.workspaceId,
          fileObjectId: resource.id,
          content: resource.content,
          source: 'generated-resource',
          purpose: resource.fileCategory || 'generated'
        }))
      );
    }

    return indexed;
  }
}

const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'java',
  'cpp',
  'c',
  'cc',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'swift',
  'kt',
  'scala',
  'sh',
  'bash',
  'zsh',
  'html',
  'css',
  'scss',
  'less',
  'sql'
]);

const splitCodeLike = (extension: string) => CODE_EXTENSIONS.has(extension);

export const knowledgeChunkingService = new KnowledgeChunkingService();

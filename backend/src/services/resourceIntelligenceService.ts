import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import prisma from '../config/db';
import { FileSystemError } from '../types/fileSystem';
import {
  documentTextExtractionService,
  PdfPageText,
  PdfTextLine,
  RenderableDocument,
  StructuredDocumentChunk
} from './documentTextExtractionService';
import { aiModelProviderService } from './aiModelProviderService';
import { LocalStorageService } from './storage/localStorageService';

type ResourceIntelligenceKind = 'document' | 'web' | 'code' | 'text' | 'visualization' | 'resource';
type ResourceIntelligenceStatus = 'idle' | 'processing' | 'ready' | 'degraded' | 'failed';
type ResourceIntelligenceStage =
  | 'idle'
  | 'queued'
  | 'extracting_text'
  | 'running_ocr'
  | 'detecting_layout'
  | 'classifying_pages'
  | 'segmenting_sections'
  | 'summarizing'
  | 'grounding_evidence'
  | 'indexing_context'
  | 'completed'
  | 'degraded'
  | 'failed';
type ResourcePageType =
  | 'cover'
  | 'toc'
  | 'section_divider'
  | 'content'
  | 'exercise'
  | 'bibliography'
  | 'appendix'
  | 'blank'
  | 'scan_required'
  | 'unknown';

const execFileAsync = promisify(execFile);

interface ResourceIntelligenceStageRecord {
  stage: ResourceIntelligenceStage;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  label?: string;
  message?: string;
  tool?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  outputCount?: number;
  warning?: string;
  error?: string;
}

interface ResourceIntelligenceProgress {
  stage: ResourceIntelligenceStage;
  percent: number;
  message?: string;
  heartbeatAt?: string;
  canRetry?: boolean;
  stages: ResourceIntelligenceStageRecord[];
  timings?: Record<string, number>;
}

interface ResourceEvidenceSnippet {
  id: string;
  text: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
  bbox?: { page?: number; left: number; top: number; width: number; height: number };
  confidence?: 'high' | 'medium' | 'low';
}

interface ResourceIntelligenceSection {
  id: string;
  title: string;
  summary: string;
  level?: number;
  parentId?: string;
  rangeLabel: string;
  locator: Record<string, unknown>;
  evidence?: string;
  evidenceSnippets?: ResourceEvidenceSnippet[];
  confidence?: 'high' | 'medium' | 'low';
  pageTypes?: ResourcePageType[];
  manuallyEdited?: boolean;
}

interface ResourceIntelligenceQuality {
  extraction: 'high' | 'medium' | 'low';
  structure: 'high' | 'medium' | 'low';
  grounding: 'high' | 'medium' | 'low';
  coverage: number;
  transcriptCoverage?: number;
  outlineDepth?: number;
  elementCount?: number;
  scannedPageCount?: number;
  pageCount?: number;
}

interface ResourcePageAnalysis {
  page: number;
  pageType: ResourcePageType;
  titleCandidates: string[];
  dominantHeading?: string;
  textLength: number;
  semanticTextLength: number;
  lineCount: number;
  noiseLineCount: number;
  keywordSignature: string[];
  confidence: 'high' | 'medium' | 'low';
}

interface ResourceIntelligenceStructure {
  extractor?: string;
  pageCount?: number;
  pageTypes?: Record<string, number>;
  pages?: ResourcePageAnalysis[];
  outline?: ResourceOutlineNode[];
}

interface ResourceOutlineNode {
  id: string;
  title: string;
  level: number;
  pageStart?: number;
  pageEnd?: number;
  parentId?: string;
  children?: ResourceOutlineNode[];
  summary?: string;
  confidence?: 'high' | 'medium' | 'low';
  locator?: Record<string, unknown>;
  evidenceSnippets?: ResourceEvidenceSnippet[];
  pageTypes?: ResourcePageType[];
}

interface ResourceTranscriptSegment {
  id: string;
  index: number;
  title?: string;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  locator: Record<string, unknown>;
  evidenceSnippets?: ResourceEvidenceSnippet[];
  confidence?: 'high' | 'medium' | 'low';
}

interface ResourceElement {
  id: string;
  type: 'table' | 'figure' | 'formula' | 'code' | 'quote' | 'list';
  title?: string;
  text: string;
  page?: number;
  locator: Record<string, unknown>;
  confidence?: 'high' | 'medium' | 'low';
}

interface ResourceIntelligenceDiagnostics {
  pageCount?: number;
  parsedPageCount: number;
  transcriptSegmentCount: number;
  outlineNodeCount: number;
  elementCount: number;
  scannedPageCount: number;
  lowConfidencePages: number[];
  warnings: string[];
}

export interface ResourceIntelligence {
  status: ResourceIntelligenceStatus;
  kind: ResourceIntelligenceKind;
  title?: string;
  overview: string;
  readingAdvice: string;
  sections: ResourceIntelligenceSection[];
  generatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  model?: string;
  error?: string;
  sourceHash?: string;
  progress?: ResourceIntelligenceProgress;
  warnings?: string[];
  tools?: Record<string, string | undefined>;
  quality?: ResourceIntelligenceQuality;
  structure?: ResourceIntelligenceStructure;
  transcript?: ResourceTranscriptSegment[];
  elements?: ResourceElement[];
  diagnostics?: ResourceIntelligenceDiagnostics;
}

interface IntelligenceOutput {
  overview: string;
  readingAdvice: string;
  sections: Array<{
    id?: string;
    sourceProposalId?: string;
    title: string;
    summary: string;
    readingAdvice?: string;
  }>;
  chapters?: Array<{
    id?: string;
    title: string;
    summary: string;
    pageStart: number;
    pageEnd: number;
  }>;
  slides?: Array<{
    page: number;
    title: string;
    explanation: string;
    keyPoints?: string[];
  }>;
}

interface IntelligenceUnit {
  id: string;
  label: string;
  locator: Record<string, unknown>;
  text: string;
  pageType?: ResourcePageType;
  titleCandidates?: string[];
  evidenceSnippets?: ResourceEvidenceSnippet[];
  confidence?: 'high' | 'medium' | 'low';
}

interface SectionProposal {
  id: string;
  title: string;
  summary: string;
  level?: number;
  parentId?: string;
  rangeLabel: string;
  locator: Record<string, unknown>;
  text: string;
  pages: number[];
  pageTypes: ResourcePageType[];
  evidenceSnippets: ResourceEvidenceSnippet[];
  confidence: 'high' | 'medium' | 'low';
}

interface DocumentAnalysisContext {
  structure: RenderableDocument | null;
  slideDeck: boolean;
  units: IntelligenceUnit[];
  proposals: SectionProposal[];
  outline: ResourceOutlineNode[];
  transcript: ResourceTranscriptSegment[];
  elements: ResourceElement[];
  diagnostics: ResourceIntelligenceDiagnostics;
  pageAnalysis: ResourcePageAnalysis[];
  warnings: string[];
  tools: Record<string, string | undefined>;
  quality: ResourceIntelligenceQuality;
  sourceHash: string;
}

const STAGE_LABELS: Record<ResourceIntelligenceStage, string> = {
  idle: 'Idle',
  queued: 'Queued',
  extracting_text: 'Extracting text',
  running_ocr: 'Running OCR',
  detecting_layout: 'Detecting layout',
  classifying_pages: 'Classifying pages',
  segmenting_sections: 'Segmenting sections',
  summarizing: 'Summarizing',
  grounding_evidence: 'Grounding evidence',
  indexing_context: 'Indexing context',
  completed: 'Completed',
  degraded: 'Partial result',
  failed: 'Failed'
};

const STAGE_PERCENT: Record<ResourceIntelligenceStage, number> = {
  idle: 0,
  queued: 3,
  extracting_text: 14,
  running_ocr: 24,
  detecting_layout: 36,
  classifying_pages: 48,
  segmenting_sections: 62,
  summarizing: 78,
  grounding_evidence: 90,
  indexing_context: 96,
  completed: 100,
  degraded: 100,
  failed: 100
};

const MAX_RESOURCE_SECTIONS = Math.max(20, Number(process.env.RESOURCE_INTELLIGENCE_MAX_SECTIONS || 120));
const MAX_LLM_PROPOSALS = Math.max(8, Number(process.env.RESOURCE_INTELLIGENCE_LLM_PROPOSALS || 80));
const RESOURCE_INTELLIGENCE_TIMEOUT_MS = Number(process.env.RESOURCE_INTELLIGENCE_TIMEOUT_MS || 120000);
const MAX_LLM_SLIDE_INPUTS = Math.max(8, Number(process.env.RESOURCE_INTELLIGENCE_LLM_SLIDE_INPUTS || 80));

const getExtension = (name?: string | null) => name?.split('.').pop()?.toLowerCase() || '';

const parseJsonObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const stableHash = (value: unknown) => {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
};

const clip = (value: string, max = 1200) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max).trim()}...` : normalized;
};

const cleanText = (value: string, max = 1200) => {
  const noise = [
    /仅限于?教学使用/i,
    /版权所有|copyright/i,
    /由\s*FLUX/i,
    /^苏州大学/i,
    /^计算机科学与技术学院/i,
    /^Source type:/i,
    /^URL:/i,
    /^Site:/i,
    /^Byline:/i,
    /^Excerpt:/i
  ];
  const lines = String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !noise.some((pattern) => pattern.test(line)));
  return clip(lines.join('\n'), max);
};

const normalizeLine = (value: string) => String(value || '').replace(/\s+/g, ' ').trim();

const isLikelyNoiseLine = (line: string) => {
  const text = normalizeLine(line);
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^[-–—_]{3,}$/.test(text)) return true;
  if (/仅限于?教学使用|版权所有|copyright|由\s*FLUX|苏州大学|计算机科学与技术学院/i.test(text)) return true;
  if (/^第?\s*\d+\s*页\s*(\/|共)?\s*\d*$/i.test(text)) return true;
  return false;
};

const keywordTokens = (value: string, max = 18) => {
  const text = normalizeLine(value).toLowerCase();
  const cjk = Array.from(text.matchAll(/[\u3400-\u9fff]{2,6}/g)).map((match) => match[0]);
  const latin = Array.from(text.matchAll(/[a-z][a-z0-9_-]{2,}/g)).map((match) => match[0]);
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'this',
    'that',
    'project',
    'software',
    'page',
    '课程',
    '项目',
    '管理',
    '软件',
    '介绍',
    '内容',
    '章节',
    '问题'
  ]);
  const counts = new Map<string, number>();
  [...cjk, ...latin].forEach((token) => {
    if (stop.has(token) || token.length < 2) return;
    counts.set(token, (counts.get(token) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, max)
    .map(([token]) => token);
};

const jaccard = (left: string[], right: string[]) => {
  if (!left.length || !right.length) return 0;
  const l = new Set(left);
  const r = new Set(right);
  const intersection = Array.from(l).filter((item) => r.has(item)).length;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
};

const isSlideDeckStructure = (structure: RenderableDocument | null, pageAnalysis: ResourcePageAnalysis[]) => {
  const pages = structure?.pages || [];
  if (pages.length < 4) return false;
  const landscapeRatio = pages.filter((page) => (page.width || 0) > (page.height || 0)).length / Math.max(1, pages.length);
  const titleRatio = pageAnalysis.filter((page) => page.titleCandidates.length || page.dominantHeading).length / Math.max(1, pageAnalysis.length);
  const avgSemanticLength =
    pageAnalysis.reduce((sum, page) => sum + page.semanticTextLength, 0) / Math.max(1, pageAnalysis.length || pages.length);
  return landscapeRatio >= 0.45 || (titleRatio >= 0.35 && avgSemanticLength < 1400);
};

const confidenceFromScore = (score: number): 'high' | 'medium' | 'low' => {
  if (score >= 0.72) return 'high';
  if (score >= 0.42) return 'medium';
  return 'low';
};

const pageRangeLabel = (pages: number[]) => {
  const sorted = Array.from(new Set(pages.filter((page) => Number.isFinite(page) && page > 0))).sort((a, b) => a - b);
  if (!sorted.length) return 'source';
  return sorted[0] === sorted[sorted.length - 1] ? `p${sorted[0]}` : `p${sorted[0]}-p${sorted[sorted.length - 1]}`;
};

const normalizeTitleText = (value: string) =>
  normalizeLine(value)
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(\d+(\.\d+)*|第[一二三四五六七八九十百\d]+[章节篇])[\s、.．-]+/, '')
    .replace(/\s+\d+$/, '')
    .trim();

const headingLevelFromTitle = (value: string, fallback = 2) => {
  const text = normalizeLine(value);
  const numeric = /^(\d+(?:\.\d+)*)[\s、.．-]+/.exec(text);
  if (numeric?.[1]) return Math.min(4, Math.max(1, numeric[1].split('.').length));
  if (/^第[一二三四五六七八九十百\d]+[章篇]/.test(text)) return 1;
  if (/^第[一二三四五六七八九十百\d]+节/.test(text)) return 2;
  return fallback;
};

const likelyTocEntry = (line: string) =>
  /^(.{2,90}?)(?:\.{2,}|\s{2,}|…+)\s*(\d{1,4})$/.exec(normalizeLine(line));

const extractOutlineFromToc = (pages: PdfPageText[], pageAnalysis: ResourcePageAnalysis[]): ResourceOutlineNode[] => {
  const tocPages = new Set(pageAnalysis.filter((page) => page.pageType === 'toc').map((page) => page.page));
  if (!tocPages.size) return [];
  const nodes: ResourceOutlineNode[] = [];
  const stack: ResourceOutlineNode[] = [];

  pages
    .filter((page) => tocPages.has(page.page))
    .flatMap((page) => (page.lines || syntheticOcrLines(page.page, page.text)).map((line) => normalizeLine(line.text)))
    .forEach((line) => {
      const match = likelyTocEntry(line);
      if (!match) return;
      const rawTitle = normalizeTitleText(match[1]);
      const targetPage = Number(match[2]);
      if (!rawTitle || !Number.isFinite(targetPage) || targetPage <= 0) return;
      const level = headingLevelFromTitle(match[1], /^\s{2,}/.test(match[1]) ? 2 : 1);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      const node: ResourceOutlineNode = {
        id: `toc-${nodes.length + 1}`,
        title: clip(rawTitle, 96),
        level,
        pageStart: targetPage,
        pageEnd: targetPage,
        parentId: parent?.id,
        confidence: 'high',
        locator: { page: targetPage, pageStart: targetPage, pageEnd: targetPage, chunkIndex: Math.max(0, targetPage - 1) },
        children: []
      };
      parent?.children?.push(node);
      nodes.push(node);
      stack.push(node);
    });

  const sorted = [...nodes].sort((left, right) => (left.pageStart || 0) - (right.pageStart || 0));
  sorted.forEach((node, index) => {
    const nextSameOrHigher = sorted.slice(index + 1).find((candidate) => candidate.level <= node.level && (candidate.pageStart || 0) > (node.pageStart || 0));
    if (node.pageStart) {
      node.pageEnd = nextSameOrHigher?.pageStart ? Math.max(node.pageStart, nextSameOrHigher.pageStart - 1) : node.pageEnd;
      node.locator = { ...(node.locator || {}), pageEnd: node.pageEnd };
    }
  });

  return nodes;
};

const extractOutlineFromHeadings = (
  pages: PdfPageText[],
  pageAnalysis: ResourcePageAnalysis[]
): ResourceOutlineNode[] => {
  const nodes: ResourceOutlineNode[] = [];
  const stack: ResourceOutlineNode[] = [];
  const analysisByPage = new Map(pageAnalysis.map((page) => [page.page, page]));

  pages.forEach((page) => {
    const analysis = analysisByPage.get(page.page);
    const candidates = analysis?.titleCandidates?.length
      ? analysis.titleCandidates
      : titleCandidatesForPage(page, semanticLinesForPage(page, new Set()));
    const rawTitle = candidates.map(normalizeTitleText).find((title) => title.length >= 3 && title.length <= 90);
    if (!rawTitle) return;
    if (nodes.some((node) => node.title === rawTitle && Math.abs((node.pageStart || 0) - page.page) <= 1)) return;
    const level = headingLevelFromTitle(candidates[0] || rawTitle, nodes.length ? 2 : 1);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    const node: ResourceOutlineNode = {
      id: `heading-${nodes.length + 1}`,
      title: clip(rawTitle, 96),
      level,
      pageStart: page.page,
      pageEnd: page.page,
      parentId: parent?.id,
      confidence: analysis?.confidence || 'medium',
      locator: { page: page.page, pageStart: page.page, pageEnd: page.page, chunkIndex: Math.max(0, page.page - 1) },
      children: []
    };
    parent?.children?.push(node);
    nodes.push(node);
    stack.push(node);
  });

  nodes.forEach((node, index) => {
    const next = nodes.slice(index + 1).find((candidate) => candidate.level <= node.level && (candidate.pageStart || 0) > (node.pageStart || 0));
    if (node.pageStart) {
      node.pageEnd = next?.pageStart ? Math.max(node.pageStart, next.pageStart - 1) : pages[pages.length - 1]?.page || node.pageStart;
      node.locator = { ...(node.locator || {}), pageEnd: node.pageEnd };
    }
  });

  return nodes;
};

const outlineNodeListToTree = (nodes: ResourceOutlineNode[]) => {
  const byId = new Map(nodes.map((node) => [node.id, { ...node, children: [] as ResourceOutlineNode[] }]));
  const roots: ResourceOutlineNode[] = [];
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)?.children?.push(node);
    else roots.push(node);
  });
  return roots;
};

const flattenOutline = (nodes: ResourceOutlineNode[]): ResourceOutlineNode[] => {
  const output: ResourceOutlineNode[] = [];
  const visit = (node: ResourceOutlineNode) => {
    output.push(node);
    (node.children || []).forEach(visit);
  };
  nodes.forEach(visit);
  return output;
};

const mergeBboxes = (snippets: ResourceEvidenceSnippet[]) => {
  const boxes = snippets.map((snippet) => snippet.bbox).filter(Boolean) as Array<{ page?: number; left: number; top: number; width: number; height: number }>;
  if (!boxes.length) return undefined;
  const page = boxes[0].page;
  const samePage = boxes.filter((box) => box.page === page);
  const left = Math.min(...samePage.map((box) => box.left));
  const top = Math.min(...samePage.map((box) => box.top));
  const right = Math.max(...samePage.map((box) => box.left + box.width));
  const bottom = Math.max(...samePage.map((box) => box.top + box.height));
  return { page, left, top, width: right - left, height: bottom - top };
};

const kindForFile = (file: any): ResourceIntelligenceKind => {
  const extension = getExtension(file.name || file.extension);
  const category = String(file.fileCategory || '').toLowerCase();
  if (category === 'web' || file.origin === 'web') return 'web';
  if (extension === 'html') return 'visualization';
  if (category === 'code' || /^(ts|tsx|js|jsx|py|java|cpp|c|h|go|rs|sql|css|json|yaml|yml)$/.test(extension)) return 'code';
  if (category === 'document' || /^(pdf|doc|docx|ppt|pptx|md|markdown)$/.test(extension) || file.mimeType?.includes('pdf')) return 'document';
  if (!file.isBinary) return 'text';
  return 'resource';
};

const rangeLabel = (locator: Record<string, any>, kind?: ResourceIntelligenceKind, index?: number) => {
  const pageStart = Number(locator.pageStart || locator.page);
  const pageEnd = Number(locator.pageEnd || locator.pageStart || locator.page);
  if (Number.isFinite(pageStart) && pageStart > 0) return pageEnd > pageStart ? `p${pageStart}-p${pageEnd}` : `p${pageStart}`;
  const lineStart = Number(locator.lineStart);
  const lineEnd = Number(locator.lineEnd || lineStart);
  if (Number.isFinite(lineStart) && lineStart > 0) {
    if (kind === 'code') return lineEnd > lineStart ? `L${lineStart}-L${lineEnd}` : `L${lineStart}`;
    return `Part ${(index ?? 0) + 1}`;
  }
  return 'source';
};

const commandExists = async (command: string) => {
  try {
    await execFileAsync('which', [command], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
};

const syntheticOcrLines = (page: number, text: string): PdfTextLine[] =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .map((line, index) => ({
      lineIndex: index,
      text: line,
      charStart: 0,
      charEnd: line.length
    }));

const tryOcrPdfPages = async (
  file: any,
  pages: PdfPageText[],
  warnings: string[],
  tools: Record<string, string | undefined>
): Promise<PdfPageText[]> => {
  const extension = getExtension(file.name || file.extension);
  if (extension !== 'pdf' && !file.mimeType?.toLowerCase().includes('pdf')) return pages;
  const blankPages = pages.filter((page) => normalizeLine(page.text).length < 20).slice(0, 24);
  if (!blankPages.length) return pages;
  if (!file.storageKey) {
    warnings.push('OCR skipped: source PDF has no stored file.');
    return pages;
  }

  const hasPdftoppm = await commandExists('pdftoppm');
  const hasTesseract = await commandExists('tesseract');
  if (!hasPdftoppm || !hasTesseract) {
    warnings.push('OCR unavailable: install pdftoppm and tesseract to analyze scanned PDF pages.');
    tools.ocr = hasTesseract ? 'tesseract-present-pdftoppm-missing' : 'unavailable';
    return pages;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp1-doc-ocr-'));
  const pdfPath = LocalStorageService.getFilePath(file.storageKey);
  const nextPages = [...pages];
  let ocrCount = 0;

  try {
    for (const page of blankPages) {
      const prefix = path.join(tempDir, `page-${page.page}`);
      try {
        await execFileAsync('pdftoppm', ['-f', String(page.page), '-l', String(page.page), '-r', '160', '-png', pdfPath, prefix], { timeout: 20000 });
        const files = await fs.readdir(tempDir);
        const imageName = files.find((name) => name.startsWith(`page-${page.page}`) && name.endsWith('.png'));
        if (!imageName) continue;
        const { stdout } = await execFileAsync(
          'tesseract',
          [path.join(tempDir, imageName), 'stdout', '-l', process.env.DOCUMENT_OCR_LANG || 'chi_sim+eng', '--psm', '6'],
          { timeout: 30000, maxBuffer: 1024 * 1024 * 4 }
        );
        const text = normalizeLine(stdout).length ? stdout.trim() : '';
        if (!text) continue;
        const index = nextPages.findIndex((candidate) => candidate.page === page.page);
        if (index >= 0) {
          nextPages[index] = {
            ...nextPages[index],
            text,
            lines: syntheticOcrLines(page.page, text)
          };
          ocrCount += 1;
        }
      } catch (error) {
        warnings.push(`OCR failed on page ${page.page}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }

  if (ocrCount) {
    tools.ocr = `tesseract:${process.env.DOCUMENT_OCR_LANG || 'chi_sim+eng'}`;
    warnings.push(`OCR recovered text from ${ocrCount} scanned page(s).`);
  } else {
    tools.ocr = 'tesseract-no-text';
    warnings.push('OCR ran but did not recover readable text from scanned pages.');
  }
  return nextPages;
};

const collectRepeatedNoise = (pages: PdfPageText[]) => {
  const counts = new Map<string, number>();
  pages.forEach((page) => {
    const seen = new Set<string>();
    const height = page.height || 1;
    (page.lines || []).forEach((line) => {
      const top = line.bbox?.top;
      const text = normalizeLine(line.text);
      if (!text || text.length > 80) return;
      const positionalNoise = typeof top === 'number' && (top < height * 0.12 || top > height * 0.88);
      if (!positionalNoise && !isLikelyNoiseLine(text)) return;
      seen.add(text.toLowerCase());
    });
    seen.forEach((text) => counts.set(text, (counts.get(text) || 0) + 1));
  });
  const threshold = Math.max(3, Math.ceil(pages.length * 0.35));
  return new Set(Array.from(counts.entries()).filter(([, count]) => count >= threshold).map(([text]) => text));
};

const semanticLinesForPage = (page: PdfPageText, repeatedNoise: Set<string>) => {
  const height = page.height || 1;
  return (page.lines || syntheticOcrLines(page.page, page.text))
    .map((line) => ({ ...line, text: normalizeLine(line.text) }))
    .filter((line) => {
      if (!line.text) return false;
      if (repeatedNoise.has(line.text.toLowerCase())) return false;
      const top = line.bbox?.top;
      const edgeLine = typeof top === 'number' && (top < height * 0.06 || top > height * 0.94);
      return !edgeLine && !isLikelyNoiseLine(line.text);
    });
};

const classifyPage = (page: PdfPageText, lines: PdfTextLine[], pageIndex: number, pageCount: number): ResourcePageType => {
  const text = normalizeLine(lines.map((line) => line.text).join(' '));
  if (!text) return normalizeLine(page.text).length ? 'unknown' : 'scan_required';
  if (text.length < 25) return 'blank';
  if (pageIndex === 0 && lines.length <= 12 && text.length < 500) return 'cover';
  if (/目录|contents|table of contents/i.test(text) || (lines.filter((line) => /\.{3,}\s*\d+$/.test(line.text)).length >= 3)) return 'toc';
  if (/练习|习题|作业|quiz|exercise|思考题|复习题/i.test(text)) return 'exercise';
  if (/参考文献|references|bibliography/i.test(text)) return 'bibliography';
  if (/附录|appendix/i.test(text)) return 'appendix';
  if (lines.length <= 8 && text.length < 260 && pageIndex > 0 && pageIndex < pageCount - 1) return 'section_divider';
  return 'content';
};

const titleCandidatesForPage = (page: PdfPageText, lines: PdfTextLine[]) => {
  const heights = lines.map((line) => line.bbox?.height || 0).filter((height) => height > 0).sort((a, b) => a - b);
  const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const pageHeight = page.height || 1;
  const candidates = lines
    .filter((line, index) => {
      const text = normalizeLine(line.text);
      if (!text || text.length > 80 || text.length < 4) return false;
      if (/[。；;]$/.test(text)) return false;
      const isNumbered = /^(\d+(\.\d+)*|第[一二三四五六七八九十百\d]+[章节篇])[\s、.．-]+/.test(text);
      const isTop = typeof line.bbox?.top === 'number' ? line.bbox.top < pageHeight * 0.38 : index < 8;
      const isLarge = medianHeight > 0 && (line.bbox?.height || 0) >= medianHeight * 1.12;
      const shortStrong = text.length <= 28 && !/[，,。]/.test(text);
      return isNumbered || (isTop && (isLarge || shortStrong));
    })
    .map((line) => normalizeLine(line.text));
  return Array.from(new Set(candidates)).slice(0, 4);
};

const analyzePdfPages = (pages: PdfPageText[]) => {
  const repeatedNoise = collectRepeatedNoise(pages);
  return pages.map((page, index) => {
    const semanticLines = semanticLinesForPage(page, repeatedNoise);
    const pageType = classifyPage(page, semanticLines, index, pages.length);
    const semanticText = semanticLines.map((line) => line.text).join('\n');
    const titleCandidates = titleCandidatesForPage(page, semanticLines);
    const keywordSignature = keywordTokens(semanticText, 16);
    const textLength = normalizeLine(page.text).length;
    const semanticTextLength = normalizeLine(semanticText).length;
    const score = Math.min(1, semanticTextLength / 600) * 0.45
      + (semanticLines.some((line) => line.bbox) ? 0.25 : 0.08)
      + (titleCandidates.length ? 0.2 : 0)
      + (pageType === 'scan_required' || pageType === 'blank' ? 0 : 0.1);
    return {
      page: page.page,
      pageType,
      titleCandidates,
      dominantHeading: titleCandidates[0],
      textLength,
      semanticTextLength,
      lineCount: (page.lines || []).length,
      noiseLineCount: Math.max(0, (page.lines || []).length - semanticLines.length),
      keywordSignature,
      confidence: confidenceFromScore(score)
    } as ResourcePageAnalysis;
  });
};

const evidenceFromLines = (page: PdfPageText, lines: PdfTextLine[], sectionId: string, max = 3): ResourceEvidenceSnippet[] =>
  lines
    .map((line) => ({ ...line, text: normalizeLine(line.text) }))
    .filter((line) => line.text.length >= 12 && !isLikelyNoiseLine(line.text))
    .slice(0, max)
    .map((line, index) => ({
      id: `${sectionId}-ev-${index + 1}`,
      text: clip(line.text, 180),
      page: page.page,
      lineStart: line.lineIndex + 1,
      lineEnd: line.lineIndex + 1,
      bbox: line.bbox,
      confidence: line.bbox ? 'high' : 'medium'
    }));

const slideChapterTitleFrom = (title: string, keywords: string[], index: number) => {
  const base = normalizeTitleText(title) || keywords.slice(0, 2).join('与') || `主题 ${index + 1}`;
  if (/[？?]$/.test(base)) return clip(base, 96);
  if (/为什么|如何|怎么|是否|能否|什么|哪些|怎样/.test(base)) return clip(base, 96);
  return clip(base.length <= 18 ? `如何理解${base}` : base, 96);
};

const summarizeSlideChapter = (items: Array<{ analysis?: ResourcePageAnalysis; text: string }>, title: string) => {
  const keywords = keywordTokens(items.map((item) => item.text).join('\n'), 8).slice(0, 5);
  const pages = items.length;
  if (keywords.length >= 3) {
    return clip(`这一组 ${pages} 页围绕「${title}」展开，重点连接 ${keywords.join('、')} 等概念，形成连续的问题脉络。`, 180);
  }
  return clip(`这一组 ${pages} 页围绕「${title}」展开，形成一个连续的讲解单元。`, 180);
};

const buildSlideDeckChaptersFromPages = (
  pages: PdfPageText[],
  pageAnalysis: ResourcePageAnalysis[]
): ResourceOutlineNode[] => {
  const repeatedNoise = collectRepeatedNoise(pages);
  const analysisByPage = new Map(pageAnalysis.map((page) => [page.page, page]));
  const items = pages
    .map((page) => {
      const lines = semanticLinesForPage(page, repeatedNoise);
      const text = cleanText(lines.map((line) => line.text).join('\n'), 1800);
      const analysis = analysisByPage.get(page.page);
      return {
        page,
        lines,
        text,
        analysis,
        keywords: analysis?.keywordSignature?.length ? analysis.keywordSignature : keywordTokens(text, 12),
        title: analysis?.dominantHeading || analysis?.titleCandidates?.[0] || ''
      };
    })
    .filter((item) => item.text.length > 20 && item.analysis?.pageType !== 'blank' && item.analysis?.pageType !== 'scan_required');

  if (!items.length) return [];

  const groups: typeof items[] = [];
  let current: typeof items = [];
  items.forEach((item, index) => {
    const previous = current[current.length - 1];
    const similarity = previous ? jaccard(previous.keywords, item.keywords) : 1;
    const type = item.analysis?.pageType || 'unknown';
    const previousType = previous?.analysis?.pageType || 'unknown';
    const explicitDivider = type === 'section_divider' && current.length > 0;
    const newNumberedChapter = /^(\d+(\.\d+)?|第[一二三四五六七八九十百\d]+[章节篇]|chapter|part)\b/i.test(item.title);
    const topicShift = current.length >= 3 && similarity < 0.1;
    const typeShift = current.length >= 2 && type !== previousType && (type === 'exercise' || previousType === 'exercise' || type === 'bibliography');
    const tooLong = current.length >= 7;
    if (index > 0 && current.length && (explicitDivider || newNumberedChapter || topicShift || typeShift || tooLong)) {
      groups.push(current);
      current = [];
    }
    current.push(item);
  });
  if (current.length) groups.push(current);

  return groups.map((group, index) => {
    const selectedTitle =
      group.find((item) => item.analysis?.pageType !== 'cover' && item.title)?.title ||
      group.find((item) => item.title)?.title ||
      group[0]?.keywords.slice(0, 2).join(' / ') ||
      `主题 ${index + 1}`;
    const keywords = keywordTokens(group.map((item) => item.text).join('\n'), 8);
    const pageStart = group[0].page.page;
    const pageEnd = group[group.length - 1].page.page;
    const evidenceSnippets = group
      .flatMap((item) => evidenceFromLines(item.page, item.lines, `slide-chapter-${index + 1}`, 2))
      .slice(0, 5);
    const pageTypes = Array.from(new Set(group.map((item) => item.analysis?.pageType || 'unknown')));
    const title = slideChapterTitleFrom(selectedTitle, keywords, index);
    return {
      id: `slide-chapter-${index + 1}`,
      title,
      level: 1,
      pageStart,
      pageEnd,
      summary: summarizeSlideChapter(group, title),
      confidence: group.some((item) => item.analysis?.confidence === 'high') ? 'high' : 'medium',
      locator: {
        page: pageStart,
        pageStart,
        pageEnd,
        chunkIndex: Math.max(0, pageStart - 1),
        lineStart: evidenceSnippets[0]?.lineStart,
        lineEnd: evidenceSnippets[evidenceSnippets.length - 1]?.lineEnd,
        bbox: mergeBboxes(evidenceSnippets)
      },
      evidenceSnippets,
      pageTypes,
      children: []
    } satisfies ResourceOutlineNode;
  });
};

const buildOutline = (structure: RenderableDocument, pageAnalysis: ResourcePageAnalysis[], proposals: SectionProposal[]) => {
  if (isSlideDeckStructure(structure, pageAnalysis)) {
    const chapters = buildSlideDeckChaptersFromPages(structure.pages || [], pageAnalysis);
    if (chapters.length) return outlineNodeListToTree(chapters);
    return outlineNodeListToTree(proposals.map((proposal, index) => ({
      id: `slide-chapter-${index + 1}`,
      title: slideChapterTitleFrom(proposal.title, keywordTokens(proposal.text, 8), index),
      level: 1,
      pageStart: proposal.pages[0],
      pageEnd: proposal.pages[proposal.pages.length - 1],
      summary: summarizeSlideChapter([{ text: proposal.text }], proposal.title),
      confidence: proposal.confidence,
      locator: proposal.locator,
      evidenceSnippets: proposal.evidenceSnippets,
      pageTypes: proposal.pageTypes,
      children: []
    } satisfies ResourceOutlineNode)));
  }

  if (structure.pages?.length) {
    const tocNodes = extractOutlineFromToc(structure.pages, pageAnalysis);
    const headingNodes = tocNodes.length >= 2 ? tocNodes : extractOutlineFromHeadings(structure.pages, pageAnalysis);
    const enriched = headingNodes.length
      ? headingNodes.map((node) => {
          const overlapping = proposals.find((proposal) =>
            proposal.pages.some((page) => page >= (node.pageStart || 0) && page <= (node.pageEnd || node.pageStart || 0))
          );
          return {
            ...node,
            summary: overlapping?.summary,
            evidenceSnippets: overlapping?.evidenceSnippets || node.evidenceSnippets,
            pageTypes: overlapping?.pageTypes || node.pageTypes
          };
        })
      : proposals.map((proposal, index) => ({
          id: proposal.id,
          title: proposal.title,
          level: index === 0 ? 1 : 2,
          pageStart: proposal.pages[0],
          pageEnd: proposal.pages[proposal.pages.length - 1],
          summary: proposal.summary,
          confidence: proposal.confidence,
          locator: proposal.locator,
          evidenceSnippets: proposal.evidenceSnippets,
          pageTypes: proposal.pageTypes,
          children: []
        } satisfies ResourceOutlineNode));
    return outlineNodeListToTree(enriched);
  }

  const nodes = proposals.map((proposal, index) => {
    const headingDepth = Array.isArray((proposal.locator as any).headingPath)
      ? Math.max(1, Math.min(4, (proposal.locator as any).headingPath.length))
      : 1;
    return {
      id: proposal.id,
      title: proposal.title,
      level: headingDepth || (index === 0 ? 1 : 2),
      pageStart: proposal.pages[0],
      pageEnd: proposal.pages[proposal.pages.length - 1],
      summary: proposal.summary,
      confidence: proposal.confidence,
      locator: proposal.locator,
      evidenceSnippets: proposal.evidenceSnippets,
      pageTypes: proposal.pageTypes,
      children: []
    } satisfies ResourceOutlineNode;
  });
  return outlineNodeListToTree(nodes);
};

const buildTranscriptFromPages = (
  pages: PdfPageText[],
  pageAnalysis: ResourcePageAnalysis[],
  outline: ResourceOutlineNode[]
): ResourceTranscriptSegment[] => {
  const repeatedNoise = collectRepeatedNoise(pages);
  const outlineFlat = flattenOutline(outline).sort((left, right) => (left.pageStart || 0) - (right.pageStart || 0));
  const analysisByPage = new Map(pageAnalysis.map((page) => [page.page, page]));
  const segments: ResourceTranscriptSegment[] = [];

  pages.forEach((page) => {
    const analysis = analysisByPage.get(page.page);
    if (analysis?.pageType === 'blank' || analysis?.pageType === 'scan_required') return;
    const lines = semanticLinesForPage(page, repeatedNoise);
    if (!lines.length) return;
    const paragraphs: PdfTextLine[][] = [];
    let current: PdfTextLine[] = [];
    lines.forEach((line) => {
      const text = normalizeLine(line.text);
      if (!text) return;
      const isHeading = analysis?.titleCandidates.some((candidate) => normalizeLine(candidate) === text);
      const shouldBreak = current.length >= 5 || (current.length > 0 && isHeading) || /[。.!?？；;:]$/.test(normalizeLine(current[current.length - 1]?.text || ''));
      if (shouldBreak && current.length) {
        paragraphs.push(current);
        current = [];
      }
      current.push(line);
    });
    if (current.length) paragraphs.push(current);

    paragraphs.forEach((paragraphLines) => {
      const text = cleanText(paragraphLines.map((line) => line.text).join('\n'), 1600);
      if (text.length < 20) return;
      const first = paragraphLines[0];
      const last = paragraphLines[paragraphLines.length - 1];
      const activeOutline = outlineFlat
        .filter((node) => (node.pageStart || 0) <= page.page && (node.pageEnd || node.pageStart || 0) >= page.page)
        .sort((left, right) => right.level - left.level)[0];
      const id = `tx-${segments.length + 1}`;
      segments.push({
        id,
        index: segments.length,
        title: activeOutline?.title || analysis?.dominantHeading,
        text,
        pageStart: page.page,
        pageEnd: page.page,
        locator: {
          page: page.page,
          pageStart: page.page,
          pageEnd: page.page,
          lineStart: first.lineIndex + 1,
          lineEnd: last.lineIndex + 1,
          bbox: mergeBboxes(evidenceFromLines(page, paragraphLines, id, 4))
        },
        evidenceSnippets: evidenceFromLines(page, paragraphLines, id, 2),
        confidence: first.bbox ? 'high' : 'medium'
      });
    });
  });

  return segments.slice(0, MAX_RESOURCE_SECTIONS * 6);
};

const buildTranscriptFromChunks = (chunks: StructuredDocumentChunk[], proposals: SectionProposal[]): ResourceTranscriptSegment[] =>
  chunks
    .filter((chunk) => chunk.text?.trim())
    .slice(0, MAX_RESOURCE_SECTIONS * 6)
    .map((chunk, index) => {
      const proposal = proposals.find((item) =>
        typeof chunk.chunkIndex === 'number' && Number((item.locator as any).chunkIndex) === chunk.chunkIndex
      );
      return {
        id: `tx-${index + 1}`,
        index,
        title: chunk.headingPath?.[chunk.headingPath.length - 1] || proposal?.title,
        text: cleanText(chunk.text, 1800),
        pageStart: chunk.pageStart || chunk.page,
        pageEnd: chunk.pageEnd || chunk.pageStart || chunk.page,
        locator: {
          chunkIndex: chunk.chunkIndex,
          blockId: chunk.blockId,
          headingPath: chunk.headingPath,
          paragraphIndex: chunk.paragraphIndex,
          page: chunk.page,
          pageStart: chunk.pageStart || chunk.page,
          pageEnd: chunk.pageEnd || chunk.pageStart || chunk.page,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd
        },
        evidenceSnippets: evidenceFromChunk(chunk, `tx-${index + 1}`, 2),
        confidence: chunk.lineStart || chunk.page ? 'high' : 'medium'
      } satisfies ResourceTranscriptSegment;
    })
    .filter((segment) => segment.text.length > 20);

const buildSlideNotesFromPages = (
  pages: PdfPageText[],
  pageAnalysis: ResourcePageAnalysis[],
  outline: ResourceOutlineNode[]
): ResourceTranscriptSegment[] => {
  const repeatedNoise = collectRepeatedNoise(pages);
  const outlineFlat = flattenOutline(outline).sort((left, right) => (left.pageStart || 0) - (right.pageStart || 0));
  const analysisByPage = new Map(pageAnalysis.map((page) => [page.page, page]));

  const notes: ResourceTranscriptSegment[] = [];
  pages.forEach((page, index) => {
    const analysis = analysisByPage.get(page.page);
    if (analysis?.pageType === 'blank' || analysis?.pageType === 'scan_required') return;
    const lines = semanticLinesForPage(page, repeatedNoise);
    const text = cleanText(lines.map((line) => line.text).join('\n'), 1800);
    if (text.length < 20) return;
    const title = normalizeTitleText(analysis?.dominantHeading || analysis?.titleCandidates?.[0] || `Slide ${page.page}`);
    const activeChapter = outlineFlat.find((node) =>
      (node.pageStart || 0) <= page.page && (node.pageEnd || node.pageStart || 0) >= page.page
    );
    const keywords = keywordTokens(text, 8).slice(0, 4);
    const first = lines[0];
    const last = lines[lines.length - 1] || first;
    const role = page.page === activeChapter?.pageStart
      ? '开启这个章节的问题场景'
      : page.page === activeChapter?.pageEnd
        ? '收束这一段讨论并指向后续理解'
        : '承接上一页并推进当前主题';
    const keyPointLine = keywords.length
      ? `可以重点看它怎样把 ${keywords.join('、')} 串成一个可理解的逻辑。`
      : '可以重点看它怎样把页面上的定义、例子或步骤组织成一个可理解的逻辑。';
    const explanation = [
      `本页讲的是「${title}」。`,
      activeChapter?.title ? `在「${activeChapter.title}」中，它的作用是${role}。` : `它的作用是${role}。`,
      keyPointLine
    ].join('\n');
    notes.push({
      id: `slide-${page.page}`,
      index,
      title,
      text: explanation,
      pageStart: page.page,
      pageEnd: page.page,
      locator: {
        page: page.page,
        pageStart: page.page,
        pageEnd: page.page,
        lineStart: first?.lineIndex != null ? first.lineIndex + 1 : undefined,
        lineEnd: last?.lineIndex != null ? last.lineIndex + 1 : undefined,
        bbox: mergeBboxes(evidenceFromLines(page, lines, `slide-${page.page}`, 4))
      },
      evidenceSnippets: evidenceFromLines(page, lines, `slide-${page.page}`, 2),
      confidence: analysis?.confidence || (first?.bbox ? 'high' : 'medium')
    });
  });
  return notes;
};

const detectElementsFromPage = (page: PdfPageText, lines: PdfTextLine[], sectionId: string): ResourceElement[] => {
  const elements: ResourceElement[] = [];
  let tableLines: PdfTextLine[] = [];
  const flushTable = () => {
    if (tableLines.length < 2) {
      tableLines = [];
      return;
    }
    const id = `${sectionId}-table-${elements.length + 1}`;
    const text = tableLines.map((line) => line.text).join('\n');
    elements.push({
      id,
      type: 'table',
      title: `Table on p${page.page}`,
      text: clip(text, 900),
      page: page.page,
      locator: {
        page: page.page,
        pageStart: page.page,
        pageEnd: page.page,
        lineStart: tableLines[0].lineIndex + 1,
        lineEnd: tableLines[tableLines.length - 1].lineIndex + 1,
        bbox: mergeBboxes(evidenceFromLines(page, tableLines, id, 8))
      },
      confidence: 'medium'
    });
    tableLines = [];
  };

  lines.forEach((line) => {
    const text = normalizeLine(line.text);
    const looksTable = /\|/.test(text) || text.split(/\s{2,}/).length >= 3 || /^(表|table)\s*\d+/i.test(text);
    if (looksTable) {
      tableLines.push(line);
      return;
    }
    flushTable();
    if (/^(图|figure|fig\.)\s*\d+/i.test(text)) {
      elements.push({
        id: `${sectionId}-figure-${elements.length + 1}`,
        type: 'figure',
        title: clip(text, 96),
        text: clip(text, 500),
        page: page.page,
        locator: {
          page: page.page,
          pageStart: page.page,
          pageEnd: page.page,
          lineStart: line.lineIndex + 1,
          lineEnd: line.lineIndex + 1,
          bbox: line.bbox
        },
        confidence: line.bbox ? 'high' : 'medium'
      });
    }
    if (/([=≈∑∫√≤≥]|\\frac|\\sum|\\int)/.test(text) && text.length <= 180) {
      elements.push({
        id: `${sectionId}-formula-${elements.length + 1}`,
        type: 'formula',
        text: clip(text, 300),
        page: page.page,
        locator: {
          page: page.page,
          pageStart: page.page,
          pageEnd: page.page,
          lineStart: line.lineIndex + 1,
          lineEnd: line.lineIndex + 1,
          bbox: line.bbox
        },
        confidence: line.bbox ? 'high' : 'medium'
      });
    }
  });
  flushTable();
  return elements;
};

const buildElements = (structure: RenderableDocument | null, pageAnalysis: ResourcePageAnalysis[]): ResourceElement[] => {
  if (structure?.pages?.length) {
    const repeatedNoise = collectRepeatedNoise(structure.pages);
    return structure.pages
      .flatMap((page) => detectElementsFromPage(page, semanticLinesForPage(page, repeatedNoise), `p${page.page}`))
      .slice(0, MAX_RESOURCE_SECTIONS * 2);
  }
  if (structure?.chunks?.length) {
    return structure.chunks
      .filter((chunk) => chunk.chunkType === 'table' || chunk.chunkType === 'code' || /^\|.+\|/m.test(chunk.text))
      .slice(0, MAX_RESOURCE_SECTIONS * 2)
      .map((chunk, index) => ({
        id: `element-${index + 1}`,
        type: chunk.chunkType === 'code' ? 'code' : 'table',
        title: chunk.headingPath?.[chunk.headingPath.length - 1],
        text: clip(chunk.text, 900),
        page: chunk.page || chunk.pageStart,
        locator: {
          chunkIndex: chunk.chunkIndex,
          page: chunk.page,
          pageStart: chunk.pageStart || chunk.page,
          pageEnd: chunk.pageEnd || chunk.pageStart || chunk.page,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          blockId: chunk.blockId
        },
        confidence: 'medium'
      } satisfies ResourceElement));
  }
  return [];
};

const buildDocumentUnitsAndProposals = (structure: RenderableDocument, pageAnalysis: ResourcePageAnalysis[]): { units: IntelligenceUnit[]; proposals: SectionProposal[] } => {
  const pages = structure.pages || [];
  if (!pages.length) return { units: buildUnitsFromStructure(structure, 'document'), proposals: [] };

  const repeatedNoise = collectRepeatedNoise(pages);
  const analysisByPage = new Map(pageAnalysis.map((page) => [page.page, page]));
  const semanticPages = pages.map((page) => ({
    page,
    lines: semanticLinesForPage(page, repeatedNoise),
    analysis: analysisByPage.get(page.page)
  }));

  const units = semanticPages
    .map(({ page, lines, analysis }) => {
      const text = cleanText(lines.map((line) => line.text).join('\n'), 1800);
      return {
        id: `page-${page.page}`,
        label: analysis?.dominantHeading ? `p${page.page} ${analysis.dominantHeading}` : `p${page.page}`,
        locator: { page: page.page, pageStart: page.page, pageEnd: page.page, chunkIndex: Math.max(0, page.page - 1) },
        text,
        pageType: analysis?.pageType || 'unknown',
        titleCandidates: analysis?.titleCandidates || [],
        evidenceSnippets: evidenceFromLines(page, lines, `page-${page.page}`, 2),
        confidence: analysis?.confidence || 'medium'
      } as IntelligenceUnit;
    })
    .filter((unit) => unit.text.length > 20);

  const groups: Array<typeof semanticPages> = [];
  let current: typeof semanticPages = [];
  semanticPages.forEach((item, index) => {
    const type = item.analysis?.pageType || 'unknown';
    const previous = current[current.length - 1];
    const similarity = previous ? jaccard(previous.analysis?.keywordSignature || [], item.analysis?.keywordSignature || []) : 1;
    const startsByHeading = Boolean(item.analysis?.dominantHeading && index > 0);
    const startsByDivider = type === 'section_divider';
    const weakSimilarity = current.length >= 2 && similarity < 0.08;
    const tooLong = current.length >= 8;
    if (current.length && (startsByDivider || startsByHeading || weakSimilarity || tooLong)) {
      groups.push(current);
      current = [];
    }
    current.push(item);
  });
  if (current.length) groups.push(current);

  const proposals = groups
    .map((group, index) => {
      const useful = group.filter((item) => {
        const type = item.analysis?.pageType;
        return type !== 'blank' && type !== 'scan_required' && type !== 'toc';
      });
      const selected = useful.length ? useful : group;
      const pagesInGroup = selected.map((item) => item.page.page);
      const title = selected.map((item) => item.analysis?.dominantHeading).find(Boolean)
        || selected[0]?.lines.find((line) => normalizeLine(line.text).length >= 4 && normalizeLine(line.text).length <= 60)?.text
        || `文档主题 ${index + 1}`;
      const text = selected.map((item) => item.lines.map((line) => line.text).join('\n')).join('\n\n');
      const evidenceSnippets = selected.flatMap((item) => evidenceFromLines(item.page, item.lines, `section-${index + 1}`, 2)).slice(0, 5);
      const pageTypes = Array.from(new Set(selected.map((item) => item.analysis?.pageType || 'unknown')));
      const locator: Record<string, unknown> = {
        pageStart: Math.min(...pagesInGroup),
        pageEnd: Math.max(...pagesInGroup),
        page: pagesInGroup[0],
        lineStart: evidenceSnippets[0]?.lineStart || 1,
        lineEnd: evidenceSnippets[evidenceSnippets.length - 1]?.lineEnd || 1,
        bbox: mergeBboxes(evidenceSnippets)
      };
      const score = (evidenceSnippets.length ? 0.35 : 0)
        + (selected.some((item) => item.analysis?.dominantHeading) ? 0.25 : 0)
        + Math.min(0.3, normalizeLine(text).length / 3000)
        + (pageTypes.includes('scan_required') ? -0.25 : 0);
      return {
        id: `proposal-${index + 1}`,
        title: clip(title, 80),
        summary: clip(text, 180),
        level: index === 0 ? 1 : 2,
        rangeLabel: pageRangeLabel(pagesInGroup),
        locator,
        text: clip(text, 2800),
        pages: pagesInGroup,
        pageTypes,
        evidenceSnippets,
        confidence: confidenceFromScore(score)
      } as SectionProposal;
    })
    .filter((proposal) => normalizeLine(proposal.text).length > 20)
    .slice(0, MAX_RESOURCE_SECTIONS);

  return { units, proposals };
};

const evidenceFromChunk = (chunk: StructuredDocumentChunk, id: string, max = 2): ResourceEvidenceSnippet[] => {
  const lines = String(chunk.text || '').replace(/\r\n/g, '\n').split('\n').map(normalizeLine).filter(Boolean);
  return lines.slice(0, max).map((line, index) => ({
    id: `${id}-ev-${index + 1}`,
    text: clip(line, 180),
    page: chunk.page || chunk.pageStart,
    lineStart: chunk.lineStart ? chunk.lineStart + index : undefined,
    lineEnd: chunk.lineStart ? chunk.lineStart + index : undefined,
    bbox: chunk.bbox,
    confidence: chunk.bbox || chunk.lineStart ? 'high' : 'medium'
  }));
};

const buildUnitsFromStructure = (structure: RenderableDocument, kind: ResourceIntelligenceKind): IntelligenceUnit[] => {
  if (structure.pages?.length) {
    return structure.pages
      .map((page) => ({
        id: `page-${page.page}`,
        label: `p${page.page}`,
        locator: { page: page.page, pageStart: page.page, pageEnd: page.page, chunkIndex: Math.max(0, page.page - 1) },
        text: cleanText(page.text, 1400),
        pageType: normalizeLine(page.text).length < 20 ? 'scan_required' as const : 'content' as const,
        evidenceSnippets: evidenceFromLines(page, page.lines || syntheticOcrLines(page.page, page.text), `page-${page.page}`, 2),
        confidence: normalizeLine(page.text).length > 300 ? 'medium' as const : 'low' as const
      }))
      .filter((unit) => unit.text.length > 20);
  }

  if (structure.chunks?.length) {
    return structure.chunks
      .filter((chunk) => chunk.text?.trim())
      .slice(0, 120)
      .map((chunk, index) => {
        const locator = {
          chunkIndex: chunk.chunkIndex,
          blockId: chunk.blockId,
          page: (chunk as any).page || (chunk as any).pageStart,
          pageStart: (chunk as any).pageStart || (chunk as any).page,
          pageEnd: (chunk as any).pageEnd || (chunk as any).pageStart || (chunk as any).page,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd
        };
        return {
          id: `chunk-${chunk.chunkIndex}`,
          label: chunk.headingPath?.length ? `${rangeLabel(locator, kind, index)} ${chunk.headingPath.join(' / ')}` : rangeLabel(locator, kind, index),
          locator,
          text: kind === 'code' ? clip(chunk.text, 1400) : cleanText(chunk.text, 1400),
          titleCandidates: chunk.headingPath?.length ? [chunk.headingPath[chunk.headingPath.length - 1]] : [],
          evidenceSnippets: evidenceFromChunk(chunk, `chunk-${chunk.chunkIndex}`, 2),
          confidence: chunk.headingPath?.length || chunk.lineStart ? 'high' as const : 'medium' as const
        };
      })
      .filter((unit) => unit.text.length > 20);
  }

  return [];
};

const buildFallbackUnitsFromText = (text: string, kind: ResourceIntelligenceKind): IntelligenceUnit[] => {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const windowSize = kind === 'code' ? 80 : 45;
  const units: IntelligenceUnit[] = [];
  for (let index = 0; index < lines.length && units.length < 80; index += windowSize) {
    const chunk = lines.slice(index, index + windowSize).join('\n').trim();
    if (!chunk) continue;
    const lineStart = index + 1;
    const lineEnd = Math.min(lines.length, index + windowSize);
    units.push({
      id: `lines-${lineStart}-${lineEnd}`,
      label: kind === 'code'
        ? (lineEnd > lineStart ? `L${lineStart}-L${lineEnd}` : `L${lineStart}`)
        : `Part ${units.length + 1}`,
      locator: { lineStart, lineEnd, scrollRatio: Math.min(1, Math.max(0, (lineStart - 1) / Math.max(1, lines.length))) },
      text: kind === 'code' ? clip(chunk, 1400) : cleanText(chunk, 1400),
      evidenceSnippets: lines.slice(index, index + windowSize).map(normalizeLine).filter(Boolean).slice(0, 2).map((line, evidenceIndex) => ({
        id: `lines-${lineStart}-${lineEnd}-ev-${evidenceIndex + 1}`,
        text: clip(line, 180),
        lineStart: lineStart + evidenceIndex,
        lineEnd: lineStart + evidenceIndex,
        confidence: 'medium'
      })),
      confidence: 'medium'
    });
  }
  return units.filter((unit) => unit.text.length > 20);
};

const invalidSectionTitle = (title: string) => /^(pages?|section|chapter|chunk|code block)\s*\d+/i.test(title.trim());

const proposalsFromUnits = (units: IntelligenceUnit[], kind?: ResourceIntelligenceKind): SectionProposal[] =>
  units.slice(0, MAX_RESOURCE_SECTIONS).map((unit, index) => {
    const locator = unit.locator || {};
    const pageStart = Number((locator as any).pageStart || (locator as any).page);
    const pageEnd = Number((locator as any).pageEnd || pageStart);
    const pages = Number.isFinite(pageStart) && pageStart > 0
      ? Array.from({ length: Math.max(1, (pageEnd || pageStart) - pageStart + 1) }, (_, offset) => pageStart + offset)
      : [];
    const title = unit.titleCandidates?.[0] || unit.label || `资源片段 ${index + 1}`;
    return {
      id: `proposal-${index + 1}`,
      title,
      summary: clip(unit.text, 180),
      level: 1,
      rangeLabel: pages.length ? pageRangeLabel(pages) : rangeLabel(locator, kind, index),
      locator,
      text: clip(unit.text, 2800),
      pages,
      pageTypes: unit.pageType ? [unit.pageType] : ['unknown'],
      evidenceSnippets: unit.evidenceSnippets || [],
      confidence: unit.confidence || 'medium'
    };
  });

const normalizeOutput = (output: IntelligenceOutput, proposals: SectionProposal[]): IntelligenceOutput & { sections: ResourceIntelligenceSection[] } => {
  const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const used = new Set<string>();
  const sections = Array.isArray(output.sections)
    ? output.sections
        .map((section, index) => {
          const proposal = proposalById.get(String(section.sourceProposalId || section.id || '')) || proposals[index];
          if (!proposal) return null;
          used.add(proposal.id);
          const title = String(section.title || proposal.title || '').trim();
          const summary = String(section.summary || proposal.summary || '').trim();
          if (!title || !summary || invalidSectionTitle(title)) {
            return {
              id: proposal.id,
              title: proposal.title,
              summary: proposal.summary,
              level: proposal.level,
              parentId: proposal.parentId,
              rangeLabel: proposal.rangeLabel,
              locator: proposal.locator,
              evidence: proposal.evidenceSnippets[0]?.text,
              evidenceSnippets: proposal.evidenceSnippets,
              confidence: proposal.confidence,
              pageTypes: proposal.pageTypes
            } as ResourceIntelligenceSection;
          }
          return {
            id: proposal.id,
            title,
            summary,
            level: proposal.level,
            parentId: proposal.parentId,
            rangeLabel: proposal.rangeLabel,
            locator: proposal.locator,
            evidence: proposal.evidenceSnippets[0]?.text,
            evidenceSnippets: proposal.evidenceSnippets,
            confidence: proposal.confidence,
            pageTypes: proposal.pageTypes
          } as ResourceIntelligenceSection;
        })
        .filter((section): section is ResourceIntelligenceSection => Boolean(section))
    : [];
  proposals.forEach((proposal) => {
    if (used.has(proposal.id) || sections.length >= MAX_RESOURCE_SECTIONS) return;
    sections.push({
      id: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      level: proposal.level,
      parentId: proposal.parentId,
      rangeLabel: proposal.rangeLabel,
      locator: proposal.locator,
      evidence: proposal.evidenceSnippets[0]?.text,
      evidenceSnippets: proposal.evidenceSnippets,
      confidence: proposal.confidence,
      pageTypes: proposal.pageTypes
    });
  });
  return {
    overview: String(output.overview || '').trim(),
    readingAdvice: String(output.readingAdvice || '').trim(),
    sections
  };
};

const applySlideDeckOutput = (
  output: IntelligenceOutput,
  baseOutline: ResourceOutlineNode[],
  baseSlides: ResourceTranscriptSegment[],
  proposals: SectionProposal[],
  pages: PdfPageText[]
) => {
  const maxPage = pages[pages.length - 1]?.page || baseSlides.length || 1;
  const minPage = pages[0]?.page || 1;
  const proposalByRange = (pageStart: number, pageEnd: number) =>
    proposals.find((proposal) => proposal.pages.some((page) => page >= pageStart && page <= pageEnd));

  const generatedChapters = Array.isArray(output.chapters) && output.chapters.length
    ? output.chapters
        .map((chapter, index) => {
          const pageStart = Math.max(minPage, Math.min(maxPage, Math.floor(Number(chapter.pageStart || minPage))));
          const pageEnd = Math.max(pageStart, Math.min(maxPage, Math.floor(Number(chapter.pageEnd || pageStart))));
          const proposal = proposalByRange(pageStart, pageEnd);
          return {
            id: `chapter-${index + 1}`,
            title: clip(String(chapter.title || proposal?.title || `主题 ${index + 1}`), 96),
            level: 1,
            pageStart,
            pageEnd,
            summary: clip(String(chapter.summary || proposal?.summary || ''), 240),
            confidence: proposal?.confidence || 'medium',
            locator: { page: pageStart, pageStart, pageEnd, chunkIndex: Math.max(0, pageStart - 1) },
            evidenceSnippets: proposal?.evidenceSnippets,
            pageTypes: proposal?.pageTypes,
            children: []
          } satisfies ResourceOutlineNode;
        })
        .filter((chapter) => chapter.title && chapter.summary)
    : [];

  const sourceChapters = generatedChapters.length ? generatedChapters : flattenOutline(baseOutline);
  let cursor = minPage;
  const chapters = sourceChapters
    .sort((left, right) => (left.pageStart || minPage) - (right.pageStart || minPage))
    .map((chapter, index) => {
      const requestedStart = Math.max(minPage, Math.min(maxPage, Math.floor(Number(chapter.pageStart || cursor))));
      const pageStart = Math.max(cursor, requestedStart);
      const requestedEnd = Math.max(pageStart, Math.min(maxPage, Math.floor(Number(chapter.pageEnd || pageStart))));
      const nextRequestedStart = sourceChapters[index + 1]?.pageStart;
      const pageEnd = nextRequestedStart && nextRequestedStart > pageStart
        ? Math.min(requestedEnd, nextRequestedStart - 1)
        : requestedEnd;
      cursor = Math.min(maxPage + 1, pageEnd + 1);
      return {
        ...chapter,
        id: `chapter-${index + 1}`,
        level: 1,
        parentId: undefined,
        pageStart,
        pageEnd,
        locator: { ...(chapter.locator || {}), page: pageStart, pageStart, pageEnd, chunkIndex: Math.max(0, pageStart - 1) },
        children: []
      } satisfies ResourceOutlineNode;
    })
    .filter((chapter) => (chapter.pageStart || 0) <= (chapter.pageEnd || 0));

  if (chapters.length && chapters[chapters.length - 1].pageEnd && chapters[chapters.length - 1].pageEnd! < maxPage) {
    chapters[chapters.length - 1] = {
      ...chapters[chapters.length - 1],
      pageEnd: maxPage,
      locator: { ...(chapters[chapters.length - 1].locator || {}), pageEnd: maxPage }
    };
  }

  const slideByPage = new Map(baseSlides.map((slide) => [slide.pageStart, slide]));
  const slides = baseSlides.map((base) => {
    const generated = output.slides?.find((slide) => Number(slide.page) === base.pageStart);
    if (!generated) return base;
    const keyPoints = Array.isArray(generated.keyPoints)
      ? generated.keyPoints.map((point) => normalizeLine(point)).filter(Boolean).slice(0, 4)
      : [];
    const text = [
      String(generated.explanation || '').trim(),
      keyPoints.length ? `关键点：${keyPoints.join('；')}` : ''
    ].filter(Boolean).join('\n');
    return {
      ...base,
      title: String(generated.title || base.title || `Slide ${base.pageStart}`).trim(),
      text: text || base.text
    };
  });

  const sections: ResourceIntelligenceSection[] = chapters.map((chapter) => {
    const evidence = slideByPage.get(chapter.pageStart)?.text || chapter.evidenceSnippets?.[0]?.text;
    return {
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary || '',
      level: chapter.level,
      rangeLabel: chapter.pageStart === chapter.pageEnd ? `p${chapter.pageStart}` : `p${chapter.pageStart}-p${chapter.pageEnd}`,
      locator: chapter.locator || { pageStart: chapter.pageStart, pageEnd: chapter.pageEnd },
      evidence,
      evidenceSnippets: chapter.evidenceSnippets,
      confidence: chapter.confidence,
      pageTypes: chapter.pageTypes
    };
  });

  return {
    outline: outlineNodeListToTree(chapters),
    transcript: slides,
    sections
  };
};

const pageTypeCounts = (pages: ResourcePageAnalysis[]) =>
  pages.reduce<Record<string, number>>((acc, page) => {
    acc[page.pageType] = (acc[page.pageType] || 0) + 1;
    return acc;
  }, {});

const qualityFor = (
  structure: RenderableDocument | null,
  pageAnalysis: ResourcePageAnalysis[],
  proposals: SectionProposal[],
  units: IntelligenceUnit[],
  outline: ResourceOutlineNode[] = [],
  transcript: ResourceTranscriptSegment[] = [],
  elements: ResourceElement[] = []
): ResourceIntelligenceQuality => {
  const pageCount = structure?.pageCount || structure?.pages?.length || undefined;
  const scannedPageCount = pageAnalysis.filter((page) => page.pageType === 'scan_required').length;
  const usablePages = pageAnalysis.filter((page) => page.semanticTextLength > 80).length;
  const extractionScore = pageAnalysis.length
    ? (usablePages / Math.max(1, pageAnalysis.length)) - (scannedPageCount / Math.max(1, pageAnalysis.length)) * 0.5
    : units.length ? 0.62 : 0;
  const headingRatio = pageAnalysis.length ? pageAnalysis.filter((page) => page.titleCandidates.length).length / Math.max(1, pageAnalysis.length) : 0.5;
  const groundingRatio = proposals.length
    ? proposals.filter((proposal) => proposal.evidenceSnippets.length).length / Math.max(1, proposals.length)
    : 0;
  const coveredPages = new Set(proposals.flatMap((proposal) => proposal.pages)).size;
  const coverage = pageCount ? coveredPages / Math.max(1, pageCount) : Math.min(1, units.length / Math.max(1, proposals.length || units.length));
  const transcriptPages = new Set(transcript.flatMap((segment) => {
    const start = segment.pageStart || 0;
    const end = segment.pageEnd || start;
    return start ? Array.from({ length: Math.max(1, end - start + 1) }, (_, offset) => start + offset) : [];
  })).size;
  const outlineDepth = flattenOutline(outline).reduce((max, node) => Math.max(max, node.level || 1), 0);
  return {
    extraction: confidenceFromScore(extractionScore),
    structure: confidenceFromScore(headingRatio * 0.35 + Math.min(1, flattenOutline(outline).length / 4) * 0.45 + Math.min(1, outlineDepth / 3) * 0.2),
    grounding: confidenceFromScore(groundingRatio),
    coverage: Number(Math.max(0, Math.min(1, coverage)).toFixed(2)),
    transcriptCoverage: pageCount ? Number(Math.max(0, Math.min(1, transcriptPages / Math.max(1, pageCount))).toFixed(2)) : undefined,
    outlineDepth,
    elementCount: elements.length,
    scannedPageCount,
    pageCount
  };
};

const buildAnalysisContext = async (file: any, kind: ResourceIntelligenceKind): Promise<DocumentAnalysisContext> => {
  const warnings: string[] = [];
  const tools: Record<string, string | undefined> = {};
  let structure = await documentTextExtractionService.renderable(file).catch((error) => {
    warnings.push(`Text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });

  if (structure?.pages?.length) {
    const ocrPages = await tryOcrPdfPages(file, structure.pages, warnings, tools);
    if (ocrPages !== structure.pages) {
      structure = {
        ...structure,
        pages: ocrPages,
        pageCount: structure.pageCount || ocrPages.length
      };
    }
  }

  const pageAnalysis = structure?.pages?.length ? analyzePdfPages(structure.pages) : [];
  let units: IntelligenceUnit[] = [];
  let proposals: SectionProposal[] = [];

  if (kind === 'document' && structure?.pages?.length) {
    const built = buildDocumentUnitsAndProposals(structure, pageAnalysis);
    units = built.units;
    proposals = built.proposals;
  } else if (structure) {
    units = buildUnitsFromStructure(structure, kind);
    proposals = proposalsFromUnits(units, kind);
  } else {
    units = buildFallbackUnitsFromText(file.content || '', kind);
    proposals = proposalsFromUnits(units, kind);
  }

  const outline = structure ? buildOutline(structure, pageAnalysis, proposals) : buildOutline({ kind: 'text', chunks: [], extractor: 'none' }, pageAnalysis, proposals);
  const slideDeck = isSlideDeckStructure(structure, pageAnalysis);
  const transcript: ResourceTranscriptSegment[] = structure?.pages?.length
    ? slideDeck
      ? buildSlideNotesFromPages(structure.pages, pageAnalysis, outline)
      : buildTranscriptFromPages(structure.pages, pageAnalysis, outline)
    : structure?.chunks?.length
      ? buildTranscriptFromChunks(structure.chunks, proposals)
      : buildFallbackUnitsFromText(file.content || '', kind).map((unit, index) => ({
          id: `tx-${index + 1}`,
          index,
          title: unit.label,
          text: unit.text,
          locator: unit.locator,
          evidenceSnippets: unit.evidenceSnippets,
          confidence: unit.confidence || 'medium'
        } satisfies ResourceTranscriptSegment));
  const elements = buildElements(structure, pageAnalysis);
  const diagnostics: ResourceIntelligenceDiagnostics = {
    pageCount: structure?.pageCount || structure?.pages?.length,
    parsedPageCount: pageAnalysis.filter((page) => page.semanticTextLength > 20).length || units.length,
    transcriptSegmentCount: transcript.length,
    outlineNodeCount: flattenOutline(outline).length,
    elementCount: elements.length,
    scannedPageCount: pageAnalysis.filter((page) => page.pageType === 'scan_required').length,
    lowConfidencePages: pageAnalysis.filter((page) => page.confidence === 'low').map((page) => page.page),
    warnings
  };
  const quality = qualityFor(structure, pageAnalysis, proposals, units, outline, transcript, elements);
  if (quality.scannedPageCount) warnings.push(`${quality.scannedPageCount} page(s) look scanned or text-poor.`);
  if (quality.extraction === 'low') warnings.push('Extraction quality is low; result may be incomplete.');
  if (quality.grounding === 'low') warnings.push('Grounded evidence coverage is low.');
  tools.extraction = structure?.extractor || (file.content ? 'stored-text' : 'none');
  tools.layout = structure?.pages?.length ? 'pdf-text-layer-layout-heuristics' : structure?.chunks?.length ? 'structured-chunk-headings' : 'plain-text-windowing';
  tools.segmentation = structure?.pages?.length ? 'heading-boundary+jaccard-page-clustering' : 'chunk-window-proposals';
  tools.evidence = 'line-bbox-grounding';

  const sourceHash = stableHash({
    name: file.name,
    updatedAt: file.updatedAt,
    kind,
    extractor: structure?.extractor,
    pageAnalysis: pageAnalysis.map((page) => [page.page, page.pageType, page.dominantHeading, page.semanticTextLength]),
    units: units.map((unit) => [unit.label, unit.text.slice(0, 160)]),
    outline: flattenOutline(outline).map((node) => [node.title, node.pageStart, node.pageEnd, node.level]),
    transcript: transcript.map((segment) => [segment.pageStart, segment.pageEnd, segment.text.slice(0, 120)])
  });

  return { structure, slideDeck, units, proposals, outline, transcript, elements, diagnostics, pageAnalysis, warnings, tools, quality, sourceHash };
};

export class ResourceIntelligenceService {
  async getAnalysis(workspaceId: string, fileObjectId: string): Promise<ResourceIntelligence> {
    const file = await prisma.fileSystemObject.findFirst({ where: { id: fileObjectId, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');
    const metadata = parseJsonObject(file.metadataJson);
    const existing = metadata.resourceIntelligence && typeof metadata.resourceIntelligence === 'object'
      ? metadata.resourceIntelligence as ResourceIntelligence
      : null;
    return existing || {
      status: 'idle',
      kind: kindForFile(file),
      title: file.name,
      overview: '',
      readingAdvice: '',
      sections: []
    };
  }

  async enqueueAnalysis(workspaceId: string, fileObjectId: string, options: { force?: boolean } = {}): Promise<ResourceIntelligence> {
    const file = await prisma.fileSystemObject.findFirst({ where: { id: fileObjectId, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Resource intelligence requires a file resource');

    const metadata = parseJsonObject(file.metadataJson);
    const existing = metadata.resourceIntelligence && typeof metadata.resourceIntelligence === 'object'
      ? metadata.resourceIntelligence as ResourceIntelligence
      : null;

    if (!options.force && existing?.status === 'processing') {
      return existing;
    }

    const queued: ResourceIntelligence = {
      status: 'processing',
      kind: kindForFile(file),
      title: file.name,
      overview: '',
      readingAdvice: '',
      sections: [],
      generatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      progress: {
        stage: 'queued',
        percent: STAGE_PERCENT.queued,
        message: 'Queued resource intelligence analysis.',
        heartbeatAt: new Date().toISOString(),
        canRetry: false,
        stages: [{
          stage: 'queued',
          status: 'completed',
          label: STAGE_LABELS.queued,
          message: 'Queued resource intelligence analysis.',
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString()
        }]
      },
      warnings: [],
      tools: {}
    };
    await this.save(fileObjectId, metadata, queued);

    void this.analyze(workspaceId, fileObjectId, { force: true }).catch((error) => {
      const failed: ResourceIntelligence = {
        status: 'failed',
        kind: kindForFile(file),
        title: file.name,
        overview: '',
        readingAdvice: '',
        sections: [],
        generatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Resource intelligence failed.'
      };
      void this.save(fileObjectId, metadata, failed).catch(() => undefined);
    });

    return queued;
  }

  async analyze(workspaceId: string, fileObjectId: string, options: { force?: boolean } = {}): Promise<ResourceIntelligence> {
    const file = await prisma.fileSystemObject.findFirst({ where: { id: fileObjectId, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Resource intelligence requires a file resource');

    const metadata = parseJsonObject(file.metadataJson);
    const kind = kindForFile(file);
    const existing = metadata.resourceIntelligence && typeof metadata.resourceIntelligence === 'object'
      ? metadata.resourceIntelligence as ResourceIntelligence
      : null;

    const startedAt = new Date().toISOString();
    let processing: ResourceIntelligence = {
      status: 'processing',
      kind,
      title: file.name,
      overview: '',
      readingAdvice: '',
      sections: [],
      generatedAt: startedAt,
      startedAt,
      progress: this.mergeProgress(existing?.progress, {
        stage: 'extracting_text',
        status: 'running',
        message: 'Extracting readable text and renderable document structure.'
      }),
      warnings: [],
      tools: {}
    };
    await this.save(fileObjectId, metadata, processing);

    const context = await buildAnalysisContext(file, kind);
    const { structure, slideDeck, units, proposals, outline, transcript, elements, diagnostics, pageAnalysis, warnings, tools, quality, sourceHash } = context;

    if (!options.force && existing?.status === 'ready' && existing.sourceHash === sourceHash) {
      return existing;
    }

    processing = {
      ...processing,
      sourceHash,
      progress: this.mergeProgress(this.mergeProgress(processing.progress, {
        stage: 'extracting_text',
        status: 'completed',
        message: 'Extracted readable text and renderable document structure.',
        outputCount: units.length
      }), {
        stage: 'detecting_layout',
        status: 'completed',
        message: 'Detected layout, page types, headings, and repeated noise.',
        outputCount: units.length
      }),
      warnings,
      tools,
      quality,
      structure: {
        extractor: structure?.extractor,
        pageCount: structure?.pageCount || structure?.pages?.length,
        pageTypes: pageTypeCounts(pageAnalysis),
        pages: pageAnalysis.slice(0, 120),
        outline
      }
    };
    await this.save(fileObjectId, metadata, processing);

    processing = {
      ...processing,
      progress: this.mergeProgress(processing.progress, {
        stage: 'segmenting_sections',
        status: 'completed',
        message: 'Clustered adjacent pages and prepared grounded section proposals.',
        outputCount: proposals.length
      })
    };
    await this.save(fileObjectId, metadata, processing);

    if (!units.length || !proposals.length) {
      const failed: ResourceIntelligence = {
        status: 'failed',
        kind,
        title: file.name,
        overview: '',
        readingAdvice: '',
        sections: [],
        generatedAt: new Date().toISOString(),
        startedAt,
        completedAt: new Date().toISOString(),
        error: 'No readable text was available for resource intelligence.',
        sourceHash,
        progress: this.mergeProgress(processing.progress, {
          stage: 'failed',
          status: 'failed',
          message: 'No readable text was available for resource intelligence.',
          error: 'No readable text was available for resource intelligence.'
        }),
        warnings,
        tools,
        quality,
        structure: processing.structure,
        transcript,
        elements,
        diagnostics
      };
      await this.save(fileObjectId, metadata, failed);
      return failed;
    }

    try {
      processing = {
        ...processing,
        progress: this.mergeProgress(processing.progress, {
          stage: 'summarizing',
          status: 'running',
          message: 'Summarizing section proposals with the model while preserving backend locators.'
        })
      };
      await this.save(fileObjectId, metadata, processing);

      const response = await aiModelProviderService.json<IntelligenceOutput>({
        useCase: 'resource',
        instruction: [
          slideDeck
            ? 'Generate slide-deck intelligence: semantic chapter ranges and one teaching explanation per slide.'
            : `Generate ${kind} resource intelligence from backend section proposals.`,
          slideDeck
            ? 'Chapters must describe the big question/problem covered by a contiguous page range.'
            : 'Only refine semantic titles, concise summaries, overview, and readingAdvice.',
          slideDeck
            ? 'Slides must explain what each slide is teaching and why it matters. Do not merely copy OCR text.'
            : '',
          'Do not invent page ranges, citations, evidence, quizzes, exercises, flashcards, or study notes.',
          slideDeck ? 'Use only pages and text provided in slideInputs.' : 'Keep each section tied to sourceProposalId exactly as provided.',
          'Use concise, information-rich Chinese titles. Avoid mechanical titles like "Pages 1-9", "Section 1", "Chunk 1".',
          'Ignore covers, repeated headers, copyright notices, generated-by text, and grading logistics unless they are the actual subject matter.'
        ].filter(Boolean).join('\n'),
        schema: {
          overview: 'string, <= 45 Chinese chars',
          readingAdvice: 'string, <= 60 Chinese chars',
          chapters: [
            {
              title: 'big semantic question/topic for contiguous slides',
              summary: 'what this chapter teaches, <= 90 Chinese chars',
              pageStart: 'integer page number from provided pages',
              pageEnd: 'integer page number from provided pages'
            }
          ],
          slides: [
            {
              page: 'integer page number',
              title: 'semantic slide title',
              explanation: 'teaching explanation for this slide, 1-3 Chinese sentences',
              keyPoints: ['2-4 short key points']
            }
          ],
          sections: [
            {
              sourceProposalId: 'must equal one provided proposal id',
              title: 'semantic content title, not a page label',
              summary: 'what this part contributes, <= 70 Chinese chars'
            }
          ]
        },
        input: {
          resource: { name: file.name, path: file.path, kind },
          extractionQuality: quality,
          pageTypes: pageTypeCounts(pageAnalysis),
          outline: flattenOutline(outline).slice(0, MAX_LLM_PROPOSALS).map((node) => ({
            id: node.id,
            title: node.title,
            level: node.level,
            pageStart: node.pageStart,
            pageEnd: node.pageEnd,
            evidence: node.evidenceSnippets?.slice(0, 2).map((snippet) => clip(snippet.text, 500))
          })),
          transcriptPreview: transcript.slice(0, 18).map((segment) => ({
            id: segment.id,
            title: segment.title,
            range: segment.pageStart === segment.pageEnd ? `p${segment.pageStart}` : `${segment.pageStart || ''}-${segment.pageEnd || ''}`,
            text: clip(segment.text, 420)
          })),
          slideInputs: slideDeck && structure?.pages
            ? structure.pages.slice(0, MAX_LLM_SLIDE_INPUTS).map((page) => {
                const analysis = pageAnalysis.find((item) => item.page === page.page);
                return {
                  page: page.page,
                  titleCandidates: analysis?.titleCandidates || [],
                  pageType: analysis?.pageType,
                  text: clip(page.text, 700)
                };
              })
            : undefined,
          proposals: proposals.slice(0, MAX_LLM_PROPOSALS).map((proposal) => ({
            id: proposal.id,
            backendTitle: proposal.title,
            rangeLabel: proposal.rangeLabel,
            pageTypes: proposal.pageTypes,
            evidence: proposal.evidenceSnippets.slice(0, 2).map((snippet) => clip(snippet.text, 320)),
            text: clip(proposal.text, 800)
          }))
        },
        timeoutMs: RESOURCE_INTELLIGENCE_TIMEOUT_MS
      });
      const normalized = normalizeOutput(response.data, proposals);
      const slideDeckOutput = slideDeck && structure?.pages
        ? applySlideDeckOutput(response.data, outline, transcript, proposals, structure.pages)
        : null;
      const finalSections = slideDeckOutput?.sections?.length ? slideDeckOutput.sections : normalized.sections;
      const finalOutline = slideDeckOutput?.outline || outline;
      const finalTranscript = slideDeckOutput?.transcript || transcript;
      const finalStructure = {
        ...processing.structure,
        outline: finalOutline
      };
      if (!finalSections.length) throw new Error('Resource intelligence returned no semantic sections.');
      const degraded = quality.extraction === 'low' || quality.grounding === 'low' || Boolean(warnings.length);
      const analysis: ResourceIntelligence = {
        status: degraded ? 'degraded' : 'ready',
        kind,
        title: file.name,
        overview: normalized.overview || `${file.name} 的资源结构已完成分析。`,
        readingAdvice: normalized.readingAdvice || '按语义章节定位后再进入原文细读。',
        sections: finalSections,
        generatedAt: new Date().toISOString(),
        startedAt,
        completedAt: new Date().toISOString(),
        model: response.model,
        sourceHash,
        progress: this.mergeProgress(this.mergeProgress(processing.progress, {
          stage: 'summarizing',
          status: 'completed',
          message: 'Model refined section titles and summaries.',
          tool: response.model,
          outputCount: finalSections.length
        }), {
          stage: degraded ? 'degraded' : 'completed',
          status: 'completed',
          message: degraded ? 'Resource intelligence completed with quality warnings.' : 'Resource intelligence completed.',
          outputCount: finalSections.length,
          tool: response.model
        }),
        warnings,
        tools: { ...tools, llm: response.model },
        quality,
        structure: finalStructure,
        transcript: finalTranscript,
        elements,
        diagnostics: {
          ...diagnostics,
          transcriptSegmentCount: finalTranscript.length,
          outlineNodeCount: flattenOutline(finalOutline).length
        }
      };
      await this.save(fileObjectId, metadata, analysis);
      return analysis;
    } catch (error) {
      const fallbackSections = normalizeOutput({ overview: '', readingAdvice: '', sections: [] }, proposals).sections;
      const degraded: ResourceIntelligence = {
        status: fallbackSections.length ? 'degraded' : 'failed',
        kind,
        title: file.name,
        overview: fallbackSections.length ? `${file.name} 的结构分析已完成，模型摘要降级。` : '',
        readingAdvice: fallbackSections.length ? '已使用本地结构与证据生成降级语义地图。' : '',
        sections: fallbackSections,
        generatedAt: new Date().toISOString(),
        startedAt,
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Resource intelligence failed.',
        sourceHash,
        progress: this.mergeProgress(processing.progress, {
          stage: fallbackSections.length ? 'degraded' : 'failed',
          status: fallbackSections.length ? 'completed' : 'failed',
          message: fallbackSections.length ? 'Model summarization failed; returned grounded deterministic sections.' : 'Resource intelligence failed.',
          error: error instanceof Error ? error.message : 'Resource intelligence failed.'
        }),
        warnings: [...warnings, `Model summarization failed: ${error instanceof Error ? error.message : String(error)}`],
        tools,
        quality,
        structure: processing.structure,
        transcript,
        elements,
        diagnostics
      };
      await this.save(fileObjectId, metadata, degraded);
      return degraded;
    }
  }

  private mergeProgress(
    previous: ResourceIntelligenceProgress | undefined,
    patch: {
      stage: ResourceIntelligenceStage;
      status?: ResourceIntelligenceStageRecord['status'];
      message?: string;
      tool?: string;
      outputCount?: number;
      warning?: string;
      error?: string;
    }
  ): ResourceIntelligenceProgress {
    const now = new Date().toISOString();
    const existingStages = previous?.stages ? [...previous.stages] : [];
    const existingIndex = existingStages.findIndex((record) => record.stage === patch.stage);
    const previousRecord = existingIndex >= 0 ? existingStages[existingIndex] : undefined;
    const startedAt = previousRecord?.startedAt || now;
    const endedAt = patch.status && ['completed', 'failed', 'skipped'].includes(patch.status) ? now : undefined;
    const record: ResourceIntelligenceStageRecord = {
      ...previousRecord,
      stage: patch.stage,
      status: patch.status || previousRecord?.status || 'running',
      label: STAGE_LABELS[patch.stage],
      message: patch.message,
      tool: patch.tool,
      outputCount: patch.outputCount,
      warning: patch.warning,
      error: patch.error,
      startedAt,
      endedAt,
      durationMs: endedAt ? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()) : previousRecord?.durationMs
    };
    if (existingIndex >= 0) existingStages[existingIndex] = record;
    else existingStages.push(record);
    return {
      stage: patch.stage,
      percent: STAGE_PERCENT[patch.stage],
      message: patch.message,
      heartbeatAt: now,
      canRetry: patch.stage === 'failed' || patch.stage === 'degraded',
      stages: existingStages,
      timings: {
        ...(previous?.timings || {}),
        ...(record.durationMs != null ? { [patch.stage]: record.durationMs } : {})
      }
    };
  }

  private async save(fileObjectId: string, metadata: Record<string, any>, analysis: ResourceIntelligence) {
    await prisma.fileSystemObject.update({
      where: { id: fileObjectId },
      data: {
        metadataJson: JSON.stringify({
          ...metadata,
          resourceIntelligence: analysis
        })
      }
    });
  }
}

export const resourceIntelligenceService = new ResourceIntelligenceService();

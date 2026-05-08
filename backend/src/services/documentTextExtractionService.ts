import fs from 'fs/promises';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { FileSystemError } from '../types/fileSystem';
import { LocalStorageService } from './storage/localStorageService';

export interface ExtractedDocumentText {
  text: string;
  extractor: string;
  metadata: Record<string, unknown>;
}

export interface PdfPageText {
  fileId?: string;
  page: number;
  text: string;
  charStart?: number;
  charEnd?: number;
  width?: number;
  height?: number;
  lines?: PdfTextLine[];
}

export interface PdfTextLine {
  lineIndex: number;
  text: string;
  charStart?: number;
  charEnd?: number;
  bbox?: { page?: number; left: number; top: number; width: number; height: number };
  rects?: Array<{ page?: number; left: number; top: number; width: number; height: number }>;
}

export interface StructuredDocumentChunk {
  fileId?: string;
  chunkIndex: number;
  chunkType?: 'parent' | 'text' | 'table' | 'list' | 'code' | 'summary';
  text: string;
  headingPath?: string[];
  paragraphIndex?: number;
  blockId?: string;
  blockIndex?: number;
  page?: number;
  pageStart?: number;
  pageEnd?: number;
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
  bbox?: { page?: number; left: number; top: number; width: number; height: number };
  rects?: Array<{ page?: number; left: number; top: number; width: number; height: number }>;
  html?: string;
}

export interface RenderableDocument {
  kind: 'pdf' | 'docx' | 'markdown' | 'code' | 'text';
  fileId?: string;
  fileName?: string | null;
  pageCount?: number;
  pages?: PdfPageText[];
  chunks?: StructuredDocumentChunk[];
  extractor: string;
  fallbackReason?: string;
}

const getExtension = (fileName?: string | null) =>
  fileName?.split('.').pop()?.toLowerCase() || '';

const stripHtml = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const sanitizeHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\s(href|src)="javascript:[^"]*"/gi, '')
    .replace(/\s(href|src)='javascript:[^']*'/gi, '');

const decodeHtml = (value: string) =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();

const splitParagraphs = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

const chunkPlainText = (text: string, fileId?: string): StructuredDocumentChunk[] => {
  const chunks: StructuredDocumentChunk[] = [];
  let charCursor = 0;

  splitParagraphs(text).forEach((paragraph, index) => {
    const charStart = text.indexOf(paragraph, charCursor);
    const safeCharStart = charStart >= 0 ? charStart : charCursor;
    const charEnd = safeCharStart + paragraph.length;
    charCursor = charEnd;
    chunks.push({
      fileId,
      chunkIndex: chunks.length,
      paragraphIndex: index,
      text: paragraph,
      charStart: safeCharStart,
      charEnd
    });
  });

  return chunks.length
    ? chunks
    : text.trim()
      ? [{ fileId, chunkIndex: 0, paragraphIndex: 0, text: text.trim(), charStart: 0, charEnd: text.trim().length }]
      : [];
};

const chunkMarkdown = (text: string, fileId?: string): StructuredDocumentChunk[] => {
  const chunks: StructuredDocumentChunk[] = [];
  const headingStack: string[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paragraphLines: string[] = [];
  let paragraphStartLine = 1;
  let charCursor = 0;
  let paragraphIndex = 0;

  const flushParagraph = (lineEnd: number) => {
    const paragraph = paragraphLines.join('\n').trim();
    if (!paragraph) {
      paragraphLines = [];
      return;
    }
    const charStart = text.indexOf(paragraph, charCursor);
    const safeCharStart = charStart >= 0 ? charStart : charCursor;
    const charEnd = safeCharStart + paragraph.length;
    charCursor = charEnd;
    chunks.push({
      fileId,
      chunkIndex: chunks.length,
      paragraphIndex,
      headingPath: headingStack.length ? [...headingStack] : undefined,
      lineStart: paragraphStartLine,
      lineEnd,
      text: paragraph,
      charStart: safeCharStart,
      charEnd
    });
    paragraphIndex += 1;
    paragraphLines = [];
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flushParagraph(lineNumber - 1);
      const level = heading[1].length;
      headingStack.splice(level - 1);
      headingStack[level - 1] = heading[2].trim();
      chunks.push({
        fileId,
        chunkIndex: chunks.length,
        paragraphIndex,
        headingPath: [...headingStack],
        lineStart: lineNumber,
        lineEnd: lineNumber,
        text: heading[2].trim()
      });
      paragraphIndex += 1;
      return;
    }

    if (!line.trim()) {
      flushParagraph(lineNumber - 1);
      return;
    }

    if (paragraphLines.length === 0) paragraphStartLine = lineNumber;
    paragraphLines.push(line);
  });

  flushParagraph(lines.length);
  return chunks;
};

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

const chunkCode = (text: string, fileId?: string): StructuredDocumentChunk[] => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks: StructuredDocumentChunk[] = [];
  let charStart = 0;
  const windowSize = 80;

  for (let index = 0; index < lines.length; index += windowSize) {
    const lineSlice = lines.slice(index, index + windowSize);
    const chunkText = lineSlice.join('\n').trimEnd();
    if (!chunkText.trim()) {
      charStart += lineSlice.join('\n').length + 1;
      continue;
    }
    chunks.push({
      fileId,
      chunkIndex: chunks.length,
      text: chunkText,
      lineStart: index + 1,
      lineEnd: index + lineSlice.length,
      charStart,
      charEnd: charStart + lineSlice.join('\n').length
    });
    charStart += lineSlice.join('\n').length + 1;
  }

  return chunks;
};

const chunkPdfPage = (page: PdfPageText, chunkStartIndex: number): StructuredDocumentChunk[] => {
  const lines: PdfTextLine[] = page.lines?.length
    ? page.lines
    : page.text
        .split('\n')
        .map((line, index) => ({ lineIndex: index, text: line.trim() }))
        .filter((line) => line.text);

  if (lines.length === 0) {
    return [
      {
        fileId: page.fileId,
        chunkIndex: chunkStartIndex,
        chunkType: 'text' as const,
        page: page.page,
        pageStart: page.page,
        pageEnd: page.page,
        blockIndex: 0,
        blockId: `page-${page.page}`,
        text: page.text,
        charStart: page.charStart,
        charEnd: page.charEnd,
        rects: []
      }
    ].filter((chunk) => chunk.text.trim());
  }

  const chunks: StructuredDocumentChunk[] = [];
  let blockLines: PdfTextLine[] = [];
  let blockStartLine = 1;
  let blockCharStart = page.charStart || 0;
  let blockRects: Array<{ page?: number; left: number; top: number; width: number; height: number }> = [];

  const flushBlock = (lineEnd: number) => {
    const text = blockLines.map((line) => line.text).join('\n').trim();
    if (!text) {
      blockLines = [];
      blockRects = [];
      return;
    }
    const bbox = mergeRects(blockRects);
    chunks.push({
      fileId: page.fileId,
      chunkIndex: chunkStartIndex + chunks.length,
      chunkType: 'text',
      page: page.page,
      pageStart: page.page,
      pageEnd: page.page,
      blockIndex: chunks.length,
      blockId: `page-${page.page}-block-${chunks.length}`,
      lineStart: blockStartLine,
      lineEnd,
      text,
      charStart: blockCharStart,
      charEnd: blockCharStart + text.length,
      bbox,
      rects: blockRects
    });
    blockLines = [];
    blockRects = [];
  };

  lines.forEach((line) => {
    if (blockLines.length === 0) {
      blockStartLine = line.lineIndex + 1;
      blockCharStart = typeof line.charStart === 'number' ? line.charStart : page.charStart || 0;
    }
    blockLines.push(line);
    blockRects.push(...(line.rects || []));
    const blockText = blockLines.map((item) => item.text).join('\n');
    if (blockText.length >= 900) flushBlock(line.lineIndex + 1);
  });

  flushBlock(lines[lines.length - 1]?.lineIndex + 1 || lines.length);
  return chunks;
};

const mergeRects = (rects: Array<{ page?: number; left: number; top: number; width: number; height: number }>) => {
  if (!rects.length) return undefined;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  return {
    page: rects[0].page,
    left,
    top,
    width: right - left,
    height: bottom - top
  };
};

const extractPdfWithPdfJs = async (buffer: Buffer, fileId?: string): Promise<{ text: string; pages: PdfPageText[]; pageCount: number }> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const message = args.map((arg) => String(arg)).join(' ');
    if (/^Warning:\s*TT: undefined function: \d+/.test(message) || /^TT: undefined function: \d+/.test(message)) {
      return;
    }
    originalWarn(...args);
  };
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
    verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0
  } as any);
  const pages: PdfPageText[] = [];
  let globalCharCursor = 0;
  let document: any = null;

  try {
    document = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({ includeMarkedContent: true } as any);
      const items = (textContent.items || [])
        .filter((item: any) => typeof item.str === 'string' && item.str.trim())
        .map((item: any) => {
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.hypot(transform[2], transform[3]) || item.height || 10;
          const left = transform[4];
          const top = transform[5] - fontHeight;
          return {
            text: item.str,
            x: left,
            y: top,
            rect: {
              page: pageNumber,
              left,
              top,
              width: Math.max(1, item.width || Math.hypot(transform[0], transform[1])),
              height: Math.max(1, fontHeight)
            }
          };
        })
        .sort((left: any, right: any) => Math.abs(left.y - right.y) > 2 ? left.y - right.y : left.x - right.x);

      const lines: PdfTextLine[] = [];
      let currentItems: typeof items = [];
      const flushLine = () => {
        if (!currentItems.length) return;
        const text = currentItems.map((item: any, index: number) => {
          if (index === 0) return item.text;
          const previous = currentItems[index - 1];
          const gap = item.x - (previous.x + previous.rect.width);
          return `${gap > 3 ? ' ' : ''}${item.text}`;
        }).join('').trim();
        if (!text) {
          currentItems = [];
          return;
        }
        const charStart = globalCharCursor;
        globalCharCursor += text.length + 1;
        const rects = currentItems.map((item: any) => item.rect);
        lines.push({
          lineIndex: lines.length,
          text,
          charStart,
          charEnd: charStart + text.length,
          bbox: mergeRects(rects),
          rects
        });
        currentItems = [];
      };

      items.forEach((item: any) => {
        if (!currentItems.length) {
          currentItems.push(item);
          return;
        }
        const currentY = currentItems[0].y;
        if (Math.abs(item.y - currentY) <= 2.5) {
          currentItems.push(item);
          return;
        }
        flushLine();
        currentItems.push(item);
      });
      flushLine();

      const text = lines.map((line) => line.text).join('\n');
      pages.push({
        fileId,
        page: pageNumber,
        text,
        width: viewport.width,
        height: viewport.height,
        charStart: lines[0]?.charStart ?? globalCharCursor,
        charEnd: lines[lines.length - 1]?.charEnd ?? globalCharCursor,
        lines
      });
    }

    return {
      text: pages.map((page) => page.text).join('\n\n'),
      pages,
      pageCount: document.numPages
    };
  } finally {
    console.warn = originalWarn;
    await document?.destroy?.().catch(() => undefined);
    await loadingTask.destroy().catch(() => undefined);
  }
};


const chunkDocxHtml = (html: string, fileId?: string): { text: string; chunks: StructuredDocumentChunk[] } => {
  const chunks: StructuredDocumentChunk[] = [];
  const headingStack: string[] = [];
  const textParts: string[] = [];
  let paragraphIndex = 0;
  let charCursor = 0;
  const blockPattern = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(html))) {
    const tag = match[1].toLowerCase();
    const text = decodeHtml(match[2]);
    if (!text) continue;

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      headingStack.splice(level - 1);
      headingStack[level - 1] = text;
    }

    const charStart = charCursor;
    textParts.push(text);
    charCursor += text.length + 2;
    chunks.push({
      fileId,
      chunkIndex: chunks.length,
      paragraphIndex,
      headingPath: headingStack.length ? [...headingStack] : undefined,
      text,
      html: sanitizeHtml(match[0]),
      charStart,
      charEnd: charStart + text.length
    });
    paragraphIndex += 1;
  }

  const fullText = textParts.join('\n\n').trim() || stripHtml(html);
  return {
    text: fullText,
    chunks: chunks.length ? chunks : chunkPlainText(fullText, fileId)
  };
};

type ExtractableFile = {
  id?: string;
  name?: string | null;
  extension?: string | null;
  mimeType?: string | null;
  storageKey?: string | null;
  content?: string | null;
  isBinary?: boolean | null;
};

export class DocumentTextExtractionService {
  async extract(file: ExtractableFile): Promise<ExtractedDocumentText> {
    const extension = (file.extension || getExtension(file.name)).toLowerCase();

    if (file.content && !file.isBinary) {
      const chunks = this.chunkTextByType(file.content, extension, file.id);
      return {
        text: file.content,
        extractor: 'stored-text',
        metadata: { extension, chunks }
      };
    }

    if (!file.storageKey) {
      return {
        text: '',
        extractor: 'empty',
        metadata: { extension }
      };
    }

    const filePath = LocalStorageService.getFilePath(file.storageKey);

    if (extension === 'pdf' || file.mimeType?.toLowerCase().includes('pdf')) {
      const buffer = await fs.readFile(filePath);
      const infoResult = await this.readPdfInfo(buffer).catch(() => null);
      const structuredPdf = await extractPdfWithPdfJs(buffer, file.id).catch(async () => {
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const textResult = await parser.getText();
        await parser.destroy();
        const pages = this.normalizePdfPages(textResult.pages || [], file.id);
        return {
          text: textResult.text || '',
          pages,
          pageCount: textResult.total || pages.length
        };
      });

      return {
        text: structuredPdf.text,
        extractor: structuredPdf.pages.some((page) => page.lines?.some((line) => line.rects?.length)) ? 'pdfjs-text-layer' : 'pdf-parse',
        metadata: {
          extension,
          pageCount: structuredPdf.pageCount,
          pages: structuredPdf.pages,
          chunks: structuredPdf.pages.flatMap((page, pageIndex) => chunkPdfPage(page, pageIndex * 1000)),
          info: infoResult?.info || null
        }
      };
    }

    if (extension === 'docx') {
      const converted = await mammoth.convertToHtml({ path: filePath });
      const structured = chunkDocxHtml(converted.value || '', file.id);

      return {
        text: structured.text,
        extractor: 'mammoth',
        metadata: {
          extension,
          chunks: structured.chunks,
          messages: converted.messages || []
        }
      };
    }

    const textLikeExtensions = new Set([
      'md',
      'markdown',
      'txt',
      'csv',
      'json',
      'yaml',
      'yml',
      'xml',
      'html',
      'css',
      'js',
      'ts',
      'tsx',
      'jsx',
      'py',
      'java',
      'cpp',
      'c',
      'go',
      'rs',
      'sql'
    ]);

    if (textLikeExtensions.has(extension) || file.mimeType?.toLowerCase().startsWith('text/')) {
      const text = await fs.readFile(filePath, 'utf-8');
      return {
        text,
        extractor: 'plain-text',
        metadata: {
          extension,
          chunks: this.chunkTextByType(text, extension, file.id)
        }
      };
    }

    throw new FileSystemError(
      415,
      `Text extraction is not available for ${path.extname(file.name || '').replace('.', '') || 'this file type'} yet`
    );
  }

  async extractPdfPages(file: ExtractableFile, pages?: number[]): Promise<PdfPageText[]> {
    const extension = (file.extension || getExtension(file.name)).toLowerCase();
    if (extension !== 'pdf' && !file.mimeType?.toLowerCase().includes('pdf')) return [];
    if (!file.storageKey) return [];

    const filePath = LocalStorageService.getFilePath(file.storageKey);
    const buffer = await fs.readFile(filePath);
    const structuredPdf = await extractPdfWithPdfJs(buffer, file.id).catch(async () => {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const textResult = await parser.getText(pages?.length ? { partial: pages } : undefined);
      await parser.destroy();
      return {
        text: textResult.text || '',
        pages: this.normalizePdfPages(textResult.pages || [], file.id),
        pageCount: textResult.total || 0
      };
    });
    return pages?.length
      ? structuredPdf.pages.filter((page) => pages.includes(page.page))
      : structuredPdf.pages;
  }

  async extractChunks(file: ExtractableFile): Promise<StructuredDocumentChunk[]> {
    const extension = (file.extension || getExtension(file.name)).toLowerCase();
    const extracted = await this.extract(file);
    const metadataChunks = extracted.metadata.chunks;
    if (Array.isArray(metadataChunks)) return metadataChunks as StructuredDocumentChunk[];
    return this.chunkTextByType(extracted.text, extension, file.id);
  }

  async renderable(file: ExtractableFile): Promise<RenderableDocument> {
    const extension = (file.extension || getExtension(file.name)).toLowerCase();

    if (extension === 'pdf' || file.mimeType?.toLowerCase().includes('pdf')) {
      const pages = await this.extractPdfPages(file);
      return {
        kind: 'pdf',
        fileId: file.id,
        fileName: file.name,
        pageCount: pages.length,
        pages,
        extractor: 'pdf-parse'
      };
    }

    if (extension === 'docx') {
      if (!file.storageKey) {
        return {
          kind: 'docx',
          fileId: file.id,
          fileName: file.name,
          chunks: [],
          extractor: 'empty',
          fallbackReason: 'DOCX source file has no storageKey'
        };
      }
      const filePath = LocalStorageService.getFilePath(file.storageKey);
      const converted = await mammoth.convertToHtml({ path: filePath });
      const structured = chunkDocxHtml(converted.value || '', file.id);
      return {
        kind: 'docx',
        fileId: file.id,
        fileName: file.name,
        chunks: structured.chunks,
        extractor: 'mammoth'
      };
    }

    const text = file.content && !file.isBinary
      ? file.content
      : file.storageKey
        ? await fs.readFile(LocalStorageService.getFilePath(file.storageKey), 'utf-8')
        : '';
    const chunks = this.chunkTextByType(text, extension, file.id);
    return {
      kind: extension === 'md' || extension === 'markdown' ? 'markdown' : CODE_EXTENSIONS.has(extension) ? 'code' : 'text',
      fileId: file.id,
      fileName: file.name,
      chunks,
      extractor: file.storageKey ? 'plain-text' : 'stored-text'
    };
  }

  chunkTextByType(text: string, extension?: string | null, fileId?: string): StructuredDocumentChunk[] {
    const normalizedExtension = (extension || '').toLowerCase();
    if (normalizedExtension === 'md' || normalizedExtension === 'markdown') return chunkMarkdown(text, fileId);
    if (CODE_EXTENSIONS.has(normalizedExtension)) return chunkCode(text, fileId);
    return chunkPlainText(text, fileId);
  }

  private normalizePdfPages(pages: Array<{ num: number; text: string }>, fileId?: string): PdfPageText[] {
    let charCursor = 0;
    return pages.map((page) => {
      const text = (page.text || '').trim();
      const item = {
        fileId,
        page: page.num,
        text,
        charStart: charCursor,
        charEnd: charCursor + text.length
      };
      charCursor += text.length + 1;
      return item;
    });
  }

  private async readPdfInfo(buffer: Buffer) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      return await parser.getInfo().catch(() => null);
    } finally {
      await parser.destroy();
    }
  }
}

export const documentTextExtractionService = new DocumentTextExtractionService();

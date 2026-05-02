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

export class DocumentTextExtractionService {
  async extract(file: {
    name?: string | null;
    extension?: string | null;
    mimeType?: string | null;
    storageKey?: string | null;
    content?: string | null;
    isBinary?: boolean | null;
  }): Promise<ExtractedDocumentText> {
    const extension = (file.extension || getExtension(file.name)).toLowerCase();

    if (file.content && !file.isBinary) {
      return {
        text: file.content,
        extractor: 'stored-text',
        metadata: { extension }
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
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const [textResult, infoResult] = await Promise.all([
        parser.getText(),
        parser.getInfo().catch(() => null)
      ]);
      await parser.destroy();

      return {
        text: textResult.text || '',
        extractor: 'pdf-parse',
        metadata: {
          extension,
          pageCount: textResult.total,
          info: infoResult?.info || null
        }
      };
    }

    if (extension === 'docx') {
      const converted = await mammoth.convertToHtml({ path: filePath });

      return {
        text: stripHtml(converted.value || ''),
        extractor: 'mammoth',
        metadata: {
          extension,
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
      return {
        text: await fs.readFile(filePath, 'utf-8'),
        extractor: 'plain-text',
        metadata: { extension }
      };
    }

    throw new FileSystemError(
      415,
      `Text extraction is not available for ${path.extname(file.name || '').replace('.', '') || 'this file type'} yet`
    );
  }
}

export const documentTextExtractionService = new DocumentTextExtractionService();

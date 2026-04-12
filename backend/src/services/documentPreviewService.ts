import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import prisma from '../config/db';
import { FileSystemError } from '../types/fileSystem';
import { LocalStorageService } from './storage/localStorageService';
import { CloudConvertService } from './cloudConvertService';

const execFileAsync = promisify(execFile);
const PREVIEW_DIR = path.resolve(__dirname, '../../uploads/.previews');
const CONVERTIBLE_EXTENSIONS = new Set([
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ods',
  'ppt',
  'pptx',
  'odt',
  'odp'
]);
const PDF_EXTENSIONS = new Set(['pdf']);

export interface PreviewInfo {
  status: 'ready' | 'unavailable' | 'unsupported';
  previewKind: 'pdf' | 'document' | 'binary' | 'unknown';
  previewUrl?: string;
  sourceUrl?: string;
  message?: string;
}

const fileExists = async (targetPath: string) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const getExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() || '';

const findLibreOfficeBinary = async () => {
  const candidates = [
    process.env.SOFFICE_PATH,
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/Applications/OpenOffice.app/Contents/MacOS/soffice',
    'soffice',
    'libreoffice'
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (await fileExists(candidate)) return candidate;
      continue;
    }

    try {
      const { stdout } = await execFileAsync('which', [candidate]);
      const resolved = stdout.trim();
      if (resolved) return resolved;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
};

const ensurePreviewDir = async () => {
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
};

const getPreviewFilename = (storageKey: string, stamp: number, provider: string) =>
  `${storageKey}-${provider}-${stamp}.pdf`;

const getConfiguredPreviewProvider = async () => {
  if (CloudConvertService.isConfigured()) return 'cloudconvert';
  const localBinary = await findLibreOfficeBinary();
  if (localBinary) return 'local';
  return null;
};

export class DocumentPreviewService {
  static async getPreviewInfo(workspaceId: string, id: string): Promise<PreviewInfo> {
    const file = await prisma.fileSystemObject.findUnique({ where: { id, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Folders cannot be previewed');

    const extension = getExtension(file.name);
    const sourceUrl = `/api/files/workspace/${workspaceId}/download?id=${id}`;

    if (PDF_EXTENSIONS.has(extension) || file.mimeType?.toLowerCase().includes('pdf')) {
      return {
        status: 'ready',
        previewKind: 'pdf',
        previewUrl: `/api/files/workspace/${workspaceId}/preview?id=${id}`,
        sourceUrl
      };
    }

    if (CONVERTIBLE_EXTENSIONS.has(extension)) {
      const provider = await getConfiguredPreviewProvider();
      if (!provider) {
        return {
          status: 'unavailable',
          previewKind: 'document',
          sourceUrl,
          message:
            'This document needs a conversion service before it can be previewed as PDF. Configure CloudConvert or install LibreOffice on the server.'
        };
      }

      return {
        status: 'ready',
        previewKind: 'document',
        previewUrl: `/api/files/workspace/${workspaceId}/preview?id=${id}`,
        sourceUrl
      };
    }

    return {
      status: file.isBinary ? 'unsupported' : 'unavailable',
      previewKind: file.isBinary ? 'binary' : 'unknown',
      sourceUrl,
      message: file.isBinary
        ? 'Binary files are not available for inline preview in this editor.'
        : 'This file type does not have a dedicated preview mode yet.'
    };
  }

  static async resolvePreviewPath(workspaceId: string, id: string) {
    const file = await prisma.fileSystemObject.findUnique({ where: { id, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Folders cannot be previewed');

    const extension = getExtension(file.name);

    if (PDF_EXTENSIONS.has(extension) || file.mimeType?.toLowerCase().includes('pdf')) {
      if (!file.storageKey) {
        throw new FileSystemError(400, 'Preview is unavailable for this PDF file');
      }

      return {
        filePath: LocalStorageService.getFilePath(file.storageKey),
        downloadName: file.name
      };
    }

    if (!CONVERTIBLE_EXTENSIONS.has(extension)) {
      throw new FileSystemError(400, 'This file type does not support PDF preview');
    }

    if (!file.storageKey) {
      throw new FileSystemError(400, 'The source document is missing stored file data');
    }

    await ensurePreviewDir();

    const sourcePath = LocalStorageService.getFilePath(file.storageKey);
    const sourceStats = await fs.stat(sourcePath);
    const previewProvider = await getConfiguredPreviewProvider();
    if (!previewProvider) {
      throw new FileSystemError(
        503,
        'Document preview requires CloudConvert configuration or a local LibreOffice installation'
      );
    }

    const previewFilename = getPreviewFilename(
      file.storageKey,
      Math.floor(sourceStats.mtimeMs),
      previewProvider
    );
    const previewPath = path.join(PREVIEW_DIR, previewFilename);

    if (!(await fileExists(previewPath))) {
      try {
        if (previewProvider === 'cloudconvert') {
          const converted = await CloudConvertService.convertOfficeToPdf(sourcePath, file.name);
          await fs.writeFile(previewPath, converted.pdfBuffer);
        } else {
          const sofficeBinary = await findLibreOfficeBinary();
          if (!sofficeBinary) {
            throw new FileSystemError(503, 'LibreOffice/soffice is not installed on the server');
          }

          const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp1-preview-'));
          const inputCopyPath = path.join(tempDir, file.name);
          try {
            await fs.copyFile(sourcePath, inputCopyPath);
            await execFileAsync(
              sofficeBinary,
              ['--headless', '--convert-to', 'pdf', '--outdir', tempDir, inputCopyPath],
              { timeout: 60000 }
            );

            const convertedName = `${path.parse(file.name).name}.pdf`;
            const convertedPath = path.join(tempDir, convertedName);

            if (!(await fileExists(convertedPath))) {
              throw new FileSystemError(500, 'Office conversion finished without producing a PDF file');
            }

            await fs.copyFile(convertedPath, previewPath);
          } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
          }
        }
      } catch (error) {
        if (error instanceof FileSystemError) throw error;
        throw new FileSystemError(500, 'Failed to convert document to PDF preview');
      }
    }

    return {
      filePath: previewPath,
      downloadName: `${path.parse(file.name).name}.pdf`
    };
  }
}

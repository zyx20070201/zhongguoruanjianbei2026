import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createReadStream } from 'fs';

const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads');

// Ensure upload directory exists
const ensureUploadDir = async () => {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
};

// Initialize on load
ensureUploadDir().catch(console.error);

export class LocalStorageService {
  /**
   * Save an uploaded file from a temporary path to the final storage location
   */
  static async saveUploadedFile(tempFilePath: string): Promise<{ storageKey: string, size: number }> {
    const storageKey = crypto.randomBytes(16).toString('hex');
    const destPath = path.join(UPLOAD_DIR, storageKey);
    
    // Move the file from temp location (managed by multer) to our permanent storage
    await fs.rename(tempFilePath, destPath);
    const stats = await fs.stat(destPath);
    
    return { storageKey, size: stats.size };
  }

  /**
   * Save text content directly to disk
   */
  static async saveTextFile(content: string, existingStorageKey?: string): Promise<{ storageKey: string, size: number }> {
    const storageKey = existingStorageKey || crypto.randomBytes(16).toString('hex');
    const destPath = path.join(UPLOAD_DIR, storageKey);
    
    await fs.writeFile(destPath, content, 'utf-8');
    const stats = await fs.stat(destPath);
    
    return { storageKey, size: stats.size };
  }

  /**
   * Read text content from a stored file
   */
  static async readTextFile(storageKey: string): Promise<string> {
    const filePath = path.join(UPLOAD_DIR, storageKey);
    return await fs.readFile(filePath, 'utf-8');
  }

  /**
   * Delete a stored file
   */
  static async deleteFile(storageKey: string): Promise<void> {
    const filePath = path.join(UPLOAD_DIR, storageKey);
    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      // Ignore if file doesn't exist, log other errors
      if (error.code !== 'ENOENT') {
        console.error(`Failed to delete file ${storageKey}:`, error);
      }
    }
  }

  /**
   * Get an absolute path for a storage key (useful for sending files)
   */
  static getFilePath(storageKey: string): string {
    return path.join(UPLOAD_DIR, storageKey);
  }

  /**
   * Get a readable stream for a storage key
   */
  static getFileStream(storageKey: string) {
    const filePath = path.join(UPLOAD_DIR, storageKey);
    return createReadStream(filePath);
  }
}

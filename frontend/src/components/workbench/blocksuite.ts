import { AffineSchemas, MarkdownAdapter } from '@blocksuite/blocks';
import { createEmptyDoc } from '@blocksuite/presets';
import { DocCollection, Job, Schema, type Doc, type DocSnapshot } from '@blocksuite/store';
import { ResourceReference } from '../../types';

export type BlocksuiteMode = 'page' | 'edgeless';
export type BlocksuiteSnapshot = DocSnapshot;

function createCollection() {
  const schema = new Schema().register(AffineSchemas);
  const collection = new DocCollection({ schema });
  collection.meta.initialize();
  return collection;
}

function createDefaultDoc() {
  return createEmptyDoc().init();
}

export async function createBlocksuiteDoc(options: {
  snapshot?: BlocksuiteSnapshot | null;
  markdown?: string | null;
  title?: string | null;
}): Promise<Doc> {
  const { snapshot, markdown, title } = options;
  const applyTitle = (doc: Doc) => {
    const nextTitle = title?.trim();
    if (!nextTitle) return doc;

    doc.collection.meta.setDocMeta(doc.id, { title: nextTitle });

    const rootTitle = (doc.root as any)?.title;
    if (rootTitle && typeof rootTitle.toString === 'function' && rootTitle.toString() !== nextTitle) {
      if (typeof rootTitle.delete === 'function' && rootTitle.length > 0) {
        rootTitle.delete(0, rootTitle.length);
      }
      if (typeof rootTitle.insert === 'function') {
        rootTitle.insert(nextTitle, 0);
      }
    }

    return doc;
  };

  if (snapshot) {
    try {
      const collection = createCollection();
      const job = new Job({ collection });
      const doc = await job.snapshotToDoc(snapshot);

      if (doc) {
        return applyTitle(doc);
      }
    } catch (error) {
      console.error('Failed to restore BlockSuite snapshot:', error);
    }
  }

  if (markdown && markdown.trim()) {
    try {
      const collection = createCollection();
      const job = new Job({ collection });
      const adapter = new MarkdownAdapter(job);
      const doc = await adapter.toDoc({
        file: markdown,
        assets: job.assetsManager
      });

      if (doc) {
        return applyTitle(doc);
      }
    } catch (error) {
      console.error('Failed to import markdown into BlockSuite:', error);
    }
  }

  return applyTitle(createDefaultDoc());
}

export function serializeBlocksuiteSnapshot(doc: Doc): BlocksuiteSnapshot | null {
  try {
    const job = new Job({ collection: doc.collection });
    return job.docToSnapshot(doc) ?? null;
  } catch (error) {
    console.error('Failed to serialize BlockSuite snapshot:', error);
    return null;
  }
}

export async function serializeBlocksuiteMarkdown(doc: Doc): Promise<string> {
  try {
    const job = new Job({ collection: doc.collection });
    const snapshot = job.docToSnapshot(doc);

    if (!snapshot) {
      return '';
    }

    const adapter = new MarkdownAdapter(job);
    const result = await adapter.fromDocSnapshot({
      snapshot,
      assets: job.assetsManager
    });

    return result.file ?? '';
  } catch (error) {
    console.error('Failed to export BlockSuite markdown:', error);
    return '';
  }
}

const escapeCodeFence = (code: string) => code.replace(/```/g, '\\`\\`\\`');

export const getCodeBlockLanguage = (resource: ResourceReference | null | undefined) =>
  resource?.extension?.toLowerCase().replace(/^\./, '') ||
  resource?.name.split('.').pop()?.toLowerCase() ||
  'text';

export function createCodeBlockMarkdown(
  code: string,
  resource: ResourceReference | null | undefined
): string {
  const language = getCodeBlockLanguage(resource);
  const normalizedCode = String(code ?? '').replace(/\r\n/g, '\n');
  return `\`\`\`${language}\n${escapeCodeFence(normalizedCode)}\n\`\`\`\n`;
}

export function extractCodeFromBlocksuiteMarkdown(markdown: string): string {
  const normalized = String(markdown ?? '').trim();
  const exactFenceMatch = normalized.match(/^```[^\n]*\n([\s\S]*?)\n```$/);

  if (exactFenceMatch) {
    return exactFenceMatch[1].replace(/\\`\\`\\`/g, '```');
  }

  const firstFenceMatch = normalized.match(/```[^\n]*\n([\s\S]*?)\n```/);
  if (firstFenceMatch) {
    return firstFenceMatch[1].replace(/\\`\\`\\`/g, '```');
  }

  return markdown;
}

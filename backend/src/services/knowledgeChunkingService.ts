import prisma from '../config/db';

interface IndexFileInput {
  workspaceId: string;
  fileObjectId: string;
  content?: string | null;
  source?: string;
  purpose?: string;
  metadata?: Record<string, unknown>;
}

const MAX_CHUNK_LENGTH = 1400;
const MIN_CHUNK_LENGTH = 160;

const estimateTokens = (text: string) => Math.ceil(text.length / 2);

const splitText = (content: string) => {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= MAX_CHUNK_LENGTH) {
      current = next;
      continue;
    }

    if (current) chunks.push(current);

    if (paragraph.length <= MAX_CHUNK_LENGTH) {
      current = paragraph;
      continue;
    }

    for (let index = 0; index < paragraph.length; index += MAX_CHUNK_LENGTH) {
      chunks.push(paragraph.slice(index, index + MAX_CHUNK_LENGTH));
    }
    current = '';
  }

  if (current) chunks.push(current);

  return chunks.filter((chunk, index, all) => chunk.length >= MIN_CHUNK_LENGTH || all.length === 1 || index === all.length - 1);
};

const summarizeChunk = (text: string) => {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return (firstLine || text.slice(0, 120)).slice(0, 180);
};

export class KnowledgeChunkingService {
  async indexFile(input: IndexFileInput) {
    const chunks = splitText(input.content || '');

    await prisma.knowledgeChunk.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId
      }
    });

    if (chunks.length === 0) return [];

    return prisma.$transaction(
      chunks.map((chunk, index) =>
        prisma.knowledgeChunk.create({
          data: {
            workspaceId: input.workspaceId,
            fileObjectId: input.fileObjectId,
            chunkIndex: index,
            text: chunk,
            summary: summarizeChunk(chunk),
            tokenEstimate: estimateTokens(chunk),
            metadataJson: JSON.stringify({
              source: input.source || 'workspace-file',
              purpose: input.purpose || 'grounding',
              ...(input.metadata || {})
            })
          }
        })
      )
    );
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

export const knowledgeChunkingService = new KnowledgeChunkingService();

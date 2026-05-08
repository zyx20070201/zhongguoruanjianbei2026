import crypto from 'crypto';
import prisma from '../config/db';
import { buildLearnerMemoryKey } from './learnerMemoryKeys';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export interface SavedMemoryItem {
  id: string;
  memoryKey: string;
  text: string;
  category: string;
  source: string;
  confidence: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const clip = (value: string | null | undefined, maxLength = 360) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const normalizeMemoryText = (value: string) =>
  value
    .replace(/^请你?记住[:：,，\s]*/i, '')
    .replace(/^记住[:：,，\s]*/i, '')
    .replace(/^以后(?:都|请|回答时)?[:：,，\s]*/i, '以后')
    .replace(/\s+/g, ' ')
    .trim();

const explicitMemoryText = (message: string) => {
  const text = message.trim();
  const direct = text.match(/(?:请你?|帮我)?记住(?:一下)?[：:\s]*(.+)$/i);
  if (direct?.[1]) return normalizeMemoryText(direct[1]);
  const preference = text.match(/(?:以后|之后|接下来|从现在开始).{0,12}(?:都|请|回答时|讲解时)?(.{4,160})/i);
  if (/以后|之后|接下来|从现在开始/.test(text) && /我(?:更|比较)?喜欢|我偏好|不要再|请始终|总是|默认/.test(text)) {
    return normalizeMemoryText(preference?.[0] || text);
  }
  if (/我(?:更|比较)?喜欢|我偏好/.test(text) && /记住|以后|默认|始终/.test(text)) return normalizeMemoryText(text);
  return '';
};

const categorize = (text: string) => {
  if (/喜欢|偏好|prefer|例子|代码|简洁|详细|不要|默认/.test(text)) return 'preference';
  if (/正在|项目|使用|环境|系统|课程|专业/.test(text)) return 'background';
  return 'note';
};

const toSavedMemory = (row: any): SavedMemoryItem => ({
  id: String(row.id),
  memoryKey: String(row.memoryKey),
  text: String(row.text),
  category: String(row.category || 'note'),
  source: String(row.source || 'explicit_user_request'),
  confidence: Number(row.confidence ?? 0.9),
  status: String(row.status || 'active'),
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export class SavedMemoryService {
  async list(input: { workspaceId: string; limit?: number; includeDeleted?: boolean }) {
    const rows = await prisma.savedMemory.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.includeDeleted ? {} : { status: 'active' })
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(input.limit || 20, 1), 80)
    });
    return rows.map(toSavedMemory);
  }

  async promptContext(input: { workspaceId: string; limit?: number }) {
    const memories = await this.list(input);
    if (!memories.length) return 'Saved memories: none.';
    return [
      'Saved memories:',
      ...memories.slice(0, input.limit || 8).map((memory) => `- ${memory.text}`)
    ].join('\n');
  }

  async maybeCaptureExplicitMemory(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId: string;
    messages: ChatMessage[];
    createdFromMessageId?: string | null;
  }) {
    const userMessage = [...input.messages].reverse().find((message) => message.role === 'user' && message.content.trim());
    if (!userMessage) return null;
    const text = clip(explicitMemoryText(userMessage.content), 320);
    if (!text || text.length < 4) return null;
    return this.upsert({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      userId: input.userId,
      text,
      category: categorize(text),
      source: 'explicit_user_request',
      confidence: 0.95,
      createdFromMessageId: input.createdFromMessageId || null
    });
  }

  async upsert(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId: string;
    text: string;
    category?: string;
    source?: string;
    confidence?: number;
    createdFromMessageId?: string | null;
  }) {
    const text = clip(input.text, 360);
    const memoryKey = buildLearnerMemoryKey(input.category || categorize(text), text);
    const memory = await prisma.savedMemory.upsert({
      where: {
        workspaceId_memoryKey: {
          workspaceId: input.workspaceId,
          memoryKey
        }
      },
      create: {
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        userId: input.userId,
        memoryKey,
        text,
        category: input.category || categorize(text),
        source: input.source || 'explicit_user_request',
        confidence: input.confidence ?? 0.9,
        status: 'active',
        createdFromMessageId: input.createdFromMessageId || null
      },
      update: {
        text,
        category: input.category || categorize(text),
        source: input.source || 'explicit_user_request',
        confidence: input.confidence ?? 0.9,
        status: 'active',
        workbenchId: input.workbenchId || null
      }
    });
    return toSavedMemory(memory);
  }

  async delete(input: { workspaceId: string; memoryKey: string }) {
    await prisma.savedMemory.updateMany({
      where: { workspaceId: input.workspaceId, memoryKey: input.memoryKey },
      data: { status: 'deleted' }
    });
  }

  async update(input: { workspaceId: string; memoryKey: string; text: string; category?: string }) {
    const text = clip(input.text, 360);
    const row = await prisma.savedMemory.findFirst({
      where: { workspaceId: input.workspaceId, memoryKey: input.memoryKey }
    });
    if (!row) throw new Error('Saved memory not found');
    const updated = await prisma.savedMemory.update({
      where: { id: row.id },
      data: {
        text,
        category: input.category || categorize(text),
        status: 'active'
      }
    });
    return toSavedMemory(updated);
  }

  async restore(input: { workspaceId: string; memoryKey: string }) {
    const row = await prisma.savedMemory.findFirst({
      where: { workspaceId: input.workspaceId, memoryKey: input.memoryKey }
    });
    if (!row) throw new Error('Saved memory not found');
    const updated = await prisma.savedMemory.update({
      where: { id: row.id },
      data: { status: 'active' }
    });
    return toSavedMemory(updated);
  }
}

export const savedMemoryService = new SavedMemoryService();

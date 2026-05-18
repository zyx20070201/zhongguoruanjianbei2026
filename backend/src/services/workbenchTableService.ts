import prisma from '../config/db';
import { aiModelProviderService } from './aiModelProviderService';
import { findWorkbenchResourceFiles } from './workbenchResourceScope';

const DEFAULT_PROPERTIES = [
  { name: '主题', type: 'text', source: 'system', orderIndex: 0, widthPx: 220 },
  { name: '状态', type: 'status', source: 'custom', orderIndex: 1, widthPx: 160, options: ['进行中', '待整理', '已完成'] },
  { name: '最近活动', type: 'date', source: 'system', orderIndex: 2, widthPx: 160 },
  { name: '内容', type: 'text', source: 'system', orderIndex: 3, widthPx: 180 }
];

const parseJson = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const serializeValue = (value: unknown) => JSON.stringify(value ?? null);

const normalizeOptions = (options: unknown) => {
  if (!Array.isArray(options)) return [];
  return [...new Set(
    options
      .filter((option): option is string => typeof option === 'string')
      .map((option) => option.trim())
      .filter(Boolean)
  )].slice(0, 80);
};

export class WorkbenchTableService {
  async ensureDefaults(workspaceId: string) {
    for (const property of DEFAULT_PROPERTIES) {
      await prisma.workbenchTableProperty.upsert({
        where: { workspaceId_name: { workspaceId, name: property.name } },
        create: {
          workspaceId,
          name: property.name,
          type: property.type,
          source: property.source,
          visible: true,
          orderIndex: property.orderIndex,
          widthPx: property.widthPx,
          optionsJson: JSON.stringify(property.options || [])
        },
        update: {
          type: property.type,
          source: property.source
        }
      });
    }
  }

  async getConfig(workspaceId: string) {
    await this.ensureDefaults(workspaceId);
    const [properties, values] = await Promise.all([
      prisma.workbenchTableProperty.findMany({
        where: { workspaceId },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }]
      }),
      prisma.workbenchTablePropertyValue.findMany({ where: { workspaceId } })
    ]);

    return {
      properties: properties.map((property) => ({
        id: property.id,
        name: property.name,
        type: property.type,
        source: property.source,
        visible: property.visible,
        orderIndex: property.orderIndex,
        widthPx: property.widthPx,
        options: parseJson(property.optionsJson) || []
      })),
      values: values.reduce<Record<string, Record<string, unknown>>>((acc, value) => {
        acc[value.workbenchId] = acc[value.workbenchId] || {};
        acc[value.workbenchId][value.propertyId] = parseJson(value.valueJson);
        return acc;
      }, {})
    };
  }

  async createProperty(input: {
    workspaceId: string;
    name: string;
    type: string;
    options?: string[];
    widthPx?: number;
  }) {
    const existing = await prisma.workbenchTableProperty.findUnique({
      where: { workspaceId_name: { workspaceId: input.workspaceId, name: input.name } }
    });
    if (existing) return existing;

    const count = await prisma.workbenchTableProperty.count({ where: { workspaceId: input.workspaceId } });
    const property = await prisma.workbenchTableProperty.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        type: input.type,
        source: 'custom',
        visible: true,
        orderIndex: count,
        widthPx: Number.isFinite(input.widthPx) ? Math.max(120, Math.min(520, Math.round(input.widthPx || 220))) : 220,
        optionsJson: JSON.stringify(normalizeOptions(input.options))
      }
    });

    return property;
  }

  async updateProperty(input: {
    workspaceId: string;
    propertyId: string;
    name?: string;
    type?: string;
    visible?: boolean;
    orderIndex?: number;
    widthPx?: number;
    options?: string[];
  }) {
    const property = await prisma.workbenchTableProperty.findFirst({
      where: { id: input.propertyId, workspaceId: input.workspaceId }
    });
    if (!property) return null;

    const data: Record<string, unknown> = {};
    if (typeof input.name === 'string' && input.name.trim()) {
      data.name = input.name.trim();
    }
    if (typeof input.type === 'string' && input.type.trim()) {
      data.type = input.type.trim();
    }
    if (typeof input.visible === 'boolean') {
      data.visible = input.visible;
    }
    if (typeof input.orderIndex === 'number' && Number.isFinite(input.orderIndex)) {
      data.orderIndex = Math.max(0, Math.round(input.orderIndex));
    }
    if (typeof input.widthPx === 'number' && Number.isFinite(input.widthPx)) {
      data.widthPx = Math.max(120, Math.min(520, Math.round(input.widthPx)));
    }
    if (Array.isArray(input.options)) {
      data.optionsJson = JSON.stringify(normalizeOptions(input.options));
    }

    if (Object.keys(data).length === 0) return property;

    return prisma.workbenchTableProperty.update({
      where: { id: input.propertyId },
      data
    });
  }

  async deleteProperty(input: {
    workspaceId: string;
    propertyId: string;
  }) {
    const property = await prisma.workbenchTableProperty.findFirst({
      where: { id: input.propertyId, workspaceId: input.workspaceId }
    });
    if (!property) return false;
    if (property.source === 'system') {
      throw new Error('System properties cannot be deleted');
    }

    await prisma.workbenchTableProperty.delete({ where: { id: input.propertyId } });
    return true;
  }

  async setValue(input: {
    workspaceId: string;
    workbenchId: string;
    propertyId: string;
    value: unknown;
  }) {
    return prisma.workbenchTablePropertyValue.upsert({
      where: { workbenchId_propertyId: { workbenchId: input.workbenchId, propertyId: input.propertyId } },
      create: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId,
        propertyId: input.propertyId,
        valueJson: serializeValue(input.value)
      },
      update: {
        valueJson: serializeValue(input.value)
      }
    });
  }

  async generateSummary(input: {
    workspaceId: string;
    workbenchId: string;
    propertyId: string;
  }) {
    const [workbench, property, recentEvents, recentTraces, recentMessages, resources] = await Promise.all([
      prisma.workbench.findUnique({ where: { id: input.workbenchId } }),
      prisma.workbenchTableProperty.findUnique({ where: { id: input.propertyId } }),
      prisma.learningEvent.findMany({
        where: { workspaceId: input.workspaceId, workbenchId: input.workbenchId },
        orderBy: { createdAt: 'desc' },
        take: 5
      }),
      prisma.learningTrace.findMany({
        where: { workspaceId: input.workspaceId, workbenchId: input.workbenchId },
        orderBy: { updatedAt: 'desc' },
        take: 5
      }),
      prisma.conversationMessage.findMany({
        where: { workspaceId: input.workspaceId, workbenchId: input.workbenchId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { role: true, content: true }
      }),
      findWorkbenchResourceFiles({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId,
        take: 6,
        select: { name: true, path: true, content: true }
      })
    ]);

    if (!workbench || !property) {
      throw new Error('Workbench or property not found');
    }

    const fallback = [
      workbench.description || workbench.title,
      recentTraces[0]?.summary,
      resources[0]?.name ? `相关资料：${resources.map((resource) => resource.name).slice(0, 3).join('、')}` : ''
    ].filter(Boolean).join('；').slice(0, 160) || workbench.title;

    let value = fallback;
    if (aiModelProviderService.isConfigured({ useCase: 'table' })) {
      try {
        const response = await aiModelProviderService.chat([
          {
            role: 'user',
            content: [
              '请为这个学习现场生成一句学生可读的简短总结，18-36 个中文字，不要使用系统、agent、signals、confidence 等内部词。',
              `学习现场标题：${workbench.title}`,
              workbench.description ? `描述：${workbench.description}` : '',
              recentTraces.length ? `近期学习记录：${recentTraces.map((trace) => trace.summary).join('；')}` : '',
              recentMessages.length ? `最近对话：${recentMessages.reverse().map((message) => `${message.role}: ${message.content.slice(0, 220)}`).join('\n')}` : '',
              recentEvents.length ? `近期事件：${recentEvents.map((event) => event.eventType).join('、')}` : '',
              resources.length ? `相关资料：${resources.map((resource) => `${resource.name} ${resource.content?.slice(0, 180) || ''}`).join('\n')}` : ''
            ].filter(Boolean).join('\n')
          }
        ], {
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId,
          workbenchTitle: workbench.title,
          workbenchDescription: workbench.description
        }, { timeoutMs: 20000, useCase: 'table' });
        value = response.reply.replace(/\s+/g, ' ').slice(0, 120);
      } catch (error) {
        console.warn('Workbench table AI summary fallback:', error);
      }
    }

    const saved = await this.setValue({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId,
      propertyId: input.propertyId,
      value
    });

    return { value: parseJson(saved.valueJson), saved };
  }
}

export const workbenchTableService = new WorkbenchTableService();

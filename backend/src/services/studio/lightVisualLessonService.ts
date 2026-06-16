import prisma from '../../config/db';
import { ContextCapsule } from '../../types/contextSystem';
import { aiModelProviderService } from '../aiModelProviderService';
import { documentTextExtractionService } from '../documentTextExtractionService';
import { FileSystemService } from '../fileSystemService';
import { normalizeStudioArtifact } from './artifactSchemas';
import { renderStudioArtifact } from './artifactRenderer';
import { StudioGenerateV2Input, StudioGenerateV2Result, StudioGenerationContext, StudioResourceTemplate } from './types';

type ExplicitSource = {
  id: string;
  name: string;
  path: string;
  fileId?: string;
  content: string;
};

const clip = (value: unknown, maxLength = 1200) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const slug = (value: string) => {
  const raw = value
    .replace(/[\\/:*?"<>|#{}[\]`]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  return raw || 'lesson';
};

const videoAnalysisText = (file: any) => {
  try {
    const metadata = file.metadataJson ? JSON.parse(file.metadataJson) : {};
    const analysis = metadata.videoAnalysis && typeof metadata.videoAnalysis === 'object' ? metadata.videoAnalysis : null;
    if (!analysis) return '';
    const transcript = Array.isArray(analysis.transcript)
      ? analysis.transcript.map((item: any) => `[${item.start ?? ''}] ${item.text || item.content || ''}`).join('\n')
      : '';
    const chapters = Array.isArray(analysis.chapters)
      ? analysis.chapters.map((item: any) => `${item.title || ''}\n${item.summary || ''}`).join('\n\n')
      : '';
    const keyPoints = Array.isArray(analysis.keyPoints)
      ? analysis.keyPoints.map((item: any) => `${item.concept || item.title || ''}: ${item.explanation || item.summary || ''}`).join('\n')
      : '';
    return [analysis.title ? `Title: ${analysis.title}` : '', analysis.summary || '', chapters, keyPoints, transcript]
      .filter(Boolean)
      .join('\n\n');
  } catch {
    return '';
  }
};

const readExplicitSourceText = async (workspaceId: string, file: any) => {
  const videoText = videoAnalysisText(file);
  if (videoText.trim()) return videoText;
  try {
    return await FileSystemService.getFileContent(workspaceId, file.id);
  } catch {
    const extracted = await documentTextExtractionService.extract(file).catch(() => null);
    return extracted?.text || '';
  }
};

const explicitSelectedSources = async (workspaceId: string, selectedResourceIds: unknown[] = []): Promise<ExplicitSource[]> => {
  const ids = [...new Set(selectedResourceIds.filter((value): value is string => typeof value === 'string' && Boolean(value)))];
  if (!ids.length) return [];
  const files = await prisma.fileSystemObject.findMany({
    where: { workspaceId, id: { in: ids }, nodeType: 'file' }
  });
  const byId = new Map(files.map((file) => [file.id, file] as const));
  return Promise.all(ids.map(async (id, index) => {
    const file = byId.get(id);
    if (!file) return { id, name: `Selected source ${index + 1}`, path: '', content: '' };
    const content = await readExplicitSourceText(workspaceId, file);
    return {
      id: file.id,
      name: file.name,
      path: file.path,
      fileId: file.id,
      content: String(content || '').trim()
    };
  }));
};

const sourcesBlock = (sources: ExplicitSource[]) =>
  sources.length
    ? sources.map((source, index) => [
        `## Source ${index + 1}: ${source.name}`,
        `SourceId: ${source.id}`,
        source.path ? `Path: ${source.path}` : '',
        '',
        source.content || '(empty source text)'
      ].filter(Boolean).join('\n')).join('\n\n---\n\n')
    : '(no selected source text)';

const markdownPrompt = (userPrompt: string, sources: ExplicitSource[]) => [
  '你是一名擅长课堂讲解的教师。',
  '请只基于用户要求和显式选中的资料，写一份正常 Markdown 讲稿。',
  '不要输出 JSON，不要输出 schema，不要写实现计划。',
  '讲稿要有层次、有小节、有自然段，适合后续切成 PPT slide。',
  '每个小节最好只讲一个核心点。',
  '',
  `用户要求：${userPrompt || '生成一套轻量可视化讲解。'}`,
  '',
  '# 显式选中文件',
  sourcesBlock(sources)
].join('\n');

const lessonSchema = {
  type: 'object',
  required: ['title', 'slides'],
  properties: {
    title: { type: 'string' },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        required: ['header', 'description'],
        properties: {
          header: { type: 'string' },
          description: { type: 'string' },
          timeline: {
            type: 'array',
            items: {
              type: 'object',
              required: ['kind', 'content'],
              properties: {
                kind: { type: 'string', enum: ['text', 'visual'] },
                content: { type: 'string' },
                visualIndex: { type: 'number' }
              }
            }
          },
          visuals: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type', 'content'],
              properties: {
                type: { type: 'string', enum: ['diagram', 'chart', 'table', 'formula', 'code', 'image_hint', 'sketch'] },
                content: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
};

const lessonPrompt = [
  '你负责把 Markdown 讲稿切分成极简的课件式可视化讲解 JSON。',
  '输出必须是纯 JSON，不要 Markdown，不要代码块，不要解释。',
  '顶层只有 title 和 slides。',
  '每个 slide 核心字段只有 header 和 description，其中 description 必须保留该页的完整正文，不要压缩、不要删段、不要只写摘要。',
  'timeline 是可选字段，只作为展开节奏和讲解顺序提示，不要替代 description，也不要把 description 改写成更短的版本。',
  'visuals 是可选字段。只有确实需要图解时才生成，不要为了有图而强行生成。',
  'visuals.type 可选 diagram、chart、table、formula、code、image_hint、sketch：diagram/code 优先写 Mermaid DSL；chart/table 可写 ECharts option JSON；sketch/image_hint 写适合 Excalidraw 的草图意图。',
  'visuals.content 保持短小稳定：可以是 Mermaid DSL、ECharts option JSON，或一段草图说明；不要生成坐标密集的复杂对象树。',
  '不要生成坐标、颜色、动画 easing、对象树、renderer、targetIds 或状态 patch。',
  '每一页只讲一个核心点，避免把多个主题塞进同一页。'
].join('\n');

const fallbackLessonFromMarkdown = (title: string, markdownDraft: string) => {
  const chunks = markdownDraft
    .split(/\n(?=##?\s+)/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .slice(0, 12);
  const source = chunks.length ? chunks : [markdownDraft || title];
  return {
    title,
    slides: source.map((chunk, index) => {
      const header = chunk.match(/^#{1,3}\s+(.+)$/m)?.[1] || (index === 0 ? title : `第 ${index + 1} 页`);
      const description = chunk.replace(/^#{1,3}\s+.+$/m, '').trim() || chunk;
      const sentences = description
        .split(/(?<=[。！？.!?])\s+|\n+/)
        .map((item) => item.replace(/^[-*]\s+/, '').trim())
        .filter(Boolean)
        .slice(0, 5);
      return {
        header: clip(header, 120),
        description,
        timeline: (sentences.length ? sentences : [description || header]).map((content) => ({
          kind: 'text',
          content: clip(content, 1000)
        })),
        visuals: []
      };
    })
  };
};

const emptyReview = (): StudioGenerateV2Result['review'] => ({
  score: 1,
  warnings: [],
  checks: [],
  metrics: {
    grounding: 1,
    schema: 1,
    personalization: 1,
    pedagogicalFit: 1,
    usability: 1
  },
  passed: true,
  summary: 'Light Visual Lesson direct generation skips AI Studio V2 review.'
});

export class LightVisualLessonService {
  async generate(input: StudioGenerateV2Input, template: StudioResourceTemplate): Promise<StudioGenerateV2Result> {
    const startedAt = Date.now();
    const runId = `light-visual-lesson-${Date.now()}`;
    const selectedSources = await explicitSelectedSources(input.workspaceId, input.context.selectedResourceIds || []);
    const selectedSourceIds = selectedSources.map((source) => source.id);
    const selectedSourceChars = selectedSources.reduce((sum, source) => sum + source.content.length, 0);
    const citations = selectedSources.map((source) => ({
      sourceId: source.id,
      fileId: source.fileId || source.id,
      fileName: source.name,
      label: source.name,
      sourceType: 'pinned' as const,
      confidence: 'high' as const,
      preview: clip(source.content, 600)
    }));
    const capsule: ContextCapsule = {
      capsuleId: runId,
      userId: 'light-visual-lesson',
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || undefined,
      mode: 'workbench',
      resources: selectedSources.map((source) => ({
        fileId: source.fileId || source.id,
        fileName: source.name,
        filePath: source.path || undefined,
        type: 'generated',
        summary: clip(source.content, 300),
        tokenCount: Math.ceil(source.content.length / 4),
        indexed: false
      })),
      retrievedChunks: [],
      visualEvidence: [],
      tokenBudget: selectedSourceChars,
      estimatedTokens: Math.ceil(selectedSourceChars / 4),
      estimatedTokensByLayer: { selected_sources: Math.ceil(selectedSourceChars / 4) },
      promptContextPreview: selectedSources.map((source) => `## ${source.name}\n${clip(source.content, 1000)}`).join('\n\n---\n\n'),
      buildTrace: [],
      fallbackReasons: [],
      clippedItems: [],
      citations,
      sourceMap: citations.map((citation) => ({ ...citation, includedInPrompt: true })),
      createdAt: new Date(startedAt).toISOString()
    };
    const contextPolicy = {
      includeSelection: false,
      includeViewport: false,
      includeActiveFileFullText: false,
      includeActiveFileSummary: false,
      ragScope: 'none' as const,
      includeResourceSummaries: false,
      maxRetrievedChunks: 0,
      intent: 'general_qa' as const,
      reasons: ['Light Visual Lesson uses only the user prompt and explicitly selected files.']
    };
    const contextShell = {
      input,
      template,
      runId,
      goalId: null,
      capsule,
      contextPolicy,
      trace: []
    } as StudioGenerationContext;

    const markdownResponse = await aiModelProviderService.chat(
      [{ role: 'user', content: markdownPrompt(input.prompt || '', selectedSources) }],
      undefined,
      {
        useCase: 'studio',
        timeoutMs: Number(process.env.STUDIO_MODEL_TIMEOUT_MS || 240000),
        systemPrompt: '你是一个严谨的中文课堂讲稿生成器，只基于显式资料和用户要求写 Markdown。'
      }
    );
    const markdownDraft = markdownResponse.reply.trim();
    let lessonPayload: any;
    let lessonModel = markdownResponse.model;
    let lessonProvider = markdownResponse.provider;
    let lessonUsage: unknown = markdownResponse.usage;

    try {
      const lessonResponse = await aiModelProviderService.json<Record<string, unknown>>({
        instruction: lessonPrompt,
        schema: lessonSchema,
        input: {
          userPrompt: input.prompt || '',
          markdownDraft,
          selectedSources: selectedSources.map((source, index) => ({
            index: index + 1,
            id: source.id,
            name: source.name,
            path: source.path,
            textPreview: clip(source.content, 2000)
          }))
        },
        useCase: 'studio',
        timeoutMs: Number(process.env.STUDIO_MODEL_TIMEOUT_MS || 240000),
        systemPrompt: '你是一个极简课件 JSON 切分器。'
      });
      lessonPayload = lessonResponse.data;
      lessonModel = lessonResponse.model;
      lessonProvider = lessonResponse.provider;
      lessonUsage = lessonResponse.usage;
    } catch (error) {
      lessonPayload = fallbackLessonFromMarkdown(input.prompt || template.title, markdownDraft);
    }

    const rawContent = JSON.stringify({
      ...lessonPayload,
      markdownDraft
    }, null, 2);
    const structured = normalizeStudioArtifact(contextShell, rawContent);
    const content = renderStudioArtifact(structured);
    const metadata = {
      model: lessonModel,
      usage: lessonUsage,
      selectedResourceIds: selectedSourceIds,
      selectedSourceCount: selectedSources.length,
      selectedSourceChars,
      markdownDraftModel: markdownResponse.model,
      markdownDraftProvider: markdownResponse.provider,
      lightVisualLessonGeneration: {
        schemaVersion: 'light_visual_lesson.generation.v1',
        strategy: 'markdown_then_slide_timeline',
        sourceScope: 'selected_resources_only',
        visualMode: 'mock',
        provider: lessonProvider,
        model: lessonModel,
        durationMs: Date.now() - startedAt
      }
    };
    const file = await FileSystemService.saveGeneratedContent({
      workspaceId: input.workspaceId,
      targetDir: 'Generated',
      filename: `light-visual-lesson-${slug(input.prompt || template.title)}.json`,
      category: 'generated',
      mimeType: 'application/json',
      isBinary: false,
      workbenchId: input.workbenchId || undefined,
      resourceRole: 'generated',
      resourceType: 'generated',
      scope: input.workbenchId ? 'workbench' : 'workspace',
      origin: 'ai',
      metadata: {
        generator: 'light-visual-lesson',
        templateId: template.id,
        goal: template.goal,
        generatorKind: template.generator,
        renderer: template.renderer,
        source: `${lessonProvider}-light-visual-lesson`,
        studioMetadata: metadata
      },
      content: rawContent
    });

    return {
      file,
      content,
      template,
      goal: input.goal || template.goal,
      generator: template.generator,
      renderer: template.renderer,
      runId,
      source: `${lessonProvider}-light-visual-lesson`,
      metadata,
      contextCapsule: capsule,
      contextPolicy,
      usedContextSummary: {
        mode: capsule.mode,
        selection: false,
        viewport: false,
        activeFile: null,
        resources: selectedSources.length,
        retrievedChunks: 0,
        estimatedTokens: capsule.estimatedTokens,
        citations: citations.map((citation) => citation.label)
      },
      workflowTrace: [],
      review: emptyReview(),
      qualityReport: null,
      practiceNext: null,
      recommendation: null,
      structured,
      artifact: null,
      renderJob: null,
      delivery: {
        kind: 'markdown',
        filename: file.name,
        mimeType: 'application/json',
        fileObjectId: file.id,
        path: file.path,
        previewContent: rawContent
      }
    };
  }
}

export const lightVisualLessonService = new LightVisualLessonService();

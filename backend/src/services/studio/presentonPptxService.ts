import prisma from '../../config/db';
import { ContextCapsule } from '../../types/contextSystem';
import { documentTextExtractionService } from '../documentTextExtractionService';
import { FileSystemService } from '../fileSystemService';
import { StudioGenerateV2Input, StudioGenerateV2Result, StudioResourceTemplate } from './types';

type ExplicitSource = {
  id: string;
  name: string;
  path: string;
  fileId?: string;
  content: string;
};

type PresentonGenerateResponse = {
  presentation_id?: string;
  path?: string;
  edit_path?: string;
  [key: string]: unknown;
};

const pptxMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const clip = (value: unknown, maxLength = 24000) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const slug = (value: string) => {
  const raw = value
    .replace(/[\\/:*?"<>|#{}[\]`]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return raw || 'presenton-presentation';
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const joinUrl = (baseUrl: string, pathOrUrl: string) => {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${normalizeBaseUrl(baseUrl)}/${pathOrUrl.replace(/^\/+/, '')}`;
};

const presentonHeaders = () => {
  const username = process.env.PRESENTON_USERNAME || process.env.PRESENTON_BASIC_USERNAME || process.env.AUTH_USERNAME || '';
  const password = process.env.PRESENTON_PASSWORD || process.env.PRESENTON_BASIC_PASSWORD || process.env.AUTH_PASSWORD || '';
  const token = process.env.PRESENTON_API_KEY || process.env.PRESENTON_AUTH_TOKEN || '';
  const headers: Record<string, string> = {};
  if (username || password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

const presentonAuthConfigured = () =>
  Boolean(
    (process.env.PRESENTON_USERNAME || process.env.PRESENTON_BASIC_USERNAME || process.env.AUTH_USERNAME) ||
    (process.env.PRESENTON_PASSWORD || process.env.PRESENTON_BASIC_PASSWORD || process.env.AUTH_PASSWORD) ||
    process.env.PRESENTON_API_KEY ||
    process.env.PRESENTON_AUTH_TOKEN
  );

const presentonResponseError = async (response: Response, baseUrl: string, phase: 'generation' | 'download') => {
  const errorText = await response.text().catch(() => '');
  const server = response.headers.get('server') || '';
  const contentType = response.headers.get('content-type') || '';
  const details = clip(errorText, 800) || response.statusText;

  if (/airtunes|airplay/i.test(server)) {
    return [
      `Presenton ${phase} reached macOS AirPlay/AirTunes at ${baseUrl}, not Presenton.`,
      'Port 5000 is often occupied by AirPlay Receiver on macOS.',
      'Start Presenton on another port, for example docker -p 5050:80, then set PRESENTON_BASE_URL=http://localhost:5050.'
    ].join(' ');
  }

  if ((response.status === 401 || response.status === 403) && !presentonAuthConfigured()) {
    return [
      `Presenton ${phase} was rejected with ${response.status}.`,
      'Presenton /api/v1 routes require HTTP Basic auth.',
      'Set PRESENTON_USERNAME and PRESENTON_PASSWORD to the Presenton web UI/admin credentials, then restart the backend.'
    ].join(' ');
  }

  if (response.status === 401 || response.status === 403) {
    return [
      `Presenton ${phase} was rejected with ${response.status}.`,
      'Check PRESENTON_USERNAME/PRESENTON_PASSWORD and PRESENTON_BASE_URL.',
      details
    ].filter(Boolean).join(' ');
  }

  return [
    `Presenton ${phase} failed (${response.status}).`,
    contentType ? `Content-Type: ${contentType}.` : '',
    details
  ].filter(Boolean).join(' ');
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
        source.path ? `Path: ${source.path}` : '',
        '',
        clip(source.content || '(empty source text)', 16000)
      ].filter(Boolean).join('\n')).join('\n\n---\n\n')
    : '';

const buildPresentonContent = (prompt: string, sources: ExplicitSource[]) => [
  prompt.trim() || '生成一份适合课堂讲解的 PPT。',
  sources.length ? '\n# Selected source material\n' : '',
  sourcesBlock(sources)
].filter(Boolean).join('\n\n');

const buildPresentonInstructions = (prompt: string, sources: ExplicitSource[]) => [
  '请生成一份中文课堂讲解型 PPTX。',
  '结构要像教师上课用的课件：标题清晰、每页只讲一个重点、内容按概念引入、步骤展开、例子/注意点收束。',
  '如果提供了 selected source material，请优先基于这些资料，不要编造来源没有支持的细节。',
  '保留足够讲解细节，避免只输出空泛标题。',
  '视觉风格要求干净、可读、适合课程汇报或课堂展示。',
  prompt.trim() ? `用户要求：${prompt.trim()}` : '',
  sources.length ? `已选择 ${sources.length} 个资料作为输入。` : ''
].filter(Boolean).join('\n');

const numberOption = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const stringOption = (value: unknown, fallback: string) => {
  const text = String(value || '').trim();
  return text || fallback;
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
  summary: 'Presenton PPTX generation skips AI Studio V2 prompt and review.'
});

const contextCapsuleFor = (input: StudioGenerateV2Input, runId: string, sources: ExplicitSource[]): ContextCapsule => {
  const citations = sources.map((source) => ({
    sourceId: source.id,
    fileId: source.fileId || source.id,
    fileName: source.name,
    label: source.name,
    sourceType: 'pinned' as const,
    confidence: 'high' as const,
    preview: clip(source.content, 600)
  }));
  const sourceChars = sources.reduce((sum, source) => sum + source.content.length, 0);
  return {
    capsuleId: runId,
    userId: 'presenton-pptx',
    workspaceId: input.workspaceId,
    workbenchId: input.workbenchId || undefined,
    mode: 'workbench',
    resources: sources.map((source) => ({
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
    tokenBudget: sourceChars,
    estimatedTokens: Math.ceil(sourceChars / 4),
    estimatedTokensByLayer: { selected_sources: Math.ceil(sourceChars / 4) },
    promptContextPreview: sources.map((source) => `## ${source.name}\n${clip(source.content, 1000)}`).join('\n\n---\n\n'),
    buildTrace: [],
    fallbackReasons: [],
    clippedItems: [],
    citations,
    sourceMap: citations.map((citation) => ({
      ...citation,
      includedInPrompt: true
    })),
    createdAt: new Date().toISOString()
  };
};

const contextPolicy = () => ({
  includeSelection: false,
  includeViewport: false,
  includeActiveFileFullText: false,
  includeActiveFileSummary: false,
  ragScope: 'none' as const,
  includeResourceSummaries: false,
  maxRetrievedChunks: 0,
  intent: 'general_qa' as const,
  reasons: ['Presenton PPTX uses only the user prompt and explicitly selected resources.']
});

export class PresentonPptxService {
  async generate(input: StudioGenerateV2Input, template: StudioResourceTemplate): Promise<StudioGenerateV2Result> {
    const startedAt = Date.now();
    const runId = `presenton-pptx-${Date.now()}`;
    const baseUrl = normalizeBaseUrl(process.env.PRESENTON_BASE_URL || 'http://localhost:5000');
    const selectedIds = input.options?.selectedResourceIds || input.context.selectedResourceIds || [];
    const sources = await explicitSelectedSources(input.workspaceId, Array.isArray(selectedIds) ? selectedIds : []);
    const nSlides = numberOption(input.options?.nSlides || input.options?.slideCount, 8);
    const language = stringOption(input.options?.language, 'Chinese');
    const presentonTemplate = stringOption(input.options?.presentonTemplate || input.options?.template, 'general');
    const content = buildPresentonContent(input.prompt || '', sources);
    const instructions = buildPresentonInstructions(input.prompt || '', sources);

    const generateResponse = await fetch(joinUrl(baseUrl, '/api/v1/ppt/presentation/generate'), {
      method: 'POST',
      headers: {
        ...presentonHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: clip(content, Number(process.env.PRESENTON_CONTENT_MAX_CHARS || 60000)),
        instructions,
        n_slides: nSlides,
        language,
        template: presentonTemplate,
        export_as: 'pptx'
      })
    });

    if (!generateResponse.ok) {
      throw new Error(await presentonResponseError(generateResponse, baseUrl, 'generation'));
    }

    const presenton = await generateResponse.json() as PresentonGenerateResponse;
    const outputPath = typeof presenton.path === 'string' ? presenton.path : '';
    if (!outputPath) {
      throw new Error('Presenton generation response did not include a PPTX path.');
    }

    const downloadResponse = await fetch(joinUrl(baseUrl, outputPath), {
      method: 'GET',
      headers: presentonHeaders()
    });
    if (!downloadResponse.ok) {
      throw new Error(await presentonResponseError(downloadResponse, baseUrl, 'download'));
    }

    const pptxBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    const filename = `${slug(input.prompt || template.title)}.pptx`;
    const previewContent = [
      `# ${input.prompt || template.title}`,
      '',
      'Generated by Presenton.',
      '',
      `- Slides: ${nSlides}`,
      `- Language: ${language}`,
      `- Template: ${presentonTemplate}`,
      `- Selected sources: ${sources.length}`,
      presenton.presentation_id ? `- Presenton presentation id: ${presenton.presentation_id}` : '',
      presenton.edit_path ? `- Edit URL: ${joinUrl(baseUrl, String(presenton.edit_path))}` : ''
    ].filter(Boolean).join('\n');

    const file = await FileSystemService.saveGeneratedContent({
      workspaceId: input.workspaceId,
      targetDir: 'Generated',
      filename,
      category: 'generated',
      mimeType: pptxMime,
      isBinary: true,
      workbenchId: input.workbenchId || undefined,
      resourceRole: 'generated',
      resourceType: 'generated',
      scope: input.workbenchId ? 'workbench' : 'workspace',
      origin: 'ai',
      metadata: {
        generator: 'presenton',
        templateId: template.id,
        goal: template.goal,
        generatorKind: template.generator,
        renderer: template.renderer,
        deliveryKind: 'pptx',
        visualFramework: 'Presenton',
        presenton: {
          baseUrl,
          presentationId: presenton.presentation_id || null,
          path: presenton.path || null,
          editPath: presenton.edit_path || null
        },
        selectedResourceIds: sources.map((source) => source.id),
        durationMs: Date.now() - startedAt
      },
      content: pptxBuffer
    });

    const capsule = contextCapsuleFor(input, runId, sources);
    const policy = contextPolicy();

    return {
      file,
      content: previewContent,
      template,
      goal: input.goal || template.goal,
      generator: template.generator,
      renderer: template.renderer,
      runId,
      source: 'presenton',
      metadata: {
        provider: 'presenton',
        durationMs: Date.now() - startedAt,
        selectedResourceIds: sources.map((source) => source.id),
        selectedSourceCount: sources.length,
        presenton
      },
      contextCapsule: capsule,
      contextPolicy: policy,
      usedContextSummary: {
        mode: capsule.mode,
        selection: false,
        viewport: false,
        activeFile: null,
        resources: sources.length,
        retrievedChunks: 0,
        estimatedTokens: capsule.estimatedTokens,
        citations: capsule.citations.map((citation) => citation.label)
      },
      workflowTrace: [],
      review: emptyReview(),
      qualityReport: null,
      practiceNext: null,
      recommendation: null,
      structured: null,
      artifact: null,
      renderJob: null,
      delivery: {
        kind: 'pptx',
        filename: file.name,
        mimeType: pptxMime,
        fileObjectId: file.id,
        path: file.path,
        framework: 'Presenton',
        previewContent
      }
    };
  }
}

export const presentonPptxService = new PresentonPptxService();

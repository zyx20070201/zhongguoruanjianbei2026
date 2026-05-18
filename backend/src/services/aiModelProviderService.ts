import { deepseekService } from './deepseekService';
import { ChatSessionAttachmentContext, VisualEvidenceItem } from '../types/contextSystem';

type ChatRole = 'system' | 'user' | 'assistant';

export interface ProviderChatMessage {
  role: ChatRole;
  content: string;
}

export type AiModelProviderId = 'deepseek' | 'openai' | 'gemini' | 'claude';
export type AiProviderUseCase =
  | 'chat'
  | 'studio'
  | 'memory'
  | 'planner'
  | 'learning'
  | 'flashcard'
  | 'quiz'
  | 'resource'
  | 'video'
  | 'table'
  | 'health'
  | 'default';

export interface ProviderChatOptions {
  provider?: AiModelProviderId;
  useCase?: AiProviderUseCase;
  model?: string;
  timeoutMs?: number;
  attachments?: ChatSessionAttachmentContext[];
  visualEvidence?: VisualEvidenceItem[];
  systemPrompt?: string;
}

export interface ProviderChatResult {
  reply: string;
  model: string;
  provider: AiModelProviderId;
  usage?: Record<string, unknown> | null;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_PROVIDER_TIMEOUT_MS || 60000);
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_SYSTEM_PROMPT = [
  '你是一个集成在学习工作台中的 AI 学习助手。',
  '默认使用简体中文回答，表达清晰、务实、鼓励式。',
  '如果用户提供了 Chat 附件、选区、当前文件或资料片段，请优先结合这些显式上下文回答。',
  '如果上下文不足，请明确指出还缺什么信息。'
].join('\n');

const clip = (value: string | undefined, maxLength = 12000) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n\n[Content truncated]` : text;
};

const normalizeProvider = (value?: string | null): AiModelProviderId | null => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'openai' || normalized === 'gemini' || normalized === 'claude' || normalized === 'deepseek') return normalized;
  return null;
};

const useCaseEnvKey = (useCase: AiProviderUseCase, suffix: 'PROVIDER' | 'MODEL') =>
  `AI_${useCase.toUpperCase()}_${suffix}`;

const configuredProvider = (useCase: AiProviderUseCase = 'chat'): AiModelProviderId => {
  const value =
    normalizeProvider(process.env[useCaseEnvKey(useCase, 'PROVIDER')]) ||
    normalizeProvider(process.env.AI_DEFAULT_PROVIDER) ||
    normalizeProvider(process.env.AI_CHAT_PROVIDER) ||
    normalizeProvider(process.env.MULTIMODAL_PROVIDER) ||
    'openai';
  if (value === 'openai' || value === 'gemini' || value === 'claude' || value === 'deepseek') return value;
  return 'openai';
};

const attachmentTextProjection = (attachments: ChatSessionAttachmentContext[] = []) =>
  attachments
    .map((attachment) =>
      [
        `Chat attachment: ${attachment.name}`,
        `MIME: ${attachment.mimeType}`,
        `Kind: ${attachment.kind}`,
        `Size: ${attachment.size} bytes`,
        attachment.textContent ? `Text content:\n${clip(attachment.textContent)}` : '',
        !attachment.textContent && attachment.kind === 'image'
          ? 'Image payload is available only for multimodal providers. Text-only providers can see this metadata only.'
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');

const visualEvidenceTextProjection = (items: VisualEvidenceItem[] = []) =>
  items
    .map((item, index) =>
      [
        `Visual evidence [V${index + 1}]: ${item.title}`,
        `Kind: ${item.kind}`,
        `Source: ${item.fileName}`,
        item.locator ? `Locator: ${JSON.stringify(item.locator)}` : '',
        item.textDescription ? `Description:\n${clip(item.textDescription)}` : '',
        item.ocrText ? `OCR:\n${clip(item.ocrText)}` : '',
        item.nearbyText ? `Nearby text:\n${clip(item.nearbyText)}` : ''
      ].filter(Boolean).join('\n')
    )
    .join('\n\n');

const dataUrlForAttachment = (attachment: ChatSessionAttachmentContext) => {
  if (attachment.dataUrl?.startsWith('data:')) return attachment.dataUrl;
  if (attachment.base64Data && attachment.mimeType) return `data:${attachment.mimeType};base64,${attachment.base64Data}`;
  return '';
};

const dataUrlForVisualEvidence = (item: VisualEvidenceItem) => {
  if (item.dataUrl?.startsWith('data:')) return item.dataUrl;
  if (item.imageUrl?.startsWith('data:')) return item.imageUrl;
  return '';
};

const base64PartsFromDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  return match ? { mimeType: match[1], data: match[2] } : null;
};

const base64ForAttachment = (attachment: ChatSessionAttachmentContext) => {
  if (attachment.base64Data) return attachment.base64Data;
  const match = attachment.dataUrl?.match(/^data:[^;]+;base64,(.+)$/);
  return match?.[1] || '';
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const providerBaseUrl = (provider: AiModelProviderId) => {
  if (provider === 'openai') return trimTrailingSlash(process.env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL);
  if (provider === 'gemini') return trimTrailingSlash(process.env.GEMINI_BASE_URL?.trim() || process.env.GOOGLE_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL);
  if (provider === 'claude') return trimTrailingSlash(process.env.ANTHROPIC_BASE_URL?.trim() || process.env.CLAUDE_BASE_URL?.trim() || DEFAULT_CLAUDE_BASE_URL);
  return '';
};

const openaiApiMode = () => {
  const value = String(process.env.OPENAI_API_MODE || '').trim().toLowerCase();
  return value === 'chat_completions' || value === 'chat-completions' || value === 'chat' ? 'chat_completions' : 'responses';
};

class AiModelProviderService {
  provider(options?: ProviderChatOptions): AiModelProviderId {
    return options?.provider || configuredProvider(options?.useCase || 'chat');
  }

  model(provider: AiModelProviderId, explicit?: string, useCase: AiProviderUseCase = 'chat') {
    if (explicit) return explicit;
    const useCaseModel = process.env[useCaseEnvKey(useCase, 'MODEL')]?.trim();
    if (useCaseModel) return useCaseModel;
    const defaultModel = process.env.AI_DEFAULT_MODEL?.trim();
    if (defaultModel) return defaultModel;
    if (provider === 'openai') return process.env.OPENAI_MODEL || 'gpt-5.4';
    if (provider === 'gemini') return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (provider === 'claude') return process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
    return process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  }

  isConfigured(options?: ProviderChatOptions) {
    const provider = this.provider(options);
    if (provider === 'openai') return Boolean(process.env.OPENAI_API_KEY?.trim());
    if (provider === 'gemini') return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim());
    if (provider === 'claude') return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim());
    return deepseekService.isConfigured();
  }

  private normalizeOptions(contextOrOptions?: ProviderChatOptions | Record<string, any>, maybeOptions?: ProviderChatOptions): ProviderChatOptions {
    const looksLikeOptions =
      contextOrOptions &&
      typeof contextOrOptions === 'object' &&
      ('provider' in contextOrOptions ||
        'useCase' in contextOrOptions ||
        'model' in contextOrOptions ||
        'timeoutMs' in contextOrOptions ||
        'attachments' in contextOrOptions ||
        'visualEvidence' in contextOrOptions ||
        'systemPrompt' in contextOrOptions);
    return looksLikeOptions ? { ...(contextOrOptions as ProviderChatOptions), ...(maybeOptions || {}) } : (maybeOptions || {});
  }

  async chat(
    messages: ProviderChatMessage[],
    contextOrOptions?: ProviderChatOptions | Record<string, any>,
    maybeOptions?: ProviderChatOptions
  ): Promise<ProviderChatResult> {
    const options = this.normalizeOptions(contextOrOptions, maybeOptions);
    const provider = this.provider(options);
    if (provider === 'openai') return this.openai(messages, options);
    if (provider === 'gemini') return this.gemini(messages, options);
    if (provider === 'claude') return this.claude(messages, options);
    const projection = [attachmentTextProjection(options.attachments), visualEvidenceTextProjection(options.visualEvidence)]
      .filter(Boolean)
      .join('\n\n');
    const projectedMessages = projection
      ? messages.map((message, index) =>
          index === messages.length - 1 && message.role === 'user'
            ? { ...message, content: `${message.content}\n\n${projection}` }
            : message
        )
      : messages;
    const result = await deepseekService.chat(projectedMessages as any, undefined, { timeoutMs: options.timeoutMs });
    return { reply: result.reply, model: result.model, provider: 'deepseek', usage: result.usage as any };
  }

  async *chatStream(
    messages: ProviderChatMessage[],
    contextOrOptions?: ProviderChatOptions | Record<string, any>,
    maybeOptions?: ProviderChatOptions
  ): AsyncGenerator<string> {
    const options = this.normalizeOptions(contextOrOptions, maybeOptions);
    const provider = this.provider(options);
    if (provider === 'deepseek') {
      const projection = [attachmentTextProjection(options.attachments), visualEvidenceTextProjection(options.visualEvidence)]
        .filter(Boolean)
        .join('\n\n');
      const projectedMessages = projection
        ? messages.map((message, index) =>
            index === messages.length - 1 && message.role === 'user'
              ? { ...message, content: `${message.content}\n\n${projection}` }
              : message
          )
        : messages;
      for await (const delta of deepseekService.chatStream(projectedMessages as any, undefined, { timeoutMs: options.timeoutMs })) {
        yield delta;
      }
      return;
    }

    const result = await this.chat(messages, options);
    yield result.reply;
  }

  async json<T>(params: {
    instruction: string;
    schema: Record<string, unknown>;
    input: Record<string, unknown>;
    context?: Record<string, any>;
    timeoutMs?: number;
    provider?: AiModelProviderId;
    useCase?: AiProviderUseCase;
    model?: string;
    systemPrompt?: string;
  }): Promise<{ data: T; model: string; provider: AiModelProviderId; usage: Record<string, unknown> | null | undefined }> {
    const response = await this.chat(
      [
        {
          role: 'user',
          content: [
            params.instruction,
            '你必须只输出一个 JSON 对象，不要输出 Markdown，不要输出解释文字。',
            `JSON schema hint: ${JSON.stringify(params.schema)}`,
            `Input: ${JSON.stringify(params.input)}`
          ].join('\n\n')
        }
      ],
      {
      provider: params.provider,
      useCase: params.useCase,
      model: params.model,
      timeoutMs: params.timeoutMs,
      visualEvidence: params.context?.visualEvidence as VisualEvidenceItem[] | undefined,
      systemPrompt: params.systemPrompt
    }
  );

    return {
      data: extractJsonObject(response.reply) as T,
      model: response.model,
      provider: response.provider,
      usage: response.usage
    };
  }

  async health(options: ProviderChatOptions = {}) {
    const provider = this.provider({ ...options, useCase: options.useCase || 'health' });
    const model = this.model(provider, options.model, options.useCase || 'health');
    if (!this.isConfigured({ ...options, provider })) {
      return { ok: false, configured: false, provider, model, error: `${provider} API key is not configured` };
    }
    const startedAt = Date.now();
    try {
      const result = await this.chat([{ role: 'user', content: 'Reply with OK.' }], {
        ...options,
        provider,
        model,
        timeoutMs: options.timeoutMs || 10000
      });
      return {
        ok: Boolean(result.reply),
        configured: true,
        provider,
        model: result.model,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        ok: false,
        configured: true,
        provider,
        model,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async openai(messages: ProviderChatMessage[], options: ProviderChatOptions): Promise<ProviderChatResult> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    const model = this.model('openai', options.model, options.useCase || 'chat');
    const input = messages.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: this.openaiContentParts(message, options.attachments, options.visualEvidence)
    }));

    const baseUrl = providerBaseUrl('openai');
    if (openaiApiMode() === 'chat_completions') {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          messages: this.openaiChatCompletionMessages(messages, options),
          temperature: 0.4
        })
      });
      const data = await response.json().catch(() => null) as any;
      if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed with status ${response.status}`);
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('OpenAI returned an empty response');
      return { reply, model, provider: 'openai', usage: data?.usage || null };
    }

    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        instructions: options.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        input
      })
    });
    const data = await response.json().catch(() => null) as any;
    if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed with status ${response.status}`);
    const reply =
      data?.output_text ||
      data?.output?.flatMap((item: any) => item?.content || []).map((part: any) => part?.text || '').join('').trim();
    if (!reply) throw new Error('OpenAI returned an empty response');
    return { reply, model, provider: 'openai', usage: data?.usage || null };
  }

  private openaiChatCompletionMessages(messages: ProviderChatMessage[], options: ProviderChatOptions) {
    const projectedMessages = messages.map((message, index) => {
      const projection = index === messages.length - 1 && message.role === 'user'
        ? [attachmentTextProjection(options.attachments), visualEvidenceTextProjection(options.visualEvidence)].filter(Boolean).join('\n\n')
        : '';
      return {
        role: message.role,
        content: projection ? `${message.content}\n\n${projection}` : message.content
      };
    });
    return [
      {
        role: 'system',
        content: options.systemPrompt || DEFAULT_SYSTEM_PROMPT
      },
      ...projectedMessages
    ];
  }

  private openaiContentParts(message: ProviderChatMessage, attachments: ChatSessionAttachmentContext[] = [], visualEvidence: VisualEvidenceItem[] = []) {
    const parts: any[] = [{ type: 'input_text', text: message.content }];
    if (message.role !== 'user') return [{ type: 'output_text', text: message.content }];
    attachments.forEach((attachment) => {
      if (attachment.kind === 'image') {
        const imageUrl = dataUrlForAttachment(attachment);
        if (imageUrl) parts.push({ type: 'input_image', image_url: imageUrl });
      } else if (attachment.textContent) {
        parts.push({ type: 'input_text', text: `Attachment ${attachment.name}:\n${clip(attachment.textContent)}` });
      }
    });
    visualEvidence.forEach((item) => {
      const imageUrl = dataUrlForVisualEvidence(item);
      if (imageUrl) {
        parts.push({ type: 'input_image', image_url: imageUrl });
      } else {
        parts.push({
          type: 'input_text',
          text: [
            `Visual evidence ${item.title}:`,
            item.textDescription || '',
            item.ocrText ? `OCR:\n${clip(item.ocrText)}` : '',
            item.nearbyText ? `Nearby text:\n${clip(item.nearbyText)}` : ''
          ].filter(Boolean).join('\n')
        });
      }
    });
    return parts;
  }

  private async gemini(messages: ProviderChatMessage[], options: ProviderChatOptions): Promise<ProviderChatResult> {
    const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
    const model = this.model('gemini', options.model, options.useCase || 'chat');
    const contents = messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: this.geminiParts(message, options.attachments, options.visualEvidence)
    }));
    const baseUrl = providerBaseUrl('gemini');
    const response = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.systemPrompt || DEFAULT_SYSTEM_PROMPT }] },
        contents
      })
    });
    const data = await response.json().catch(() => null) as any;
    if (!response.ok) throw new Error(data?.error?.message || `Gemini request failed with status ${response.status}`);
    const reply = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('').trim();
    if (!reply) throw new Error('Gemini returned an empty response');
    return { reply, model, provider: 'gemini', usage: data?.usageMetadata || null };
  }

  private geminiParts(message: ProviderChatMessage, attachments: ChatSessionAttachmentContext[] = [], visualEvidence: VisualEvidenceItem[] = []) {
    const parts: any[] = [{ text: message.content }];
    if (message.role !== 'user') return parts;
    attachments.forEach((attachment) => {
      if (attachment.kind === 'image') {
        const data = base64ForAttachment(attachment);
        if (data) parts.push({ inline_data: { mime_type: attachment.mimeType, data } });
      } else if (attachment.textContent) {
        parts.push({ text: `Attachment ${attachment.name}:\n${clip(attachment.textContent)}` });
      }
    });
    visualEvidence.forEach((item) => {
      const imageUrl = dataUrlForVisualEvidence(item);
      if (imageUrl) {
        const base64 = base64PartsFromDataUrl(imageUrl);
        if (base64) parts.push({ inline_data: { mime_type: base64.mimeType, data: base64.data } });
      } else {
        parts.push({
          text: [
            `Visual evidence ${item.title}:`,
            item.textDescription || '',
            item.ocrText ? `OCR:\n${clip(item.ocrText)}` : '',
            item.nearbyText ? `Nearby text:\n${clip(item.nearbyText)}` : ''
          ].filter(Boolean).join('\n')
        });
      }
    });
    return parts;
  }

  private async claude(messages: ProviderChatMessage[], options: ProviderChatOptions): Promise<ProviderChatResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    const model = this.model('claude', options.model, options.useCase || 'chat');
    const baseUrl = providerBaseUrl('claude');
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      signal: AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_tokens: Number(process.env.CLAUDE_MAX_TOKENS || 4096),
        system: options.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        messages: messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: this.claudeContentParts(message, options.attachments, options.visualEvidence)
          }))
      })
    });
    const data = await response.json().catch(() => null) as any;
    if (!response.ok) throw new Error(data?.error?.message || `Claude request failed with status ${response.status}`);
    const reply = data?.content?.map((part: any) => part.text || '').join('').trim();
    if (!reply) throw new Error('Claude returned an empty response');
    return { reply, model, provider: 'claude', usage: data?.usage || null };
  }

  private claudeContentParts(message: ProviderChatMessage, attachments: ChatSessionAttachmentContext[] = [], visualEvidence: VisualEvidenceItem[] = []) {
    const parts: any[] = [{ type: 'text', text: message.content }];
    if (message.role !== 'user') return parts;
    attachments.forEach((attachment) => {
      if (attachment.kind === 'image') {
        const data = base64ForAttachment(attachment);
        if (data) {
          parts.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType,
              data
            }
          });
        }
      } else if (attachment.textContent) {
        parts.push({ type: 'text', text: `Attachment ${attachment.name}:\n${clip(attachment.textContent)}` });
      }
    });
    visualEvidence.forEach((item) => {
      const imageUrl = dataUrlForVisualEvidence(item);
      if (imageUrl) {
        const base64 = base64PartsFromDataUrl(imageUrl);
        if (base64) {
          parts.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: base64.mimeType,
              data: base64.data
            }
          });
          return;
        }
      }
      parts.push({
        type: 'text',
        text: [
          `Visual evidence ${item.title}:`,
          item.textDescription || '',
          item.ocrText ? `OCR:\n${clip(item.ocrText)}` : '',
          item.nearbyText ? `Nearby text:\n${clip(item.nearbyText)}` : ''
        ].filter(Boolean).join('\n')
      });
    });
    return parts;
  }
}

const extractJsonObject = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || value;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('No JSON object found in model response');
  }

  return JSON.parse(raw.slice(start, end + 1));
};

export const aiModelProviderService = new AiModelProviderService();

type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AiChatContext {
  workspaceId?: string;
  workbenchId?: string;
  workbenchTitle?: string;
  workbenchDescription?: string;
  activeFile?: {
    id?: string;
    name?: string;
    path?: string;
    content?: string;
  } | null;
  activeExternal?: {
    title?: string;
    url?: string;
    description?: string;
  } | null;
  learningContext?: {
    goal?: {
      title: string;
      goalText: string;
      skills: string[];
      weaknesses: string[];
    } | null;
    traces?: Array<{ summary: string; nextActions: string[] }>;
    knowledge?: Array<{ fileName: string; path: string; summary?: string | null; chunkText: string }>;
  };
}

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

interface DeepSeekStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const MAX_MESSAGE_COUNT = 20;
const MAX_FILE_CONTENT_LENGTH = 6000;
const REQUEST_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS || 60000);

const timeoutSignal = (timeoutMs?: number, fallbackMs = REQUEST_TIMEOUT_MS) => {
  const ms = timeoutMs === undefined || timeoutMs === null ? fallbackMs : Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return AbortSignal.timeout(ms);
};

const clipText = (value: string | undefined, maxLength: number) => {
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n\n[Content truncated]` : value;
};

const buildSystemPrompt = (context?: AiChatContext) => {
  const lines = [
    '你是一个集成在学习工作台中的 AI 学习助手。',
    '默认使用简体中文回答，表达清晰、务实、鼓励式。',
    '当前场景以数据结构与算法学习为主，请优先提供定义、思路、步骤、复杂度分析、代码示例和练习建议。',
    '如果用户给出了文件内容或外部资料，请优先结合这些上下文回答。',
    '如果上下文不足，请明确指出还缺什么信息。',
    '回答尽量结构化，但不要过度冗长。'
  ];

  if (context?.workbenchTitle) {
    lines.push(`当前工作台: ${context.workbenchTitle}`);
  }

  if (context?.workbenchDescription) {
    lines.push(`工作台描述: ${context.workbenchDescription}`);
  }

  if (context?.activeFile?.path || context?.activeFile?.name) {
    lines.push(`当前文件: ${context.activeFile.name || '未命名文件'} (${context.activeFile.path || '未知路径'})`);
  }

  if (context?.activeFile?.content) {
    lines.push('当前文件内容如下:');
    lines.push(clipText(context.activeFile.content, MAX_FILE_CONTENT_LENGTH));
  }

  if (context?.activeExternal?.title || context?.activeExternal?.url) {
    lines.push(
      `当前外部资料: ${context.activeExternal?.title || '未命名资料'}${context.activeExternal?.url ? ` (${context.activeExternal.url})` : ''}`
    );
  }

  if (context?.activeExternal?.description) {
    lines.push(`外部资料说明: ${context.activeExternal.description}`);
  }

  if (context?.learningContext?.goal) {
    lines.push('当前学习目标:');
    lines.push(`标题: ${context.learningContext.goal.title}`);
    lines.push(`目标: ${context.learningContext.goal.goalText}`);
    if (context.learningContext.goal.skills.length > 0) {
      lines.push(`技能拆解: ${context.learningContext.goal.skills.join('、')}`);
    }
    if (context.learningContext.goal.weaknesses.length > 0) {
      lines.push(`已知短板: ${context.learningContext.goal.weaknesses.join('；')}`);
    }
  }

  if (context?.learningContext?.traces?.length) {
    lines.push('近期学习记忆:');
    context.learningContext.traces.slice(0, 3).forEach((trace, index) => {
      lines.push(`${index + 1}. ${trace.summary}`);
      if (trace.nextActions.length > 0) {
        lines.push(`下一步: ${trace.nextActions.join('；')}`);
      }
    });
  }

  if (context?.learningContext?.knowledge?.length) {
    lines.push('可引用的相关资料片段:');
    context.learningContext.knowledge.slice(0, 5).forEach((item, index) => {
      lines.push(`[${index + 1}] ${item.fileName} (${item.path})`);
      lines.push(clipText(item.chunkText, 900));
    });
  }

  return lines.join('\n');
};

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

export class DeepSeekService {
  private get apiKey() {
    return process.env.DEEPSEEK_API_KEY?.trim() || '';
  }

  private get baseUrl() {
    return process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL;
  }

  private get model() {
    return process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async health() {
    if (!this.isConfigured()) {
      return { ok: false, configured: false, model: this.model, baseUrl: this.baseUrl, error: 'DEEPSEEK_API_KEY is not configured' };
    }
    const startedAt = Date.now();
    try {
      const result = await this.chat([{ role: 'user', content: 'Reply with OK.' }], undefined, { timeoutMs: 10000 });
      return {
        ok: Boolean(result.reply),
        configured: true,
        model: this.model,
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        ok: false,
        configured: true,
        model: this.model,
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async chat(messages: ChatMessage[], context?: AiChatContext, options?: { timeoutMs?: number }) {
    if (!this.isConfigured()) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }

    const normalizedMessages = messages
      .filter(
        (message): message is ChatMessage =>
          Boolean(message) &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0
      )
      .slice(-MAX_MESSAGE_COUNT)
      .map((message) => ({
        role: message.role,
        content: message.content.trim()
      }));

    if (normalizedMessages.length === 0) {
      throw new Error('At least one message is required');
    }

    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      signal: timeoutSignal(options?.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt(context)
          },
          ...normalizedMessages
        ],
        temperature: 0.4,
        stream: false
      })
    });

    const data = (await response.json().catch(() => null)) as DeepSeekChatResponse | null;

    if (!response.ok) {
      const message = data?.error?.message || `DeepSeek request failed with status ${response.status}`;
      throw new Error(message);
    }

    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('DeepSeek returned an empty response');
    }

    return {
      reply: content,
      model: this.model,
      usage: data?.usage ?? null
    };
  }

  async *chatStream(messages: ChatMessage[], context?: AiChatContext, options?: { timeoutMs?: number }): AsyncGenerator<string> {
    if (!this.isConfigured()) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }

    const normalizedMessages = messages
      .filter(
        (message): message is ChatMessage =>
          Boolean(message) &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0
      )
      .slice(-MAX_MESSAGE_COUNT)
      .map((message) => ({
        role: message.role,
        content: message.content.trim()
      }));

    if (normalizedMessages.length === 0) {
      throw new Error('At least one message is required');
    }

    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      signal: timeoutSignal(options?.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt(context)
          },
          ...normalizedMessages
        ],
        temperature: 0.4,
        stream: true
      })
    });

    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => null)) as DeepSeekChatResponse | null;
      const message = data?.error?.message || `DeepSeek request failed with status ${response.status}`;
      throw new Error(message);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;

        const payload = line.replace(/^data:\s*/, '');
        if (payload === '[DONE]') return;

        const data = JSON.parse(payload) as DeepSeekStreamChunk;
        if (data.error?.message) throw new Error(data.error.message);

        const content = data.choices?.[0]?.delta?.content;
        if (content) yield content;
      }
    }
  }

  async json<T>(params: {
    instruction: string;
    schema: Record<string, unknown>;
    input: Record<string, unknown>;
    context?: AiChatContext;
    timeoutMs?: number;
  }): Promise<{ data: T; model: string; usage: DeepSeekChatResponse['usage'] | null }> {
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
      params.context,
      { timeoutMs: params.timeoutMs }
    );

    return {
      data: extractJsonObject(response.reply) as T,
      model: response.model,
      usage: response.usage
    };
  }
}

export const deepseekService = new DeepSeekService();

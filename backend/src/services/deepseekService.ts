type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AiChatContext {
  workbenchTitle?: string;
  workbenchDescription?: string;
  activeFile?: {
    name?: string;
    path?: string;
    content?: string;
  } | null;
  activeExternal?: {
    title?: string;
    url?: string;
    description?: string;
  } | null;
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

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const MAX_MESSAGE_COUNT = 20;
const MAX_FILE_CONTENT_LENGTH = 6000;

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

  return lines.join('\n');
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

  async chat(messages: ChatMessage[], context?: AiChatContext) {
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
}

export const deepseekService = new DeepSeekService();

import client from '../api/client';

export interface AiChatMessage {
  role: 'user' | 'assistant';
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

export const aiApi = {
  chat: async (payload: {
    messages: AiChatMessage[];
    context?: AiChatContext;
  }): Promise<{ reply: string; model?: string; usage?: Record<string, unknown> | null }> => {
    const response = await client.post('/ai/chat', payload);
    return response.data;
  }
};

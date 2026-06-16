import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Message } from '../types';
import { useConfig } from './ConfigContext';
import { useSession } from './SessionContext';
import { callAPI } from '../utils/api';
import { parseResponse } from '../utils/parser';
import type { ParsedPart, PendingImage } from '../types';

interface ChatContextValue {
  loading: boolean;
  send: (
    text: string,
    images: PendingImage[],
    searchContext: string,
  ) => Promise<SendResult>;
}

export interface SendResult {
  parts: ParsedPart[];
  error?: string;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { base, key, model, fmt } = useConfig();
  const {
    currentSessionId,
    history,
    setHistory,
    newSession,
    saveCurrentSession,
  } = useSession();

  const [loading, setLoading] = useState(false);
  const historyRef = useRef(history);
  historyRef.current = history;

  const send = useCallback(
    async (
      text: string,
      images: PendingImage[],
      searchContext: string,
    ): Promise<SendResult> => {
      let sid = currentSessionId;
      // Auto-create session if needed
      if (!sid) {
        newSession();
        // The session state update is async; use a fresh id directly
        sid = Date.now().toString();
        const { sessions } = (() => {
          try {
            const d = localStorage.getItem('sb3_sessions');
            return { sessions: d ? JSON.parse(d) : [] };
          } catch {
            return { sessions: [] };
          }
        })();
      }

      // Build user message content
      let userContent: Message['content'];
      if (images.length > 0) {
        const blocks: Message['content'] = [];
        for (const img of images) {
          if (Array.isArray(blocks)) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.mediaType,
                data: img.base64,
              },
            });
          }
        }
        if (text && Array.isArray(blocks)) {
          blocks.push({ type: 'text', text });
        }
        userContent = blocks;
      } else {
        userContent = text;
      }

      const currentHistory = historyRef.current;
      const updatedHistory: Message[] = [
        ...currentHistory,
        { role: 'user', content: userContent },
      ];
      setHistory(updatedHistory);
      historyRef.current = updatedHistory;
      setLoading(true);

      try {
        const resp = await callAPI(
          { base, key, model, fmt, id: '', name: '' },
          updatedHistory,
          searchContext,
        );
        const parts = parseResponse(resp);
        const finalHistory: Message[] = [
          ...updatedHistory,
          { role: 'assistant', content: resp },
        ];
        setHistory(finalHistory);
        historyRef.current = finalHistory;
        // Auto-save after response
        saveCurrentSession(finalHistory);
        setLoading(false);
        return { parts };
      } catch (e) {
        setHistory(currentHistory);
        historyRef.current = currentHistory;
        setLoading(false);
        return {
          parts: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    [base, key, model, fmt, currentSessionId, newSession, setHistory, saveCurrentSession],
  );

  return (
    <ChatContext.Provider value={{ loading, send }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be inside ChatProvider');
  return ctx;
}

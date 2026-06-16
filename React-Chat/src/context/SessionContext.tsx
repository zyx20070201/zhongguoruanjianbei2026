import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import type { Message, Session } from '../types';

const SESSIONS_KEY = 'sb3_sessions';
const ACTIVE_SESSION_KEY = 'sb3_activeSession';

interface SessionContextValue {
  sessions: Session[];
  currentSessionId: string | null;
  history: Message[];
  setHistory: (h: Message[]) => void;
  newSession: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  saveCurrentSession: (hist: Message[]) => void;
  loadHistory: (hist: Message[]) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function getSessions(): Session[] {
  try {
    const d = localStorage.getItem(SESSIONS_KEY);
    return d ? JSON.parse(d) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      // silently fail — user will see error on next save attempt
    }
  }
}

function generateTitle(hist: Message[]): string {
  if (hist.length === 0) return '新对话';
  const firstUser = hist.find((m) => m.role === 'user');
  if (!firstUser) return '新对话';
  let text = '';
  if (typeof firstUser.content === 'string') {
    text = firstUser.content;
  } else if (Array.isArray(firstUser.content)) {
    text = firstUser.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ');
  }
  return text.slice(0, 40) || '新对话';
}

function compactHistory(hist: Message[]): Message[] {
  return hist.map((m) => {
    if (m.role === 'user' && Array.isArray(m.content)) {
      return {
        ...m,
        content: m.content.map((b) => {
          if (b.type === 'image') {
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: b.source.media_type,
                data: b.source.data.slice(0, 100) + '...',
              },
            };
          }
          return b;
        }),
      };
    }
    return m;
  });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>(getSessions);
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const active = localStorage.getItem(ACTIVE_SESSION_KEY);
    const all = getSessions();
    if (active && all.find((s) => s.id === active)) return active;
    if (all.length > 0) return all[0].id;
    return null;
  });
  const [history, setHistory] = useState<Message[]>(() => {
    const all = getSessions();
    const active = localStorage.getItem(ACTIVE_SESSION_KEY);
    const session = active
      ? all.find((s) => s.id === active)
      : all[0];
    return session?.history || [];
  });

  const persistActive = useCallback((id: string) => {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  }, []);

  const newSession = useCallback(() => {
    const session: Session = {
      id: Date.now().toString(),
      title: '新对话',
      updatedAt: Date.now(),
      history: [],
    };
    const updated = [session, ...sessions];
    setSessions(updated);
    saveSessions(updated);
    setCurrentId(session.id);
    persistActive(session.id);
    setHistory([]);
  }, [sessions, persistActive]);

  const switchSession = useCallback(
    (id: string) => {
      if (id === currentId) return;
      const session = sessions.find((s) => s.id === id);
      if (!session) return;
      setCurrentId(id);
      persistActive(id);
      setHistory(session.history || []);
    },
    [currentId, sessions, persistActive],
  );

  const deleteSession = useCallback(
    (id: string) => {
      const updated = sessions.filter((s) => s.id !== id);
      setSessions(updated);
      saveSessions(updated);
      if (id === currentId) {
        if (updated.length > 0) {
          setCurrentId(updated[0].id);
          persistActive(updated[0].id);
          setHistory(updated[0].history || []);
        } else {
          // Create a new one if none left
          const session: Session = {
            id: Date.now().toString(),
            title: '新对话',
            updatedAt: Date.now(),
            history: [],
          };
          setSessions([session]);
          saveSessions([session]);
          setCurrentId(session.id);
          persistActive(session.id);
          setHistory([]);
        }
      }
    },
    [currentId, sessions, persistActive],
  );

  const saveCurrentSession = useCallback(
    (hist: Message[]) => {
      if (!currentId) return;
      const idx = sessions.findIndex((s) => s.id === currentId);
      if (idx === -1) return;
      const updated = [...sessions];
      updated[idx] = {
        ...updated[idx],
        history: compactHistory(hist),
        title: generateTitle(hist),
        updatedAt: Date.now(),
      };
      setSessions(updated);
      saveSessions(updated);
    },
    [currentId, sessions],
  );

  const loadHistory = useCallback((hist: Message[]) => {
    setHistory(hist);
  }, []);

  return (
    <SessionContext.Provider
      value={{
        sessions,
        currentSessionId: currentId,
        history,
        setHistory,
        newSession,
        switchSession,
        deleteSession,
        saveCurrentSession,
        loadHistory,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be inside SessionProvider');
  return ctx;
}

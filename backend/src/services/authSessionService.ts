import crypto from 'crypto';

const DEFAULT_COOKIE_NAME = 'pp1_session';
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}

const secret = process.env.AUTH_SESSION_SECRET || 'pp1-dev-auth-secret';
const cookieName = process.env.AUTH_COOKIE_NAME || DEFAULT_COOKIE_NAME;
const ttlMs = Number(process.env.AUTH_SESSION_TTL_MS || DEFAULT_TTL_MS);

const sessions = new Map<string, SessionRecord>();

const sign = (value: string) =>
  crypto.createHmac('sha256', secret).update(value).digest('base64url');

const encodeCookieValue = (sessionId: string) => `${sessionId}.${sign(sessionId)}`;

const decodeCookieValue = (cookieValue: string | undefined) => {
  if (!cookieValue) return null;

  const [sessionId, signature] = cookieValue.split('.');
  if (!sessionId || !signature) return null;
  if (sign(sessionId) !== signature) return null;
  return sessionId;
};

const cleanupExpiredSessions = () => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(sessionId);
    }
  }
};

setInterval(cleanupExpiredSessions, Math.max(60_000, Math.min(ttlMs, 10 * 60_000))).unref?.();

export const authSessionConfig = {
  cookieName,
  ttlMs,
  isSecureCookie: String(process.env.NODE_ENV || '').toLowerCase() === 'production'
};

export const authSessionService = {
  create(userId: string) {
    cleanupExpiredSessions();

    const now = Date.now();
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      userId,
      createdAt: now,
      expiresAt: now + ttlMs
    };

    sessions.set(session.id, session);
    return session;
  },

  resolve(cookieValue: string | undefined) {
    cleanupExpiredSessions();

    const sessionId = decodeCookieValue(cookieValue);
    if (!sessionId) return null;

    const session = sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return null;
    }

    return session;
  },

  destroy(cookieValue: string | undefined) {
    const sessionId = decodeCookieValue(cookieValue);
    if (!sessionId) return false;
    return sessions.delete(sessionId);
  },

  destroyUserSessions(userId: string) {
    for (const [sessionId, session] of sessions.entries()) {
      if (session.userId === userId) {
        sessions.delete(sessionId);
      }
    }
  },

  buildCookieValue(sessionId: string) {
    return encodeCookieValue(sessionId);
  }
};

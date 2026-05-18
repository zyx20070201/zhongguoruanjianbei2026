import { NextFunction, Request, Response } from 'express';
import prisma from '../config/db';
import { authSessionConfig, authSessionService } from '../services/authSessionService';

const cookiePairSeparator = ';';

const parseCookies = (cookieHeader: string | undefined) =>
  Object.fromEntries(
    (cookieHeader || '')
      .split(cookiePairSeparator)
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const index = pair.indexOf('=');
        if (index <= 0) return [pair, ''];
        return [pair.slice(0, index).trim(), decodeURIComponent(pair.slice(index + 1))];
      })
  );

const getCookieValue = (req: Request, name: string) => parseCookies(req.headers.cookie)[name];

export const getAuthCookieValue = (req: Request) => getCookieValue(req, authSessionConfig.cookieName);

const buildSetCookie = (value: string | null, expiresAt?: number) => {
  const parts = [`${authSessionConfig.cookieName}=${value ? encodeURIComponent(value) : ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];

  if (authSessionConfig.isSecureCookie) parts.push('Secure');
  if (typeof expiresAt === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}`);
  if (!value) parts.push('Max-Age=0');

  return parts.join('; ');
};

export const setAuthCookie = (res: Response, sessionId: string, expiresAt: number) => {
  const cookieValue = authSessionService.buildCookieValue(sessionId);
  res.setHeader('Set-Cookie', buildSetCookie(cookieValue, expiresAt));
};

export const clearAuthCookie = (res: Response) => {
  res.setHeader('Set-Cookie', buildSetCookie(null));
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const session = authSessionService.resolve(getAuthCookieValue(req));
  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, username: true, email: true }
  });

  if (!user) {
    authSessionService.destroy(getAuthCookieValue(req));
    return res.status(401).json({ error: 'Authentication required' });
  }

  req.authSession = session;
  req.authUser = user;
  return next();
};

export const requireWorkspaceAccess = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = String(req.params.workspaceId || req.query.workspaceId || req.body?.workspaceId || '').trim();
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, userId: true }
  });

  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  if (!req.authUser || workspace.userId !== req.authUser.id) {
    return res.status(403).json({ error: 'You do not have access to this workspace' });
  }

  req.workspaceAccess = workspace;
  return next();
};

export const requireWorkbenchAccess = async (req: Request, res: Response, next: NextFunction) => {
  const workbenchId = String(req.params.id || req.body?.workbenchId || req.query.workbenchId || '').trim();
  if (!workbenchId) {
    return res.status(400).json({ error: 'Workbench id is required' });
  }

  const workbench = await prisma.workbench.findUnique({
    where: { id: workbenchId },
    select: { id: true, workspaceId: true }
  });

  if (!workbench) {
    return res.status(404).json({ error: 'Workbench not found' });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workbench.workspaceId },
    select: { id: true, userId: true }
  });

  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  if (!req.authUser || workspace.userId !== req.authUser.id) {
    return res.status(403).json({ error: 'You do not have access to this workbench' });
  }

  req.workspaceAccess = workspace;
  req.workbenchAccess = workbench;
  return next();
};

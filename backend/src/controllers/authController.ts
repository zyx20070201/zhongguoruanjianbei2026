import { Request, Response } from 'express';
import prisma from '../config/db';
import { badRequest, conflict, unauthorized } from '../errors/AppError';
import { authSecurityService, validatePasswordStrength } from '../services/authSecurityService';
import { authSessionService } from '../services/authSessionService';
import { clearAuthCookie, getAuthCookieValue, setAuthCookie } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../utils/password';

const isValidUsername = (value: string) => /^[A-Za-z0-9_]{3,24}$/.test(value);

const toSafeUser = (user: { id: string; username: string; email: string | null }) => ({
  id: user.id,
  username: user.username,
  email: user.email
});
export const register = async (req: Request, res: Response) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    throw badRequest('请填写用户名、邮箱和密码');
  }

  const normalizedUsername = String(username).trim();
  const normalizedEmail = String(email).trim().toLowerCase();

  if (!normalizedUsername) {
    throw badRequest('请填写用户名');
  }

  if (!isValidUsername(normalizedUsername)) {
    throw badRequest('用户名需为 3-24 位，只能包含字母、数字或下划线', 'INVALID_USERNAME');
  }

  if (!authSecurityService.isValidEmail(normalizedEmail)) {
    throw badRequest('请输入有效的邮箱地址', 'INVALID_EMAIL');
  }

  validatePasswordStrength(String(password));

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ username: normalizedUsername }, { email: normalizedEmail }]
    }
  });

  if (existingUser) {
    throw conflict('用户名或邮箱已被使用', 'ACCOUNT_EXISTS');
  }

  const user = await prisma.user.create({
    data: {
      username: normalizedUsername,
      email: normalizedEmail,
      password: hashPassword(String(password))
    }
  });

  const session = authSessionService.create(user.id);
  setAuthCookie(res, session.id, session.expiresAt);

  res.status(201).json({ user: toSafeUser(user) });
};

export const login = async (req: Request, res: Response) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    throw badRequest('请填写邮箱或用户名和密码');
  }

  const normalizedIdentifier = String(identifier).trim();
  const normalizedEmail = normalizedIdentifier.toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: normalizedIdentifier }, { email: normalizedEmail }]
    }
  });

  if (!user || !verifyPassword(String(password), user.password)) {
    throw unauthorized('邮箱、用户名或密码错误', 'INVALID_CREDENTIALS');
  }

  const session = authSessionService.create(user.id);
  setAuthCookie(res, session.id, session.expiresAt);

  res.json({ user: toSafeUser(user) });
};

export const getCurrentUser = async (req: Request, res: Response) => {
  if (!req.authUser) {
    throw unauthorized();
  }

  const users = await prisma.$queryRaw<Array<{ id: string; username: string; email: string | null }>>`
    SELECT "id", "username", "email"
    FROM "User"
    WHERE "id" = ${req.authUser.id}
    LIMIT 1
  `;

  res.json({ user: toSafeUser(users[0] || req.authUser) });
};

export const logout = async (req: Request, res: Response) => {
  const cookieValue = getAuthCookieValue(req);
  if (cookieValue) {
    authSessionService.destroy(cookieValue);
  }

  clearAuthCookie(res);
  res.json({ success: true });
};

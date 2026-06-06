import { Request, Response } from 'express';
import prisma from '../config/db';
import { badRequest, conflict, unauthorized } from '../errors/AppError';
import { authSecurityService, validatePasswordStrength } from '../services/authSecurityService';
import { authSessionService } from '../services/authSessionService';
import { clearAuthCookie, getAuthCookieValue, setAuthCookie } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../utils/password';

const isValidUsername = (value: string) => /^[A-Za-z0-9_]{3,24}$/.test(value);
const nullableString = (value: unknown, maxLength: number) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
};

type SafeUserRow = {
  id: string;
  username: string;
  email: string | null;
  profileImageUrl?: string | null;
  bio?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  notificationWebhookUrl?: string | null;
};

const toSafeUser = (user: SafeUserRow) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  profileImageUrl: user.profileImageUrl ?? null,
  bio: user.bio ?? null,
  gender: user.gender ?? null,
  dateOfBirth: user.dateOfBirth ?? null,
  notificationWebhookUrl: user.notificationWebhookUrl ?? null
});

const getSafeUserById = async (userId: string) => {
  const users = await prisma.$queryRaw<SafeUserRow[]>`
    SELECT "id", "username", "email", "profileImageUrl", "bio", "gender", "dateOfBirth", "notificationWebhookUrl"
    FROM "User"
    WHERE "id" = ${userId}
    LIMIT 1
  `;
  return users[0] ? toSafeUser(users[0]) : null;
};

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

  res.status(201).json({ user: await getSafeUserById(user.id) });
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

  res.json({ user: await getSafeUserById(user.id) });
};

export const getCurrentUser = async (req: Request, res: Response) => {
  if (!req.authUser) {
    throw unauthorized();
  }

  const user = await getSafeUserById(req.authUser.id);

  res.json({ user: user || toSafeUser(req.authUser) });
};

export const updateUserProfile = async (req: Request, res: Response) => {
  if (!req.authUser) {
    throw unauthorized();
  }

  const name = nullableString(req.body?.name ?? req.body?.username, 64);
  if (!name) {
    throw badRequest('请填写用户名');
  }
  if (!isValidUsername(name)) {
    throw badRequest('用户名需为 3-24 位，只能包含字母、数字或下划线', 'INVALID_USERNAME');
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      username: name,
      NOT: { id: req.authUser.id }
    }
  });
  if (existingUser) {
    throw conflict('用户名已被使用', 'USERNAME_EXISTS');
  }

  const profileImageUrl = nullableString(req.body?.profileImageUrl ?? req.body?.profile_image_url, 2_000_000);
  const bio = nullableString(req.body?.bio, 5000);
  const gender = nullableString(req.body?.gender, 120);
  const dateOfBirth = nullableString(req.body?.dateOfBirth ?? req.body?.date_of_birth, 32);
  const notificationWebhookUrl = nullableString(
    req.body?.notificationWebhookUrl ?? req.body?.notification_webhook_url,
    2048
  );

  await prisma.$executeRaw`
    UPDATE "User"
    SET
      "username" = ${name},
      "profileImageUrl" = ${profileImageUrl},
      "bio" = ${bio},
      "gender" = ${gender},
      "dateOfBirth" = ${dateOfBirth},
      "notificationWebhookUrl" = ${notificationWebhookUrl},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${req.authUser.id}
  `;

  res.json({ user: await getSafeUserById(req.authUser.id) });
};

export const updateUserPassword = async (req: Request, res: Response) => {
  if (!req.authUser) {
    throw unauthorized();
  }

  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  if (!currentPassword || !newPassword) {
    throw badRequest('请填写当前密码和新密码');
  }

  const user = await prisma.user.findUnique({ where: { id: req.authUser.id } });
  if (!user || !verifyPassword(currentPassword, user.password)) {
    throw unauthorized('当前密码错误', 'INVALID_CURRENT_PASSWORD');
  }

  validatePasswordStrength(newPassword);
  await prisma.user.update({
    where: { id: req.authUser.id },
    data: {
      password: hashPassword(newPassword),
      passwordChangedAt: new Date()
    }
  });

  res.json({ success: true });
};

export const logout = async (req: Request, res: Response) => {
  const cookieValue = getAuthCookieValue(req);
  if (cookieValue) {
    authSessionService.destroy(cookieValue);
  }

  clearAuthCookie(res);
  res.json({ success: true });
};

import { Request, Response } from 'express';
import prisma from '../config/db';
import { badRequest, conflict, unauthorized } from '../errors/AppError';
import { authSecurityService, validatePasswordStrength } from '../services/authSecurityService';
import { authSessionService } from '../services/authSessionService';
import { clearAuthCookie, getAuthCookieValue, setAuthCookie } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../utils/password';

const GENERIC_RESET_RESPONSE = {
  message: 'If an account exists for that identifier, a password reset link has been sent.'
};

const toSafeUser = (user: { id: string; username: string; email: string | null; emailVerifiedAt?: Date | string | null }) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  emailVerified: Boolean(user.emailVerifiedAt)
});
export const register = async (req: Request, res: Response) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    throw badRequest('Username, email and password are required');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedUsername = String(username).trim();

  if (!authSecurityService.isValidEmail(normalizedEmail)) {
    throw badRequest('Please enter a valid email address', 'INVALID_EMAIL');
  }

  validatePasswordStrength(String(password), [normalizedUsername, normalizedEmail]);

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalizedEmail }, { username: normalizedUsername }]
    }
  });

  if (existingUser) {
    throw conflict('Email or username is already in use', 'ACCOUNT_EXISTS');
  }

  const user = await prisma.user.create({
    data: {
      username: normalizedUsername,
      email: normalizedEmail,
      password: hashPassword(String(password))
    }
  });

  await authSecurityService.issueEmailVerification(user);

  const session = authSessionService.create(user.id);
  setAuthCookie(res, session.id, session.expiresAt);

  res.status(201).json({ user: toSafeUser(user) });
};

export const login = async (req: Request, res: Response) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    throw badRequest('Email/username and password are required');
  }

  const normalizedIdentifier = String(identifier).trim();
  const normalizedEmail = normalizedIdentifier.toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: normalizedIdentifier }, { email: normalizedEmail }]
    }
  });

  if (!user || !verifyPassword(String(password), user.password)) {
    throw unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
  }

  const session = authSessionService.create(user.id);
  setAuthCookie(res, session.id, session.expiresAt);

  res.json({ user: toSafeUser(user) });
};

export const getCurrentUser = async (req: Request, res: Response) => {
  if (!req.authUser) {
    throw unauthorized();
  }

  const users = await prisma.$queryRaw<Array<{ id: string; username: string; email: string | null; emailVerifiedAt: Date | string | null }>>`
    SELECT "id", "username", "email", "emailVerifiedAt"
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

export const requestPasswordReset = async (req: Request, res: Response) => {
  const identifier = String(req.body?.identifier || '').trim();
  if (!identifier) {
    throw badRequest('Email or username is required');
  }

  await authSecurityService.issuePasswordReset(identifier);
  res.json(GENERIC_RESET_RESPONSE);
};

export const resetPassword = async (req: Request, res: Response) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token || !password) {
    throw badRequest('Reset token and new password are required');
  }

  const user = await authSecurityService.resetPassword(token, password);
  if (!user) {
    throw badRequest('This password reset link is invalid or expired', 'INVALID_RESET_TOKEN');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashPassword(password)
    }
  });
  await prisma.$executeRaw`
    UPDATE "User"
    SET "passwordChangedAt" = ${new Date()}
    WHERE "id" = ${user.id}
  `;
  authSessionService.destroyUserSessions(user.id);

  res.json({ success: true });
};

export const verifyEmail = async (req: Request, res: Response) => {
  const token = String(req.body?.token || '').trim();
  if (!token) {
    throw badRequest('Verification token is required');
  }

  const user = await authSecurityService.verifyEmail(token);
  if (!user) {
    throw badRequest('This verification link is invalid or expired', 'INVALID_VERIFICATION_TOKEN');
  }

  res.json({ user: toSafeUser(user) });
};

export const resendEmailVerification = async (req: Request, res: Response) => {
  if (!req.authUser) {
    throw unauthorized();
  }

  const users = await prisma.$queryRaw<Array<{ id: string; email: string | null; emailVerifiedAt: Date | string | null }>>`
    SELECT "id", "email", "emailVerifiedAt"
    FROM "User"
    WHERE "id" = ${req.authUser.id}
    LIMIT 1
  `;
  const user = users[0];

  if (!user) {
    throw unauthorized();
  }

  if (user.emailVerifiedAt) {
    return res.json({ message: 'Email is already verified' });
  }

  await authSecurityService.issueEmailVerification(user);
  return res.json({ message: 'Verification link sent' });
};

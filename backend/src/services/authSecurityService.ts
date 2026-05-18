import crypto from 'crypto';
import prisma from '../config/db';
import { badRequest } from '../errors/AppError';

export type AuthTokenType = 'email_verification' | 'password_reset';

const TOKEN_BYTES = 32;
const EMAIL_VERIFICATION_TTL_MS = Number(process.env.EMAIL_VERIFICATION_TTL_MS || 1000 * 60 * 60 * 24);
const PASSWORD_RESET_TTL_MS = Number(process.env.PASSWORD_RESET_TTL_MS || 1000 * 60 * 30);
const APP_BASE_URL = process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || 'http://localhost:5173';

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const randomId = () => crypto.randomUUID();

const emailLooksValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const validatePasswordStrength = (password: string, identityParts: string[] = []) => {
  const failures: string[] = [];

  if (password.length < 10) failures.push('at least 10 characters');
  if (!/[a-z]/.test(password)) failures.push('one lowercase letter');
  if (!/[A-Z]/.test(password)) failures.push('one uppercase letter');
  if (!/\d/.test(password)) failures.push('one number');
  if (!/[^A-Za-z0-9]/.test(password)) failures.push('one symbol');
  if (/(.)\1{2,}/.test(password)) failures.push('no repeated character runs');

  const normalizedPassword = password.toLowerCase();
  const containsIdentity = identityParts
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 3)
    .some((part) => normalizedPassword.includes(part));

  if (containsIdentity) failures.push('no username or email fragments');

  if (failures.length > 0) {
    throw badRequest(`Password must include ${failures.join(', ')}.`, 'WEAK_PASSWORD');
  }
};

const createToken = async (userId: string, type: AuthTokenType, ttlMs: number) => {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await prisma.$executeRaw`
    INSERT INTO "AuthToken" ("id", "userId", "type", "tokenHash", "expiresAt")
    VALUES (${randomId()}, ${userId}, ${type}, ${tokenHash}, ${expiresAt})
  `;

  return { token, expiresAt };
};

const consumeToken = async (token: string, type: AuthTokenType): Promise<{ id: string; userId: string } | null> => {
  const tokenHash = hashToken(token);
  const rows = await prisma.$queryRaw<Array<{ id: string; userId: string; expiresAt: Date | string; consumedAt: Date | string | null }>>`
    SELECT "id", "userId", "expiresAt", "consumedAt"
    FROM "AuthToken"
    WHERE "tokenHash" = ${tokenHash} AND "type" = ${type}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.consumedAt || new Date(row.expiresAt).getTime() <= Date.now()) return null;

  await prisma.$executeRaw`
    UPDATE "AuthToken"
    SET "consumedAt" = ${new Date()}
    WHERE "id" = ${row.id} AND "consumedAt" IS NULL
  `;

  return { id: row.id, userId: row.userId };
};

const logDelivery = (kind: string, email: string, url: string) => {
  if (process.env.NODE_ENV === 'production') {
    console.warn(`${kind} email delivery is not configured for ${email}. Set up an email provider before production use.`);
    return;
  }

  console.info(`[auth:${kind}] ${email} -> ${url}`);
};

export const authSecurityService = {
  isValidEmail: emailLooksValid,

  async issueEmailVerification(user: { id: string; email: string | null }) {
    if (!user.email) return null;

    const { token, expiresAt } = await createToken(user.id, 'email_verification', EMAIL_VERIFICATION_TTL_MS);
    const url = `${APP_BASE_URL}/?verifyEmailToken=${encodeURIComponent(token)}`;
    logDelivery('verify-email', user.email, url);
    return { expiresAt };
  },

  async verifyEmail(token: string) {
    const consumed = await consumeToken(token, 'email_verification');
    if (!consumed) return null;

    await prisma.$executeRaw`
      UPDATE "User"
      SET "emailVerifiedAt" = ${new Date()}
      WHERE "id" = ${consumed.userId}
    `;

    const users = await prisma.$queryRaw<Array<{ id: string; username: string; email: string | null; emailVerifiedAt: Date | string | null }>>`
      SELECT "id", "username", "email", "emailVerifiedAt"
      FROM "User"
      WHERE "id" = ${consumed.userId}
      LIMIT 1
    `;

    return users[0] || null;
  },

  async issuePasswordReset(identifier: string) {
    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) return;

    const users = await prisma.$queryRaw<Array<{ id: string; username: string; email: string | null }>>`
      SELECT "id", "username", "email"
      FROM "User"
      WHERE "username" = ${normalizedIdentifier} OR "email" = ${normalizedIdentifier.toLowerCase()}
      LIMIT 1
    `;
    const user = users[0];
    if (!user?.email) return;

    const { token } = await createToken(user.id, 'password_reset', PASSWORD_RESET_TTL_MS);
    const url = `${APP_BASE_URL}/?resetPasswordToken=${encodeURIComponent(token)}`;
    logDelivery('reset-password', user.email, url);
  },

  async resetPassword(token: string, password: string) {
    const consumed = await consumeToken(token, 'password_reset');
    if (!consumed) return null;

    const users = await prisma.$queryRaw<Array<{ id: string; username: string; email: string | null }>>`
      SELECT "id", "username", "email"
      FROM "User"
      WHERE "id" = ${consumed.userId}
      LIMIT 1
    `;
    const user = users[0];
    if (!user) return null;

    validatePasswordStrength(password, [user.username, user.email || '']);
    return user;
  }
};

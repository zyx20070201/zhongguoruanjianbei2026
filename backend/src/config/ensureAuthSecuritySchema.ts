import prisma from './db';

const statements = [
  `CREATE TABLE IF NOT EXISTS "AuthToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash")`,
  `CREATE INDEX IF NOT EXISTS "AuthToken_userId_type_expiresAt_idx" ON "AuthToken"("userId", "type", "expiresAt")`
];

const userColumns = [
  ['emailVerifiedAt', 'DATETIME'],
  ['passwordChangedAt', 'DATETIME']
] as const;

export const ensureAuthSecuritySchema = async () => {
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  for (const [name, definition] of userColumns) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "${name}" ${definition}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column|already exists/i.test(message)) throw error;
    }
  }
};

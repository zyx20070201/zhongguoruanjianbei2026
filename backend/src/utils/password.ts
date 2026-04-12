import crypto from 'crypto';

const SCRYPT_KEYLEN = 64;

export const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derivedKey}`;
};

export const verifyPassword = (password: string, storedValue: string) => {
  if (!storedValue.includes(':')) {
    return storedValue === password;
  }

  const [salt, hash] = storedValue.split(':');
  const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const storedBuffer = Buffer.from(hash, 'hex');

  if (storedBuffer.length !== derivedKey.length) return false;

  return crypto.timingSafeEqual(storedBuffer, derivedKey);
};

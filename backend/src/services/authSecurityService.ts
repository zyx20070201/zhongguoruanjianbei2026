import { badRequest } from '../errors/AppError';

const emailLooksValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const validatePasswordStrength = (password: string) => {
  if (password.length < 6) {
    throw badRequest('密码长度不能少于 6 位', 'WEAK_PASSWORD');
  }
};

export const authSecurityService = {
  isValidEmail: emailLooksValid
};

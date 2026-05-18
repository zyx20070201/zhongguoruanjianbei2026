import { Router } from 'express';
import {
  getCurrentUser,
  login,
  logout,
  register,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  verifyEmail
} from '../controllers/authController';
import { requireAuth } from '../middleware/auth';
import { createRateLimit } from '../middleware/rateLimit';

const router = Router();

const loginLimiter = createRateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyPrefix: 'auth-login'
});

const registerLimiter = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyPrefix: 'auth-register'
});

const passwordResetLimiter = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyPrefix: 'auth-password-reset'
});

const emailVerificationLimiter = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  keyPrefix: 'auth-email-verification'
});

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.get('/me', requireAuth, getCurrentUser);
router.post('/logout', requireAuth, logout);
router.post('/password-reset/request', passwordResetLimiter, requestPasswordReset);
router.post('/password-reset/confirm', passwordResetLimiter, resetPassword);
router.post('/email/verify', emailVerificationLimiter, verifyEmail);
router.post('/email/resend', requireAuth, emailVerificationLimiter, resendEmailVerification);

export default router;

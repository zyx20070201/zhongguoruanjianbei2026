import { Router } from 'express';
import {
  getCurrentUser,
  login,
  logout,
  register,
  updateUserPassword,
  updateUserProfile
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

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.get('/me', requireAuth, getCurrentUser);
router.put('/profile', requireAuth, updateUserProfile);
router.put('/password', requireAuth, updateUserPassword);
router.post('/logout', requireAuth, logout);

export default router;

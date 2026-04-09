import { Router } from 'express';
import { login, getCurrentUser } from '../controllers/authController';

const router = Router();

router.post('/login', login);
router.get('/me', getCurrentUser);

export default router;

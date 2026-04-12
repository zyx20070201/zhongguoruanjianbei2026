import { Request, Response } from 'express';
import prisma from '../config/db';
import { hashPassword, verifyPassword } from '../utils/password';

const toSafeUser = (user: { id: string; username: string; email: string | null }) => ({
  id: user.id,
  username: user.username,
  email: user.email
});
export const register = async (req: Request, res: Response) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedUsername = String(username).trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalizedEmail }, { username: normalizedUsername }]
    }
  });

  if (existingUser) {
    return res.status(409).json({ error: 'Email or username is already in use' });
  }

  const user = await prisma.user.create({
    data: {
      username: normalizedUsername,
      email: normalizedEmail,
      password: hashPassword(String(password))
    }
  });

  res.status(201).json({ user: toSafeUser(user) });
};

export const login = async (req: Request, res: Response) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email/username and password are required' });
  }

  const normalizedIdentifier = String(identifier).trim();
  const normalizedEmail = normalizedIdentifier.toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: normalizedIdentifier }, { email: normalizedEmail }]
    }
  });

  if (!user || !verifyPassword(String(password), user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ user: toSafeUser(user) });
};

export const getCurrentUser = async (req: Request, res: Response) => {
  const id = String(req.query.id || '').trim();
  if (!id) {
    return res.status(400).json({ error: 'User id is required' });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, email: true }
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user });
};

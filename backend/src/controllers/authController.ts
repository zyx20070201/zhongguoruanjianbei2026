import { Request, Response } from 'express';
import prisma from '../config/db';

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body;
  // Simplified for Phase 1
  let user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    user = await prisma.user.create({
      data: { username, password } // In production, hash password
    });
  }
  res.json({ user });
};

export const getCurrentUser = async (req: Request, res: Response) => {
  // Mocking auth for Phase 1
  const user = await prisma.user.findFirst();
  res.json({ user });
};

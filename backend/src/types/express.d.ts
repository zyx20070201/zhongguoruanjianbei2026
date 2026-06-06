import type { SessionRecord } from '../services/authSessionService';

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        username: string;
        email: string | null;
        profileImageUrl?: string | null;
        bio?: string | null;
        gender?: string | null;
        dateOfBirth?: string | null;
        notificationWebhookUrl?: string | null;
      };
      authSession?: SessionRecord;
      workspaceAccess?: {
        id: string;
        userId: string;
      };
      workbenchAccess?: {
        id: string;
        workspaceId: string;
      };
    }
  }
}

export {};

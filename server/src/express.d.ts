import type { UserDocument } from './models.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserDocument;
      authSessionId?: string;
    }
  }
}
export {};

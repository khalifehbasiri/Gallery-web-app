import type { User } from '../../shared/contracts.js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      authSessionId?: string;
      authTokenId?: string;
      authTokenExpiry?: number;
    }
  }
}
export {};

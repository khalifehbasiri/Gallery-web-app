import type { AccountRole, User } from '../../shared/contracts.js';
import { randomBytes } from 'node:crypto';
export type AccountUser = User & { passwordHash?: string };
export interface ArtworkDocument {
  id: string;
  artistId: string;
  title: string;
  year: string;
  category: string;
  medium: string;
  description: string;
  imageUrl: string;
}
export interface ArtworkStore {
  get(id: string): Promise<ArtworkDocument | null>;
  create(art: ArtworkDocument): Promise<void>;
  remove(id: string): Promise<void>;
  close(): Promise<void>;
}
export const newId = () => randomBytes(12).toString('hex');
export function userDto(row: Record<string, unknown>): AccountUser {
  return {
    id: String(row['id']),
    username: String(row['username']),
    role: row['role'] as AccountRole,
    ...(row['password_hash']
      ? { passwordHash: String(row['password_hash']) }
      : {}),
  };
}
export const publicUser = ({ id, username, role }: AccountUser): User => ({
  id,
  username,
  role,
});

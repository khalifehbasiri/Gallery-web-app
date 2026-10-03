import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
export const isPasswordHash = (value: string) => value.startsWith('scrypt$');
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = (await deriveKey(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(
  password: string,
  storedPassword: string,
): Promise<boolean> {
  if (typeof storedPassword !== 'string') return false;
  if (!isPasswordHash(storedPassword)) {
    const expected = Buffer.from(storedPassword);
    const actual = Buffer.from(password);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
  const parts = storedPassword.split('$');
  const [, salt = '', hash = ''] = parts;
  if (
    parts.length !== 3 ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !/^[a-f0-9]{128}$/.test(hash)
  )
    return false;
  const actual = (await deriveKey(password, salt, 64)) as Buffer;
  return timingSafeEqual(Buffer.from(hash, 'hex'), actual);
}

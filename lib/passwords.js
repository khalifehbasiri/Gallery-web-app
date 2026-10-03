import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const prefix = 'scrypt$';

export function isPasswordHash(value) {
  return typeof value === 'string' && value.startsWith(prefix);
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64);
  return `${prefix}${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, storedPassword) {
  if (typeof storedPassword !== 'string') return false;
  // Keep old accounts usable; login upgrades them after a successful login.
  if (!isPasswordHash(storedPassword)) {
    const expected = Buffer.from(storedPassword);
    const actual = Buffer.from(password);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
  const [, salt, hash] = storedPassword.split('$');
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash))
    return false;
  const actual = await deriveKey(password, salt, 64);
  return timingSafeEqual(Buffer.from(hash, 'hex'), actual);
}

import { Types } from 'mongoose';
import type { RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function textField(
  body: unknown,
  field: string,
  maxLength = 200,
): string {
  const value =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>)[field]
      : undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength)
    throw new HttpError(
      400,
      `${field} is required and must be at most ${maxLength} characters.`,
    );
  return value.trim();
}
export function objectId(value: unknown): Types.ObjectId {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value))
    throw new HttpError(404, 'Unknown ID.');
  return new Types.ObjectId(value);
}
export function requireDocument<T>(
  document: T,
  message: string,
): NonNullable<T> {
  if (document === null || document === undefined)
    throw new HttpError(404, message);
  return document;
}
export function pageParameters(query: Record<string, unknown>) {
  const page = query['page'] === undefined ? 1 : Number(query['page']);
  const limit = query['limit'] === undefined ? 12 : Number(query['limit']);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 48
  )
    throw new HttpError(
      400,
      'Invalid pagination. Page must be 1–10000 and limit 1–48.',
    );
  return { page, limit, skip: (page - 1) * limit };
}
export const artistOnly: RequestHandler = (req, _res, next) => {
  if (req.user?.aType !== 'artist')
    throw new HttpError(403, 'An artist account is required.');
  next();
};

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
  const result = value.trim();
  // Plain text, not executable HTML. Preserve punctuation/Unicode; reject control bytes.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result))
    throw new HttpError(400, `${field} contains invalid control characters.`);
  return result;
}
export function objectId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value))
    throw new HttpError(404, 'Unknown ID.');
  return value;
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
    page > 500 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 48
  )
    throw new HttpError(
      400,
      'Invalid pagination. Page must be 1–500 and limit 1–48.',
    );
  return { page, limit, skip: (page - 1) * limit };
}
export const artistOnly: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'artist')
    throw new HttpError(403, 'An artist account is required.');
  next();
};

import mongoose from 'mongoose';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Express 4 needs rejected promises forwarded to its error middleware.
export const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function textField(body, field, maxLength = 200) {
  const value = body?.[field];
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new HttpError(
      400,
      `${field} is required and must be at most ${maxLength} characters.`,
    );
  }
  return value.trim();
}

export function objectId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) {
    throw new HttpError(404, 'Unknown ID.');
  }
  return new mongoose.Types.ObjectId(value);
}

export function requireDocument(document, message) {
  if (!document) throw new HttpError(404, message);
  return document;
}

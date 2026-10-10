import {
  artForms,
  type ArtDetails,
  type ArtForm,
} from '../../shared/art-forms.js';
import { HttpError, textField } from './http.js';

export function parseArtDetails(
  value: unknown,
  category: string,
): ArtDetails | undefined {
  // Old documents and custom categories can omit structured details.
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'Art details must be an object.');
  const type = (value as Record<string, unknown>)['type'];
  if (typeof type !== 'string' || !Object.hasOwn(artForms, type))
    throw new HttpError(400, 'Unknown art form.');
  const form = artForms[type as ArtForm];
  if (form.category !== category)
    throw new HttpError(400, 'Art form must match the artwork category.');
  const allowed = ['type', ...form.fields.map((field) => field.key)];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new HttpError(400, 'Unknown field for this art form.');
  return Object.fromEntries([
    ['type', type],
    ...form.fields.map((field) => [field.key, textField(value, field.key)]),
  ]) as ArtDetails;
}

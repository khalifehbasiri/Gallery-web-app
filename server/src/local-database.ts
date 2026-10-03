import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { rootDirectory } from './config.js';
import path from 'node:path';
import type { Sql } from './database.js';
import type { ArtworkDocument, ArtworkStore } from './domain.js';

export async function localDatabase(): Promise<Sql> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Local database is disabled in production.');
  const db = new PGlite();
  await db.exec(
    await readFile(
      path.join(
        rootDirectory,
        'supabase/migrations/20261003201653_gallery_schema.sql',
      ),
      'utf8',
    ),
  );
  const wrap = (connection: Pick<PGlite, 'query'>): Sql => ({
    query: async <T>(text: string, values?: unknown[]) => {
      const r = await connection.query<T>(text, values);
      return { rows: r.rows, rowCount: r.affectedRows };
    },
    transaction: async (work) =>
      db.transaction(async (tx) => work(wrap(tx as unknown as PGlite))),
    close: () => db.close(),
  });
  return wrap(db);
}
export class LocalArtworkStore implements ArtworkStore {
  readonly documents = new Map<string, ArtworkDocument>();
  async get(id: string) {
    return structuredClone(this.documents.get(id) || null);
  }
  async create(art: ArtworkDocument) {
    if (this.documents.has(art.id)) throw new Error('Artwork already exists.');
    this.documents.set(art.id, structuredClone(art));
  }
  async remove(id: string) {
    this.documents.delete(id);
  }
  async close() {}
}

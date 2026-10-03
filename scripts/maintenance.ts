import { readConfig } from '../server/src/config.js';
import { postgres } from '../server/src/database.js';
import { supabaseStorage } from '../server/src/storage.js';
const config = readConfig();
if (!config.databaseUrl) throw new Error('Configure DATABASE_URL.');
const sql = postgres(config.databaseUrl, config.databaseCa),
  storage = supabaseStorage(config);
try {
  // Bound storage cleanup. Used reservations and ambiguous publications require reconciliation.
  const unused = (
    await sql.query(
      'SELECT id,path FROM gallery.uploads WHERE used_at IS NULL AND expires_at < now() ORDER BY expires_at LIMIT 100',
    )
  ).rows;
  for (const row of unused) {
    await storage.remove(String(row['path']));
    await sql.query(
      'DELETE FROM gallery.uploads WHERE id=$1 AND used_at IS NULL AND expires_at < now()',
      [row['id']],
    );
  }
  const counts = await sql.transaction(async (tx) => {
    const tokens = await tx.query(
      'DELETE FROM gallery.refresh_tokens WHERE expires_at < now()',
    );
    const sessions = await tx.query(
      'DELETE FROM gallery.sessions s WHERE (s.idle_expires_at < now() OR s.absolute_expires_at < now()) AND NOT EXISTS (SELECT 1 FROM gallery.refresh_tokens t WHERE t.session_id=s.id)',
    );
    const denials = await tx.query(
      'DELETE FROM gallery.token_denials WHERE expires_at < now()',
    );
    return {
      tokens: tokens.rowCount,
      sessions: sessions.rowCount,
      denials: denials.rowCount,
      unusedUploads: unused.length,
    };
  });
  console.log(JSON.stringify(counts));
} finally {
  await sql.close();
}

import type { Sql } from './database.js';
import type { ArtworkStore } from './domain.js';
import type { ImageStorage } from './storage.js';
import type { DiscoveryCache } from './cache.js';
import { processAccountDeletions } from './account-lifecycle.js';
export async function runMaintenance(
  sql: Sql,
  store: ArtworkStore,
  storage: ImageStorage,
  cache: DiscoveryCache,
) {
  const deletedAccounts = await processAccountDeletions(
    sql,
    store,
    storage,
    cache,
    2,
  );
  const unused = (
    await sql.query(
      "SELECT id,path FROM gallery.uploads WHERE used_at IS NULL AND expires_at+interval '105 minutes'<now() ORDER BY expires_at LIMIT 10",
    )
  ).rows;
  let unusedUploads = 0;
  for (const row of unused) {
    try {
      await storage.remove(String(row['path']));
      await sql.query(
        "DELETE FROM gallery.uploads WHERE id=$1 AND used_at IS NULL AND expires_at+interval '105 minutes'<now()",
        [row['id']],
      );
      unusedUploads++;
    } catch {
      console.error('Expired image cleanup postponed.');
    }
  }
  return sql.transaction(async (tx) => {
    const tokens = await tx.query(
      'DELETE FROM gallery.refresh_tokens WHERE expires_at<now()',
    );
    const sessions = await tx.query(
      'DELETE FROM gallery.sessions s WHERE (s.idle_expires_at<now() OR s.absolute_expires_at<now()) AND NOT EXISTS(SELECT 1 FROM gallery.refresh_tokens t WHERE t.session_id=s.id)',
    );
    await tx.query('DELETE FROM gallery.token_denials WHERE expires_at<now()');
    await tx.query(
      "UPDATE gallery.notification_outbox o SET status='cancelled',finished_at=now(),lease_until=NULL WHERE kind IN ('account-verify','password-reset') AND status='pending' AND NOT EXISTS(SELECT 1 FROM gallery.account_challenges c WHERE c.id=o.preference_version AND c.used_at IS NULL AND c.expires_at>now())",
    );
    const challenges = await tx.query(
      'DELETE FROM gallery.account_challenges WHERE expires_at<now()',
    );
    const notifications = await tx.query(
      "DELETE FROM gallery.notification_outbox WHERE status IN ('done','cancelled','dead') AND coalesce(finished_at,created_at)<now()-interval '30 days'",
    );
    await tx.query(
      "DELETE FROM gallery.email_webhooks WHERE created_at<now()-interval '30 days'",
    );
    await tx.query(
      "DELETE FROM gallery.email_suppressions WHERE created_at<now()-interval '3 years'",
    );
    await tx.query(
      "DELETE FROM gallery.email_verification_limits WHERE window_started<now()-interval '7 days'",
    );
    await tx.query(
      'UPDATE gallery.notification_preferences SET verification_hash=NULL WHERE verification_expires_at<now() AND verification_hash IS NOT NULL',
    );
    await tx.query(
      "DELETE FROM gallery.email_budget WHERE period<'month:'||to_char(now()-interval '90 days','YYYY-MM') AND period LIKE 'month:%'",
    );
    await tx.query(
      "DELETE FROM gallery.email_budget WHERE period<'day:'||to_char(now()-interval '90 days','YYYY-MM-DD') AND period LIKE 'day:%'",
    );
    return {
      deletedAccounts,
      unusedUploads,
      expiredRefreshTokens: tokens.rowCount,
      expiredSessions: sessions.rowCount,
      expiredChallenges: challenges.rowCount,
      completedMail: notifications.rowCount,
    };
  });
}

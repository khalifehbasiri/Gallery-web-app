import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { FeedMode, FeedPage } from '../../shared/contracts.js';
import type { Sql } from './database.js';
import type { DiscoveryCache, CacheStatus } from './cache.js';
import type { Config } from './config.js';
import { summary, liked } from './catalog.js';
import { HttpError } from './http.js';

export const feedPoolSize = 256;
export const followingLimit = 1000;
const timeFormat = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const feedSelect = `SELECT a.id,a.artist_id,a.title,a.year,a.category,a.medium,
  a.description_preview,a.image_url,a.like_count,a.review_count,a.created_at,a.explore_key,
  to_char(a.created_at AT TIME ZONE 'UTC',${timeFormat}) AS feed_time,u.username AS artist
  FROM gallery.artworks a JOIN gallery.users u ON u.id=a.artist_id`;
const publicClause = "a.status='published' AND u.deletion_requested_at IS NULL";
type Row = Record<string, unknown>;
interface Post {
  art: ReturnType<typeof summary>;
  author: string;
  time: string;
  key: string;
}
interface Cursor {
  mode: FeedMode;
  context: string;
  snapshot: string;
  seed: string;
  expires: number;
  after?: { time: string; key: string; id: string };
}
const post = (row: Row): Post => ({
  art: summary(row),
  author: String(row['artist_id']),
  time: String(row['feed_time']),
  key: String(row['explore_key']),
});
const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex');
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(value) &&
  Number.isFinite(Date.parse(value));

export class Feeds {
  constructor(
    private sql: Sql,
    private cache: DiscoveryCache,
    private config: Config,
  ) {}

  async following(user: string) {
    return (
      await this.cache.remember(`feed:v1:follows:${user}`, async () => {
        const ids = (
          await this.sql.query(
            'SELECT f.artist_id FROM gallery.follows f JOIN gallery.users u ON u.id=f.artist_id WHERE f.user_id=$1 AND u.deletion_requested_at IS NULL ORDER BY f.artist_id LIMIT 1001',
            [user],
          )
        ).rows.map((row) => String(row['artist_id']));
        if (ids.length > followingLimit)
          throw new HttpError(
            413,
            'Following exceeds this portfolio feed limit. Contact the maintainer.',
          );
        return ids;
      })
    ).value;
  }

  private pool() {
    return this.cache.remember('feed:v1:recent', async () => {
      // The SQL statement supplies an exact microsecond cutoff even for an empty catalog.
      const value = (
        await this.sql.query(
          `SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC',${timeFormat}) AS snapshot,
        coalesce(jsonb_agg(p ORDER BY p.created_at DESC,p.id DESC),'[]'::jsonb) AS entries
        FROM (${feedSelect} WHERE ${publicClause} AND a.created_at<=statement_timestamp()
        ORDER BY a.created_at DESC,a.id DESC LIMIT $1) p`,
          [feedPoolSize + 1],
        )
      ).rows[0]!;
      const entries = value['entries'] as Row[];
      return {
        snapshot: String(value['snapshot']),
        complete: entries.length <= feedPoolSize,
        entries: entries.slice(0, feedPoolSize).map(post),
      };
    });
  }

  // Called after durable publication and cache invalidation, outside the response lifetime.
  async prime() {
    if (this.cache.status() === 'ready') await this.pool();
  }

  private encode(cursor: Cursor) {
    const value = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return `${value}.${createHmac('sha256', this.config.jwtSecret).update(`feed:v1:${value}`).digest('base64url')}`;
  }
  private decode(value: unknown, mode: FeedMode, context: string): Cursor {
    if (
      typeof value !== 'string' ||
      value.length > 1024 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)
    )
      throw new HttpError(400, 'Invalid feed cursor.');
    const [body, signature] = value.split('.') as [string, string];
    const expected = createHmac('sha256', this.config.jwtSecret)
      .update(`feed:v1:${body}`)
      .digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new HttpError(400, 'Invalid feed cursor.');
    let cursor: Cursor;
    try {
      cursor = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      throw new HttpError(400, 'Invalid feed cursor.');
    }
    if (
      !cursor ||
      cursor.mode !== mode ||
      !timestamp(cursor.snapshot) ||
      !/^[a-f0-9]{32}$/.test(cursor.seed) ||
      !Number.isInteger(cursor.expires) ||
      cursor.expires < Date.now() / 1000 ||
      !cursor.after ||
      !timestamp(cursor.after.time) ||
      !/^[a-f0-9]{32}$/.test(cursor.after.key) ||
      !/^[a-f0-9]{24}$/.test(cursor.after.id)
    )
      throw new HttpError(
        400,
        'Feed cursor is invalid or expired. Refresh your feed.',
      );
    if (cursor.context !== context)
      throw new HttpError(
        409,
        'Following or account changed. Refresh your feed.',
      );
    return cursor;
  }

  async page(
    mode: FeedMode,
    user: string | undefined,
    query: Record<string, unknown>,
  ): Promise<{
    value: FeedPage;
    status: CacheStatus;
    poolStatus: CacheStatus;
  }> {
    if (Object.keys(query).some((key) => !['limit', 'cursor'].includes(key)))
      throw new HttpError(400, 'Unknown feed filter.');
    const limit = query['limit'] === undefined ? 12 : Number(query['limit']);
    if (!Number.isInteger(limit) || limit < 1 || limit > 48)
      throw new HttpError(400, 'Feed limit must be 1–48.');
    if (mode === 'following' && !user)
      throw new HttpError(401, 'Sign in to view your following feed.');
    const authors = mode === 'following' ? await this.following(user!) : [];
    const context =
      mode === 'following' ? digest(`${user}:${authors.join(',')}`) : 'public';
    // Verify before any potentially expensive content query.
    const decoded =
      query['cursor'] === undefined
        ? undefined
        : this.decode(query['cursor'], mode, context);
    const pool = await this.pool();
    const cursor: Cursor = decoded ?? {
      mode,
      context,
      snapshot: pool.value.snapshot,
      seed: randomBytes(16).toString('hex'),
      expires: Math.floor(Date.now() / 1000) + 3600,
    };
    const source: FeedMode =
      mode === 'following' && authors.length ? 'following' : 'explore';
    // Personalized selection uses a user-bound context; cache never contains liked flags.
    const key = `feed:v1:page:${source}:${context}:${cursor.snapshot}:${source === 'explore' ? cursor.seed : ''}:${JSON.stringify(cursor.after)}:${limit}`;
    const select = async () => {
      const eligible = pool.value.entries.filter(
        (p) => p.time <= cursor.snapshot,
      );
      if (source === 'following') {
        const set = new Set(authors);
        const recent = eligible.filter(
          (p) =>
            set.has(p.author) &&
            (!cursor.after ||
              p.time < cursor.after.time ||
              (p.time === cursor.after.time && p.art.id < cursor.after.id)),
        );
        if (pool.value.complete || recent.length > limit)
          return recent.slice(0, limit + 1);
        return (
          await this.sql.query(
            `${feedSelect} WHERE ${publicClause} AND a.artist_id=ANY($1::text[]) AND a.created_at<=$2::timestamptz
          ${cursor.after ? 'AND (a.created_at,a.id)<($4::timestamptz,$5)' : ''} ORDER BY a.created_at DESC,a.id DESC LIMIT $3`,
            [
              authors,
              cursor.snapshot,
              limit + 1,
              ...(cursor.after ? [cursor.after.time, cursor.after.id] : []),
            ],
          )
        ).rows.map(post);
      }
      const sort = (a: Post, b: Post) =>
        a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : a.art.id.localeCompare(b.art.id);
      const beyond = (p: Post) =>
        !cursor.after ||
        p.key > cursor.after.key ||
        (p.key === cursor.after.key && p.art.id > cursor.after.id);
      const wrapped = Boolean(cursor.after && cursor.after.key < cursor.seed);
      if (pool.value.complete) {
        const ordered = eligible.sort(sort);
        return [
          ...(!wrapped
            ? ordered.filter((p) => p.key >= cursor.seed && beyond(p))
            : []),
          ...ordered.filter(
            (p) => p.key < cursor.seed && (!wrapped || beyond(p)),
          ),
        ].slice(0, limit + 1);
      }
      const seek = async (wrap: boolean, count: number, after: boolean) =>
        (
          await this.sql.query(
            `${feedSelect} WHERE ${publicClause} AND a.created_at<=$1::timestamptz AND a.explore_key${wrap ? '<' : '>='}$2
        ${after ? 'AND (a.explore_key,a.id)>($4,$5)' : ''} ORDER BY a.explore_key,a.id LIMIT $3`,
            [
              cursor.snapshot,
              cursor.seed,
              count,
              ...(after ? [cursor.after!.key, cursor.after!.id] : []),
            ],
          )
        ).rows.map(post);
      const entries = wrapped
        ? []
        : await seek(false, limit + 1, Boolean(cursor.after));
      if (entries.length < limit + 1)
        entries.push(
          ...(await seek(true, limit + 1 - entries.length, wrapped)),
        );
      return entries;
    };
    // A complete small catalog can be shuffled locally without a Redis key per random seed.
    const selected =
      source === 'explore' && pool.value.complete
        ? { value: await select(), status: pool.status }
        : await this.cache.remember(key, select);
    const shown = selected.value.slice(0, limit),
      last = shown.at(-1);
    return {
      status: selected.status,
      poolStatus: pool.status,
      value: {
        items: await liked(
          this.sql,
          shown.map((p) => p.art),
          user,
        ),
        source,
        followingCount: authors.length,
        nextCursor:
          selected.value.length > limit && last
            ? this.encode({
                ...cursor,
                after: { time: last.time, key: last.key, id: last.art.id },
              })
            : null,
      },
    };
  }
}

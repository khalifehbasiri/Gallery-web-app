import { Pool } from 'pg';

export interface Sql {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function postgres(url: string, ca?: string): Sql {
  // Supavisor transaction mode, unnamed queries, and one socket per warm function.
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    allowExitOnIdle: true,
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
  });
  pool.on('error', () => console.error('PostgreSQL connection unavailable.'));
  const root: Sql = {
    async query<T>(text: string, values?: unknown[]) {
      return (await pool.query(text, values)) as unknown as {
        rows: T[];
        rowCount: number | null;
      };
    },
    async transaction(work) {
      const client = await pool.connect();
      const tx: Sql = {
        query: async <T>(text: string, values?: unknown[]) =>
          (await client.query(text, values)) as unknown as {
            rows: T[];
            rowCount: number | null;
          },
        transaction: () => {
          throw new Error('Nested transactions are not supported.');
        },
        close: async () => {},
      };
      try {
        await client.query('BEGIN');
        const result = await work(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return root;
}

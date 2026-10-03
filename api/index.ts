import type { Request, Response } from 'express';
import { createRuntime } from '../server/src/runtime.js';
let runtime: ReturnType<typeof createRuntime> | undefined;
// Reuse pools/SDK clients within a warm function; failed initialization is retryable.
export default async function handler(req: Request, res: Response) {
  try {
    runtime ??= createRuntime().catch((error) => {
      runtime = undefined;
      throw error;
    });
    const { app } = await runtime;
    app(req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'Gallery is temporarily unavailable.' });
  }
}

// One-off bootstrap for the local app database; the deployed Worker uses Cron Triggers.
import { parseEnv } from 'node:util';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { runBulletinSync } from '../apps/api/.test-dist/event-sync.js';
const env = parseEnv(await readFile(new URL('../apps/api/.dev.vars', import.meta.url), 'utf8'));
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(env.DATABASE_URL).hostname)) throw new Error('Local database required.');
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
try {
  const result = await runBulletinSync(pool, { ...env, BETTER_AUTH_URL: 'http://localhost:8787' }, 'cli');
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'failed') process.exitCode = 1;
} finally { await pool.end(); }

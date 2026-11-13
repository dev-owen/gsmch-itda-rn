import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { userInfo } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const root = new URL('../', import.meta.url);
const vars = new URL('apps/api/.dev.vars', root);
let env;
try { env = parseEnv(await readFile(vars, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  env = { DATABASE_URL: process.env.DATABASE_URL || `postgres://${encodeURIComponent(userInfo().username)}@127.0.0.1:6547/itda_local`, BETTER_AUTH_SECRET: randomBytes(48).toString('hex') };
  await writeFile(vars, Object.entries(env).map(([key,value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
}
const connection = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)) throw new Error('This script only initializes a local database.');
const migrated = spawnSync(process.execPath, ['node_modules/auth/dist/index.mjs', 'migrate', '--config', './apps/api/auth.config.ts', '--yes'],
  { cwd: fileURLToPath(root), env: { ...process.env, ...env }, stdio: 'inherit' });
if (migrated.status !== 0) process.exit(migrated.status || 1);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
try {
  for (const filename of ['schema.sql', 'event-schema.sql', 'account-schema.sql', 'event-sync-schema.sql', 'retreat-schema.sql', 'retreat-demo.sql', 'retreat-date-correction.sql']) {
    await pool.query(await readFile(new URL(`apps/api/db/${filename}`, root), 'utf8'));
  }
  console.log('Local bulletin, event and account schemas are ready. No production database was accessed.');
} finally { await pool.end(); }

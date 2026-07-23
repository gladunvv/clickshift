import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClickshiftConfig } from './types.js';

const DEFAULTS: ClickshiftConfig = {
  url: 'http://localhost:8123',
  database: 'default',
  username: 'default',
  password: '',
  migrationsDir: 'migrations',
};

const RC_FILENAME = '.clickshiftrc';

function readRcFile(cwd: string): Partial<ClickshiftConfig> {
  const path = resolve(cwd, RC_FILENAME);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to parse ${RC_FILENAME}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function readEnv(): Partial<ClickshiftConfig> {
  const env: Partial<ClickshiftConfig> = {};
  if (process.env.CLICKHOUSE_URL) env.url = process.env.CLICKHOUSE_URL;
  if (process.env.CLICKHOUSE_DATABASE) env.database = process.env.CLICKHOUSE_DATABASE;
  if (process.env.CLICKHOUSE_USERNAME) env.username = process.env.CLICKHOUSE_USERNAME;
  if (process.env.CLICKHOUSE_PASSWORD) env.password = process.env.CLICKHOUSE_PASSWORD;
  if (process.env.CLICKSHIFT_MIGRATIONS_DIR) env.migrationsDir = process.env.CLICKSHIFT_MIGRATIONS_DIR;
  return env;
}

export function loadConfig(cwd: string = process.cwd()): ClickshiftConfig {
  return { ...DEFAULTS, ...readRcFile(cwd), ...readEnv() };
}

export { RC_FILENAME };

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RC_FILENAME } from '../config.js';

const RC_TEMPLATE = `{
  "url": "http://localhost:8123",
  "database": "default",
  "username": "default",
  "password": "",
  "migrationsDir": "migrations"
}
`;

export function runInit(cwd: string = process.cwd()): void {
  const migrationsDir = resolve(cwd, 'migrations');
  if (!existsSync(migrationsDir)) {
    mkdirSync(migrationsDir, { recursive: true });
    console.log(`Created ${migrationsDir}`);
  } else {
    console.log(`${migrationsDir} already exists, skipping.`);
  }

  const rcPath = resolve(cwd, RC_FILENAME);
  if (!existsSync(rcPath)) {
    writeFileSync(rcPath, RC_TEMPLATE);
    console.log(`Created ${rcPath}`);
  } else {
    console.log(`${rcPath} already exists, skipping.`);
  }

  console.log('\nNext steps:');
  console.log(`  1. Edit ${RC_FILENAME} (or set CLICKHOUSE_* env vars) to point at your ClickHouse instance.`);
  console.log('  2. Run "clickshift new <name>" to create your first migration.');
  console.log('  3. Run "clickshift up" to apply pending migrations.');
}

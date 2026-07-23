import { createClient } from '@clickhouse/client';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runUp } from '../../src/commands/up.js';
import { runStatus } from '../../src/commands/status.js';
import type { ClickshiftConfig } from '../../src/types.js';
import { STATE_TABLE } from '../../src/clickhouse/state.js';

const url = 'http://localhost:8123';

function makeConfig(migrationsDir: string, database: string): ClickshiftConfig {
  return { url, database, username: 'default', password: '', migrationsDir };
}

function writeMigration(migrationsDir: string, folderName: string, upSql: string, downSql?: string): void {
  const dir = join(migrationsDir, folderName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'up.sql'), upSql);
  if (downSql !== undefined) writeFileSync(join(dir, 'down.sql'), downSql);
}

describe('up / status against real ClickHouse', () => {
  let migrationsDir: string;
  let database: string;
  let config: ClickshiftConfig;
  let logSpy: ReturnType<typeof import('vitest').vi.spyOn>;

  beforeAll(async () => {
    const client = createClient({ url });
    // sanity check the docker instance is reachable before running the suite
    await client.query({ query: 'SELECT 1' });
    await client.close();
  });

  beforeEach(async () => {
    migrationsDir = mkdtempSync(join(tmpdir(), 'clickshift-'));
    database = `clickshift_test_${randomUUID().replace(/-/g, '')}`;
    config = makeConfig(migrationsDir, database);

    const admin = createClient({ url });
    await admin.command({ query: `CREATE DATABASE "${database}"` });
    await admin.close();

    logSpy = (await import('vitest')).vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    rmSync(migrationsDir, { recursive: true, force: true });
    const admin = createClient({ url });
    await admin.command({ query: `DROP DATABASE IF EXISTS "${database}"` });
    await admin.close();
  });

  it('applies migrations in order and records them as applied', async () => {
    writeMigration(migrationsDir, '20260101000000_create_events', 'CREATE TABLE events (id UInt64) ENGINE = MergeTree ORDER BY id');
    writeMigration(migrationsDir, '20260101000001_add_column', 'ALTER TABLE events ADD COLUMN name String');

    await runUp(config);

    const client = createClient({ url, database });
    const result = await client.query({ query: 'DESCRIBE TABLE events', format: 'JSONEachRow' });
    const columns = await result.json<{ name: string }>();
    await client.close();

    expect(columns.map((c) => c.name)).toEqual(['id', 'name']);
  });

  it('is idempotent: running up twice applies nothing the second time', async () => {
    writeMigration(migrationsDir, '20260101000000_create_events', 'CREATE TABLE events (id UInt64) ENGINE = MergeTree ORDER BY id');

    await runUp(config);
    await runUp(config);

    const client = createClient({ url, database });
    const result = await client.query({
      query: `SELECT count() AS c FROM "${database}".${STATE_TABLE} WHERE status = 'applied'`,
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ c: string }>();
    await client.close();

    expect(rows[0].c).toBe('1');
  });

  it('rejects a modified already-applied migration with a checksum mismatch', async () => {
    writeMigration(migrationsDir, '20260101000000_create_events', 'CREATE TABLE events (id UInt64) ENGINE = MergeTree ORDER BY id');
    await runUp(config);

    writeMigration(migrationsDir, '20260101000000_create_events', 'CREATE TABLE events (id UInt64, extra String) ENGINE = MergeTree ORDER BY id');

    await expect(runUp(config)).rejects.toThrow(/checksum mismatch/);
  });

  it('records a failed migration and stops, without marking it applied', async () => {
    writeMigration(migrationsDir, '20260101000000_broken', 'CREATE TABLE this is not valid sql');

    await expect(runUp(config)).rejects.toThrow(/failed/);

    const client = createClient({ url, database });
    const result = await client.query({
      query: `SELECT status FROM "${database}".${STATE_TABLE} ORDER BY applied_at DESC LIMIT 1`,
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ status: string }>();
    await client.close();

    expect(rows[0].status).toBe('failed');
  });

  it('status reports pending migrations before up runs', async () => {
    writeMigration(migrationsDir, '20260101000000_create_events', 'CREATE TABLE events (id UInt64) ENGINE = MergeTree ORDER BY id');

    await runStatus(config);

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('[pending]');
    expect(logged).toContain('20260101000000_create_events');
  });

  it('rejects up when a migration is stuck in "running" (advisory conflict)', async () => {
    writeMigration(migrationsDir, '20260101000000_create_events', 'CREATE TABLE events (id UInt64) ENGINE = MergeTree ORDER BY id');

    const client = createClient({ url, database });
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS "${database}".${STATE_TABLE}
        (
            name String, checksum String, status LowCardinality(String), irreversible UInt8,
            applied_at DateTime64(3) DEFAULT now64(3), execution_time_ms UInt32,
            error String DEFAULT '', lock_token String
        ) ENGINE = MergeTree ORDER BY (name, applied_at)
      `,
    });
    await client.insert({
      table: `"${database}".${STATE_TABLE}`,
      values: [
        {
          name: '20260101000000_create_events',
          checksum: 'irrelevant',
          status: 'running',
          irreversible: 0,
          execution_time_ms: 0,
          error: '',
          lock_token: randomUUID(),
        },
      ],
      format: 'JSONEachRow',
    });
    await client.close();

    await expect(runUp(config)).rejects.toThrow(/recorded as "running"/);
  });
});

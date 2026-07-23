import type { ClickHouseClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import type { MigrationRecord, MigrationStatus } from '../types.js';

export const STATE_TABLE = '_clickshift_migrations';

export class LockConflictError extends Error {
  constructor(migrationName: string) {
    super(
      `Another process appears to be applying migration "${migrationName}" right now. ` +
        `This is an advisory lock (ClickHouse has no unique constraints), so if you're sure ` +
        `no other process is running, check for a stale "running" row in ${STATE_TABLE}.`,
    );
    this.name = 'LockConflictError';
  }
}

export async function ensureStateTable(client: ClickHouseClient, database: string): Promise<void> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS "${database}".${STATE_TABLE}
      (
          name String,
          checksum String,
          status LowCardinality(String),
          irreversible UInt8,
          applied_at DateTime64(3) DEFAULT now64(3),
          execution_time_ms UInt32,
          error String DEFAULT '',
          lock_token String
      )
      ENGINE = MergeTree
      ORDER BY (name, applied_at)
    `,
  });
}

interface LatestStateRow {
  name: string;
  checksum: string;
  status: MigrationStatus;
  irreversible: number;
  last_applied_at: string;
  execution_time_ms: number;
  error: string;
  lock_token: string;
}

/** Current state per migration, derived from the append-only event log via argMax. */
export async function fetchLatestStates(
  client: ClickHouseClient,
  database: string,
): Promise<Map<string, MigrationRecord>> {
  const resultSet = await client.query({
    query: `
      SELECT
          name,
          argMax(checksum, applied_at) AS checksum,
          argMax(status, applied_at) AS status,
          argMax(irreversible, applied_at) AS irreversible,
          max(applied_at) AS last_applied_at,
          argMax(execution_time_ms, applied_at) AS execution_time_ms,
          argMax(error, applied_at) AS error,
          argMax(lock_token, applied_at) AS lock_token
      FROM "${database}".${STATE_TABLE}
      GROUP BY name
    `,
    format: 'JSONEachRow',
  });

  const rows = await resultSet.json<LatestStateRow>();
  const states = new Map<string, MigrationRecord>();
  for (const row of rows) {
    states.set(row.name, {
      name: row.name,
      checksum: row.checksum,
      status: row.status,
      irreversible: row.irreversible === 1,
      appliedAt: row.last_applied_at,
      executionTimeMs: row.execution_time_ms,
      error: row.error,
      lockToken: row.lock_token,
    });
  }
  return states;
}

export async function insertEvent(
  client: ClickHouseClient,
  database: string,
  event: {
    name: string;
    checksum: string;
    status: MigrationStatus;
    irreversible: boolean;
    executionTimeMs: number;
    error: string;
    lockToken: string;
  },
): Promise<void> {
  await client.insert({
    table: `"${database}".${STATE_TABLE}`,
    values: [
      {
        name: event.name,
        checksum: event.checksum,
        status: event.status,
        irreversible: event.irreversible ? 1 : 0,
        execution_time_ms: event.executionTimeMs,
        error: event.error,
        lock_token: event.lockToken,
      },
    ],
    format: 'JSONEachRow',
  });
}

/**
 * Best-effort advisory lock: ClickHouse has no unique constraints, so this
 * cannot be a true mutex. It inserts a "running" event, then checks whether
 * it was the earliest still-unresolved "running" event for this migration.
 * Rows are scoped to "since the last applied/failed event" so a stale
 * "running" row from a previous, already-resolved attempt doesn't falsely
 * trigger a conflict.
 */
export async function acquireLock(
  client: ClickHouseClient,
  database: string,
  migrationName: string,
): Promise<string> {
  const lockToken = randomUUID();

  await insertEvent(client, database, {
    name: migrationName,
    checksum: '',
    status: 'running',
    irreversible: false,
    executionTimeMs: 0,
    error: '',
    lockToken,
  });

  const resultSet = await client.query({
    query: `
      WITH (
          SELECT max(applied_at)
          FROM "${database}".${STATE_TABLE}
          WHERE name = {name:String} AND status != 'running'
      ) AS resolved_before
      SELECT lock_token
      FROM "${database}".${STATE_TABLE}
      WHERE name = {name:String}
        AND status = 'running'
        AND applied_at > coalesce(resolved_before, toDateTime64('1970-01-01 00:00:00', 3))
      ORDER BY applied_at ASC, lock_token ASC
      LIMIT 1
    `,
    query_params: { name: migrationName },
    format: 'JSONEachRow',
  });

  const rows = await resultSet.json<{ lock_token: string }>();
  if (rows[0]?.lock_token !== lockToken) {
    throw new LockConflictError(migrationName);
  }

  return lockToken;
}

import { createClickhouseClient } from '../clickhouse/client.js';
import { acquireLock, ensureStateTable, fetchLatestStates, insertEvent } from '../clickhouse/state.js';
import { ChecksumMismatchError, MigrationRunningError } from '../errors.js';
import { scanMigrations } from '../migrations/scanner.js';
import type { ClickshiftConfig } from '../types.js';

export async function runUp(config: ClickshiftConfig): Promise<void> {
  const migrations = scanMigrations(config.migrationsDir);
  const client = createClickhouseClient(config);

  try {
    await ensureStateTable(client, config.database);
    const states = await fetchLatestStates(client, config.database);

    let appliedCount = 0;

    for (const migration of migrations) {
      const existing = states.get(migration.name);

      if (existing?.status === 'applied') {
        if (existing.checksum !== migration.checksum) {
          throw new ChecksumMismatchError(migration.name);
        }
        continue;
      }

      if (existing?.status === 'running') {
        throw new MigrationRunningError(migration.name);
      }

      console.log(`Applying ${migration.name} ...`);
      const lockToken = await acquireLock(client, config.database, migration.name);
      const irreversible = migration.directives.irreversible === true;
      const start = Date.now();

      try {
        await client.command({ query: migration.upSql });
        const executionTimeMs = Date.now() - start;
        await insertEvent(client, config.database, {
          name: migration.name,
          checksum: migration.checksum,
          status: 'applied',
          irreversible,
          executionTimeMs,
          error: '',
          lockToken,
        });
        appliedCount += 1;
        console.log(`  applied in ${executionTimeMs}ms`);
      } catch (err) {
        const executionTimeMs = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);
        await insertEvent(client, config.database, {
          name: migration.name,
          checksum: migration.checksum,
          status: 'failed',
          irreversible,
          executionTimeMs,
          error: message,
          lockToken,
        });
        throw new Error(`Migration "${migration.name}" failed: ${message}`);
      }
    }

    if (appliedCount === 0) {
      console.log('Nothing to apply, already up to date.');
    } else {
      console.log(`Applied ${appliedCount} migration(s).`);
    }
  } finally {
    await client.close();
  }
}

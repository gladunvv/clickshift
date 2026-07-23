import { createClickhouseClient } from '../clickhouse/client.js';
import { ensureStateTable, fetchLatestStates } from '../clickhouse/state.js';
import { scanMigrations } from '../migrations/scanner.js';
import type { ClickshiftConfig } from '../types.js';

export async function runStatus(config: ClickshiftConfig): Promise<void> {
  const migrations = scanMigrations(config.migrationsDir);
  const client = createClickhouseClient(config);

  try {
    await ensureStateTable(client, config.database);
    const states = await fetchLatestStates(client, config.database);

    let hasStaleRunning = false;

    for (const migration of migrations) {
      const existing = states.get(migration.name);

      if (!existing) {
        console.log(`[pending]  ${migration.name}`);
        continue;
      }

      if (existing.status === 'applied') {
        const checksumNote = existing.checksum === migration.checksum ? 'ok' : 'MISMATCH';
        console.log(`[applied]  ${migration.name}  (checksum: ${checksumNote}, at ${existing.appliedAt})`);
      } else if (existing.status === 'running') {
        hasStaleRunning = true;
        console.log(`[running?] ${migration.name}  (since ${existing.appliedAt}, may be stale)`);
      } else {
        console.log(`[failed]   ${migration.name}  (at ${existing.appliedAt}: ${existing.error})`);
      }
    }

    if (hasStaleRunning) {
      console.log(
        '\nNote: "running" is an advisory status. If no other process is actually applying ' +
          'that migration, a previous run crashed mid-migration — verify manually before retrying.',
      );
    }
  } finally {
    await client.close();
  }
}

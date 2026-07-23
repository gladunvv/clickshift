import { createClient, type ClickHouseClient } from '@clickhouse/client';
import type { ClickshiftConfig } from '../types.js';

export function createClickhouseClient(config: ClickshiftConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    clickhouse_settings: {
      // The advisory lock in state.ts relies on inserted rows being
      // immediately visible to the next SELECT on this connection.
      async_insert: 0,
    },
  });
}

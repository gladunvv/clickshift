export interface ClickshiftConfig {
  url: string;
  database: string;
  username: string;
  password: string;
  migrationsDir: string;
}

export interface MigrationDirectives {
  irreversible: boolean;
  [key: string]: string | boolean;
}

export interface MigrationFile {
  /** Folder name, e.g. "20260722193000_add_events_table" */
  name: string;
  dirPath: string;
  upSql: string;
  downSql: string | null;
  directives: MigrationDirectives;
  checksum: string;
}

export type MigrationStatus = 'running' | 'applied' | 'failed';

export interface MigrationRecord {
  name: string;
  checksum: string;
  status: MigrationStatus;
  irreversible: boolean;
  appliedAt: string;
  executionTimeMs: number;
  error: string;
  lockToken: string;
}

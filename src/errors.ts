export class ChecksumMismatchError extends Error {
  constructor(migrationName: string) {
    super(
      `Migration "${migrationName}" was already applied but its up.sql has changed since then ` +
        `(checksum mismatch). Applied migrations must not be edited — create a new migration instead.`,
    );
    this.name = 'ChecksumMismatchError';
  }
}

export class MigrationRunningError extends Error {
  constructor(migrationName: string) {
    super(
      `Migration "${migrationName}" is recorded as "running" with no later resolution. ` +
        `Either another process is applying it right now, or a previous run crashed mid-migration. ` +
        `Verify manually, then resolve the row in the state table before retrying.`,
    );
    this.name = 'MigrationRunningError';
  }
}

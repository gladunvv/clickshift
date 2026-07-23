import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClickshiftConfig } from '../types.js';

const SLUG_PATTERN = /^[a-z0-9_]+$/;

const UP_TEMPLATE = `-- clickshift: irreversible=false
-- Write the forward migration below.
`;

const DOWN_TEMPLATE = `-- Write the rollback for up.sql below.
-- If up.sql is irreversible, delete this file and set irreversible=true instead.
`;

function timestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function runNew(config: ClickshiftConfig, rawName: string, now: Date = new Date()): string {
  const slug = rawName.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Invalid migration name "${rawName}". Use lowercase letters, digits, and underscores only.`,
    );
  }

  const folderName = `${timestamp(now)}_${slug}`;
  const dirPath = join(config.migrationsDir, folderName);
  if (existsSync(dirPath)) {
    throw new Error(`Migration folder "${dirPath}" already exists.`);
  }

  mkdirSync(dirPath, { recursive: true });
  writeFileSync(join(dirPath, 'up.sql'), UP_TEMPLATE);
  writeFileSync(join(dirPath, 'down.sql'), DOWN_TEMPLATE);

  console.log(`Created ${dirPath}/up.sql`);
  console.log(`Created ${dirPath}/down.sql`);

  return dirPath;
}

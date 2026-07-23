#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runNew } from './commands/new.js';
import { runStatus } from './commands/status.js';
import { runUp } from './commands/up.js';
import { loadConfig } from './config.js';

const program = new Command();

program.name('clickshift').description('Schema migration CLI for ClickHouse').version('0.1.0');

program
  .command('init')
  .description('Create migrations/ and a .clickshiftrc config file')
  .action(() => {
    runInit();
  });

program
  .command('new <name>')
  .description('Create a new migration folder with up.sql/down.sql')
  .action((name: string) => {
    const config = loadConfig();
    runNew(config, name);
  });

program
  .command('up')
  .description('Apply all pending migrations, in order')
  .action(async () => {
    const config = loadConfig();
    await runUp(config);
  });

program
  .command('status')
  .description('Show which migrations are applied, pending, or failed')
  .action(async () => {
    const config = loadConfig();
    await runStatus(config);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});

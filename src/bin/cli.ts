#!/usr/bin/env node

import { Command } from 'commander';
import { createTranslator } from '../core/translator.js';
import { createFileWatcher } from '../core/file-watcher.js';
import { createProjectSession } from '../core/project-session.js';
import { selectTargetLanguages } from '../core/route-selector.js';
import { startPanelServer } from '../panel/server.js';
import { setVerbose, printBanner, printConfigInfo, printStats, info, success, error as logError, warn } from '../utils/logger.js';
import fs from 'fs/promises';

const packageJson = JSON.parse(
  await fs.readFile(new URL('../../package.json', import.meta.url), 'utf-8')
);

const program = new Command();

program
  .name('i18n-ai-diff')
  .description('Smart incremental i18n translation tool')
  .version(packageJson.version, '-v, --version')
  .option('-c, --config <path>', 'Config file path')
  .option('-w, --watch', 'Watch mode')
  .option('-f, --force', 'Force retranslate all')
  .option('-l, --langs <langs...>', 'Target languages (override config)')
  .option('--verbose', 'Verbose logging')
  .action(async (options: { config?: string; watch?: boolean; force?: boolean; langs?: string[]; verbose?: boolean }) => {
    try {
      if (options.verbose) setVerbose(true);
      printBanner(packageJson.version);

      const session = await createProjectSession({ configPath: options.config });
      const config = session.config;
      if (options.langs?.length) {
        selectTargetLanguages(config, options.langs);
      }

      printConfigInfo({
        routes: config.routes,
        localesDir: config.localesDir,
        model: config.llm.model || 'unknown',
      });

      const translator = createTranslator(config);
      await translator.initialize();
      if (options.verbose) translator.setVerbose(true);

      if (options.force) {
        warn('Force mode: retranslating all keys');
        await translator.clearCache();
        translator.setForce(true);
      }

      info('Translating...');
      const stats = await translator.translateAll();
      printStats(stats);

      if (stats.failedFiles > 0) process.exit(1);
      success('Done!');

      if (options.watch) {
        config.watch = {
          enabled: true,
          debounceMs: config.watch?.debounceMs ?? 300,
          ignored: config.watch?.ignored,
        };
        const watcher = createFileWatcher(config, translator);
        await watcher.start();
      }
    } catch (err) {
      logError((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('panel')
  .description('Open the local project panel')
  .option('-c, --config <path>', 'Config file path')
  .option('-p, --port <port>', 'Local port', parsePort, 4178)
  .option('--edit', 'Enable local locale-file editing')
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (options: { config?: string; port: number; open: boolean; edit?: boolean }) => {
    try {
      printBanner(packageJson.version);
      const session = await createProjectSession({ configPath: options.config });
      const panel = await startPanelServer(session, {
        port: options.port,
        open: options.open,
        editable: options.edit === true,
        packageVersion: packageJson.version,
      });
      success('Panel ready', panel.url);
      info(options.edit ? 'Local editor enabled' : 'Local-only server', 'Press Ctrl+C to stop');

      let closing = false;
      const shutdown = async () => {
        if (closing) return;
        closing = true;
        await panel.close();
        process.exit(0);
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    } catch (err) {
      logError((err as Error).message);
      process.exit(1);
    }
  });

await program.parseAsync();

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

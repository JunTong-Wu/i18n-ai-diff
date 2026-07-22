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
        if (options.langs?.length) {
          warn(`Force mode: retranslating selected target languages (${config.targetLangs.join(', ')})`);
          await translator.clearCacheScope({ targetLangs: config.targetLangs });
        } else {
          warn('Force mode: retranslating all keys');
          await translator.clearCache();
        }
        translator.setForce(true);
      }

      info('Translating...');
      const stats = await translator.translateAll();
      printStats(stats);

      if (stats.failedFiles > 0) process.exit(1);
      success('Done!');

      if (options.watch) {
        config.watch = {
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
  .command('translate-master')
  .description('One-time translation from another master language into a master language')
  .requiredOption('--from <sourceLang>', 'Source master language')
  .requiredOption('--to <targetLang>', 'Target master language')
  .option('--file <paths...>', 'Limit to one or more project-relative JSON files')
  .option('-c, --config <path>', 'Config file path')
  .option('-f, --force', 'Overwrite existing master copy and ignore translation cache')
  .option('--verbose', 'Verbose logging')
  .action(async (options: {
    from: string;
    to: string;
    file?: string[];
    config?: string;
    force?: boolean;
    verbose?: boolean;
  }) => {
    try {
      const rootOptions = program.opts<{ config?: string; verbose?: boolean }>();
      const configPath = options.config || rootOptions.config;
      const verbose = options.verbose || rootOptions.verbose;
      if (verbose) setVerbose(true);
      printBanner(packageJson.version);

      const session = await createProjectSession({ configPath });
      const config = session.config;
      printConfigInfo({
        routes: config.routes,
        localesDir: config.localesDir,
        model: config.llm.model || 'unknown',
      });

      const translator = createTranslator(config);
      await translator.initialize();
      if (verbose) translator.setVerbose(true);
      if (options.force) {
        warn(`Force master translation: ${options.from} → ${options.to} will overwrite existing copy and ignore cache`);
      }

      info(`Translating master copy: ${options.from} → ${options.to}`);
      const stats = await translator.translateMaster({
        sourceLang: options.from,
        targetLang: options.to,
        files: options.file,
        force: options.force,
      });
      printStats(stats);

      if (stats.failedFiles > 0) process.exit(1);
      success('Master translation done!');
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
      const rootOptions = program.opts<{ config?: string }>();
      const configPath = options.config || rootOptions.config;
      printBanner(packageJson.version);
      const session = await createProjectSession({ configPath });
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

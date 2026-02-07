#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig } from '../core/config-loader.js';
import { createTranslator } from '../core/translator.js';
import { createFileWatcher } from '../core/file-watcher.js';
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

      const config = await loadConfig(options.config);
      if (options.langs?.length) config.targetLangs = options.langs as typeof config.targetLangs;

      printConfigInfo({
        baseLang: config.baseLang,
        targetLangs: config.targetLangs,
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

program.parse();

import chalk from 'chalk';

type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';

let verboseMode = false;

export function setVerbose(verbose: boolean): void {
  verboseMode = verbose;
}

const ICONS: Record<LogLevel, string> = {
  info: 'ℹ',
  success: '✓',
  warn: '⚠',
  error: '✗',
  debug: '›',
};

const COLORS: Record<LogLevel, (text: string) => string> = {
  info: chalk.blue,
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  debug: chalk.gray,
};

function log(level: LogLevel, message: string, details?: string): void {
  if (level === 'debug' && !verboseMode) return;
  const icon = COLORS[level](ICONS[level]);
  const colorFn = COLORS[level];
  let output = `${icon} ${colorFn(message)}`;
  if (details) output += ` ${chalk.gray(details)}`;
  console.log(output);
}

export function info(message: string, details?: string): void { log('info', message, details); }
export function success(message: string, details?: string): void { log('success', message, details); }
export function warn(message: string, details?: string): void { log('warn', message, details); }
export function error(message: string, details?: string): void { log('error', message, details); }
export function debug(message: string, details?: string): void { log('debug', message, details); }

export function printBanner(version: string): void {
  console.log('');
  console.log(chalk.cyan('╭────────────────────────────────────╮'));
  console.log(chalk.cyan('│') + chalk.bold.white('      i18n-ai-diff v' + version + '        ') + chalk.cyan('│'));
  console.log(chalk.cyan('│') + chalk.white('   🌍 Smart Incremental i18n Tool   ') + chalk.cyan('│'));
  console.log(chalk.cyan('╰────────────────────────────────────╯'));
  console.log('');
}

export function printConfigInfo(config: {
  routes: Array<{ baseLang: string; targetLangs: readonly string[] }>;
  localesDir: string;
  model: string;
}): void {
  info('Config loaded');
  console.log(chalk.gray('  ├── Mode:      ') + chalk.white(config.routes.length > 1 ? 'Multi-master' : 'Single-master'));
  for (const route of config.routes) {
    console.log(chalk.gray('  ├── Route:     ') + chalk.white(`${route.baseLang} → ${route.targetLangs.join(', ')}`));
  }
  console.log(chalk.gray('  ├── Directory: ') + chalk.white(config.localesDir));
  console.log(chalk.gray('  └── Model:     ') + chalk.white(config.model));
  console.log('');
}

export function printFileResults(results: Array<{
  filePath: string;
  targetLang: string;
  added: number;
  updated: number;
  skipped: number;
}>): void {
  if (results.length === 0) {
    info('No files need updating');
    return;
  }

  success('Translation summary');
  console.log('');
  console.log(chalk.white('┌──────────┬──────────────────────┬────────┬────────┬────────┐'));
  console.log(chalk.white('│ ') + chalk.bold('Lang') + '     │ ' + chalk.bold('File') + '                 │ ' + chalk.bold('Added') + '  │ ' + chalk.bold('Updated') + '│ ' + chalk.bold('Skipped') + '│');
  console.log(chalk.white('├──────────┼──────────────────────┼────────┼────────┼────────┤'));

  for (const result of results) {
    const shortPath = result.filePath.length > 20 ? '...' + result.filePath.slice(-17) : result.filePath.padEnd(20);
    const lang = result.targetLang.padEnd(8);
    const added = String(result.added).padStart(4);
    const updated = String(result.updated).padStart(4);
    const skipped = String(result.skipped).padStart(4);
    console.log(chalk.white('│ ') + lang + chalk.white('│ ') + shortPath + chalk.white(' │ ') + chalk.green(added) + chalk.white(' │ ') + chalk.blue(updated) + chalk.white(' │ ') + chalk.yellow(skipped) + chalk.white(' │'));
  }

  console.log(chalk.white('└──────────┴──────────────────────┴────────┴────────┴────────┘'));
  console.log('');
}

export function printStats(stats: {
  totalFiles: number;
  successFiles: number;
  totalAdded: number;
  totalUpdated: number;
  totalSkipped: number;
}): void {
  info('Summary');
  console.log(chalk.gray('  ├── Files:   ') + chalk.white(`${stats.successFiles}/${stats.totalFiles}`));
  console.log(chalk.gray('  ├── Added:   ') + chalk.green(stats.totalAdded));
  console.log(chalk.gray('  ├── Updated: ') + chalk.blue(stats.totalUpdated));
  console.log(chalk.gray('  └── Skipped: ') + chalk.yellow(stats.totalSkipped));
  console.log('');
}

export function printWatchStart(): void {
  info('👀 Watch mode started');
  console.log(chalk.gray('  Watching for file changes, auto-syncing translations...'));
  console.log(chalk.gray('  Press ') + chalk.white('Ctrl+C') + chalk.gray(' to exit'));
  console.log('');
}

export function printFileChange(filePath: string, changeType: string): void {
  const timestamp = new Date().toLocaleTimeString();
  const icon = changeType === 'add' ? '📝' : changeType === 'change' ? '📝' : '🗑️';
  console.log(chalk.gray(`[${timestamp}]`) + ` ${icon} ${changeType}: ${filePath}`);
}

export function printDivider(): void {
  console.log(chalk.gray('─'.repeat(50)));
}

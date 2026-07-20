import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtureRoot = path.join(projectRoot, 'tests/fixtures/headless-consumer');
const panelProjectRoot = process.env.PANEL_DEV_PROJECT_DIR
  ? path.resolve(process.env.PANEL_DEV_PROJECT_DIR)
  : path.join(projectRoot, '.temp/panel-dev-consumer');
const panelDevHost = process.env.PANEL_DEV_HOST || '0.0.0.0';
const panelDevPort = process.env.PANEL_DEV_PORT || '4187';
const panelApiPort = process.env.PANEL_API_PORT || '4188';
const panelApiOrigin = process.env.PANEL_API_ORIGIN || `http://127.0.0.1:${panelApiPort}`;

const children = new Set();
let shuttingDown = false;

await preparePanelProject();

console.log(`Panel dev UI:     http://${panelDevHost === '0.0.0.0' ? '127.0.0.1' : panelDevHost}:${panelDevPort}`);
console.log(`Panel API:        ${panelApiOrigin}`);
console.log(`Preview project:  ${panelProjectRoot}`);
console.log('Press Ctrl+C to stop both processes.');

const api = start('api', bin('tsx'), [
  path.join(projectRoot, 'src/bin/cli.ts'),
  'panel',
  '--no-open',
  '--edit',
  '--port',
  panelApiPort,
], panelProjectRoot);

const vite = start('vite', bin('vite'), [
  '--config',
  'vite.panel.config.ts',
  '--host',
  panelDevHost,
  '--port',
  panelDevPort,
  '--strictPort',
], projectRoot);

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

async function preparePanelProject() {
  if (process.env.PANEL_DEV_PROJECT_DIR) return;
  await fs.rm(panelProjectRoot, { recursive: true, force: true });
  await fs.mkdir(panelProjectRoot, { recursive: true });
  await fs.cp(path.join(fixtureRoot, 'locales'), path.join(panelProjectRoot, 'locales'), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(fixtureRoot, 'state/cache.json'),
    path.join(panelProjectRoot, '.i18n-translate-cache.json'),
  );
  await fs.copyFile(
    path.join(fixtureRoot, 'state/snapshot.json'),
    path.join(panelProjectRoot, '.i18n-translate-cache.snapshot.json'),
  );
  await fs.writeFile(path.join(panelProjectRoot, 'i18n-translate.config.mjs'), devConfig(), 'utf8');
}

function start(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      PANEL_API_ORIGIN: panelApiOrigin,
      PANEL_API_PORT: panelApiPort,
      PANEL_DEV_HOST: panelDevHost,
      PANEL_DEV_PORT: panelDevPort,
    },
    stdio: 'inherit',
  });
  children.add(child);
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    const reason = signal || `code ${code ?? 0}`;
    console.error(`${name} exited with ${reason}; stopping panel dev.`);
    process.exitCode = code ?? 1;
    shutdown('SIGTERM');
  });
  return child;
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL');
    }
  }, 1500).unref();
}

function bin(name) {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  return path.join(projectRoot, 'node_modules', '.bin', `${name}${suffix}`);
}

function devConfig() {
  return `export default {
  routes: [
    {
      sourceLang: 'zh-Hans',
      targetLangs: ['ja', 'ko'],
    },
    {
      sourceLang: 'en',
      targetLangs: ['de', 'es', 'fr', 'it', 'pt'],
    },
  ],
  localesDir: './locales',
  skipKeys: ['methods.grid.*.value_global', 'methods.grid.*.value_JP'],
  llm: {
    apiKey: process.env.I18N_TEST_API_KEY || 'fixture-only-key',
    model: process.env.I18N_TEST_MODEL || 'gpt-4o-mini',
    baseURL: process.env.I18N_TEST_BASE_URL || 'http://127.0.0.1:9/v1',
    maxTokens: 4096,
    temperature: 0.3,
    timeout: 500,
    retries: 1,
  },
  prompt: \`
"DWARF" and "DWARFLAB" are brand names and must NOT be translated.
Product model names must stay consistent and not be paraphrased.
The domain is astrophotography - use terminology and tone appropriate for that field.
Keep translation quality natural and native-level; avoid literal machine translation.
Do not mix languages in one string.
\`,
  concurrency: 5,
  batchSize: 20,
  cachePath: './.i18n-translate-cache.json',
};
`;
}

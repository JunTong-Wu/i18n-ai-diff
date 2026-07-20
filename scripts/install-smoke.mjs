import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const packageVersion = packageJson.version;
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-install-'));
const packDir = path.join(tempDir, 'pack');
const consumerDir = path.join(tempDir, 'consumer');
const localesDir = path.join(consumerDir, 'locales');

async function writeJson(language, content) {
  const languageDir = path.join(localesDir, language);
  await fs.mkdir(languageDir, { recursive: true });
  await fs.writeFile(
    path.join(languageDir, 'common.json'),
    JSON.stringify(content, null, 2),
    'utf8',
  );
}

try {
  await fs.mkdir(packDir, { recursive: true });
  await fs.mkdir(consumerDir, { recursive: true });
  await execFileAsync('npm', ['pack', '--pack-destination', packDir], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024,
  });

  const tarballPath = path.join(packDir, `i18n-ai-diff-${packageVersion}.tgz`);
  await fs.writeFile(
    path.join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'i18n-ai-diff-install-smoke', private: true, type: 'module' }),
    'utf8',
  );
  await execFileAsync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath],
    { cwd: consumerDir, maxBuffer: 1024 * 1024 },
  );

  await Promise.all([
    writeJson('zh-CN', { greeting: '你好' }),
    writeJson('en', { greeting: 'Hello' }),
    writeJson('ja', { greeting: 'こんにちは' }),
    writeJson('fr', { greeting: 'Bonjour' }),
  ]);
  await fs.writeFile(path.join(consumerDir, 'i18n-translate.config.ts'), `
    import { defineConfig } from 'i18n-ai-diff';
    export default defineConfig({
      routes: [
        { sourceLang: 'zh-CN', targetLangs: ['ja'] },
        { sourceLang: 'en', targetLangs: ['fr'] },
      ],
      localesDir: './locales',
      cachePath: './cache.json',
      llm: { apiKey: 'install-smoke-key', baseURL: 'http://127.0.0.1:1/v1' },
    });
  `, 'utf8');

  const binPath = path.join(consumerDir, 'node_modules/.bin/i18n-ai-diff');
  const versionRun = await execFileAsync(binPath, ['--version'], { cwd: consumerDir });
  assert.equal(versionRun.stdout.trim(), packageVersion);

  const { stdout, stderr } = await execFileAsync(binPath, ['--langs', 'ja', 'fr'], {
    cwd: consumerDir,
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 1024 * 1024,
  });
  const output = stdout + stderr;
  assert.match(output, /Route:\s+zh-CN → ja/);
  assert.match(output, /Route:\s+en → fr/);
  assert.match(output, /Files:\s+2\/2/);

  console.log('Installed package smoke test passed.');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

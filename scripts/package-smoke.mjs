import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliPath = path.join(projectRoot, 'dist/bin/cli.js');
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-package-'));
const localesDir = path.join(tempDir, 'locales');

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
  await Promise.all([
    writeJson('zh-CN', { greeting: '你好' }),
    writeJson('en', { greeting: 'Hello' }),
    writeJson('ja', { greeting: 'こんにちは' }),
    writeJson('ko', { greeting: '안녕하세요' }),
    writeJson('fr', { greeting: 'Bonjour' }),
  ]);

  const configPath = path.join(tempDir, 'i18n-translate.config.ts');
  await fs.writeFile(configPath, `
    type Route = { baseLang: string; targetLangs: string[] };
    const routes: Route[] = [
      { baseLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
      { baseLang: 'en', targetLangs: ['de', 'fr', 'it', 'es'] },
    ];
    export default {
      routes,
      localesDir: ${JSON.stringify(localesDir)},
      cachePath: ${JSON.stringify(path.join(tempDir, '.i18n-translate-cache.json'))},
      llm: {
        apiKey: 'package-smoke-key',
        baseURL: 'http://127.0.0.1:1/v1',
        retries: 1,
        timeout: 500,
      },
    };
  `, 'utf8');

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliPath, '--langs', 'fr', 'ja', 'ko'],
    {
      cwd: tempDir,
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 1024 * 1024,
    },
  );

  const output = stdout + stderr;
  assert.match(output, /Mode:\s+Multi-master/);
  assert.match(output, /Route:\s+zh-CN → ja, ko/);
  assert.match(output, /Route:\s+en → fr/);
  assert.match(output, /Files:\s+3\/3/);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(localesDir, 'fr/common.json'), 'utf8')).greeting,
    'Bonjour',
  );
  await assert.rejects(fs.access(path.join(localesDir, 'de')));

  await writeJson('en', { greeting: 'Hello', newKey: 'New' });
  let failedRun;
  try {
    await execFileAsync(
      process.execPath,
      [cliPath, '--langs', 'fr'],
      {
        cwd: tempDir,
        env: { ...process.env, NO_COLOR: '1' },
        maxBuffer: 1024 * 1024,
      },
    );
  } catch (error) {
    failedRun = error;
  }
  assert.ok(failedRun, 'CLI should exit non-zero when an LLM translation fails');
  assert.equal(failedRun.code, 1);
  assert.match(`${failedRun.stdout || ''}${failedRun.stderr || ''}`, /1 of 1 keys failed to translate/);

  console.log('Package CLI smoke test passed.');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

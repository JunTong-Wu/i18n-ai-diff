import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const tempDirs: string[] = [];
let child: ChildProcessWithoutNullStreams | undefined;

afterEach(async () => {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise(resolve => child?.once('exit', resolve));
  }
  child = undefined;
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('CLI panel command', () => {
  it('honors panel -c/--config and dynamic port 0', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-cli-panel-'));
    tempDirs.push(root);
    await writeJson(root, 'alt-locales/en/common.json', { title: 'Hello' });
    await writeJson(root, 'alt-locales/de/common.json', { title: 'Hallo' });
    await writeJson(root, 'alt.config.json', {
      baseLang: 'en',
      targetLangs: ['de'],
      localesDir: './alt-locales',
      cachePath: './cache.json',
      llm: { apiKey: 'test-key', model: 'test-model' },
    });

    const repoRoot = process.cwd();
    child = spawn(process.execPath, [
      path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs'),
      path.join(repoRoot, 'src/bin/cli.ts'),
      'panel',
      '-c',
      'alt.config.json',
      '--no-open',
      '--port',
      '0',
    ], {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const output = await waitForOutput(child, /Panel ready\s+(http:\/\/127\.0\.0\.1:\d+)/u);
    const url = output.match(/Panel ready\s+(http:\/\/127\.0\.0\.1:\d+)/u)?.[1];
    expect(url).toBeTruthy();

    const project = await fetch(`${url}/api/project`).then(response => response.json());
    expect(await fs.realpath(project.data.configPath)).toBe(await fs.realpath(path.join(root, 'alt.config.json')));
    expect(await fs.realpath(project.data.localesDir)).toBe(await fs.realpath(path.join(root, 'alt-locales')));
    expect(project.data.totals.languages).toBe(2);
  });
});

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function waitForOutput(
  process: ChildProcessWithoutNullStreams,
  pattern: RegExp,
  timeoutMs = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for CLI output. Output so far:\n${output}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (pattern.test(output)) {
        cleanup();
        resolve(output);
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`CLI exited before panel became ready (${code}). Output:\n${output}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      process.stdout.off('data', onData);
      process.stderr.off('data', onData);
      process.off('exit', onExit);
    };
    process.stdout.on('data', onData);
    process.stderr.on('data', onData);
    process.once('exit', onExit);
  });
}

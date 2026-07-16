import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtureRoot = path.join(projectRoot, 'tests/fixtures/headless-consumer');
const tempRoot = path.join(projectRoot, '.temp');
const defaultWorkspaceRoot = path.join(os.tmpdir(), 'i18n-ai-diff-consumer');
const workspaceRoot = process.env.I18N_CONSUMER_DIR
  ? path.resolve(process.env.I18N_CONSUMER_DIR)
  : defaultWorkspaceRoot;
const artifactsRoot = path.join(tempRoot, 'consumer-artifacts');
const workspaceMarker = path.join(workspaceRoot, '.i18n-ai-diff-consumer-workspace');
const mode = process.argv[2] || 'prepare';

if (!['prepare', 'verify'].includes(mode)) {
  throw new Error(`Unknown mode: ${mode}. Use "prepare" or "verify".`);
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

async function copyFixture() {
  await fs.cp(path.join(fixtureRoot, 'locales'), path.join(workspaceRoot, 'locales'), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(fixtureRoot, 'i18n-translate.config.mjs'),
    path.join(workspaceRoot, 'i18n-translate.config.mjs'),
  );
  await fs.copyFile(
    path.join(fixtureRoot, 'state/cache.json'),
    path.join(workspaceRoot, '.i18n-translate-cache.json'),
  );
  await fs.copyFile(
    path.join(fixtureRoot, 'state/snapshot.json'),
    path.join(workspaceRoot, '.i18n-translate-cache.snapshot.json'),
  );
}

async function resetWorkspace() {
  const root = path.parse(workspaceRoot).root;
  const isProjectAncestor = projectRoot.startsWith(`${workspaceRoot}${path.sep}`);
  const isInsideProject = workspaceRoot.startsWith(`${projectRoot}${path.sep}`);
  const isInsideProjectTemp = workspaceRoot.startsWith(`${tempRoot}${path.sep}`);
  if (workspaceRoot === root || workspaceRoot === projectRoot || isProjectAncestor) {
    throw new Error(`Unsafe consumer workspace path: ${workspaceRoot}`);
  }
  if (isInsideProject && !isInsideProjectTemp) {
    throw new Error('A consumer workspace inside the repository must be placed under .temp.');
  }

  let workspaceExists = true;
  try {
    await fs.access(workspaceRoot);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      workspaceExists = false;
    } else {
      throw error;
    }
  }

  if (workspaceExists) {
    const marker = await fs.readFile(workspaceMarker, 'utf8').catch(() => '');
    if (marker.trim() !== 'managed-by-i18n-ai-diff') {
      throw new Error(
        `Refusing to replace an unmanaged directory: ${workspaceRoot}. ` +
        'Choose an empty path with I18N_CONSUMER_DIR.',
      );
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }

  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(workspaceMarker, 'managed-by-i18n-ai-diff\n', 'utf8');
}

async function prepareWorkspace() {
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));

  console.log('Building package...');
  await run('npm', ['run', 'build'], { cwd: projectRoot });

  await fs.rm(artifactsRoot, { recursive: true, force: true });
  await resetWorkspace();
  await fs.mkdir(artifactsRoot, { recursive: true });

  console.log('Packing the exact npm artifact...');
  await run('npm', ['pack', '--ignore-scripts', '--pack-destination', artifactsRoot], {
    cwd: projectRoot,
  });
  const tarballs = (await fs.readdir(artifactsRoot)).filter(file => file.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, 'Expected npm pack to create exactly one tarball');
  const tarballPath = path.join(artifactsRoot, tarballs[0]);

  await fs.writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({
      name: 'i18n-ai-diff-real-consumer',
      private: true,
      type: 'module',
      scripts: {
        translate: 'i18n-ai-diff',
      },
    }, null, 2) + '\n',
    'utf8',
  );
  await copyFixture();

  console.log('Installing the tarball in an isolated consumer project...');
  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath],
    { cwd: workspaceRoot },
  );

  const binPath = path.join(
    workspaceRoot,
    'node_modules/.bin',
    process.platform === 'win32' ? 'i18n-ai-diff.cmd' : 'i18n-ai-diff',
  );
  const versionRun = await run(binPath, ['--version'], { cwd: workspaceRoot });
  assert.equal(versionRun.stdout.trim(), packageJson.version);

  console.log(`Consumer workspace ready: ${workspaceRoot}`);
  console.log(`Installed i18n-ai-diff ${packageJson.version} from ${tarballs[0]}`);
  return { binPath };
}

async function collectFiles(root, current = root) {
  const result = [];
  const entries = await fs.readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      result.push(...await collectFiles(root, absolutePath));
    } else if (entry.isFile()) {
      const content = await fs.readFile(absolutePath);
      result.push({
        path: path.relative(root, absolutePath),
        bytes: content.length,
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
      });
    }
  }

  return result;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function verifyWorkspace() {
  const { binPath } = await prepareWorkspace();
  const manifest = await readJson(path.join(fixtureRoot, 'fixture-manifest.json'));
  const localesDir = path.join(workspaceRoot, 'locales');
  const cachePath = path.join(workspaceRoot, '.i18n-translate-cache.json');
  const snapshotPath = path.join(workspaceRoot, '.i18n-translate-cache.snapshot.json');

  const beforeFiles = await collectFiles(localesDir);
  assert.equal(beforeFiles.length, manifest.jsonFiles);
  const beforeCache = await readJson(cachePath);
  const beforeSnapshot = await readJson(snapshotPath);

  let llmRequestCount = 0;
  const llmTrap = http.createServer((_request, response) => {
    llmRequestCount += 1;
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'The consumer fixture must not call the LLM' } }));
  });
  await new Promise((resolve, reject) => {
    llmTrap.once('error', reject);
    llmTrap.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = llmTrap.address();
    assert.ok(address && typeof address === 'object');
    const { stdout, stderr } = await run(binPath, [], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        NO_COLOR: '1',
        I18N_TEST_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
    });
    const output = stdout + stderr;
    assert.match(output, /Mode:\s+Multi-master/);
    assert.match(output, /Route:\s+zh-Hans → ja, ko/);
    assert.match(output, /Route:\s+en → de, es, fr, it, pt/);
    assert.match(output, /Files:\s+259\/259/);
  } finally {
    await new Promise(resolve => llmTrap.close(resolve));
  }

  const afterFiles = await collectFiles(localesDir);
  const afterCache = await readJson(cachePath);
  const afterSnapshot = await readJson(snapshotPath);

  assert.deepEqual(afterFiles, beforeFiles, 'A normal run changed reviewed locale files');
  assert.deepEqual(afterCache, beforeCache, 'A no-op run changed the translation cache');
  assert.deepEqual(afterSnapshot, beforeSnapshot, 'A no-op run changed the source snapshot');
  assert.equal(llmRequestCount, 0, 'A no-op run unexpectedly called the LLM');
  await assert.rejects(
    fs.access(path.join(workspaceRoot, '.i18n-translate-failures.json')),
    'A no-op run unexpectedly created a failure log',
  );
  await assert.rejects(
    fs.access(path.join(workspaceRoot, '.i18n-translate-failures.md')),
    'A no-op run unexpectedly created a failure report',
  );

  console.log(
    `Real consumer verification passed: ${manifest.languages.length} languages, ` +
    `${beforeFiles.length} JSON files, 259 translation file tasks, 0 content changes, 0 LLM calls.`,
  );
  console.log(`Workspace kept for manual acceptance: ${workspaceRoot}`);
}

if (mode === 'verify') {
  await verifyWorkspace();
} else {
  await prepareWorkspace();
}

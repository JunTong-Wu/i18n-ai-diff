import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const playgroundConsumerRoot = path.join(projectRoot, 'playground/consumer');
const tempRoot = path.join(projectRoot, '.temp');
const defaultWorkspaceRoot = path.join(os.tmpdir(), 'i18n-ai-diff-consumer');
const workspaceRoot = process.env.I18N_CONSUMER_DIR
  ? path.resolve(process.env.I18N_CONSUMER_DIR)
  : defaultWorkspaceRoot;
const artifactsRoot = path.join(os.tmpdir(), 'i18n-ai-diff-consumer-artifacts');
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

async function copyPlaygroundConsumer() {
  await fs.cp(path.join(playgroundConsumerRoot, 'locales'), path.join(workspaceRoot, 'locales'), {
    recursive: true,
  });
  await fs.cp(path.join(playgroundConsumerRoot, 'state'), path.join(workspaceRoot, 'state'), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(playgroundConsumerRoot, 'i18n-translate.config.mjs'),
    path.join(workspaceRoot, 'i18n-translate.config.mjs'),
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
        panel: 'i18n-ai-diff panel',
      },
    }, null, 2) + '\n',
    'utf8',
  );
  await copyPlaygroundConsumer();

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

async function verifyPanel(binPath) {
  const child = spawn(binPath, ['panel', '--no-open', '--port', '0'], {
    cwd: workspaceRoot,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  try {
    const panelUrl = await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Timed out waiting for the installed panel to start.\n${output}`));
      }, 15_000);
      const inspect = chunk => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (!match || settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(match[0]);
      };
      child.stdout.on('data', inspect);
      child.stderr.on('data', inspect);
      child.once('exit', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Installed panel exited before startup (${code}).\n${output}`));
      });
      child.once('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
    });

    const page = await fetch(panelUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /i18n \/ diff — Local panel/);
    assert.match(page.headers.get('content-security-policy') || '', /default-src 'self'/);

    const health = await fetch(`${panelUrl}/api/health`).then(response => response.json());
    assert.equal(health.data.status, 'ok');
    assert.equal(health.data.localOnly, true);
    assert.equal(health.data.editable, false);

    const project = await fetch(`${panelUrl}/api/project`).then(response => response.json());
    assert.equal(project.data.mode, 'multi-master');
    assert.equal(project.data.totals.languages, 9);
    assert.equal(project.data.totals.fileTasks, 259);
    assert.equal(project.data.totals.pendingFiles, 0);

    const editorManifest = await fetch(`${panelUrl}/api/editor/manifest`).then(response => response.json());
    assert.equal(editorManifest.data.editable, false);
    assert.equal(editorManifest.data.writeToken, undefined);
    assert.equal(editorManifest.data.languages.length, 9);
    assert.equal(editorManifest.data.files.length, 37);
    assert.equal(editorManifest.data.routes.length, 2);
    const firstEditorFile = editorManifest.data.files[0];
    const editorFile = await fetch(
      `${panelUrl}/api/editor/file?${new URLSearchParams({ path: firstEditorFile.relativePath })}`,
    ).then(response => response.json());
    assert.ok(editorFile.data.rows.length > 0);
    assert.equal(Object.keys(editorFile.data.revisions).length, 9);

    const forbiddenEditorWrite = await fetch(`${panelUrl}/api/editor/file`, {
      method: 'PUT',
      headers: { origin: panelUrl, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(forbiddenEditorWrite.status, 403);

    const refresh = await fetch(`${panelUrl}/api/scan`, {
      method: 'POST',
      headers: { origin: panelUrl },
    });
    assert.equal(refresh.status, 200);
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
  }
}

async function verifyEditablePanel(binPath) {
  const child = spawn(binPath, ['panel', '--edit', '--no-open', '--port', '0'], {
    cwd: workspaceRoot,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const cachePath = path.join(workspaceRoot, 'state/cache.json');
  const snapshotPath = path.join(workspaceRoot, 'state/cache.snapshot.json');
  let targetPath;
  let originalTarget;
  let originalSnapshot;
  try {
    const panelUrl = await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Timed out waiting for the editable installed panel.\n${output}`));
      }, 15_000);
      const inspect = chunk => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (!match || settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(match[0]);
      };
      child.stdout.on('data', inspect);
      child.stderr.on('data', inspect);
      child.once('exit', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Editable installed panel exited before startup (${code}).\n${output}`));
      });
      child.once('error', reject);
    });

    const manifest = await fetch(`${panelUrl}/api/editor/manifest`).then(response => response.json());
    assert.equal(manifest.data.editable, true);
    assert.ok(manifest.data.writeToken);
    const relativePath = manifest.data.files[0].relativePath;
    const file = await fetch(
      `${panelUrl}/api/editor/file?${new URLSearchParams({ path: relativePath })}`,
    ).then(response => response.json());
    const targetLang = manifest.data.routes[0].languages[1];
    const row = file.data.rows.find(candidate => candidate.cells[targetLang]?.kind === 'string');
    assert.ok(row, `Expected ${relativePath} to contain an editable ${targetLang} string`);

    targetPath = path.join(workspaceRoot, 'locales', targetLang, ...relativePath.split('/'));
    [originalTarget, originalSnapshot] = await Promise.all([
      fs.readFile(targetPath),
      fs.readFile(snapshotPath),
    ]);
    const originalCache = await fs.readFile(cachePath);
    const originalValue = row.cells[targetLang].value;
    const saved = await fetch(`${panelUrl}/api/editor/file`, {
      method: 'PUT',
      headers: {
        origin: panelUrl,
        'content-type': 'application/json',
        'x-i18n-panel-token': manifest.data.writeToken,
      },
      body: JSON.stringify({
        relativePath,
        revisions: file.data.revisions,
        snapshotRevision: file.data.snapshotRevision,
        changes: [{ lang: targetLang, pointer: row.pointer, value: `${originalValue} [editor-smoke]` }],
      }),
    });
    const savedBody = await saved.json();
    assert.equal(saved.status, 200, JSON.stringify(savedBody));
    assert.ok(savedBody.data.savedLanguages.includes(targetLang));
    assert.notDeepEqual(await fs.readFile(targetPath), originalTarget);
    assert.deepEqual(await fs.readFile(cachePath), originalCache, 'Manual editing changed the translation cache');
  } finally {
    if (targetPath && originalTarget && originalSnapshot) {
      await Promise.all([
        fs.writeFile(targetPath, originalTarget),
        fs.writeFile(snapshotPath, originalSnapshot),
      ]);
    }
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
  }
}

async function verifyWorkspace() {
  const { binPath } = await prepareWorkspace();
  const manifest = await readJson(path.join(playgroundConsumerRoot, 'fixture-manifest.json'));
  const localesDir = path.join(workspaceRoot, 'locales');
  const cachePath = path.join(workspaceRoot, 'state/cache.json');
  const snapshotPath = path.join(workspaceRoot, 'state/cache.snapshot.json');

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

  await verifyPanel(binPath);
  await verifyEditablePanel(binPath);

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
    `${beforeFiles.length} JSON files, 259 translation file tasks, packaged panel ready, ` +
    '0 content changes, 0 LLM calls.',
  );
  console.log(`Workspace kept for manual acceptance: ${workspaceRoot}`);
}

if (mode === 'verify') {
  await verifyWorkspace();
} else {
  await prepareWorkspace();
}

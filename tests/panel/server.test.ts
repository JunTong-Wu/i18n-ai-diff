import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { EditorSyncEvent, ProjectScan } from '../../src/types/index.js';
import { RunningPanelServer, startPanelServer } from '../../src/panel/server.js';

const tempDirs: string[] = [];
const servers: RunningPanelServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('panel server', () => {
  it('serves the packaged client and read-only project APIs on loopback', async () => {
    const clientRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-panel-'));
    tempDirs.push(clientRoot);
    await fs.writeFile(
      path.join(clientRoot, 'index.html'),
      '<!doctype html><html><body><div id="root">Panel fixture</div></body></html>',
      'utf8',
    );

    const scan: ProjectScan = {
      projectRoot: '/tmp/project',
      configPath: '/tmp/project/i18n-translate.config.ts',
      mode: 'multi-master',
      localesDir: '/tmp/project/locales',
      model: 'test-model',
      scannedAt: '2026-07-16T00:00:00.000Z',
      routes: [],
      changes: [],
      cache: { path: '/tmp/project/cache.json', exists: true, version: '2.0.0', entries: 0 },
      snapshot: { path: '/tmp/project/cache.snapshot.json', exists: true, version: 3 },
      totals: {
        routes: 2,
        languages: 9,
        sourceFiles: 74,
        sourceKeys: 100,
        fileTasks: 259,
        pendingFiles: 0,
        pendingKeys: 0,
        removedKeys: 0,
      },
    };
    let scans = 0;
    const server = await startPanelServer(
      { scan: async () => { scans += 1; return scan; } },
      { port: 0, open: false, packageVersion: '1.2.0-test', clientRoot },
    );
    servers.push(server);

    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Panel fixture');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");

    const missingAsset = await fetch(`${server.url}/missing.svg`);
    expect(missingAsset.status).toBe(404);

    const health = await fetch(`${server.url}/api/health`).then(response => response.json());
    expect(health).toEqual({
      data: { status: 'ok', version: '1.2.0-test', localOnly: true, editable: false },
    });

    const expectedProject = {
      ...scan,
      version: '1.2.0-test',
      localOnly: true,
      capabilities: { contentEditing: false, aiTranslation: false },
    };

    const project = await fetch(`${server.url}/api/project`).then(response => response.json());
    expect(project).toEqual({ data: expectedProject });

    const refreshed = await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { origin: server.url },
    });
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toEqual({ data: expectedProject });
    expect(scans).toBe(2);

    const forbidden = await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { origin: 'https://example.com' },
    });
    expect(forbidden.status).toBe(403);

    const readonlyWrite = await fetch(`${server.url}/api/editor/file`, {
      method: 'PUT',
      headers: { origin: server.url, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(readonlyWrite.status).toBe(403);
  });

  it('requires edit mode, same-origin JSON, and the session write token', async () => {
    const clientRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-panel-edit-'));
    tempDirs.push(clientRoot);
    await fs.writeFile(path.join(clientRoot, 'index.html'), '<div id="root"></div>', 'utf8');
    const scan = createScan();
    let saves = 0;
    const file = {
      relativePath: 'common.json',
      revisions: { en: 'a', de: 'b' },
      snapshotRevision: null,
      rows: [],
    };
    const server = await startPanelServer({
      scan: async () => scan,
      getEditorManifest: async (editable, writeToken) => ({
        editable,
        writeToken,
        routes: [{ sourceLang: 'en', languages: ['en', 'de'] }],
        languages: ['en', 'de'],
        files: [],
      }),
      getEditorFile: async () => file,
      saveEditorFile: async () => {
        saves += 1;
        return { savedLanguages: ['de'], snapshotUpdated: true, file, project: scan };
      },
    }, {
      port: 0,
      open: false,
      editable: true,
      packageVersion: '1.2.0-test',
      clientRoot,
    });
    servers.push(server);

    const manifest = await fetch(`${server.url}/api/editor/manifest`).then(response => response.json());
    expect(manifest.data.editable).toBe(true);
    expect(manifest.data.writeToken).toEqual(expect.any(String));

    const request = {
      method: 'PUT',
      headers: { origin: server.url, 'content-type': 'application/json' },
      body: JSON.stringify({ relativePath: 'common.json', revisions: {}, snapshotRevision: null, changes: [] }),
    } as const;
    expect((await fetch(`${server.url}/api/editor/file`, request)).status).toBe(403);
    expect((await fetch(`${server.url}/api/editor/file`, {
      ...request,
      headers: {
        'content-type': 'application/json',
        'x-i18n-panel-token': manifest.data.writeToken,
      },
    })).status).toBe(403);
    expect((await fetch(`${server.url}/api/editor/file`, {
      ...request,
      headers: {
        ...request.headers,
        origin: 'https://example.com',
        'x-i18n-panel-token': manifest.data.writeToken,
      },
    })).status).toBe(403);
    expect((await fetch(`${server.url}/api/editor/file`, {
      ...request,
      headers: {
        origin: server.url,
        'content-type': 'text/plain',
        'x-i18n-panel-token': manifest.data.writeToken,
      },
    })).status).toBe(415);
    expect((await fetch(`${server.url}/api/editor/file`, {
      ...request,
      headers: {
        origin: server.url,
        'content-type': 'application/json',
        'x-i18n-panel-token': manifest.data.writeToken,
      },
      body: JSON.stringify({ content: 'x'.repeat(5 * 1024 * 1024) }),
    })).status).toBe(413);

    const saved = await fetch(`${server.url}/api/editor/file`, {
      ...request,
      headers: {
        ...request.headers,
        'x-i18n-panel-token': manifest.data.writeToken,
      },
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      data: {
        savedLanguages: ['de'],
        snapshotUpdated: true,
        file,
        project: {
          ...scan,
          version: '1.2.0-test',
          localOnly: true,
          capabilities: { contentEditing: true, aiTranslation: true },
        },
      },
    });
    expect(saves).toBe(1);
  });

  it('serves read-only editor workspace search without a write token', async () => {
    const clientRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-panel-search-'));
    tempDirs.push(clientRoot);
    await fs.writeFile(path.join(clientRoot, 'index.html'), '<div id="root"></div>', 'utf8');
    const scan = createScan();
    const searchCalls: unknown[] = [];
    const server = await startPanelServer({
      scan: async () => scan,
      searchEditorCopy: async request => {
        searchCalls.push(request);
        return {
          query: request.query,
          total: 1,
          limit: request.limit || 200,
          limited: false,
          searchedFiles: 1,
          results: [{
            relativePath: 'common.json',
            pointer: '/title',
            segments: ['title'],
            displayPath: 'title',
            lang: 'de',
            sourceLang: 'en',
            isMaster: false,
            value: 'Hallo',
            valueMatchRanges: [{ start: 0, end: 5 }],
            keyMatchRanges: [],
            cell: { kind: 'string', value: 'Hallo', pending: true, skipped: false },
          }],
        };
      },
    }, {
      port: 0,
      open: false,
      packageVersion: '1.2.0-test',
      clientRoot,
    });
    servers.push(server);

    const response = await fetch(`${server.url}/api/editor/search?q=Hallo&lang=de&state=pending&includeKeys=true&limit=25`);
    expect(response.status).toBe(200);
    expect(searchCalls).toEqual([{
      query: 'Hallo',
      languages: ['de'],
      states: ['pending'],
      includeKeys: true,
      limit: 25,
    }]);
    expect(await response.json()).toEqual({
      data: expect.objectContaining({
        query: 'Hallo',
        total: 1,
        results: [expect.objectContaining({ relativePath: 'common.json', pointer: '/title', lang: 'de' })],
      }),
    });
  });

  it('runs editable editor translation jobs behind the write token', async () => {
    const clientRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-panel-translate-'));
    tempDirs.push(clientRoot);
    await fs.writeFile(path.join(clientRoot, 'index.html'), '<div id="root"></div>', 'utf8');
    const scan = createScan();
    const server = await startPanelServer({
      scan: async () => scan,
      getEditorManifest: async (editable, writeToken) => ({
        editable,
        writeToken,
        routes: [{ sourceLang: 'en', languages: ['en', 'de'] }],
        languages: ['en', 'de'],
        files: [],
      }),
      translateEditorCells: async (_request, hooks) => {
        hooks?.onProgress?.([{
          lang: 'de',
          pointer: '/title',
          sourceLang: 'en',
          sourceText: 'Hello',
          translatedText: 'Hallo',
          status: 'translated',
          fromCache: false,
        }]);
        return [{
          lang: 'de',
          pointer: '/title',
          sourceLang: 'en',
          sourceText: 'Hello',
          translatedText: 'Hallo',
          status: 'translated',
          fromCache: false,
        }];
      },
      translateEditorMasterCells: async (_request, hooks) => {
        hooks?.onProgress?.([{
          lang: 'en',
          pointer: '/title',
          sourceLang: 'zh-Hans',
          sourceText: '你好',
          translatedText: 'Hello',
          status: 'translated',
          fromCache: false,
        }]);
        return [{
          lang: 'en',
          pointer: '/title',
          sourceLang: 'zh-Hans',
          sourceText: '你好',
          translatedText: 'Hello',
          status: 'translated',
          fromCache: false,
        }];
      },
    }, {
      port: 0,
      open: false,
      editable: true,
      packageVersion: '1.2.0-test',
      clientRoot,
    });
    servers.push(server);

    const manifest = await fetch(`${server.url}/api/editor/manifest`).then(response => response.json());
    const forbidden = await fetch(`${server.url}/api/editor/translate-jobs`, {
      method: 'POST',
      headers: { origin: server.url, 'content-type': 'application/json' },
      body: JSON.stringify({ relativePath: 'common.json', cells: [] }),
    });
    expect(forbidden.status).toBe(403);

    const created = await fetch(`${server.url}/api/editor/translate-jobs`, {
      method: 'POST',
      headers: {
        origin: server.url,
        'content-type': 'application/json',
        'x-i18n-panel-token': manifest.data.writeToken,
      },
      body: JSON.stringify({
        relativePath: 'common.json',
        revisions: { en: 'a', de: 'b' },
        snapshotRevision: null,
        cells: [{ lang: 'de', pointer: '/title' }],
      }),
    });
    expect(created.status).toBe(202);
    const createdBody = await created.json();
    expect(createdBody.data.status).toMatch(/queued|running|completed/u);

    let job = createdBody.data;
    for (let attempt = 0; attempt < 10 && job.status !== 'completed'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
      job = await fetch(`${server.url}/api/editor/translate-jobs/${job.id}`).then(response => response.json()).then(body => body.data);
    }
    expect(job.status).toBe('completed');
    expect(job.results).toEqual([
      expect.objectContaining({
        lang: 'de',
        pointer: '/title',
        translatedText: 'Hallo',
        status: 'translated',
      }),
    ]);

    const masterCreated = await fetch(`${server.url}/api/editor/master-translate-jobs`, {
      method: 'POST',
      headers: {
        origin: server.url,
        'content-type': 'application/json',
        'x-i18n-panel-token': manifest.data.writeToken,
      },
      body: JSON.stringify({
        relativePath: 'common.json',
        revisions: { en: 'a', de: 'b' },
        snapshotRevision: null,
        sourceLang: 'zh-Hans',
        targetLang: 'en',
        pointers: ['/title'],
      }),
    });
    expect(masterCreated.status).toBe(202);
    const masterCreatedBody = await masterCreated.json();
    let masterJob = masterCreatedBody.data;
    for (let attempt = 0; attempt < 10 && masterJob.status !== 'completed'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
      masterJob = await fetch(`${server.url}/api/editor/master-translate-jobs/${masterJob.id}`).then(response => response.json()).then(body => body.data);
    }
    expect(masterJob.status).toBe('completed');
    expect(masterJob.results).toEqual([
      expect.objectContaining({
        lang: 'en',
        pointer: '/title',
        sourceLang: 'zh-Hans',
        translatedText: 'Hello',
        status: 'translated',
      }),
    ]);
  });

  it('streams editor file sync events as server-sent events', async () => {
    const clientRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-panel-events-'));
    tempDirs.push(clientRoot);
    await fs.writeFile(path.join(clientRoot, 'index.html'), '<div id="root"></div>', 'utf8');
    const scan = createScan();
    const listeners: Array<(event: EditorSyncEvent) => void> = [];
    let unsubscribes = 0;
    const server = await startPanelServer({
      scan: async () => scan,
      subscribeToEditorEvents: listener => {
        listeners.push(listener);
        return () => {
          unsubscribes += 1;
        };
      },
    }, {
      port: 0,
      open: false,
      packageVersion: '1.2.0-test',
      clientRoot,
    });
    servers.push(server);

    const response = await fetch(`${server.url}/api/editor/events`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(listeners).toHaveLength(1);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    listeners[0]({
      type: 'editor:file-changed',
      id: 'event-1',
      timestamp: '2026-07-22T00:00:00.000Z',
      source: 'filesystem',
      relativePath: 'common.json',
      languages: ['en'],
      changes: ['change'],
    });

    const streamText = await readUntil(reader!, 'common.json');
    expect(streamText).toContain('event: editor:file-changed');
    expect(streamText).toContain('"relativePath":"common.json"');

    await reader!.cancel();
    await waitUntil(() => unsubscribes >= 1);
    expect(unsubscribes).toBeGreaterThanOrEqual(1);
  });
});

function createScan(): ProjectScan {
  return {
    projectRoot: '/tmp/project',
    configPath: '/tmp/project/i18n-translate.config.ts',
    mode: 'single-master',
    localesDir: '/tmp/project/locales',
    model: 'test-model',
    scannedAt: '2026-07-16T00:00:00.000Z',
    routes: [],
    changes: [],
    cache: { path: '/tmp/project/cache.json', exists: true, version: '2.0.0', entries: 0 },
    snapshot: { path: '/tmp/project/cache.snapshot.json', exists: false, version: null },
    totals: {
      routes: 1,
      languages: 2,
      sourceFiles: 1,
      sourceKeys: 1,
      fileTasks: 1,
      pendingFiles: 0,
      pendingKeys: 0,
      removedKeys: 0,
    },
  };
}

async function readUntil(
  reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> },
  expected: string,
): Promise<string> {
  const deadline = Date.now() + 1_000;
  let text = '';
  while (!text.includes(expected)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${expected}`);
    const result = await Promise.race([
      reader.read(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 20)),
    ]);
    if (!result) continue;
    if (result.done) break;
    if (result.value) text += Buffer.from(result.value).toString('utf8');
  }
  return text;
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

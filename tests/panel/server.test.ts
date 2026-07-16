import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ProjectScan } from '../../src/types/index.js';
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
      data: { status: 'ok', version: '1.2.0-test', localOnly: true },
    });

    const project = await fetch(`${server.url}/api/project`).then(response => response.json());
    expect(project.data).toMatchObject({
      mode: 'multi-master',
      version: '1.2.0-test',
      localOnly: true,
      totals: { languages: 9, fileTasks: 259, pendingFiles: 0 },
    });

    const refreshed = await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { origin: server.url },
    });
    expect(refreshed.status).toBe(200);
    expect(scans).toBe(2);

    const forbidden = await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { origin: 'https://example.com' },
    });
    expect(forbidden.status).toBe(403);
  });
});

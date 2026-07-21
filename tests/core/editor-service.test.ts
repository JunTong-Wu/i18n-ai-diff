import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createProjectSession } from '../../src/core/project-session.js';
import {
  decodeJsonPointer,
  EditorServiceError,
  encodeJsonPointer,
  commitEditorWrites,
  setStringAtPath,
} from '../../src/core/editor-service.js';
import type { TranslationResult, TranslationTask } from '../../src/types/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function createProject(): Promise<{ root: string; configPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-editor-'));
  tempDirs.push(root);
  await Promise.all([
    writeRaw(root, 'locales/en/common.json', '{\r\n    "section": {\r\n        "title": "Hello",\r\n        "a.b": {\r\n            "x/y": {\r\n                "~name": "Deep"\r\n            }\r\n        }\r\n    },\r\n    "count": 2\r\n}\r\n'),
    writeJson(root, 'locales/de/common.json', { section: { title: 'Hallo', 'a.b': { 'x/y': { '~name': 'Tief' } } }, count: 2 }),
    writeJson(root, 'locales/fr/common.json', { section: { title: 'Bonjour', 'a.b': { 'x/y': { '~name': 'Profond' } } }, count: 2 }),
    writeJson(root, 'cache.json', { version: '2.0.0', entries: { reviewed: { untouched: true } } }),
  ]);
  const configPath = path.join(root, 'i18n-translate.config.json');
  await writeJson(root, 'i18n-translate.config.json', {
    baseLang: 'en',
    targetLangs: ['de', 'fr'],
    localesDir: './locales',
    cachePath: './cache.json',
    llm: { apiKey: 'fixture-key', model: 'fixture-model' },
  });
  return { root, configPath };
}

describe('translation editor JSON paths', () => {
  it('round-trips RFC 6901 segments and does not treat dotted keys as nesting', () => {
    const segments = ['section', 'a.b', 'x/y', '~name'];
    const pointer = encodeJsonPointer(segments);
    expect(pointer).toBe('/section/a.b/x~1y/~0name');
    expect(decodeJsonPointer(pointer)).toEqual(segments);

    const content = { section: { 'a.b': {} }, count: 2 };
    setStringAtPath(content, segments, 'value');
    expect(content).toEqual({
      section: { 'a.b': { 'x/y': { '~name': 'value' } } },
      count: 2,
    });
  });

  it('refuses to traverse through a non-object value', () => {
    expect(() => setStringAtPath({ section: 'text' }, ['section', 'title'], 'value'))
      .toThrowError(EditorServiceError);
  });
});

describe('translation editor save semantics', () => {
  it('preserves formatting and non-string values while making source-only edits pending', async () => {
    const { root, configPath } = await createProject();
    const session = await createProjectSession({ cwd: root, configPath });
    const beforeCache = await fs.readFile(path.join(root, 'cache.json'), 'utf8');
    const file = await session.getEditorFile('common.json');
    expect(file.rows.some(row => row.pointer === '/section/a.b/x~1y/~0name')).toBe(true);

    const result = await session.saveEditorFile({
      relativePath: 'common.json',
      revisions: file.revisions,
      snapshotRevision: file.snapshotRevision,
      changes: [{ lang: 'en', pointer: '/section/title', value: 'Hello now' }],
    });

    const raw = await fs.readFile(path.join(root, 'locales/en/common.json'), 'utf8');
    expect(raw).toContain('\r\n    "section"');
    expect(raw.endsWith('\r\n')).toBe(true);
    expect(JSON.parse(raw).count).toBe(2);
    expect(result.project.totals.pendingKeys).toBe(2);
    expect(result.project.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetLang: 'de', keys: expect.objectContaining({ modified: ['section.title'] }) }),
      expect.objectContaining({ targetLang: 'fr', keys: expect.objectContaining({ modified: ['section.title'] }) }),
    ]));
    expect(await fs.readFile(path.join(root, 'cache.json'), 'utf8')).toBe(beforeCache);
    expect(JSON.parse(await fs.readFile(path.join(root, 'cache.snapshot.json'), 'utf8')).version).toBe(3);
  });

  it('marks only manually edited targets reviewed when source and target are saved together', async () => {
    const { root, configPath } = await createProject();
    const session = await createProjectSession({ cwd: root, configPath });
    const file = await session.getEditorFile('common.json');

    const result = await session.saveEditorFile({
      relativePath: 'common.json',
      revisions: file.revisions,
      snapshotRevision: file.snapshotRevision,
      changes: [
        { lang: 'en', pointer: '/section/title', value: 'Welcome' },
        { lang: 'de', pointer: '/section/title', value: 'Willkommen' },
      ],
    });

    expect(result.project.changes.some(change => change.targetLang === 'de' && change.keys.modified.includes('section.title'))).toBe(false);
    expect(result.project.changes.some(change => change.targetLang === 'fr' && change.keys.modified.includes('section.title'))).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(root, 'locales/de/common.json'), 'utf8')).section.title).toBe('Willkommen');
  });

  it('creates a missing target file only from existing logical keys', async () => {
    const { root, configPath } = await createProject();
    await fs.rm(path.join(root, 'locales/fr/common.json'));
    const session = await createProjectSession({ cwd: root, configPath });
    const file = await session.getEditorFile('common.json');
    expect(file.revisions.fr).toBeNull();

    await session.saveEditorFile({
      relativePath: 'common.json',
      revisions: file.revisions,
      snapshotRevision: file.snapshotRevision,
      changes: [{ lang: 'fr', pointer: '/section/title', value: 'Bonjour' }],
    });
    expect(JSON.parse(await fs.readFile(path.join(root, 'locales/fr/common.json'), 'utf8'))).toEqual({
      section: { title: 'Bonjour' },
    });
  });

  it('generates selected AI drafts from the current source draft and caches them only after save', async () => {
    const { root, configPath } = await createProject();
    const session = await createProjectSession({ cwd: root, configPath });
    const translateBatch = vi.fn(async (tasks: TranslationTask[]): Promise<TranslationResult[]> =>
      tasks.map(task => ({
        key: task.key,
        translatedText: `${task.sourceLang}->${task.targetLang}:${task.sourceText}`,
        targetLang: task.targetLang,
        success: true,
      }))
    );
    (session as unknown as { editor: { llmClient: { translateBatch: typeof translateBatch } } }).editor.llmClient = { translateBatch };

    const file = await session.getEditorFile('common.json');
    const beforeTarget = await fs.readFile(path.join(root, 'locales/de/common.json'), 'utf8');
    const beforeCache = await fs.readFile(path.join(root, 'cache.json'), 'utf8');

    const results = await session.translateEditorCells({
      relativePath: 'common.json',
      revisions: file.revisions,
      snapshotRevision: file.snapshotRevision,
      cells: [{ lang: 'de', pointer: '/section/title' }],
      drafts: [{ lang: 'en', pointer: '/section/title', value: 'Hello from draft' }],
    });

    expect(results).toEqual([
      expect.objectContaining({
        lang: 'de',
        pointer: '/section/title',
        sourceLang: 'en',
        sourceText: 'Hello from draft',
        translatedText: 'en->de:Hello from draft',
        status: 'translated',
        fromCache: false,
      }),
    ]);
    expect(await fs.readFile(path.join(root, 'locales/de/common.json'), 'utf8')).toBe(beforeTarget);
    expect(await fs.readFile(path.join(root, 'cache.json'), 'utf8')).toBe(beforeCache);

    await session.saveEditorFile({
      relativePath: 'common.json',
      revisions: file.revisions,
      snapshotRevision: file.snapshotRevision,
      changes: [
        { lang: 'en', pointer: '/section/title', value: 'Hello from draft' },
        { lang: 'de', pointer: '/section/title', value: 'en->de:Hello from draft' },
      ],
      acceptedTranslations: [{
        lang: 'de',
        pointer: '/section/title',
        sourceLang: 'en',
        sourceText: 'Hello from draft',
        translatedText: 'en->de:Hello from draft',
      }],
    });

    const cache = JSON.parse(await fs.readFile(path.join(root, 'cache.json'), 'utf8'));
    expect(Object.values(cache.entries)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceLang: 'en',
        sourceText: 'Hello from draft',
        targetLang: 'de',
        translatedText: 'en->de:Hello from draft',
      }),
    ]));
  });

  it('does not cache accepted AI provenance after the target text is manually changed', async () => {
    const { root, configPath } = await createProject();
    const session = await createProjectSession({ cwd: root, configPath });
    const file = await session.getEditorFile('common.json');

    await session.saveEditorFile({
      relativePath: 'common.json',
      revisions: file.revisions,
      snapshotRevision: file.snapshotRevision,
      changes: [{ lang: 'de', pointer: '/section/title', value: 'Manuell geändert' }],
      acceptedTranslations: [{
        lang: 'de',
        pointer: '/section/title',
        sourceLang: 'en',
        sourceText: 'Hello',
        translatedText: 'AI text that was edited',
      }],
    });

    const cache = JSON.parse(await fs.readFile(path.join(root, 'cache.json'), 'utf8'));
    expect(Object.values(cache.entries).some(entry => (
      (entry as { translatedText?: string }).translatedText === 'AI text that was edited'
    ))).toBe(false);
  });

  it('rejects stale revisions without overwriting the external edit', async () => {
    const { root, configPath } = await createProject();
    const session = await createProjectSession({ cwd: root, configPath });
    const file = await session.getEditorFile('common.json');
    await writeJson(root, 'locales/de/common.json', { section: { title: 'Extern geändert' } });

    await expect(session.saveEditorFile({
      relativePath: 'common.json',
      revisions: file.revisions,
      snapshotRevision: file.snapshotRevision,
      changes: [{ lang: 'de', pointer: '/section/title', value: 'Mein Entwurf' }],
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 409 });
    expect(JSON.parse(await fs.readFile(path.join(root, 'locales/de/common.json'), 'utf8')).section.title).toBe('Extern geändert');
  });

  it('rejects traversal, new keys, unknown languages, and symlink locale paths', async () => {
    const { root, configPath } = await createProject();
    const session = await createProjectSession({ cwd: root, configPath });
    await expect(session.getEditorFile('../common.json')).rejects.toMatchObject({ code: 'INVALID_PATH' });

    const file = await session.getEditorFile('common.json');
    await expect(session.saveEditorFile({
      relativePath: 'common.json',
      revisions: file.revisions,
      snapshotRevision: file.snapshotRevision,
      changes: [{ lang: 'de', pointer: '/brand/new', value: 'Neu' }],
    })).rejects.toMatchObject({ code: 'NEW_KEY_NOT_ALLOWED' });
    await expect(session.saveEditorFile({
      relativePath: 'common.json',
      revisions: file.revisions,
      snapshotRevision: file.snapshotRevision,
      changes: [{ lang: 'xx', pointer: '/section/title', value: 'Nope' }],
    })).rejects.toMatchObject({ code: 'UNKNOWN_LANGUAGE' });

    const linkedPath = path.join(root, 'locales/de/linked.json');
    await fs.symlink(path.join(root, 'locales/en/common.json'), linkedPath);
    await expect(session.getEditorFile('linked.json')).rejects.toMatchObject({ code: 'SYMLINK_PATH' });
  });

  it('rolls back an earlier atomic replacement when a later replacement fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-editor-rollback-'));
    tempDirs.push(root);
    const first = path.join(root, 'first.json');
    const blocked = path.join(root, 'blocked.json');
    await fs.writeFile(first, 'before', 'utf8');
    await fs.mkdir(blocked);

    await expect(commitEditorWrites([
      { filePath: first, original: 'before', content: 'after' },
      { filePath: blocked, original: null, content: 'cannot replace a directory' },
    ])).rejects.toBeDefined();
    expect(await fs.readFile(first, 'utf8')).toBe('before');
    expect((await fs.stat(blocked)).isDirectory()).toBe(true);
    expect((await fs.readdir(root)).some(name => name.endsWith('.tmp'))).toBe(false);
  });
});

async function writeJson(root: string, relativePath: string, content: unknown): Promise<void> {
  await writeRaw(root, relativePath, JSON.stringify(content, null, 2));
}

async function writeRaw(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

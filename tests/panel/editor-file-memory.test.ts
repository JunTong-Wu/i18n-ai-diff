import { describe, expect, it } from 'vitest';
import {
  readInitialEditorPath,
  readRememberedEditorPath,
  rememberEditorPath,
  resolveEditorPath,
  type EditorFileStorage,
} from '../../panel/src/editor/file-memory.js';

describe('copy editor file memory', () => {
  it('lets an explicit URL file win over remembered history', () => {
    expect(resolveEditorPath(
      ['common.json', 'pages/home.json'],
      'common.json',
      'pages/home.json',
    )).toBe('common.json');
  });

  it('restores the remembered project file when the editor route has no file query', () => {
    const storage = createStorage();
    rememberEditorPath(storage, 'pages/home.json', '/workspace/a');

    expect(readRememberedEditorPath(storage, '/workspace/a')).toBe('pages/home.json');
    expect(resolveEditorPath(
      ['common.json', 'pages/home.json'],
      '',
      readRememberedEditorPath(storage, '/workspace/a'),
    )).toBe('pages/home.json');
  });

  it('keeps file memory isolated between local projects', () => {
    const storage = createStorage();
    rememberEditorPath(storage, 'common.json', '/workspace/a');
    rememberEditorPath(storage, 'pages/home.json', '/workspace/b');

    expect(readRememberedEditorPath(storage, '/workspace/a')).toBe('common.json');
    expect(readRememberedEditorPath(storage, '/workspace/b')).toBe('pages/home.json');
  });

  it('falls back to the first manifest file when remembered history is stale', () => {
    expect(resolveEditorPath(
      ['common.json', 'pages/home.json'],
      '',
      'deleted.json',
    )).toBe('common.json');
  });

  it('reads the initial file from the editor URL search', () => {
    expect(readInitialEditorPath('?file=pages%2Fhome.json')).toBe('pages/home.json');
  });
});

function createStorage(): EditorFileStorage {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

import { describe, expect, it } from 'vitest';
import type { EditorFile } from '../../src/types/index.js';
import {
  applyHistoryTransaction,
  createEditorPatches,
  draftIdentity,
  rebaseDrafts,
} from '../../panel/src/editor/model.js';

describe('table editor draft model', () => {
  it('turns language/pointer drafts into save patches', () => {
    const drafts = new Map([
      [draftIdentity('de', '/section/title'), 'Hallo'],
      [draftIdentity('ja', '/section/title'), 'こんにちは'],
    ]);
    expect(createEditorPatches(drafts)).toEqual([
      { lang: 'de', pointer: '/section/title', value: 'Hallo' },
      { lang: 'ja', pointer: '/section/title', value: 'こんにちは' },
    ]);
  });

  it('undoes and redoes a rectangular transaction as one unit', () => {
    const transaction = [
      { identity: draftIdentity('de', '/a'), before: undefined, after: 'A' },
      { identity: draftIdentity('fr', '/a'), before: 'old', after: 'B' },
    ];
    const current = new Map([
      [draftIdentity('de', '/a'), 'A'],
      [draftIdentity('fr', '/a'), 'B'],
    ]);
    const undone = applyHistoryTransaction(current, transaction, 'undo');
    expect(undone.has(draftIdentity('de', '/a'))).toBe(false);
    expect(undone.get(draftIdentity('fr', '/a'))).toBe('old');
    expect(applyHistoryTransaction(undone, transaction, 'redo')).toEqual(current);
  });

  it('rebases unrelated disk edits and surfaces same-cell conflicts', () => {
    const previous = editorFile('Hello', 'Hallo');
    const latest = editorFile('Hello from disk', 'Extern');
    const drafts = new Map([
      [draftIdentity('de', '/title'), 'Mein Entwurf'],
      [draftIdentity('de', '/description'), 'Beschreibung'],
    ]);
    const result = rebaseDrafts(previous, latest, drafts);

    expect(result.drafts.get(draftIdentity('de', '/description'))).toBe('Beschreibung');
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        lang: 'de',
        pointer: '/title',
        originalValue: 'Hallo',
        diskValue: 'Extern',
        draftValue: 'Mein Entwurf',
        canKeepDraft: true,
      }),
    ]);
  });
});

function editorFile(sourceTitle: string, targetTitle: string): EditorFile {
  return {
    relativePath: 'common.json',
    revisions: { en: sourceTitle, de: targetTitle },
    snapshotRevision: null,
    rows: [
      {
        id: '/title',
        pointer: '/title',
        segments: ['title'],
        displayPath: 'title',
        cells: {
          en: { kind: 'string', value: sourceTitle, pending: false, skipped: false },
          de: { kind: 'string', value: targetTitle, pending: false, skipped: false },
        },
      },
      {
        id: '/description',
        pointer: '/description',
        segments: ['description'],
        displayPath: 'description',
        cells: {
          en: { kind: 'string', value: 'Description', pending: false, skipped: false },
          de: { kind: 'missing', pending: true, skipped: false },
        },
      },
    ],
  };
}

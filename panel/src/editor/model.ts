import type { EditorCell, EditorFile, EditorPatch, EditorRow } from '../../../src/types/index';
import type { PanelEditorManifest } from '../types';

export type DraftMap = Map<string, string>;

export interface DraftHistoryChange {
  identity: string;
  before: string | undefined;
  after: string | undefined;
}

export type DraftHistoryTransaction = DraftHistoryChange[];

export interface DraftConflict {
  identity: string;
  lang: string;
  pointer: string;
  displayPath: string;
  originalValue: string | undefined;
  diskValue: string | undefined;
  draftValue: string;
  canKeepDraft: boolean;
  resolution?: 'draft' | 'disk';
}

export interface RebaseResult {
  drafts: DraftMap;
  conflicts: DraftConflict[];
}

export function draftIdentity(lang: string, pointer: string): string {
  return `${lang}\0${pointer}`;
}

export function parseDraftIdentity(identity: string): { lang: string; pointer: string } {
  const separator = identity.indexOf('\0');
  return { lang: identity.slice(0, separator), pointer: identity.slice(separator + 1) };
}

export function draftForValue(
  cell: EditorCell,
  value: string,
): string | undefined {
  return cell.kind === 'string' && cell.value === value ? undefined : value;
}

export function effectiveCellValue(
  row: EditorRow,
  lang: string,
  drafts: DraftMap,
): string {
  const draft = drafts.get(draftIdentity(lang, row.pointer));
  if (draft !== undefined) return draft;
  return row.cells[lang]?.kind === 'string' ? row.cells[lang].value || '' : '';
}

export function createEditorPatches(drafts: DraftMap): EditorPatch[] {
  return [...drafts.entries()].map(([identity, value]) => {
    const { lang, pointer } = parseDraftIdentity(identity);
    return { lang, pointer, value };
  });
}

export function applyHistoryTransaction(
  drafts: DraftMap,
  transaction: DraftHistoryTransaction,
  direction: 'undo' | 'redo',
): DraftMap {
  const next = new Map(drafts);
  for (const change of transaction) {
    const value = direction === 'undo' ? change.before : change.after;
    if (value === undefined) next.delete(change.identity);
    else next.set(change.identity, value);
  }
  return next;
}

export function rebaseDrafts(
  previous: EditorFile,
  latest: EditorFile,
  drafts: DraftMap,
): RebaseResult {
  const previousRows = new Map(previous.rows.map(row => [row.pointer, row]));
  const latestRows = new Map(latest.rows.map(row => [row.pointer, row]));
  const rebased = new Map<string, string>();
  const conflicts: DraftConflict[] = [];

  for (const [identity, draftValue] of drafts) {
    const { lang, pointer } = parseDraftIdentity(identity);
    const previousRow = previousRows.get(pointer);
    const latestRow = latestRows.get(pointer);
    if (!previousRow || !latestRow) {
      conflicts.push({
        identity,
        lang,
        pointer,
        displayPath: previousRow?.displayPath || latestRow?.displayPath || pointer,
        originalValue: previousRow ? cellString(previousRow.cells[lang]) : undefined,
        diskValue: latestRow ? cellString(latestRow.cells[lang]) : undefined,
        draftValue,
        canKeepDraft: Boolean(latestRow && latestRow.cells[lang]?.kind !== 'unsupported'),
      });
      continue;
    }

    const previousCell = previousRow.cells[lang];
    const latestCell = latestRow.cells[lang];
    const oldValue = cellString(previousCell);
    const diskValue = cellString(latestCell);
    if (latestCell?.kind === 'string' && diskValue === draftValue) continue;
    if (sameCell(previousCell, latestCell)) {
      rebased.set(identity, draftValue);
      continue;
    }
    conflicts.push({
      identity,
      lang,
      pointer,
      displayPath: latestRow.displayPath,
      originalValue: oldValue,
      diskValue,
      draftValue,
      canKeepDraft: latestCell?.kind !== 'unsupported',
    });
  }
  return { drafts: rebased, conflicts };
}

export function groupManifestFiles(manifest: PanelEditorManifest): Array<{
  directory: string;
  files: PanelEditorManifest['files'];
}> {
  const groups = new Map<string, PanelEditorManifest['files']>();
  for (const file of manifest.files) {
    const separator = file.relativePath.lastIndexOf('/');
    const directory = separator === -1 ? 'Root' : file.relativePath.slice(0, separator);
    const files = groups.get(directory) || [];
    files.push(file);
    groups.set(directory, files);
  }
  return [...groups.entries()].map(([directory, files]) => ({ directory, files }));
}

function sameCell(left: EditorCell | undefined, right: EditorCell | undefined): boolean {
  return left?.kind === right?.kind && cellString(left) === cellString(right);
}

function cellString(cell: EditorCell | undefined): string | undefined {
  return cell?.kind === 'string' ? cell.value || '' : undefined;
}

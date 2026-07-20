import {
  ArrowUUpLeft,
  ArrowUUpRight,
  FileText,
  FloppyDisk,
  Lock,
  SidebarSimple,
  SlidersHorizontal,
  WarningCircle,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadEditorFile,
  loadEditorManifest,
  PanelApiError,
  saveEditorFile,
} from '../api';
import type {
  PanelEditorFile,
  PanelEditorManifest,
  PanelProject,
} from '../types';
import { PanelLayout } from '../layout/PanelLayout';
import { ConflictModal } from './ConflictModal';
import { FileDrawer } from './FileDrawer';
import { TranslationGrid, type GridValueChange } from './TranslationGrid';
import { ToolsDrawer } from './ToolsDrawer';
import {
  applyHistoryTransaction,
  createEditorPatches,
  draftForValue,
  draftIdentity,
  effectiveCellValue,
  groupManifestFiles,
  rebaseDrafts,
  type DraftConflict,
  type DraftHistoryTransaction,
  type DraftMap,
} from './model';
import {
  readInitialEditorPath,
  readRememberedEditorPath,
  rememberEditorPath,
  resolveEditorPath,
} from './file-memory';

interface EditorPageProps {
  project: PanelProject | null;
  onNavigate(href: string): void;
  onProjectChange(project: PanelProject): void;
}

type PendingNavigation =
  | { kind: 'file'; relativePath: string }
  | { kind: 'panel'; href: string };

export default function EditorPage({ project, onNavigate, onProjectChange }: EditorPageProps) {
  const initialPath = readInitialEditorPath(window.location.search);
  const [manifest, setManifest] = useState<PanelEditorManifest | null>(null);
  const [file, setFile] = useState<PanelEditorFile | null>(null);
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [fileSearch, setFileSearch] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [showMissing, setShowMissing] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [showChanged, setShowChanged] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<'files' | 'tools' | null>(null);
  const [drafts, setDrafts] = useState<DraftMap>(new Map());
  const [undoStack, setUndoStack] = useState<DraftHistoryTransaction[]>([]);
  const [redoStack, setRedoStack] = useState<DraftHistoryTransaction[]>([]);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [conflicts, setConflicts] = useState<DraftConflict[] | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const refreshManifest = useCallback(async (signal?: AbortSignal) => {
    const nextManifest = await loadEditorManifest(signal);
    setManifest(nextManifest);
    setSelectedPath(current => {
      const rememberedPath = readRememberedEditorPath(
        window.localStorage,
        nextManifest.projectRoot || project?.projectRoot,
      );
      return resolveEditorPath(
        nextManifest.files.map(candidate => candidate.relativePath),
        current,
        rememberedPath,
      );
    });
    return nextManifest;
  }, [project?.projectRoot]);

  useEffect(() => {
    const controller = new AbortController();
    setManifestLoading(true);
    setError(null);
    void refreshManifest(controller.signal)
      .catch(requestError => {
        if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
      })
      .finally(() => setManifestLoading(false));
    return () => controller.abort();
  }, [refreshManifest]);

  useEffect(() => {
    if (!selectedPath) {
      setFile(null);
      return undefined;
    }
    const controller = new AbortController();
    setFileLoading(true);
    setError(null);
    setStatus('');
    void loadEditorFile(selectedPath, controller.signal)
      .then(nextFile => {
        setFile(nextFile);
        const empty = new Map<string, string>();
        setDrafts(empty);
        draftsRef.current = empty;
        setUndoStack([]);
        setRedoStack([]);
        setConflicts(null);
        rememberEditorPath(
          window.localStorage,
          selectedPath,
          manifest?.projectRoot || project?.projectRoot,
        );
        const url = new URL(window.location.href);
        url.pathname = '/editor';
        url.searchParams.set('file', selectedPath);
        window.history.replaceState(null, '', url);
      })
      .catch(requestError => {
        if ((requestError as Error).name !== 'AbortError') {
          setFile(null);
          setError((requestError as Error).message);
        }
      })
      .finally(() => setFileLoading(false));
    return () => controller.abort();
  }, [selectedPath]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (draftsRef.current.size === 0) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const filteredFiles = useMemo(() => {
    if (!manifest) return [];
    const query = fileSearch.trim().toLocaleLowerCase();
    return query
      ? manifest.files.filter(candidate => candidate.relativePath.toLocaleLowerCase().includes(query))
      : manifest.files;
  }, [fileSearch, manifest]);

  const fileGroups = useMemo(() => manifest
    ? groupManifestFiles({ ...manifest, files: filteredFiles })
    : [], [filteredFiles, manifest]);

  const visibleRows = useMemo(() => {
    if (!file || !manifest) return [];
    const query = rowSearch.trim().toLocaleLowerCase();
    return file.rows.filter(row => {
      const hasMissing = manifest.languages.some(lang => {
        const changed = drafts.has(draftIdentity(lang, row.pointer));
        return row.cells[lang]?.kind === 'missing' && !changed;
      });
      const hasPending = manifest.languages.some(lang => row.cells[lang]?.pending);
      const hasChanged = manifest.languages.some(lang => drafts.has(draftIdentity(lang, row.pointer)));
      if (showMissing && !hasMissing) return false;
      if (showPending && !hasPending) return false;
      if (showChanged && !hasChanged) return false;
      if (!query) return true;
      if (row.displayPath.toLocaleLowerCase().includes(query)) return true;
      return manifest.languages.some(
        lang => effectiveCellValue(row, lang, drafts).toLocaleLowerCase().includes(query),
      );
    });
  }, [drafts, file, manifest, rowSearch, showChanged, showMissing, showPending]);

  const rowsByPointer = useMemo(() => new Map(
    (file?.rows || []).map(row => [row.pointer, row]),
  ), [file]);

  const cellStateCounts = useMemo(() => {
    const counts = {
      changed: 0,
      pending: 0,
      missing: 0,
      skipped: 0,
    };
    if (!file || !manifest) return counts;
    for (const row of file.rows) {
      for (const lang of manifest.languages) {
        const cell = row.cells[lang];
        const changed = drafts.has(draftIdentity(lang, row.pointer));
        if (changed) counts.changed += 1;
        else if (cell?.pending) counts.pending += 1;
        if ((cell?.kind || 'missing') === 'missing' && !changed) counts.missing += 1;
        if (cell?.skipped) counts.skipped += 1;
      }
    }
    return counts;
  }, [drafts, file, manifest]);

  const selectedMeta = manifest?.files.find(candidate => candidate.relativePath === selectedPath);
  const editable = manifest?.editable === true;

  const handleGridChanges = useCallback((values: GridValueChange[]) => {
    if (!file || !manifest?.editable) return;
    const next = new Map(draftsRef.current);
    const transaction: DraftHistoryTransaction = [];
    for (const value of values) {
      if (!manifest.languages.includes(value.lang)) continue;
      const row = rowsByPointer.get(value.pointer);
      const cell = row?.cells[value.lang];
      if (!row || !cell || cell.kind === 'unsupported') continue;
      const identity = draftIdentity(value.lang, row.pointer);
      const before = next.get(identity);
      const after = draftForValue(cell, String(value.changedValue));
      if (before === after) continue;
      if (after === undefined) next.delete(identity);
      else next.set(identity, after);
      transaction.push({ identity, before, after });
    }
    if (transaction.length === 0) return;
    draftsRef.current = next;
    setDrafts(next);
    setUndoStack(current => [...current, transaction]);
    setRedoStack([]);
    setStatus(`${next.size} unsaved change${next.size === 1 ? '' : 's'}.`);
  }, [file, manifest, rowsByPointer]);

  const undo = useCallback(() => {
    const transaction = undoStack[undoStack.length - 1];
    if (!transaction) return;
    const next = applyHistoryTransaction(draftsRef.current, transaction, 'undo');
    draftsRef.current = next;
    setDrafts(next);
    setUndoStack(current => current.slice(0, -1));
    setRedoStack(current => [...current, transaction]);
  }, [undoStack]);

  const redo = useCallback(() => {
    const transaction = redoStack[redoStack.length - 1];
    if (!transaction) return;
    const next = applyHistoryTransaction(draftsRef.current, transaction, 'redo');
    draftsRef.current = next;
    setDrafts(next);
    setRedoStack(current => current.slice(0, -1));
    setUndoStack(current => [...current, transaction]);
  }, [redoStack]);

  useEffect(() => {
    const handleDraftHistory = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLocaleLowerCase() !== 'z') return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      if (event.shiftKey) {
        if (redoStack.length === 0) return;
        event.preventDefault();
        redo();
      } else {
        if (undoStack.length === 0) return;
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleDraftHistory);
    return () => window.removeEventListener('keydown', handleDraftHistory);
  }, [redo, redoStack.length, undo, undoStack.length]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!file || !manifest?.editable || !manifest.writeToken || draftsRef.current.size === 0) return true;
    const savingDrafts = new Map(draftsRef.current);
    setSaving(true);
    setError(null);
    setStatus('Writing locale files…');
    try {
      const result = await saveEditorFile({
        relativePath: file.relativePath,
        revisions: file.revisions,
        snapshotRevision: file.snapshotRevision,
        changes: createEditorPatches(savingDrafts),
      }, manifest.writeToken);
      setFile(result.file);
      const empty = new Map<string, string>();
      setDrafts(empty);
      draftsRef.current = empty;
      setUndoStack([]);
      setRedoStack([]);
      onProjectChange(result.project);
      await refreshManifest();
      setStatus(`Saved ${result.savedLanguages.length} language file${result.savedLanguages.length === 1 ? '' : 's'} safely.`);
      return true;
    } catch (requestError) {
      if (requestError instanceof PanelApiError && requestError.code === 'REVISION_CONFLICT') {
        try {
          const latest = await loadEditorFile(file.relativePath);
          const rebased = rebaseDrafts(file, latest, savingDrafts);
          setFile(latest);
          setDrafts(rebased.drafts);
          draftsRef.current = rebased.drafts;
          setUndoStack([]);
          setRedoStack([]);
          if (rebased.conflicts.length > 0) {
            setConflicts(rebased.conflicts);
            setStatus('The file changed on disk. Resolve the overlapping cells before saving again.');
          } else {
            setStatus('External changes were preserved and your draft was rebased. Review and save again.');
          }
        } catch (reloadError) {
          setError(`Could not reload the changed file: ${(reloadError as Error).message}`);
        }
        return false;
      }
      setError((requestError as Error).message);
      setStatus('Save failed. No unchecked overwrite was attempted.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [file, manifest, onProjectChange, refreshManifest]);

  const performNavigation = useCallback((destination: PendingNavigation) => {
    if (destination.kind === 'file') {
      setSelectedPath(destination.relativePath);
      setActiveDrawer(null);
      return;
    }

    setActiveDrawer(null);
    onNavigate(destination.href);
  }, [onNavigate]);

  const requestGuardedNavigation = useCallback((destination: PendingNavigation) => {
    if (destination.kind === 'file' && destination.relativePath === selectedPath) {
      setActiveDrawer(null);
      return;
    }

    if (draftsRef.current.size > 0) {
      setPendingNavigation(destination);
      return;
    }

    performNavigation(destination);
  }, [performNavigation, selectedPath]);

  const guardedNavigate = useCallback((href: string) => {
    requestGuardedNavigation({ kind: 'panel', href });
  }, [requestGuardedNavigation]);

  const requestFile = (relativePath: string) => {
    requestGuardedNavigation({ kind: 'file', relativePath });
  };

  const discardAndNavigate = () => {
    if (!pendingNavigation) return;
    const empty = new Map<string, string>();
    setDrafts(empty);
    draftsRef.current = empty;
    setUndoStack([]);
    setRedoStack([]);
    setConflicts(null);
    const destination = pendingNavigation;
    setPendingNavigation(null);
    performNavigation(destination);
  };

  const saveAndNavigate = async () => {
    if (!pendingNavigation) return;
    const destination = pendingNavigation;
    if (await save()) {
      setPendingNavigation(null);
      performNavigation(destination);
    }
  };

  const applyConflictResolutions = () => {
    if (!conflicts || conflicts.some(conflict => !conflict.resolution)) return;
    const next = new Map(draftsRef.current);
    for (const conflict of conflicts) {
      if (conflict.resolution === 'draft') next.set(conflict.identity, conflict.draftValue);
      else next.delete(conflict.identity);
    }
    setDrafts(next);
    draftsRef.current = next;
    setConflicts(null);
    setStatus('Conflicts resolved in the draft. Review the table and save again.');
  };

  const resolveConflict = useCallback((identity: string, resolution: 'disk' | 'draft') => {
    setConflicts(current => current?.map(item => (
      item.identity === identity ? { ...item, resolution } : item
    )) || null);
  }, []);

  const currentFileSummary = (
    <div className="editor-current-file">
      <span>Locale file</span>
      <strong title={selectedPath}>{selectedPath || 'No JSON files found'}</strong>
    </div>
  );

  const editorControls = (
    <div className="editor-operation-left">
      <button
        className={activeDrawer === 'files' ? 'editor-command-button is-active' : 'editor-command-button'}
        type="button"
        aria-label="Open locale files"
        aria-expanded={activeDrawer === 'files'}
        onClick={() => setActiveDrawer(current => (current === 'files' ? null : 'files'))}
      >
        <SidebarSimple size={20} aria-hidden="true" />
        <span>Files</span>
      </button>
      <button
        className={activeDrawer === 'tools' ? 'editor-command-button is-active' : 'editor-command-button'}
        type="button"
        aria-label="Open editor tools"
        aria-expanded={activeDrawer === 'tools'}
        onClick={() => setActiveDrawer(current => (current === 'tools' ? null : 'tools'))}
      >
        <SlidersHorizontal size={20} aria-hidden="true" />
        <span>Tools</span>
      </button>
      <div className="editor-history" aria-label="Draft history">
        <button type="button" disabled={undoStack.length === 0} onClick={undo} aria-label="Undo draft change">
          <ArrowUUpLeft size={20} aria-hidden="true" />
        </button>
        <button type="button" disabled={redoStack.length === 0} onClick={redo} aria-label="Redo draft change">
          <ArrowUUpRight size={20} aria-hidden="true" />
        </button>
      </div>
      {currentFileSummary}
    </div>
  );

  const saveButton = (
    <button
      className="scan-button editor-save-button"
      type="button"
      disabled={!editable || drafts.size === 0 || saving || !file}
      onClick={() => void save()}
    >
      <FloppyDisk size={22} weight="bold" aria-hidden="true" />
      <span>{saving ? 'Saving safely…' : `Save ${drafts.size} change${drafts.size === 1 ? '' : 's'}`}</span>
    </button>
  );

  const cellStateSummary = (
    <section className="editor-cell-state-summary" aria-label="Cell states">
      <strong>Cell states</strong>
      <div className="editor-state-legend">
        <span><i className="legend-dot is-changed" />Changed <b>{cellStateCounts.changed}</b></span>
        <span><i className="legend-dot is-pending" />Pending <b>{cellStateCounts.pending}</b></span>
        <span><i className="legend-dot is-missing" />Missing <b>{cellStateCounts.missing}</b></span>
        <span><i className="legend-dot is-skipped" />Skipped <b>{cellStateCounts.skipped}</b></span>
      </div>
    </section>
  );

  return (
    <PanelLayout
      activeView="editor"
      onNavigate={guardedNavigate}
      project={project}
      skipLabel="copy editor"
      shellClassName="is-editor-shell"
      workspaceClassName="editor-workspace"
      liveStatus={status}
    >
      <section className="editor-operation-bar" aria-label="Copy editor controls">
        {editorControls}
        <div className="editor-operation-right">
          {cellStateSummary}
          {saveButton}
        </div>
      </section>

      <div className="editor-table-stage">
        <div className="editor-floating-alerts">
        {!manifestLoading && manifest && !manifest.editable && (
          <section className="editor-readonly-banner" aria-label="Read-only editor">
            <Lock size={22} weight="fill" aria-hidden="true" />
            <div>
              <strong>Viewing local copy in read-only mode</strong>
              <span>Restart with <code>i18n-ai-diff panel --edit</code> to enable explicit file saves.</span>
            </div>
          </section>
        )}
        {error && (
          <div className="inline-error" role="alert">
            <WarningCircle size={21} weight="fill" aria-hidden="true" />
            <span><strong>Editor error.</strong> {error}</span>
          </div>
        )}
        </div>

        <section className="editor-table-panel" aria-label="Translation table">
          {manifestLoading || fileLoading ? (
            <div className="editor-table-loading" aria-label="Loading locale file">
              <div className="skeleton skeleton-metrics" />
              <div className="skeleton skeleton-route" />
              <div className="skeleton skeleton-route" />
            </div>
          ) : file && manifest ? (
            <TranslationGrid
              rows={visibleRows}
              manifest={manifest}
              drafts={drafts}
              editable={editable}
              onChangeValues={handleGridChanges}
            />
          ) : (
            <div className="editor-table-empty">
              <FileText size={28} aria-hidden="true" />
              <strong>Select a valid JSON file</strong>
              <span>The table will align every string leaf across configured languages.</span>
            </div>
          )}
        </section>
      </div>

      <FileDrawer
        fileGroups={fileGroups}
        fileSearch={fileSearch}
        isOpen={activeDrawer === 'files'}
        manifest={manifest}
        manifestLoading={manifestLoading}
        selectedPath={selectedPath}
        onClose={() => setActiveDrawer(null)}
        onFileSearchChange={setFileSearch}
        onRequestFile={requestFile}
      />

      <ToolsDrawer
        draftCount={drafts.size}
        editable={editable}
        isOpen={activeDrawer === 'tools'}
        languageCount={manifest?.languages.length || 0}
        rowSearch={rowSearch}
        selectedMeta={selectedMeta}
        showChanged={showChanged}
        showMissing={showMissing}
        showPending={showPending}
        status={status}
        totalRowCount={file?.rows.length || 0}
        visibleRowCount={visibleRows.length}
        onClose={() => setActiveDrawer(null)}
        onRowSearchChange={setRowSearch}
        onToggleChanged={() => setShowChanged(value => !value)}
        onToggleMissing={() => setShowMissing(value => !value)}
        onTogglePending={() => setShowPending(value => !value)}
      />

      {activeDrawer && <button className="drawer-scrim" type="button" onClick={() => setActiveDrawer(null)} aria-label="Close editor drawer" />}

      {pendingNavigation && (
        <div className="editor-modal-layer" role="presentation">
          <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="leave-title">
            <WarningCircle size={28} weight="fill" aria-hidden="true" />
            <div>
              <p className="section-kicker">Unsaved local draft</p>
              <h2 id="leave-title">
                {pendingNavigation.kind === 'file' ? 'Save before opening another file?' : 'Save before leaving the copy editor?'}
              </h2>
              <p>
                {drafts.size} changes belong to <strong>{selectedPath}</strong>.{' '}
                {pendingNavigation.kind === 'file'
                  ? 'They cannot follow you into another JSON file.'
                  : 'They stay in this browser draft until you save or discard them.'}
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="button-tertiary" onClick={() => setPendingNavigation(null)}>Stay here</button>
              <button type="button" className="button-secondary is-danger" onClick={discardAndNavigate}>Discard draft</button>
              <button type="button" className="button-primary" disabled={saving} onClick={() => void saveAndNavigate()}>
                {pendingNavigation.kind === 'file' ? 'Save and continue' : 'Save and leave'}
              </button>
            </div>
          </section>
        </div>
      )}

      {conflicts && (
        <ConflictModal
          conflicts={conflicts}
          onApply={applyConflictResolutions}
          onResolve={resolveConflict}
        />
      )}

    </PanelLayout>
  );
}

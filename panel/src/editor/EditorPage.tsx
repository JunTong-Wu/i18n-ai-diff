import {
  ArrowUUpLeft,
  ArrowUUpRight,
  CaretDown,
  CheckCircle,
  FileText,
  FloppyDisk,
  Folder,
  Funnel,
  List,
  Lock,
  MagnifyingGlass,
  SidebarSimple,
  SlidersHorizontal,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorRow } from '../../../src/types/index';
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
import { TranslationGrid, type GridValueChange } from './TranslationGrid';
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

interface EditorPageProps {
  project: PanelProject | null;
  onNavigate(href: string): void;
  onProjectChange(project: PanelProject): void;
}

export default function EditorPage({ project, onNavigate, onProjectChange }: EditorPageProps) {
  const initialPath = new URLSearchParams(window.location.search).get('file') || '';
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
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<DraftConflict[] | null>(null);
  const draftsRef = useRef(drafts);
  const visibleRowsRef = useRef<EditorRow[]>([]);
  draftsRef.current = drafts;

  const refreshManifest = useCallback(async (signal?: AbortSignal) => {
    const nextManifest = await loadEditorManifest(signal);
    setManifest(nextManifest);
    setSelectedPath(current => {
      if (current && nextManifest.files.some(candidate => candidate.relativePath === current)) return current;
      return nextManifest.files[0]?.relativePath || '';
    });
    return nextManifest;
  }, []);

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
  visibleRowsRef.current = visibleRows;

  const selectedMeta = manifest?.files.find(candidate => candidate.relativePath === selectedPath);
  const editable = manifest?.editable === true;

  const handleGridChanges = useCallback((values: GridValueChange[]) => {
    if (!file || !manifest?.editable) return;
    const next = new Map(draftsRef.current);
    const transaction: DraftHistoryTransaction = [];
    for (const value of values) {
      if (typeof value.recordIndex !== 'number' || typeof value.field !== 'string') continue;
      if (!manifest.languages.includes(value.field)) continue;
      const row = visibleRowsRef.current[value.recordIndex];
      const cell = row?.cells[value.field];
      if (!row || !cell || cell.kind === 'unsupported') continue;
      const identity = draftIdentity(value.field, row.pointer);
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
  }, [file, manifest]);

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
      onProjectChange({
        ...result.project,
        version: project?.version || '1.2.0',
        localOnly: true,
        capabilities: { contentEditing: true },
      });
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
  }, [file, manifest, onProjectChange, project?.version, refreshManifest]);

  const requestFile = (relativePath: string) => {
    if (relativePath === selectedPath) {
      setActiveDrawer(null);
      return;
    }
    if (draftsRef.current.size > 0) setPendingNavigation(relativePath);
    else {
      setSelectedPath(relativePath);
      setActiveDrawer(null);
    }
  };

  const discardAndNavigate = () => {
    if (!pendingNavigation) return;
    const empty = new Map<string, string>();
    setDrafts(empty);
    draftsRef.current = empty;
    setPendingNavigation(null);
    setSelectedPath(pendingNavigation);
    setActiveDrawer(null);
  };

  const saveAndNavigate = async () => {
    if (!pendingNavigation) return;
    const destination = pendingNavigation;
    if (await save()) {
      setPendingNavigation(null);
      setSelectedPath(destination);
      setActiveDrawer(null);
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

  return (
    <PanelLayout
      activeView="editor"
      onNavigate={onNavigate}
      project={project}
      skipLabel="copy editor"
      shellClassName="is-editor-shell"
      workspaceClassName="editor-workspace"
      liveStatus={status}
    >
      <section className="editor-operation-bar" aria-label="Copy editor controls">
        {editorControls}
        {saveButton}
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

      <aside className={activeDrawer === 'files' ? 'editor-drawer editor-file-panel is-open' : 'editor-drawer editor-file-panel'} aria-label="Locale files">
            <div className="file-panel-header">
              <div>
                <p className="section-kicker">Project files</p>
                <strong>{manifest?.files.length || 0} JSON files</strong>
              </div>
              <button className="file-panel-close" type="button" onClick={() => setActiveDrawer(null)} aria-label="Close file browser">
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <label className="file-search">
              <MagnifyingGlass size={17} aria-hidden="true" />
              <span className="sr-only">Search locale files</span>
              <input value={fileSearch} onChange={event => setFileSearch(event.target.value)} placeholder="Find a JSON file…" />
            </label>
            <div className="file-tree">
              {fileGroups.map(group => (
                <details key={group.directory} open>
                  <summary>
                    <Folder size={17} weight="fill" aria-hidden="true" />
                    <span title={group.directory}>{group.directory}</span>
                    <small>{group.files.length}</small>
                    <CaretDown className="folder-caret" size={14} aria-hidden="true" />
                  </summary>
                  <div className="file-group-list">
                    {group.files.map(candidate => (
                      <button
                        className={candidate.relativePath === selectedPath ? 'file-row is-active' : 'file-row'}
                        type="button"
                        key={candidate.relativePath}
                        onClick={() => requestFile(candidate.relativePath)}
                        title={candidate.relativePath}
                      >
                        <FileText size={17} aria-hidden="true" />
                        <span>{fileName(candidate.relativePath)}</span>
                        {candidate.invalidLanguages.length > 0
                          ? <WarningCircle className="file-state is-error" size={16} weight="fill" aria-label="Invalid JSON" />
                          : candidate.pendingKeys > 0
                            ? <span className="file-count is-pending" title={`${candidate.pendingKeys} pending cells`}>{candidate.pendingKeys}</span>
                            : candidate.missingLanguages.length > 0
                              ? <span className="file-count" title={`${candidate.missingLanguages.length} missing language files`}>{candidate.missingLanguages.length}</span>
                              : <CheckCircle className="file-state is-clear" size={16} weight="fill" aria-label="Complete" />}
                      </button>
                    ))}
                  </div>
                </details>
              ))}
              {!manifestLoading && fileGroups.length === 0 && (
                <div className="file-tree-empty"><List size={22} aria-hidden="true" />No matching JSON files</div>
              )}
            </div>
      </aside>

      <aside className={activeDrawer === 'tools' ? 'editor-drawer editor-controls-drawer is-open' : 'editor-drawer editor-controls-drawer'} aria-label="Editor tools">
        <div className="file-panel-header">
          <div>
            <p className="section-kicker">View controls</p>
            <strong>Search, filters, and states</strong>
          </div>
          <button className="file-panel-close" type="button" onClick={() => setActiveDrawer(null)} aria-label="Close editor tools">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <label className="editor-search">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <span className="sr-only">Search keys and copy</span>
          <input value={rowSearch} onChange={event => setRowSearch(event.target.value)} placeholder="Search keys or copy…" />
        </label>

        <div className="editor-filter-bar">
          <span><Funnel size={17} aria-hidden="true" /> Show rows</span>
          <FilterButton active={showMissing} onClick={() => setShowMissing(value => !value)}>Missing</FilterButton>
          <FilterButton active={showPending} onClick={() => setShowPending(value => !value)}>Pending</FilterButton>
          <FilterButton active={showChanged} onClick={() => setShowChanged(value => !value)}>Changed</FilterButton>
          <span className="editor-row-count">{visibleRows.length} of {file?.rows.length || 0} keys</span>
        </div>

        <section className="editor-state-card" aria-label="Cell state legend">
          <strong>Cell states</strong>
          <div className="editor-state-legend">
            <span><i className="legend-dot is-changed" />Changed</span>
            <span><i className="legend-dot is-pending" />Pending</span>
            <span><i className="legend-dot is-missing" />Missing</span>
            <span><i className="legend-dot is-skipped" />Skipped key</span>
          </div>
        </section>

        <section className="editor-state-card">
          <strong>Current file</strong>
          <dl className="editor-file-stats">
            <div>
              <dt>Visible keys</dt>
              <dd>{visibleRows.length}/{file?.rows.length || 0}</dd>
            </div>
            <div>
              <dt>Language files</dt>
              <dd>{selectedMeta ? `${selectedMeta.presentLanguages.length}/${manifest?.languages.length || 0}` : '0/0'}</dd>
            </div>
            <div>
              <dt>Draft changes</dt>
              <dd>{drafts.size}</dd>
            </div>
          </dl>
        </section>

        <section className="editor-state-card">
          <strong>Draft status</strong>
          <p>{status || (drafts.size > 0 ? `${drafts.size} changes remain in this browser.` : 'Local files match the current editor draft.')}</p>
        </section>

        <section className="editor-state-card">
          <strong>Editing</strong>
          <p>{editable ? 'Local editing is enabled. Saves are explicit and revision-checked.' : 'Viewing in read-only mode. Restart with i18n-ai-diff panel --edit to save file changes.'}</p>
          <small>Double-click or press Enter to edit. Shift+Enter adds a line.</small>
        </section>
      </aside>

      {activeDrawer && <button className="drawer-scrim" type="button" onClick={() => setActiveDrawer(null)} aria-label="Close editor drawer" />}

      {pendingNavigation && (
        <div className="editor-modal-layer" role="presentation">
          <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="leave-title">
            <WarningCircle size={28} weight="fill" aria-hidden="true" />
            <div>
              <p className="section-kicker">Unsaved local draft</p>
              <h2 id="leave-title">Save before opening another file?</h2>
              <p>{drafts.size} changes belong to <strong>{selectedPath}</strong>. They cannot follow you into another JSON file.</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="button-tertiary" onClick={() => setPendingNavigation(null)}>Stay here</button>
              <button type="button" className="button-secondary is-danger" onClick={discardAndNavigate}>Discard draft</button>
              <button type="button" className="button-primary" disabled={saving} onClick={() => void saveAndNavigate()}>Save and continue</button>
            </div>
          </section>
        </div>
      )}

      {conflicts && (
        <div className="editor-modal-layer" role="presentation">
          <section className="editor-modal conflict-modal" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
            <WarningCircle size={28} weight="fill" aria-hidden="true" />
            <div>
              <p className="section-kicker">External file change</p>
              <h2 id="conflict-title">Resolve overlapping cells</h2>
              <p>Unrelated disk changes are already preserved. Choose a value for each cell changed in both places.</p>
            </div>
            <div className="conflict-list">
              {conflicts.map(conflict => (
                <article className="conflict-item" key={conflict.identity}>
                  <header><strong>{conflict.lang}</strong><code>{conflict.displayPath}</code></header>
                  <div className="conflict-original">
                    <span>Originally loaded</span>
                    <small>{displayConflictValue(conflict.originalValue)}</small>
                  </div>
                  <div className="conflict-values">
                    <button
                      type="button"
                      className={conflict.resolution === 'disk' ? 'conflict-choice is-selected' : 'conflict-choice'}
                      onClick={() => setConflicts(current => current?.map(item => item.identity === conflict.identity ? { ...item, resolution: 'disk' } : item) || null)}
                    >
                      <span>Use disk</span>
                      <small>{displayConflictValue(conflict.diskValue)}</small>
                    </button>
                    <button
                      type="button"
                      className={conflict.resolution === 'draft' ? 'conflict-choice is-selected' : 'conflict-choice'}
                      disabled={!conflict.canKeepDraft}
                      onClick={() => setConflicts(current => current?.map(item => item.identity === conflict.identity ? { ...item, resolution: 'draft' } : item) || null)}
                    >
                      <span>Keep my draft</span>
                      <small>{conflict.canKeepDraft ? displayConflictValue(conflict.draftValue) : 'The key no longer exists in any language.'}</small>
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="button-primary" disabled={conflicts.some(conflict => !conflict.resolution)} onClick={applyConflictResolutions}>
                Apply resolutions
              </button>
            </div>
          </section>
        </div>
      )}

    </PanelLayout>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick(): void; children: string }) {
  return <button type="button" className={active ? 'filter-chip is-active' : 'filter-chip'} aria-pressed={active} onClick={onClick}>{children}</button>;
}

function fileName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1);
}

function displayConflictValue(value: string | undefined): string {
  if (value === undefined) return 'Missing';
  if (value === '') return 'Empty string';
  return value.length > 160 ? `${value.slice(0, 157)}…` : value;
}

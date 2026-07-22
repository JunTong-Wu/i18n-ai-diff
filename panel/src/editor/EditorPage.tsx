import {
  ArrowUUpLeft,
  ArrowUUpRight,
  CaretDown,
  FileText,
  FloppyDisk,
  Funnel,
  Lock,
  MagnifyingGlass,
  SlidersHorizontal,
  Sparkle,
  Translate,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelEditorTranslateJob,
  connectEditorEvents,
  createEditorTranslateJob,
  loadEditorFile,
  loadEditorManifest,
  loadEditorTranslateJob,
  PanelApiError,
  saveEditorFile,
} from '../api';
import type {
  PanelEditorAcceptedTranslation,
  PanelEditorFile,
  PanelEditorManifest,
  PanelEditorSearchResult,
  PanelEditorSyncEvent,
  PanelEditorTranslateJob,
  PanelEditorTranslateResult,
  PanelProject,
} from '../types';
import { usePanelErrorToast } from '../components/feedback/usePanelErrorToast';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog } from '../components/ui/dialog';
import { ModalActions, ModalContent, ModalHeader, ModalTitleBlock } from '../components/ui/modal';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Sheet, SheetContent, SheetTitle } from '../components/ui/sheet';
import { PanelLayout } from '../layout/PanelLayout';
import { ConflictModal } from './ConflictModal';
import {
  TranslationGrid,
  type GridCellTranslationState,
  type GridContextMenuRequest,
  type GridSelectionCell,
  type GridValueChange,
} from './TranslationGrid';
import { ToolsDrawer } from './ToolsDrawer';
import { WorkspaceSearchDialog } from './WorkspaceSearchDialog';
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
  | { kind: 'file'; relativePath: string; focus?: GridSelectionCell }
  | { kind: 'panel'; href: string };

interface TranslatePreviewState {
  title: string;
  cells: GridSelectionCell[];
  includeSkipped: boolean;
  overwriteDrafts: boolean;
}

interface TranslatePreview {
  cells: GridSelectionCell[];
  skipped: Array<GridSelectionCell & { reason: string }>;
}

type AiDraftMap = Map<string, PanelEditorAcceptedTranslation>;
type FailedTranslationMap = Map<string, GridSelectionCell & { error: string }>;

const POLL_INTERVAL_MS = 650;

type ExplorerStatusTone = 'clear' | 'pending' | 'missing' | 'invalid';

interface ExplorerStatusDecoration {
  tone: ExplorerStatusTone;
  badge: string;
  label: string;
}

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatExplorerBadge(prefix: string, count: number) {
  return `${prefix} ${count > 99 ? '99+' : count}`;
}

function getExplorerFileStatus(file: PanelEditorManifest['files'][number]): ExplorerStatusDecoration {
  if (file.invalidLanguages.length > 0) {
    return {
      tone: 'invalid',
      badge: '!',
      label: `Invalid JSON in ${file.invalidLanguages.join(', ')}`,
    };
  }

  if (file.missingLanguages.length > 0) {
    return {
      tone: 'missing',
      badge: formatExplorerBadge('U', file.missingLanguages.length),
      label: `Missing ${pluralize(file.missingLanguages.length, 'language file')}: ${file.missingLanguages.join(', ')}`,
    };
  }

  if (file.pendingKeys > 0) {
    return {
      tone: 'pending',
      badge: formatExplorerBadge('M', file.pendingKeys),
      label: `${pluralize(file.pendingKeys, 'pending key')} needs translation`,
    };
  }

  return {
    tone: 'clear',
    badge: '',
    label: 'No pending file work',
  };
}

function getExplorerGroupStatus(files: PanelEditorManifest['files']): ExplorerStatusDecoration {
  const invalidFiles = files.filter(file => file.invalidLanguages.length > 0).length;
  if (invalidFiles > 0) {
    return {
      tone: 'invalid',
      badge: String(invalidFiles),
      label: `${pluralize(invalidFiles, 'file')} with invalid JSON`,
    };
  }

  const missingFiles = files.filter(file => file.missingLanguages.length > 0).length;
  if (missingFiles > 0) {
    return {
      tone: 'missing',
      badge: String(missingFiles),
      label: `${pluralize(missingFiles, 'file')} missing language files`,
    };
  }

  const pendingKeys = files.reduce((total, file) => total + file.pendingKeys, 0);
  if (pendingKeys > 0) {
    const pendingFiles = files.filter(file => file.pendingKeys > 0).length;
    return {
      tone: 'pending',
      badge: pendingKeys > 99 ? '99+' : String(pendingKeys),
      label: `${pluralize(pendingKeys, 'pending key')} in ${pluralize(pendingFiles, 'file')}`,
    };
  }

  return {
    tone: 'clear',
    badge: '',
    label: 'No pending file work',
  };
}

interface EditorSyncStatus {
  label: string;
  tone: 'muted' | 'ok' | 'warning';
  title?: string;
}

interface EditorBroadcastMessage {
  sender: string;
  event: PanelEditorSyncEvent;
}

interface EditorFocusRequest extends GridSelectionCell {
  relativePath: string;
  nonce: number;
}

export default function EditorPage({ project, onNavigate, onProjectChange }: EditorPageProps) {
  const initialPath = readInitialEditorPath(window.location.search);
  const initialFocus = readInitialEditorFocus(window.location.search, initialPath);
  const [manifest, setManifest] = useState<PanelEditorManifest | null>(null);
  const [file, setFile] = useState<PanelEditorFile | null>(null);
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const [focusRequest, setFocusRequest] = useState<EditorFocusRequest | null>(initialFocus);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<EditorSyncStatus | null>(null);
  const [fileSearch, setFileSearch] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [showMissing, setShowMissing] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [showChanged, setShowChanged] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<'tools' | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftMap>(new Map());
  const [aiDrafts, setAiDrafts] = useState<AiDraftMap>(new Map());
  const [failedTranslations, setFailedTranslations] = useState<FailedTranslationMap>(new Map());
  const [translatingCells, setTranslatingCells] = useState<Set<string>>(new Set());
  const [selectedCells, setSelectedCells] = useState<GridSelectionCell[]>([]);
  const [translatePreview, setTranslatePreview] = useState<TranslatePreviewState | null>(null);
  const [activeJob, setActiveJob] = useState<PanelEditorTranslateJob | null>(null);
  const [contextMenu, setContextMenu] = useState<GridContextMenuRequest | null>(null);
  const [undoStack, setUndoStack] = useState<DraftHistoryTransaction[]>([]);
  const [redoStack, setRedoStack] = useState<DraftHistoryTransaction[]>([]);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [conflicts, setConflicts] = useState<DraftConflict[] | null>(null);
  const tabIdRef = useRef(createEditorTabId());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const seenSyncEventsRef = useRef<string[]>([]);
  const selectedPathRef = useRef(selectedPath);
  const translatingCellsRef = useRef(translatingCells);
  const activeJobRef = useRef(activeJob);
  const draftsRef = useRef(drafts);
  const aiDraftsRef = useRef(aiDrafts);
  selectedPathRef.current = selectedPath;
  translatingCellsRef.current = translatingCells;
  activeJobRef.current = activeJob;
  draftsRef.current = drafts;
  aiDraftsRef.current = aiDrafts;
  usePanelErrorToast(error, 'Editor error');
  usePanelErrorToast(translationError, 'Translation failed');

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

  const rememberSyncEvent = useCallback((id: string): boolean => {
    const seen = seenSyncEventsRef.current;
    if (seen.includes(id)) return false;
    seen.push(id);
    if (seen.length > 240) seen.splice(0, seen.length - 240);
    return true;
  }, []);

  const broadcastSyncEvent = useCallback((event: PanelEditorSyncEvent) => {
    channelRef.current?.postMessage({
      sender: tabIdRef.current,
      event,
    } satisfies EditorBroadcastMessage);
  }, []);

  const hasProtectedLocalState = useCallback(() => {
    const job = activeJobRef.current;
    const jobRunningNow = job?.status === 'queued' || job?.status === 'running';
    return draftsRef.current.size > 0 || translatingCellsRef.current.size > 0 || jobRunningNow;
  }, []);

  const resetTransientEditorState = useCallback(() => {
    const emptyDrafts = new Map<string, string>();
    const emptyAiDrafts = new Map<string, PanelEditorAcceptedTranslation>();
    setDrafts(emptyDrafts);
    draftsRef.current = emptyDrafts;
    setAiDrafts(emptyAiDrafts);
    aiDraftsRef.current = emptyAiDrafts;
    setFailedTranslations(new Map());
    setTranslationError(null);
    setTranslatingCells(new Set());
    setSelectedCells([]);
    setUndoStack([]);
    setRedoStack([]);
    setConflicts(null);
  }, []);

  const reloadCurrentFileFromDisk = useCallback(async (
    relativePath: string,
    label = 'Synced from disk',
  ) => {
    if (hasProtectedLocalState()) {
      setSyncStatus({
        tone: 'warning',
        label: 'Disk changed',
        title: 'The file changed on disk while this tab has a local draft or translation job. Save will still use revision checks before writing.',
      });
      setStatus('The current file changed on disk. Save will check revisions before writing.');
      return;
    }

    setFileLoading(true);
    try {
      const nextFile = await loadEditorFile(relativePath);
      if (selectedPathRef.current !== relativePath || hasProtectedLocalState()) return;
      setFile(nextFile);
      resetTransientEditorState();
      setSyncStatus({ tone: 'ok', label, title: `${relativePath} was reloaded from disk.` });
      setStatus(`${label}: ${relativePath}`);
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') {
        setSyncStatus({
          tone: 'warning',
          label: 'Sync needs review',
          title: (requestError as Error).message,
        });
        setError((requestError as Error).message);
      }
    } finally {
      setFileLoading(false);
    }
  }, [hasProtectedLocalState, resetTransientEditorState]);

  const applyEditorSyncEvent = useCallback(async (event: PanelEditorSyncEvent) => {
    const currentPath = selectedPathRef.current;
    try {
      const nextManifest = await refreshManifest();
      if (!currentPath) {
        setSyncStatus({ tone: 'muted', label: 'Project updated' });
        return;
      }

      const manifestStillContainsCurrent = nextManifest.files.some(candidate => candidate.relativePath === currentPath);
      const touchesCurrentFile = event.type === 'editor:file-changed'
        ? event.relativePath === currentPath
        : event.relativePaths.length === 0 || event.relativePaths.includes(currentPath);

      if (!touchesCurrentFile) {
        setSyncStatus({ tone: 'muted', label: 'Project updated' });
        return;
      }

      if (!manifestStillContainsCurrent) {
        setSyncStatus({
          tone: hasProtectedLocalState() ? 'warning' : 'muted',
          label: hasProtectedLocalState() ? 'Disk changed' : 'File moved',
          title: `${currentPath} is no longer present in the editor manifest.`,
        });
        if (!hasProtectedLocalState()) {
          setStatus(`${currentPath} changed on disk and is no longer listed. The editor will open the next available file.`);
        }
        return;
      }

      await reloadCurrentFileFromDisk(
        currentPath,
        event.source === 'browser' ? 'Synced from another tab' : 'Synced from disk',
      );
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') {
        setSyncStatus({
          tone: 'warning',
          label: 'Sync paused',
          title: (requestError as Error).message,
        });
        setError((requestError as Error).message);
      }
    }
  }, [hasProtectedLocalState, refreshManifest, reloadCurrentFileFromDisk]);

  const receiveEditorSyncEvent = useCallback((event: PanelEditorSyncEvent, options: { rebroadcast: boolean }) => {
    if (!rememberSyncEvent(event.id)) return;
    if (options.rebroadcast) broadcastSyncEvent(event);
    void applyEditorSyncEvent(event);
  }, [applyEditorSyncEvent, broadcastSyncEvent, rememberSyncEvent]);

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
    return connectEditorEvents(
      event => receiveEditorSyncEvent(event, { rebroadcast: true }),
      connectionState => {
        setSyncStatus(current => {
          if (connectionState === 'connected') {
            return current?.tone === 'warning'
              ? current
              : { tone: 'muted', label: 'Live sync on', title: 'Watching local files for changes.' };
          }
          return {
            tone: 'warning',
            label: 'Sync reconnecting',
            title: 'The local event stream is reconnecting. Manual saves still use revision checks.',
          };
        });
      },
    );
  }, [receiveEditorSyncEvent]);

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return undefined;
    const projectRoot = manifest?.projectRoot || project?.projectRoot || 'pending-project';
    const channel = new BroadcastChannel(`i18n-ai-diff:editor:${projectRoot}`);
    channelRef.current = channel;
    channel.onmessage = (message: MessageEvent<EditorBroadcastMessage>) => {
      if (!message.data || message.data.sender === tabIdRef.current) return;
      receiveEditorSyncEvent(message.data.event, { rebroadcast: false });
    };
    return () => {
      if (channelRef.current === channel) channelRef.current = null;
      channel.close();
    };
  }, [manifest?.projectRoot, project?.projectRoot, receiveEditorSyncEvent]);

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
        resetTransientEditorState();
        rememberEditorPath(
          window.localStorage,
          selectedPath,
          manifest?.projectRoot || project?.projectRoot,
        );
      })
      .catch(requestError => {
        if ((requestError as Error).name !== 'AbortError') {
          setFile(null);
          setError((requestError as Error).message);
        }
      })
      .finally(() => setFileLoading(false));
    return () => controller.abort();
  }, [manifest?.projectRoot, project?.projectRoot, resetTransientEditorState, selectedPath]);

  useEffect(() => {
    if (!selectedPath) return;
    const url = new URL(window.location.href);
    url.pathname = '/editor';
    url.searchParams.set('file', selectedPath);
    if (focusRequest?.relativePath === selectedPath) {
      url.searchParams.set('pointer', focusRequest.pointer);
      url.searchParams.set('lang', focusRequest.lang);
    } else {
      url.searchParams.delete('pointer');
      url.searchParams.delete('lang');
    }
    window.history.replaceState(null, '', url);
  }, [focusRequest?.lang, focusRequest?.nonce, focusRequest?.pointer, focusRequest?.relativePath, selectedPath]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (draftsRef.current.size === 0) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    const closeContextMenu = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', closeContextMenu);
    return () => window.removeEventListener('click', closeContextMenu);
  }, []);

  useEffect(() => {
    const openWorkspaceSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLocaleLowerCase() !== 'f') return;
      event.preventDefault();
      setWorkspaceSearchOpen(true);
      setFilePickerOpen(false);
      setFilterPanelOpen(false);
      setBatchMenuOpen(false);
      setContextMenu(null);
    };
    window.addEventListener('keydown', openWorkspaceSearch);
    return () => window.removeEventListener('keydown', openWorkspaceSearch);
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

  const rowsByPointer = useMemo(() => new Map(
    (file?.rows || []).map(row => [row.pointer, row]),
  ), [file]);

  const routeForTarget = useCallback((lang: string) => (
    manifest?.routes.find(route => route.sourceLang !== lang && route.languages.includes(lang)) || null
  ), [manifest]);

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
      const hasSkipped = manifest.languages.some(lang => row.cells[lang]?.skipped);
      if (showMissing && !hasMissing) return false;
      if (showPending && !hasPending) return false;
      if (showChanged && !hasChanged) return false;
      if (showSkipped && !hasSkipped) return false;
      if (!query) return true;
      if (row.displayPath.toLocaleLowerCase().includes(query)) return true;
      return manifest.languages.some(
        lang => effectiveCellValue(row, lang, drafts).toLocaleLowerCase().includes(query),
      );
    });
  }, [drafts, file, manifest, rowSearch, showChanged, showMissing, showPending, showSkipped]);
  const hasVisibleRows = visibleRows.length > 0;

  useEffect(() => {
    if (hasVisibleRows) return;
    setSelectedCells([]);
    setContextMenu(null);
  }, [hasVisibleRows]);

  const cellStateCounts = useMemo(() => {
    const counts = {
      changed: 0,
      pending: 0,
      missing: 0,
      skipped: 0,
      ai: 0,
      failed: 0,
    };
    if (!file || !manifest) return counts;
    for (const row of file.rows) {
      for (const lang of manifest.languages) {
        const identity = draftIdentity(lang, row.pointer);
        const cell = row.cells[lang];
        const changed = drafts.has(identity);
        if (changed) counts.changed += 1;
        else if (cell?.pending) counts.pending += 1;
        if ((cell?.kind || 'missing') === 'missing' && !changed) counts.missing += 1;
        if (cell?.skipped) counts.skipped += 1;
        if (aiDrafts.get(identity)?.translatedText === drafts.get(identity)) counts.ai += 1;
        if (failedTranslations.has(identity)) counts.failed += 1;
      }
    }
    return counts;
  }, [aiDrafts, drafts, failedTranslations, file, manifest]);

  const selectedMeta = manifest?.files.find(candidate => candidate.relativePath === selectedPath);
  const editable = manifest?.editable === true;
  const jobRunning = activeJob?.status === 'queued' || activeJob?.status === 'running';
  const activeFilterCount = [
    showMissing,
    showPending,
    showChanged,
    showSkipped,
  ].filter(Boolean).length;

  const translationStates = useMemo(() => {
    const states = new Map<string, GridCellTranslationState>();
    for (const identity of translatingCells) states.set(identity, activeJob?.status === 'queued' ? 'queued' : 'translating');
    for (const identity of failedTranslations.keys()) states.set(identity, 'failed');
    for (const [identity, translation] of aiDrafts) {
      if (!states.has(identity) && drafts.get(identity) === translation.translatedText) states.set(identity, 'ai');
    }
    return states;
  }, [activeJob?.status, aiDrafts, drafts, failedTranslations, translatingCells]);

  const buildTranslatePreview = useCallback((
    cells: GridSelectionCell[],
    options: { includeSkipped: boolean; overwriteDrafts: boolean },
  ): TranslatePreview => {
    if (!file || !manifest) return { cells: [], skipped: [] };
    const candidates = new Map<string, GridSelectionCell>();
    const skipped: TranslatePreview['skipped'] = [];
    for (const cell of cells) {
      const identity = draftIdentity(cell.lang, cell.pointer);
      if (candidates.has(identity)) continue;
      const row = rowsByPointer.get(cell.pointer);
      const route = routeForTarget(cell.lang);
      if (!row) {
        skipped.push({ ...cell, reason: 'Key is not in the current file' });
        continue;
      }
      if (!route) {
        skipped.push({ ...cell, reason: 'Master language cells cannot be translated' });
        continue;
      }
      const targetCell = row.cells[cell.lang];
      if (targetCell?.kind === 'unsupported') {
        skipped.push({ ...cell, reason: 'Target cell is not a string value' });
        continue;
      }
      if (targetCell?.skipped && !options.includeSkipped) {
        skipped.push({ ...cell, reason: 'Skipped key' });
        continue;
      }
      if (drafts.has(identity) && !options.overwriteDrafts) {
        skipped.push({ ...cell, reason: 'Cell already has a local draft' });
        continue;
      }
      const sourceIdentity = draftIdentity(route.sourceLang, cell.pointer);
      const sourceCell = row.cells[route.sourceLang];
      const hasSourceDraft = drafts.has(sourceIdentity);
      const sourceText = effectiveCellValue(row, route.sourceLang, drafts);
      if (!hasSourceDraft && sourceCell?.kind !== 'string') {
        skipped.push({ ...cell, reason: 'Source cell is missing or not a string value' });
        continue;
      }
      if (sourceText.length === 0) {
        skipped.push({ ...cell, reason: 'Source cell is empty' });
        continue;
      }
      candidates.set(identity, cell);
    }
    return { cells: [...candidates.values()], skipped };
  }, [drafts, file, manifest, routeForTarget, rowsByPointer]);

  const currentPreview = useMemo(() => (
    translatePreview
      ? buildTranslatePreview(translatePreview.cells, translatePreview)
      : null
  ), [buildTranslatePreview, translatePreview]);

  const openTranslatePreview = useCallback((title: string, cells: GridSelectionCell[]) => {
    if (!editable) {
      setStatus('Restart with i18n-ai-diff panel --edit to run AI translations.');
      return;
    }
    if (!file || !manifest) return;
    if (cells.length === 0) {
      setStatus('Select target-language cells before translating.');
      return;
    }
    setTranslatePreview({
      title,
      cells,
      includeSkipped: false,
      overwriteDrafts: false,
    });
  }, [editable, file, manifest]);

  const cellsForRowTargets = useCallback((pointer: string): GridSelectionCell[] => {
    if (!manifest) return [];
    return manifest.routes.flatMap(route => (
      route.languages
        .filter(lang => lang !== route.sourceLang)
        .map(lang => ({ lang, pointer }))
    ));
  }, [manifest]);

  const cellsForLanguagePending = useCallback((lang: string): GridSelectionCell[] => {
    const rows = file?.rows || [];
    return rows
      .filter(row => row.cells[lang]?.pending)
      .map(row => ({ lang, pointer: row.pointer }));
  }, [file]);

  const visiblePendingCells = useMemo(() => {
    if (!manifest) return [];
    return visibleRows.flatMap(row => manifest.routes.flatMap(route => (
      route.languages
        .filter(lang => lang !== route.sourceLang && row.cells[lang]?.pending)
        .map(lang => ({ lang, pointer: row.pointer }))
    )));
  }, [manifest, visibleRows]);

  const visibleMissingCells = useMemo(() => {
    if (!manifest) return [];
    return visibleRows.flatMap(row => manifest.routes.flatMap(route => (
      route.languages
        .filter(lang => lang !== route.sourceLang && row.cells[lang]?.kind === 'missing')
        .map(lang => ({ lang, pointer: row.pointer }))
    )));
  }, [manifest, visibleRows]);

  const currentFilePendingCells = useMemo(() => {
    if (!file || !manifest) return [];
    return file.rows.flatMap(row => manifest.routes.flatMap(route => (
      route.languages
        .filter(lang => lang !== route.sourceLang && row.cells[lang]?.pending)
        .map(lang => ({ lang, pointer: row.pointer }))
    )));
  }, [file, manifest]);

  const retryFailedCells = useMemo(() => [...failedTranslations.values()].map(({ error: _error, ...cell }) => cell), [failedTranslations]);

  const applyTranslationResults = useCallback((results: PanelEditorTranslateResult[]) => {
    if (!file || !manifest) return;
    const nextDrafts = new Map(draftsRef.current);
    const nextAiDrafts = new Map(aiDraftsRef.current);
    const nextFailures = new Map<string, GridSelectionCell & { error: string }>();
    const transaction: DraftHistoryTransaction = [];
    let translated = 0;

    for (const result of results) {
      const identity = draftIdentity(result.lang, result.pointer);
      if (result.status === 'failed') {
        nextFailures.set(identity, {
          lang: result.lang,
          pointer: result.pointer,
          error: result.error || 'Translation failed',
        });
        continue;
      }
      if (result.status !== 'translated' || result.translatedText === undefined || !result.sourceLang || result.sourceText === undefined) {
        continue;
      }
      const row = rowsByPointer.get(result.pointer);
      const cell = row?.cells[result.lang];
      if (!row || !cell || cell.kind === 'unsupported') continue;
      const before = nextDrafts.get(identity);
      const after = draftForValue(cell, result.translatedText);
      if (before === after) continue;
      if (after === undefined) {
        nextDrafts.delete(identity);
        nextAiDrafts.delete(identity);
      } else {
        nextDrafts.set(identity, after);
        nextAiDrafts.set(identity, {
          lang: result.lang,
          pointer: result.pointer,
          sourceLang: result.sourceLang,
          sourceText: result.sourceText,
          translatedText: result.translatedText,
        });
      }
      transaction.push({ identity, before, after });
      translated += 1;
    }

    draftsRef.current = nextDrafts;
    aiDraftsRef.current = nextAiDrafts;
    setDrafts(nextDrafts);
    setAiDrafts(nextAiDrafts);
    setFailedTranslations(nextFailures);
    setTranslatingCells(new Set());
    if (transaction.length > 0) {
      setUndoStack(current => [...current, transaction]);
      setRedoStack([]);
    }
    const failed = nextFailures.size;
    if (failed > 0) {
      const firstFailure = [...nextFailures.values()][0];
      setTranslationError(
        `${failed} cell${failed === 1 ? '' : 's'} failed. `
        + `${firstFailure.lang} ${firstFailure.pointer}: ${firstFailure.error}`,
      );
    } else {
      setTranslationError(null);
    }
    setStatus(
      failed > 0
        ? `Generated ${translated} AI draft${translated === 1 ? '' : 's'}; ${failed} cell${failed === 1 ? '' : 's'} failed.`
        : `Generated ${translated} AI draft${translated === 1 ? '' : 's'}. Review and save explicitly.`,
    );
  }, [file, manifest, rowsByPointer]);

  const pollTranslateJob = useCallback(async (createdJob: PanelEditorTranslateJob) => {
    let current = createdJob;
    setActiveJob(current);
    try {
      while (current.status === 'queued' || current.status === 'running') {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        current = await loadEditorTranslateJob(current.id);
        setActiveJob(current);
      }
      if (current.status === 'completed' || current.status === 'cancelled') {
        applyTranslationResults(current.results);
      } else if (current.status === 'failed') {
        setTranslatingCells(new Set());
        setError(current.error || 'AI translation failed.');
      }
    } catch (requestError) {
      setTranslatingCells(new Set());
      setError((requestError as Error).message);
    }
  }, [applyTranslationResults]);

  const confirmTranslation = useCallback(async () => {
    if (!file || !manifest?.editable || !manifest.writeToken || !translatePreview || !currentPreview) return;
    if (currentPreview.cells.length === 0) {
      setStatus('No translatable target cells in this selection.');
      return;
    }
    setTranslatePreview(null);
    setContextMenu(null);
    setBatchMenuOpen(false);
    setFilePickerOpen(false);
    setFilterPanelOpen(false);
    setError(null);
    setTranslationError(null);
    setFailedTranslations(new Map());
    const identities = new Set(currentPreview.cells.map(cell => draftIdentity(cell.lang, cell.pointer)));
    setTranslatingCells(identities);
    setStatus(`Starting AI translation for ${currentPreview.cells.length} cell${currentPreview.cells.length === 1 ? '' : 's'}…`);
    try {
      const job = await createEditorTranslateJob({
        relativePath: file.relativePath,
        revisions: file.revisions,
        snapshotRevision: file.snapshotRevision,
        cells: currentPreview.cells,
        drafts: createEditorPatches(draftsRef.current),
        options: {
          includeSkipped: translatePreview.includeSkipped,
          overwriteDrafts: translatePreview.overwriteDrafts,
        },
      }, manifest.writeToken);
      void pollTranslateJob(job);
    } catch (requestError) {
      setTranslatingCells(new Set());
      setError((requestError as Error).message);
    }
  }, [currentPreview, file, manifest, pollTranslateJob, translatePreview]);

  const cancelTranslation = useCallback(async () => {
    if (!activeJob || !manifest?.writeToken) return;
    try {
      const cancelled = await cancelEditorTranslateJob(activeJob.id, manifest.writeToken);
      setActiveJob(cancelled);
      applyTranslationResults(cancelled.results);
      setStatus('Translation job cancelled. Completed AI drafts were kept.');
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setTranslatingCells(new Set());
    }
  }, [activeJob, applyTranslationResults, manifest?.writeToken]);

  const handleGridChanges = useCallback((values: GridValueChange[]) => {
    if (!file || !manifest?.editable) return;
    const next = new Map(draftsRef.current);
    const nextAiDrafts = new Map(aiDraftsRef.current);
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
      nextAiDrafts.delete(identity);
      for (const route of manifest.routes) {
        if (route.sourceLang !== value.lang) continue;
        for (const targetLang of route.languages.filter(lang => lang !== route.sourceLang)) {
          nextAiDrafts.delete(draftIdentity(targetLang, row.pointer));
        }
      }
      transaction.push({ identity, before, after });
    }
    if (transaction.length === 0) return;
    draftsRef.current = next;
    aiDraftsRef.current = nextAiDrafts;
    setDrafts(next);
    setAiDrafts(nextAiDrafts);
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
    const acceptedTranslations = [...aiDraftsRef.current.entries()].flatMap(([identity, translation]) => (
      savingDrafts.get(identity) === translation.translatedText ? [translation] : []
    ));
    setSaving(true);
    setError(null);
    setStatus('Writing locale files…');
    try {
      const result = await saveEditorFile({
        relativePath: file.relativePath,
        revisions: file.revisions,
        snapshotRevision: file.snapshotRevision,
        changes: createEditorPatches(savingDrafts),
        acceptedTranslations,
      }, manifest.writeToken);
      setFile(result.file);
      const empty = new Map<string, string>();
      setDrafts(empty);
      draftsRef.current = empty;
      setAiDrafts(new Map());
      aiDraftsRef.current = new Map();
      setFailedTranslations(new Map());
      setUndoStack([]);
      setRedoStack([]);
      onProjectChange(result.project);
      await refreshManifest();
      if (result.savedLanguages.length > 0) {
        const event: PanelEditorSyncEvent = {
          type: 'editor:file-changed',
          id: `${tabIdRef.current}:save:${Date.now()}`,
          timestamp: new Date().toISOString(),
          source: 'browser',
          relativePath: file.relativePath,
          languages: result.savedLanguages,
          changes: ['change'],
        };
        rememberSyncEvent(event.id);
        broadcastSyncEvent(event);
      }
      setSyncStatus({ tone: 'ok', label: 'Saved locally', title: `${file.relativePath} was written to disk.` });
      setStatus(`Saved ${result.savedLanguages.length} language file${result.savedLanguages.length === 1 ? '' : 's'} safely.`);
      return true;
    } catch (requestError) {
      if (requestError instanceof PanelApiError && requestError.code === 'REVISION_CONFLICT') {
        try {
          const latest = await loadEditorFile(file.relativePath);
          const rebased = rebaseDrafts(file, latest, savingDrafts);
          const nextAiDrafts = new Map<string, PanelEditorAcceptedTranslation>();
          for (const [identity, translation] of aiDraftsRef.current) {
            if (rebased.drafts.get(identity) === translation.translatedText) nextAiDrafts.set(identity, translation);
          }
          setFile(latest);
          setDrafts(rebased.drafts);
          draftsRef.current = rebased.drafts;
          setAiDrafts(nextAiDrafts);
          aiDraftsRef.current = nextAiDrafts;
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
  }, [broadcastSyncEvent, file, manifest, onProjectChange, refreshManifest, rememberSyncEvent]);

  const queueCellFocus = useCallback((relativePath: string, cell: GridSelectionCell) => {
    setRowSearch('');
    setShowMissing(false);
    setShowPending(false);
    setShowChanged(false);
    setShowSkipped(false);
    setFocusRequest({
      relativePath,
      lang: cell.lang,
      pointer: cell.pointer,
      nonce: Date.now(),
    });
    setStatus(`Opening ${relativePath} at ${cell.lang} ${cell.pointer}.`);
  }, []);

  const performNavigation = useCallback((destination: PendingNavigation) => {
    if (destination.kind === 'file') {
      if (destination.focus) queueCellFocus(destination.relativePath, destination.focus);
      else setFocusRequest(null);
      setSelectedPath(destination.relativePath);
      setActiveDrawer(null);
      setFilePickerOpen(false);
      setFilterPanelOpen(false);
      return;
    }

    setActiveDrawer(null);
    setFilePickerOpen(false);
    setFilterPanelOpen(false);
    onNavigate(destination.href);
  }, [onNavigate, queueCellFocus]);

  const requestGuardedNavigation = useCallback((destination: PendingNavigation) => {
    if (destination.kind === 'file' && destination.relativePath === selectedPath) {
      if (destination.focus) queueCellFocus(destination.relativePath, destination.focus);
      setFilePickerOpen(false);
      setFilterPanelOpen(false);
      return;
    }

    if (draftsRef.current.size > 0) {
      setFilePickerOpen(false);
      setFilterPanelOpen(false);
      setPendingNavigation(destination);
      return;
    }

    performNavigation(destination);
  }, [performNavigation, queueCellFocus, selectedPath]);

  const guardedNavigate = useCallback((href: string) => {
    requestGuardedNavigation({ kind: 'panel', href });
  }, [requestGuardedNavigation]);

  const requestFile = (relativePath: string) => {
    requestGuardedNavigation({ kind: 'file', relativePath });
  };

  const openWorkspaceSearchResult = (result: PanelEditorSearchResult) => {
    setWorkspaceSearchOpen(false);
    requestGuardedNavigation({
      kind: 'file',
      relativePath: result.relativePath,
      focus: { lang: result.lang, pointer: result.pointer },
    });
  };

  const discardAndNavigate = () => {
    if (!pendingNavigation) return;
    const empty = new Map<string, string>();
    setDrafts(empty);
    draftsRef.current = empty;
    setAiDrafts(new Map());
    aiDraftsRef.current = new Map();
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
    const nextAiDrafts = new Map(aiDraftsRef.current);
    for (const conflict of conflicts) {
      if (conflict.resolution === 'draft') next.set(conflict.identity, conflict.draftValue);
      else {
        next.delete(conflict.identity);
        nextAiDrafts.delete(conflict.identity);
      }
    }
    setDrafts(next);
    draftsRef.current = next;
    setAiDrafts(nextAiDrafts);
    aiDraftsRef.current = nextAiDrafts;
    setConflicts(null);
    setStatus('Conflicts resolved in the draft. Review the table and save again.');
  };

  const resolveConflict = useCallback((identity: string, resolution: 'disk' | 'draft') => {
    setConflicts(current => current?.map(item => (
      item.identity === identity ? { ...item, resolution } : item
    )) || null);
  }, []);

  const currentFileTriggerContent = (
    <>
      <FileText size={18} aria-hidden="true" />
      <span>Explorer</span>
    </>
  );

  const saveButton = (
    <button
      className="scan-button editor-save-button"
      type="button"
      disabled={!editable || drafts.size === 0 || saving || !file || jobRunning}
      onClick={() => void save()}
    >
      <FloppyDisk size={22} weight="bold" aria-hidden="true" />
      <span>{saving ? 'Saving safely…' : `Save ${drafts.size} change${drafts.size === 1 ? '' : 's'}`}</span>
    </button>
  );

  const cellStateSummary = (
    <div className="editor-cell-state-summary">
      <div className="editor-state-legend">
        <span><i className="legend-dot is-changed" />Changed <b>{cellStateCounts.changed}</b></span>
        <span><i className="legend-dot is-pending" />Pending <b>{cellStateCounts.pending}</b></span>
        <span><i className="legend-dot is-missing" />Missing <b>{cellStateCounts.missing}</b></span>
        <span><i className="legend-dot is-skipped" />Skipped <b>{cellStateCounts.skipped}</b></span>
        <span><i className="legend-dot is-ai" />AI <b>{cellStateCounts.ai}</b></span>
        {cellStateCounts.failed > 0 && <span><i className="legend-dot is-failed" />Failed <b>{cellStateCounts.failed}</b></span>}
      </div>
    </div>
  );

  const currentFileSummary = (
    <div className="editor-bottom-file" title={selectedPath || 'No JSON file selected'}>
      <FileText size={16} aria-hidden="true" />
      <span>{selectedPath || 'No JSON file selected'}</span>
      {syncStatus && (
        <em
          className={`editor-sync-pill is-${syncStatus.tone}`}
          title={syncStatus.title || syncStatus.label}
        >
          {syncStatus.label}
        </em>
      )}
    </div>
  );

  const filterControls = (
    <div className="editor-filter-check-list" aria-label="Show rows">
      <StatusFilterCheckbox checked={showMissing} label="Missing" onCheckedChange={setShowMissing} />
      <StatusFilterCheckbox checked={showPending} label="Pending" onCheckedChange={setShowPending} />
      <StatusFilterCheckbox checked={showChanged} label="Changed" onCheckedChange={setShowChanged} />
      <StatusFilterCheckbox checked={showSkipped} label="Skipped" onCheckedChange={setShowSkipped} />
    </div>
  );

  const filePickerPanel = (
    <>
      <div className="file-panel-header">
        <div>
          <SheetTitle asChild>
            <strong>{manifest?.files.length || 0} JSON files</strong>
          </SheetTitle>
        </div>
        <button className="file-panel-close" type="button" onClick={() => setFilePickerOpen(false)} aria-label="Close locale files">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <label className="editor-inline-search">
        <MagnifyingGlass size={17} aria-hidden="true" />
        <span className="sr-only">Search locale files</span>
        <input value={fileSearch} onChange={event => setFileSearch(event.target.value)} placeholder="Find a JSON file…" />
      </label>
      <div className="editor-file-menu-list">
        {fileGroups.length > 0 ? fileGroups.map(group => (
          <section key={group.directory}>
            {(() => {
              const groupStatus = getExplorerGroupStatus(group.files);
              return (
                <p>
                  <span>{group.directory}</span>
                  {groupStatus.tone !== 'clear' && (
                    <span
                      className={`editor-file-group-decoration is-${groupStatus.tone}`}
                      title={groupStatus.label}
                      aria-label={groupStatus.label}
                    >
                      <i aria-hidden="true" />
                      <b>{groupStatus.badge}</b>
                    </span>
                  )}
                </p>
              );
            })()}
            {group.files.map(candidate => {
              const fileStatus = getExplorerFileStatus(candidate);
              const isActive = candidate.relativePath === selectedPath;
              const className = [
                isActive ? 'is-active' : '',
                fileStatus.tone !== 'clear' ? `has-file-decoration is-${fileStatus.tone}` : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={candidate.relativePath}
                  type="button"
                  className={className}
                  title={`${candidate.relativePath}${fileStatus.tone === 'clear' ? '' : ` · ${fileStatus.label}`}`}
                  onClick={() => requestFile(candidate.relativePath)}
                >
                  <FileText size={16} aria-hidden="true" />
                  <span>
                    {candidate.relativePath.slice(candidate.relativePath.lastIndexOf('/') + 1)}
                  </span>
                  {fileStatus.tone !== 'clear' && (
                    <em
                      className={`editor-file-decoration is-${fileStatus.tone}`}
                      title={fileStatus.label}
                      aria-label={fileStatus.label}
                    >
                      {fileStatus.badge}
                    </em>
                  )}
                </button>
              );
            })}
          </section>
        )) : (
          <p className="editor-toolbar-panel-empty">No JSON files match this search.</p>
        )}
      </div>
    </>
  );

  const filterPanel = (
    <>
      <div className="editor-toolbar-panel-header">
        <span>
          <strong>{activeFilterCount === 0 ? 'All states' : `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`}</strong>
        </span>
        <em>{visibleRows.length} / {file?.rows.length || 0} keys</em>
      </div>
      {filterControls}
    </>
  );

  const editorOperationBar = (
    <>
      <div className="editor-operation-left">
        <button
          className={filePickerOpen ? 'editor-file-trigger is-active' : 'editor-file-trigger'}
          type="button"
          aria-label="Open locale files"
          aria-expanded={filePickerOpen}
          onClick={() => {
            setFilePickerOpen(true);
            setFilterPanelOpen(false);
            setBatchMenuOpen(false);
            setContextMenu(null);
          }}
        >
          {currentFileTriggerContent}
        </button>
        <div className="editor-history" aria-label="Draft history">
          <button type="button" disabled={undoStack.length === 0} onClick={undo} aria-label="Undo draft change">
            <ArrowUUpLeft size={20} aria-hidden="true" />
            <span>Undo</span>
          </button>
          <button type="button" disabled={redoStack.length === 0} onClick={redo} aria-label="Redo draft change">
            <ArrowUUpRight size={20} aria-hidden="true" />
            <span>Redo</span>
          </button>
        </div>
        <button
          className="editor-command-button editor-translate-button"
          type="button"
          disabled={!editable || selectedCells.length === 0 || jobRunning}
          onClick={() => openTranslatePreview('Translate selected cells', selectedCells)}
        >
          <Translate size={20} aria-hidden="true" />
          <span>Translate selected</span>
          {selectedCells.length > 0 && <b>{selectedCells.length}</b>}
        </button>
        <Popover
          open={batchMenuOpen}
          onOpenChange={open => {
            if (!editable || jobRunning) {
              setBatchMenuOpen(false);
              return;
            }
            setBatchMenuOpen(open);
            if (open) {
              setFilePickerOpen(false);
              setFilterPanelOpen(false);
              setContextMenu(null);
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              className={batchMenuOpen ? 'editor-command-button is-active' : 'editor-command-button'}
              type="button"
              disabled={!editable || jobRunning}
            >
              <Sparkle size={20} aria-hidden="true" />
              <span>Batch</span>
              <CaretDown size={16} aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="editor-toolbar-panel editor-batch-panel" aria-label="Batch translation actions">
            <div className="editor-toolbar-panel-header">
              <span>
                <strong>Translate current view</strong>
              </span>
            </div>
            <div className="editor-batch-action-list">
              <button type="button" onClick={() => openTranslatePreview('Translate visible pending cells', visiblePendingCells)}>Translate visible pending <b>{visiblePendingCells.length}</b></button>
              <button type="button" onClick={() => openTranslatePreview('Translate visible missing cells', visibleMissingCells)}>Translate visible missing <b>{visibleMissingCells.length}</b></button>
              <button type="button" onClick={() => openTranslatePreview('Translate current file pending cells', currentFilePendingCells)}>Translate current file pending <b>{currentFilePendingCells.length}</b></button>
              <button type="button" disabled={retryFailedCells.length === 0} onClick={() => openTranslatePreview('Retry failed translations', retryFailedCells)}>Retry failed <b>{retryFailedCells.length}</b></button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="editor-operation-right">
        {jobRunning && activeJob && (
          <div className="editor-translation-progress" role="status">
            Translating {activeJob.completed}/{activeJob.total}
            <button type="button" onClick={() => void cancelTranslation()}>Cancel</button>
          </div>
        )}
        <button
          className={workspaceSearchOpen ? 'editor-command-button is-active' : 'editor-command-button'}
          type="button"
          aria-label="Search all locale copy"
          aria-expanded={workspaceSearchOpen}
          onClick={() => {
            setWorkspaceSearchOpen(true);
            setFilePickerOpen(false);
            setFilterPanelOpen(false);
            setBatchMenuOpen(false);
            setContextMenu(null);
          }}
        >
          <MagnifyingGlass size={20} aria-hidden="true" />
          <span>Workspace</span>
        </button>
        <label className="editor-inline-search editor-copy-search">
          <MagnifyingGlass size={17} aria-hidden="true" />
          <span className="sr-only">Search keys and copy</span>
          <input value={rowSearch} onChange={event => setRowSearch(event.target.value)} placeholder="Search keys or copy…" />
        </label>
        <Popover
          open={filterPanelOpen}
          onOpenChange={open => {
            setFilterPanelOpen(open);
            if (open) {
              setFilePickerOpen(false);
              setBatchMenuOpen(false);
              setContextMenu(null);
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              className={filterPanelOpen ? 'editor-command-button editor-filter-trigger is-active' : 'editor-command-button editor-filter-trigger'}
              type="button"
              aria-label="Filter visible rows"
            >
              <Funnel size={20} aria-hidden="true" />
              {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
            </button>
          </PopoverTrigger>
          <PopoverContent className="editor-toolbar-panel editor-filter-panel" aria-label="Filter visible rows">
            {filterPanel}
          </PopoverContent>
        </Popover>
        <button
          className={activeDrawer === 'tools' ? 'editor-command-button is-active' : 'editor-command-button'}
          type="button"
          aria-label="Open editor details"
          aria-expanded={activeDrawer === 'tools'}
          onClick={() => {
            setFilePickerOpen(false);
            setFilterPanelOpen(false);
            setActiveDrawer(current => (current === 'tools' ? null : 'tools'));
          }}
        >
          <SlidersHorizontal size={20} aria-hidden="true" />
        </button>
        {saveButton}
      </div>
    </>
  );

  const editorBottomBar = (
    <>
      {currentFileSummary}
      {cellStateSummary}
    </>
  );

  return (
    <PanelLayout
      activeView="editor"
      bottomBar={editorBottomBar}
      bottomBarClassName="editor-cell-state-bar"
      bottomBarLabel="Editor status"
      operationBar={editorOperationBar}
      operationBarClassName="editor-operation-bar"
      operationBarLabel="Copy editor controls"
      onNavigate={guardedNavigate}
      project={project}
      skipLabel="copy editor"
      shellClassName="is-editor-shell"
      workspaceClassName="editor-workspace"
      liveStatus={status}
    >
      <div className="editor-table-stage">
        <div className="editor-floating-alerts">
          {!manifestLoading && manifest && !manifest.editable && (
            <section className="editor-readonly-banner" aria-label="Read-only editor">
              <Lock size={22} weight="fill" aria-hidden="true" />
              <div>
                <strong>Viewing local copy in read-only mode</strong>
                <span>Restart with <code>i18n-ai-diff panel --edit</code> to enable local saves and AI translation drafts.</span>
              </div>
            </section>
          )}
        </div>

        <section className="editor-table-panel" aria-label="Translation table">
          {manifestLoading || fileLoading ? (
            <div className="editor-table-loading" aria-label="Loading locale file">
              <div className="skeleton skeleton-metrics" />
              <div className="skeleton skeleton-route" />
              <div className="skeleton skeleton-route" />
            </div>
          ) : file && manifest && hasVisibleRows ? (
            <TranslationGrid
              rows={visibleRows}
              manifest={manifest}
              drafts={drafts}
              editable={editable}
              focusCell={focusRequest?.relativePath === file.relativePath ? focusRequest : undefined}
              translationStates={translationStates}
              onChangeValues={handleGridChanges}
              onSelectionChange={setSelectedCells}
              onContextMenu={request => {
                setContextMenu(request);
                setBatchMenuOpen(false);
                setFilePickerOpen(false);
                setFilterPanelOpen(false);
              }}
            />
          ) : file && manifest ? (
            <div className="editor-table-empty is-filtered-empty">
              <MagnifyingGlass size={28} aria-hidden="true" />
              <strong>No matching keys</strong>
              <span>No key path or copy in {file.relativePath} matches the current search and filters.</span>
            </div>
          ) : (
            <div className="editor-table-empty">
              <FileText size={28} aria-hidden="true" />
              <strong>Select a valid JSON file</strong>
              <span>The table will align every string leaf across configured languages.</span>
            </div>
          )}
        </section>
      </div>

      <Sheet
        open={filePickerOpen}
        onOpenChange={open => {
          setFilePickerOpen(open);
          if (open) {
            setFilterPanelOpen(false);
            setBatchMenuOpen(false);
            setContextMenu(null);
          }
        }}
      >
        <SheetContent className="editor-file-drawer" side="left">
          {filePickerPanel}
        </SheetContent>
      </Sheet>

      <ToolsDrawer
        draftCount={drafts.size}
        editable={editable}
        isOpen={activeDrawer === 'tools'}
        job={activeJob}
        languageCount={manifest?.languages.length || 0}
        selectedMeta={selectedMeta}
        status={status}
        totalRowCount={file?.rows.length || 0}
        visibleRowCount={visibleRows.length}
        onClose={() => setActiveDrawer(null)}
      />

      <WorkspaceSearchDialog
        open={workspaceSearchOpen}
        manifest={manifest}
        currentFile={file}
        drafts={drafts}
        onOpenChange={open => {
          setWorkspaceSearchOpen(open);
          if (open) {
            setFilePickerOpen(false);
            setFilterPanelOpen(false);
            setBatchMenuOpen(false);
            setContextMenu(null);
          }
        }}
        onOpenResult={openWorkspaceSearchResult}
      />

      {contextMenu && (
        <div
          className="editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={event => event.stopPropagation()}
          role="menu"
        >
          <button type="button" role="menuitem" onClick={() => openTranslatePreview('Translate this cell', [contextMenu.clickedCell])}>Translate this cell</button>
          <button type="button" role="menuitem" onClick={() => openTranslatePreview('Translate selected cells', contextMenu.selectedCells)}>Translate selected cells <b>{contextMenu.selectedCells.length}</b></button>
          <button type="button" role="menuitem" onClick={() => openTranslatePreview('Translate row targets', cellsForRowTargets(contextMenu.clickedCell.pointer))}>Translate row targets</button>
          <button type="button" role="menuitem" onClick={() => openTranslatePreview(`Translate ${contextMenu.clickedCell.lang} pending`, cellsForLanguagePending(contextMenu.clickedCell.lang))}>Translate this language pending</button>
        </div>
      )}

      <Dialog open={Boolean(translatePreview && currentPreview)} onOpenChange={open => { if (!open) setTranslatePreview(null); }}>
        {translatePreview && currentPreview && (
          <ModalContent className="translate-confirm-modal" size="lg" aria-describedby="translate-description">
            <ModalHeader icon={<Translate size={20} weight="bold" />}>
              <ModalTitleBlock
                title={translatePreview.title}
                descriptionId="translate-description"
                description={(
                  <>
                    {currentPreview.cells.length} target cell{currentPreview.cells.length === 1 ? '' : 's'} will be translated into the current browser draft.
                    {currentPreview.skipped.length > 0 && <> {currentPreview.skipped.length} cell{currentPreview.skipped.length === 1 ? '' : 's'} will be skipped.</>}
                  </>
                )}
              />
            </ModalHeader>
            <div className="translate-confirm-body">
              <dl className="translate-confirm-stats">
                <div><dt>Selected</dt><dd>{translatePreview.cells.length}</dd></div>
                <div><dt>Ready</dt><dd>{currentPreview.cells.length}</dd></div>
                <div><dt>Skipped</dt><dd>{currentPreview.skipped.length}</dd></div>
                <div><dt>Cache</dt><dd>Checked on start</dd></div>
              </dl>
              <label className="translate-option">
                <Checkbox
                  checked={translatePreview.includeSkipped}
                  onCheckedChange={checked => setTranslatePreview(current => current && { ...current, includeSkipped: checked === true })}
                />
                <span>Include skipped keys</span>
              </label>
              <label className="translate-option">
                <Checkbox
                  checked={translatePreview.overwriteDrafts}
                  onCheckedChange={checked => setTranslatePreview(current => current && { ...current, overwriteDrafts: checked === true })}
                />
                <span>Overwrite existing local drafts</span>
              </label>
              {currentPreview.skipped.length > 0 && (
                <div className="translate-skip-list">
                  {currentPreview.skipped.slice(0, 5).map(item => (
                    <span key={`${item.lang}:${item.pointer}`}>{item.lang} {item.pointer} · {item.reason}</span>
                  ))}
                  {currentPreview.skipped.length > 5 && <span>+ {currentPreview.skipped.length - 5} more skipped cells</span>}
                </div>
              )}
            </div>
            <ModalActions>
              <button type="button" className="button-tertiary" onClick={() => setTranslatePreview(null)}>Cancel</button>
              <button type="button" className="button-primary" disabled={currentPreview.cells.length === 0 || jobRunning} onClick={() => void confirmTranslation()}>
                Start translation
              </button>
            </ModalActions>
          </ModalContent>
        )}
      </Dialog>

      {pendingNavigation && (
        <div className="editor-modal-layer" role="presentation">
          <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="leave-title">
            <WarningCircle size={28} weight="fill" aria-hidden="true" />
            <div>
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

function StatusFilterCheckbox({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange(value: boolean): void;
}) {
  return (
    <label className="editor-filter-check">
      <Checkbox checked={checked} onCheckedChange={next => onCheckedChange(next === true)} />
      <span>{label}</span>
    </label>
  );
}

function createEditorTabId(): string {
  return globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readInitialEditorFocus(search: string, relativePath: string): EditorFocusRequest | null {
  if (!relativePath) return null;
  const params = new URLSearchParams(search);
  const pointer = params.get('pointer');
  const lang = params.get('lang');
  if (!pointer || !lang) return null;
  return {
    relativePath,
    pointer,
    lang,
    nonce: 0,
  };
}

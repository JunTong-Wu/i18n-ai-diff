import {
  ArrowUUpLeft,
  ArrowUUpRight,
  CaretDown,
  FileText,
  FloppyDisk,
  Funnel,
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
  createEditorMasterTranslateJob,
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
import { normalizePanelErrorMessage } from '../components/feedback/panelErrorMessages';
import { usePanelErrorToast } from '../components/feedback/usePanelErrorToast';
import { Checkbox } from '../components/ui/checkbox';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../components/ui/context-menu';
import { Dialog } from '../components/ui/dialog';
import { ModalActions, ModalContent, ModalHeader, ModalTitleBlock } from '../components/ui/modal';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '../components/ui/sheet';
import { usePanelI18n } from '../i18n';
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
  overwriteDrafts: boolean;
  forceRetranslate: boolean;
}

interface TranslatePreview {
  cells: GridSelectionCell[];
  skipped: Array<GridSelectionCell & { reason: string }>;
}

interface MasterTranslatePreviewState {
  targetLang: string;
  sourceLang: string;
  pointers: string[];
  overwriteDrafts: boolean;
  overwriteExisting: boolean;
  forceRetranslate: boolean;
}

interface MasterTranslatePreview {
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

function formatExplorerBadge(prefix: string, count: number) {
  return `${prefix} ${count > 99 ? '99+' : count}`;
}

function getExplorerFileStatus(
  file: PanelEditorManifest['files'][number],
  t: ReturnType<typeof usePanelI18n>['t'],
): ExplorerStatusDecoration {
  if (file.invalidLanguages.length > 0) {
    return {
      tone: 'invalid',
      badge: '!',
      label: `${t('explorer.invalidJson')}: ${file.invalidLanguages.join(', ')}`,
    };
  }

  if (file.missingLanguages.length > 0) {
    return {
      tone: 'missing',
      badge: formatExplorerBadge('U', file.missingLanguages.length),
      label: t('explorer.missingLanguageFiles', {
        count: file.missingLanguages.length,
        langs: file.missingLanguages.join(', '),
      }),
    };
  }

  if (file.pendingKeys > 0) {
    return {
      tone: 'pending',
      badge: formatExplorerBadge('M', file.pendingKeys),
      label: t('explorer.pendingKeys', { count: file.pendingKeys }),
    };
  }

  return {
    tone: 'clear',
    badge: '',
    label: t('explorer.noPending'),
  };
}

function getExplorerGroupStatus(
  files: PanelEditorManifest['files'],
  t: ReturnType<typeof usePanelI18n>['t'],
): ExplorerStatusDecoration {
  const invalidFiles = files.filter(file => file.invalidLanguages.length > 0).length;
  if (invalidFiles > 0) {
    return {
      tone: 'invalid',
      badge: String(invalidFiles),
      label: t('explorer.filesInvalid', { count: invalidFiles }),
    };
  }

  const missingFiles = files.filter(file => file.missingLanguages.length > 0).length;
  if (missingFiles > 0) {
    return {
      tone: 'missing',
      badge: String(missingFiles),
      label: t('explorer.filesMissing', { count: missingFiles }),
    };
  }

  const pendingKeys = files.reduce((total, file) => total + file.pendingKeys, 0);
  if (pendingKeys > 0) {
    const pendingFiles = files.filter(file => file.pendingKeys > 0).length;
    return {
      tone: 'pending',
      badge: pendingKeys > 99 ? '99+' : String(pendingKeys),
      label: t('explorer.pendingInFiles', { keys: pendingKeys, files: pendingFiles }),
    };
  }

  return {
    tone: 'clear',
    badge: '',
    label: t('explorer.noPending'),
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
  const { t } = usePanelI18n();
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
  const [showEmpty, setShowEmpty] = useState(false);
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
  const [masterTranslatePreview, setMasterTranslatePreview] = useState<MasterTranslatePreviewState | null>(null);
  const [translateSkippedExpanded, setTranslateSkippedExpanded] = useState(false);
  const [masterSkippedExpanded, setMasterSkippedExpanded] = useState(false);
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
  const contextMenuTriggerRef = useRef<HTMLSpanElement | null>(null);
  const draftsRef = useRef(drafts);
  const aiDraftsRef = useRef(aiDrafts);
  selectedPathRef.current = selectedPath;
  translatingCellsRef.current = translatingCells;
  activeJobRef.current = activeJob;
  draftsRef.current = drafts;
  aiDraftsRef.current = aiDrafts;
  usePanelErrorToast(error, t('editor.errorTitle'));
  usePanelErrorToast(translationError, t('editor.translationErrorTitle'));

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
    setMasterTranslatePreview(null);
    setTranslatePreview(null);
    setUndoStack([]);
    setRedoStack([]);
    setConflicts(null);
  }, []);

  const reloadCurrentFileFromDisk = useCallback(async (
    relativePath: string,
    label = t('editor.syncedFromDisk'),
  ) => {
    if (hasProtectedLocalState()) {
      setSyncStatus({
        tone: 'warning',
        label: t('editor.diskChanged'),
        title: t('editor.fileChangedReview'),
      });
      setStatus(t('editor.fileChangedReview'));
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
          label: t('editor.syncNeedsReview'),
          title: (requestError as Error).message,
        });
        setError((requestError as Error).message);
      }
    } finally {
      setFileLoading(false);
    }
  }, [hasProtectedLocalState, resetTransientEditorState, t]);

  const applyEditorSyncEvent = useCallback(async (event: PanelEditorSyncEvent) => {
    const currentPath = selectedPathRef.current;
    try {
      const nextManifest = await refreshManifest();
      if (!currentPath) {
        setSyncStatus({ tone: 'muted', label: t('editor.projectUpdated') });
        return;
      }

      const manifestStillContainsCurrent = nextManifest.files.some(candidate => candidate.relativePath === currentPath);
      const touchesCurrentFile = event.type === 'editor:file-changed'
        ? event.relativePath === currentPath
        : event.relativePaths.length === 0 || event.relativePaths.includes(currentPath);

      if (!touchesCurrentFile) {
        setSyncStatus({ tone: 'muted', label: t('editor.projectUpdated') });
        return;
      }

      if (!manifestStillContainsCurrent) {
        setSyncStatus({
          tone: hasProtectedLocalState() ? 'warning' : 'muted',
          label: hasProtectedLocalState() ? t('editor.diskChanged') : t('editor.fileMoved'),
          title: `${currentPath} is no longer present in the editor manifest.`,
        });
        if (!hasProtectedLocalState()) {
          setStatus(`${currentPath} changed on disk and is no longer listed. The editor will open the next available file.`);
        }
        return;
      }

      await reloadCurrentFileFromDisk(
        currentPath,
        event.source === 'browser' ? t('editor.syncedFromAnotherTab') : t('editor.syncedFromDisk'),
      );
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') {
        setSyncStatus({
          tone: 'warning',
          label: t('editor.syncPaused'),
          title: (requestError as Error).message,
        });
        setError((requestError as Error).message);
      }
    }
  }, [hasProtectedLocalState, refreshManifest, reloadCurrentFileFromDisk, t]);

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
              : { tone: 'muted', label: t('editor.liveSyncOn'), title: 'Watching local files for changes.' };
          }
          return {
            tone: 'warning',
            label: t('editor.syncReconnecting'),
            title: 'The local event stream is reconnecting. Manual saves still use revision checks.',
          };
        });
      },
    );
  }, [receiveEditorSyncEvent, t]);

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

  const masterLanguages = useMemo(() => (
    manifest?.routes.map(route => route.sourceLang) || []
  ), [manifest]);

  const visibleRows = useMemo(() => {
    if (!file || !manifest) return [];
    const query = rowSearch.trim().toLocaleLowerCase();
    return file.rows.filter(row => {
      const hasMissing = manifest.languages.some(lang => {
        const changed = drafts.has(draftIdentity(lang, row.pointer));
        return row.cells[lang]?.kind === 'missing' && !changed;
      });
      const hasEmpty = manifest.languages.some(lang => {
        const changed = drafts.has(draftIdentity(lang, row.pointer));
        return row.cells[lang]?.kind === 'empty' && !changed;
      });
      const hasPending = manifest.languages.some(lang => row.cells[lang]?.pending);
      const hasChanged = manifest.languages.some(lang => drafts.has(draftIdentity(lang, row.pointer)));
      const hasSkipped = manifest.languages.some(lang => row.cells[lang]?.skipped);
      if (showMissing && !hasMissing) return false;
      if (showEmpty && !hasEmpty) return false;
      if (showPending && !hasPending) return false;
      if (showChanged && !hasChanged) return false;
      if (showSkipped && !hasSkipped) return false;
      if (!query) return true;
      if (row.displayPath.toLocaleLowerCase().includes(query)) return true;
      return manifest.languages.some(
        lang => effectiveCellValue(row, lang, drafts).toLocaleLowerCase().includes(query),
      );
    });
  }, [drafts, file, manifest, rowSearch, showChanged, showEmpty, showMissing, showPending, showSkipped]);
  const hasVisibleRows = visibleRows.length > 0;

  useEffect(() => {
    if (hasVisibleRows) return;
    setSelectedCells([]);
    setContextMenu(null);
  }, [hasVisibleRows]);

  const openGridContextMenu = useCallback((request: GridContextMenuRequest) => {
    setContextMenu(request);
    setBatchMenuOpen(false);
    setFilePickerOpen(false);
    setFilterPanelOpen(false);
    window.setTimeout(() => {
      contextMenuTriggerRef.current?.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: request.x,
        clientY: request.y,
        button: 2,
        buttons: 2,
      }));
    }, 0);
  }, []);

  const cellStateCounts = useMemo(() => {
    const counts = {
      changed: 0,
      pending: 0,
      empty: 0,
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
        if ((cell?.kind || 'missing') === 'empty' && !changed) counts.empty += 1;
        if ((cell?.kind || 'missing') === 'missing' && !changed) counts.missing += 1;
        if (cell?.skipped) counts.skipped += 1;
        if (aiDrafts.get(identity)?.translatedText === drafts.get(identity)) counts.ai += 1;
        if (failedTranslations.has(identity)) counts.failed += 1;
      }
    }
    return counts;
  }, [aiDrafts, drafts, failedTranslations, file, manifest]);

  const selectedMeta = manifest?.files.find(candidate => candidate.relativePath === selectedPath);
  const jobRunning = activeJob?.status === 'queued' || activeJob?.status === 'running';
  const activeFilterCount = [
    showMissing,
    showEmpty,
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
    options: { overwriteDrafts: boolean; forceRetranslate: boolean },
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
        skipped.push({ ...cell, reason: t('editor.reasonKeyMissing') });
        continue;
      }
      if (!route) {
        skipped.push({ ...cell, reason: t('editor.reasonMasterCell') });
        continue;
      }
      const targetCell = row.cells[cell.lang];
      if (targetCell?.kind === 'unsupported') {
        skipped.push({ ...cell, reason: t('editor.reasonTargetNotString') });
        continue;
      }
      if (targetCell?.skipped) {
        skipped.push({ ...cell, reason: t('editor.reasonSkippedKey') });
        continue;
      }
      if (drafts.has(identity) && !options.overwriteDrafts) {
        skipped.push({ ...cell, reason: t('editor.reasonLocalDraft') });
        continue;
      }
      const sourceIdentity = draftIdentity(route.sourceLang, cell.pointer);
      const sourceCell = row.cells[route.sourceLang];
      const hasSourceDraft = drafts.has(sourceIdentity);
      const sourceText = effectiveCellValue(row, route.sourceLang, drafts);
      if (!hasSourceDraft && sourceCell?.kind !== 'string' && sourceCell?.kind !== 'empty') {
        skipped.push({ ...cell, reason: t('editor.reasonSourceMissing') });
        continue;
      }
      if (sourceText.length === 0) {
        skipped.push({ ...cell, reason: t('editor.reasonSourceEmpty') });
        continue;
      }
      const needsTranslation = targetCell?.kind === 'missing'
        || targetCell?.kind === 'empty'
        || targetCell?.pending
        || hasSourceDraft;
      if (!options.forceRetranslate && !needsTranslation) {
        skipped.push({ ...cell, reason: t('editor.reasonReviewed') });
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

  const buildMasterTranslatePreview = useCallback((
    preview: MasterTranslatePreviewState,
  ): MasterTranslatePreview => {
    if (!file || !manifest) return { cells: [], skipped: [] };
    const masterSet = new Set(masterLanguages);
    const candidates = new Map<string, GridSelectionCell>();
    const skipped: MasterTranslatePreview['skipped'] = [];

    if (
      masterLanguages.length < 2
      || !masterSet.has(preview.sourceLang)
      || !masterSet.has(preview.targetLang)
      || preview.sourceLang === preview.targetLang
    ) {
      return {
        cells: [],
        skipped: preview.pointers.map(pointer => ({
          lang: preview.targetLang,
          pointer,
          reason: t('editor.reasonChooseTwoMasters'),
        })),
      };
    }

    for (const pointer of preview.pointers) {
      const identity = draftIdentity(preview.targetLang, pointer);
      if (candidates.has(identity)) continue;
      const row = rowsByPointer.get(pointer);
      if (!row) {
        skipped.push({ lang: preview.targetLang, pointer, reason: t('editor.reasonKeyMissing') });
        continue;
      }

      const targetCell = row.cells[preview.targetLang];
      if (targetCell?.kind === 'unsupported') {
        skipped.push({ lang: preview.targetLang, pointer, reason: t('editor.reasonTargetMasterNotString') });
        continue;
      }
      if (targetCell?.skipped) {
        skipped.push({ lang: preview.targetLang, pointer, reason: t('editor.reasonSkippedKey') });
        continue;
      }
      if (drafts.has(identity) && !preview.overwriteDrafts) {
        skipped.push({ lang: preview.targetLang, pointer, reason: t('editor.reasonLocalDraft') });
        continue;
      }

      const sourceIdentity = draftIdentity(preview.sourceLang, pointer);
      const sourceCell = row.cells[preview.sourceLang];
      const hasSourceDraft = drafts.has(sourceIdentity);
      const sourceText = effectiveCellValue(row, preview.sourceLang, drafts);
      if (!hasSourceDraft && sourceCell?.kind !== 'string' && sourceCell?.kind !== 'empty') {
        skipped.push({ lang: preview.targetLang, pointer, reason: t('editor.reasonSourceMasterMissing') });
        continue;
      }
      if (sourceText.length === 0) {
        skipped.push({ lang: preview.targetLang, pointer, reason: t('editor.reasonSourceMasterEmpty') });
        continue;
      }

      if (
        !preview.overwriteExisting
        && targetCell?.kind === 'string'
        && targetCell.value !== sourceText
      ) {
        skipped.push({ lang: preview.targetLang, pointer, reason: t('editor.reasonExistingMaster') });
        continue;
      }

      candidates.set(identity, { lang: preview.targetLang, pointer });
    }

    return { cells: [...candidates.values()], skipped };
  }, [drafts, file, manifest, masterLanguages, rowsByPointer]);

  const currentMasterPreview = useMemo(() => (
    masterTranslatePreview
      ? buildMasterTranslatePreview(masterTranslatePreview)
      : null
  ), [buildMasterTranslatePreview, masterTranslatePreview]);

  const openTranslatePreview = useCallback((title: string, cells: GridSelectionCell[]) => {
    if (!file || !manifest) return;
    if (cells.length === 0) {
      setStatus(t('editor.selectTargets'));
      return;
    }
    setMasterTranslatePreview(null);
    setMasterSkippedExpanded(false);
    setTranslateSkippedExpanded(false);
    setTranslatePreview({
      title,
      cells,
      overwriteDrafts: false,
      forceRetranslate: false,
    });
  }, [file, manifest]);

  const openMasterTranslatePreview = useCallback((targetLang: string) => {
    if (!file || !manifest) return;
    if (masterLanguages.length < 2) {
      setStatus(t('editor.masterOnlyMulti'));
      return;
    }
    const sourceLang = masterLanguages.find(lang => lang !== targetLang) || '';
    if (!sourceLang) {
      setStatus(t('editor.chooseOtherMaster'));
      return;
    }
    setTranslatePreview(null);
    setTranslateSkippedExpanded(false);
    setMasterSkippedExpanded(false);
    setMasterTranslatePreview({
      targetLang,
      sourceLang,
      pointers: file.rows.map(row => row.pointer),
      overwriteDrafts: false,
      overwriteExisting: false,
      forceRetranslate: false,
    });
  }, [file, manifest, masterLanguages]);

  const cellsForRowTargets = useCallback((pointer: string): GridSelectionCell[] => {
    if (!manifest) return [];
    return manifest.routes.flatMap(route => (
      route.languages
        .filter(lang => lang !== route.sourceLang)
        .map(lang => ({ lang, pointer }))
    ));
  }, [manifest]);

  const cellsForLanguageTargets = useCallback((lang: string): GridSelectionCell[] => {
    const rows = file?.rows || [];
    return rows
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

  const retryFailedCells = useMemo(() => [...failedTranslations.values()].map(({ error: _error, ...cell }) => cell), [failedTranslations]);
  const failedTranslationList = useMemo(() => [...failedTranslations.values()], [failedTranslations]);

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
          error: normalizePanelErrorMessage(result.error || t('editor.translationResultFailed'), t),
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
        t('editor.translationFailedToast', {
          count: failed,
          message: `${firstFailure.lang} ${firstFailure.pointer}: ${firstFailure.error}`,
        }),
      );
    } else {
      setTranslationError(null);
    }
    setStatus(
      failed > 0
        ? t('editor.aiDraftsGeneratedWithFailures', { translated, failed })
        : t('editor.aiDraftsGenerated', { count: translated }),
    );
  }, [file, manifest, rowsByPointer, t]);

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
        setError(current.error || t('editor.aiTranslationFailed'));
      }
    } catch (requestError) {
      setTranslatingCells(new Set());
      setError((requestError as Error).message);
    }
  }, [applyTranslationResults, t]);

  const confirmTranslation = useCallback(async () => {
    if (!file || !manifest?.writeToken || !translatePreview || !currentPreview) return;
    if (currentPreview.cells.length === 0) {
      setStatus(t('editor.noTranslatableCells'));
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
    setStatus(t('editor.startingTranslation', { count: currentPreview.cells.length }));
    try {
      const job = await createEditorTranslateJob({
        relativePath: file.relativePath,
        revisions: file.revisions,
        snapshotRevision: file.snapshotRevision,
        cells: currentPreview.cells,
        drafts: createEditorPatches(draftsRef.current),
        options: {
          overwriteDrafts: translatePreview.overwriteDrafts,
          forceRetranslate: translatePreview.forceRetranslate,
        },
      }, manifest.writeToken);
      void pollTranslateJob(job);
    } catch (requestError) {
      setTranslatingCells(new Set());
      setError((requestError as Error).message);
    }
  }, [currentPreview, file, manifest, pollTranslateJob, translatePreview]);

  const confirmMasterTranslation = useCallback(async () => {
    if (!file || !manifest?.writeToken || !masterTranslatePreview || !currentMasterPreview) return;
    if (currentMasterPreview.cells.length === 0) {
      setStatus(t('editor.noMasterCells'));
      return;
    }
    setMasterTranslatePreview(null);
    setContextMenu(null);
    setBatchMenuOpen(false);
    setFilePickerOpen(false);
    setFilterPanelOpen(false);
    setError(null);
    setTranslationError(null);
    setFailedTranslations(new Map());
    const identities = new Set(currentMasterPreview.cells.map(cell => draftIdentity(cell.lang, cell.pointer)));
    setTranslatingCells(identities);
    setStatus(t('editor.startingMasterTranslation', { count: currentMasterPreview.cells.length }));
    try {
      const job = await createEditorMasterTranslateJob({
        relativePath: file.relativePath,
        revisions: file.revisions,
        snapshotRevision: file.snapshotRevision,
        sourceLang: masterTranslatePreview.sourceLang,
        targetLang: masterTranslatePreview.targetLang,
        pointers: currentMasterPreview.cells.map(cell => cell.pointer),
        drafts: createEditorPatches(draftsRef.current),
        options: {
          overwriteDrafts: masterTranslatePreview.overwriteDrafts,
          overwriteExisting: masterTranslatePreview.overwriteExisting,
          forceRetranslate: masterTranslatePreview.forceRetranslate,
        },
      }, manifest.writeToken);
      void pollTranslateJob(job);
    } catch (requestError) {
      setTranslatingCells(new Set());
      setError((requestError as Error).message);
    }
  }, [currentMasterPreview, file, manifest, masterTranslatePreview, pollTranslateJob]);

  const cancelTranslation = useCallback(async () => {
    if (!activeJob || !manifest?.writeToken) return;
    try {
      const cancelled = await cancelEditorTranslateJob(activeJob.id, manifest.writeToken);
      setActiveJob(cancelled);
      applyTranslationResults(cancelled.results);
      setStatus(t('editor.cancelled'));
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setTranslatingCells(new Set());
    }
  }, [activeJob, applyTranslationResults, manifest?.writeToken]);

  const handleGridChanges = useCallback((values: GridValueChange[]) => {
    if (!file || !manifest) return;
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
    setStatus(t('editor.unsavedChanges', { count: next.size }));
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
    if (!file || !manifest?.writeToken || draftsRef.current.size === 0) return true;
    const savingDrafts = new Map(draftsRef.current);
    const acceptedTranslations = [...aiDraftsRef.current.entries()].flatMap(([identity, translation]) => (
      savingDrafts.get(identity) === translation.translatedText ? [translation] : []
    ));
    setSaving(true);
    setError(null);
    setStatus(t('editor.writingFiles'));
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
      setSyncStatus({ tone: 'ok', label: t('editor.savedLocally'), title: `${file.relativePath} was written to disk.` });
      setStatus(t('editor.savedFiles', { count: result.savedLanguages.length }));
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
            setStatus(t('editor.fileChangedResolve'));
          } else {
            setStatus(t('editor.externalPreserved'));
          }
        } catch (reloadError) {
          setError(t('editor.reloadFailed', { message: (reloadError as Error).message }));
        }
        return false;
      }
      setError((requestError as Error).message);
      setStatus(t('editor.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [broadcastSyncEvent, file, manifest, onProjectChange, refreshManifest, rememberSyncEvent]);

  const queueCellFocus = useCallback((relativePath: string, cell: GridSelectionCell) => {
    setRowSearch('');
    setShowMissing(false);
    setShowEmpty(false);
    setShowPending(false);
    setShowChanged(false);
    setShowSkipped(false);
    setFocusRequest({
      relativePath,
      lang: cell.lang,
      pointer: cell.pointer,
      nonce: Date.now(),
    });
    setStatus(t('editor.openingCell', { path: relativePath, lang: cell.lang, pointer: cell.pointer }));
  }, [t]);

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
    setStatus(t('editor.conflictsResolved'));
  };

  const resolveConflict = useCallback((identity: string, resolution: 'disk' | 'draft') => {
    setConflicts(current => current?.map(item => (
      item.identity === identity ? { ...item, resolution } : item
    )) || null);
  }, []);

  const currentFileTriggerContent = (
    <>
      <FileText size={18} aria-hidden="true" />
      <span>{t('editor.explorer')}</span>
    </>
  );

  const saveButton = (
    <button
      className="scan-button editor-save-button"
      type="button"
      disabled={drafts.size === 0 || saving || !file || jobRunning}
      onClick={() => void save()}
    >
      <FloppyDisk size={22} weight="bold" aria-hidden="true" />
      <span>{saving ? t('editor.saveSafely') : t('editor.saveChanges', { count: drafts.size })}</span>
    </button>
  );

  const cellStateSummary = (
    <div className="editor-cell-state-summary">
      <div className="editor-state-legend">
        <span><i className="legend-dot is-changed" />{t('editor.changed')} <b>{cellStateCounts.changed}</b></span>
        <span><i className="legend-dot is-pending" />{t('editor.pending')} <b>{cellStateCounts.pending}</b></span>
        <span><i className="legend-dot is-empty" />{t('editor.emptyString')} <b>{cellStateCounts.empty}</b></span>
        <span><i className="legend-dot is-missing" />{t('editor.missing')} <b>{cellStateCounts.missing}</b></span>
        <span><i className="legend-dot is-skipped" />{t('editor.skipped')} <b>{cellStateCounts.skipped}</b></span>
        <span><i className="legend-dot is-ai" />{t('editor.ai')} <b>{cellStateCounts.ai}</b></span>
        {cellStateCounts.failed > 0 && <span><i className="legend-dot is-failed" />{t('editor.failed')} <b>{cellStateCounts.failed}</b></span>}
      </div>
    </div>
  );

  const currentFileSummary = (
    <div className="editor-bottom-file" title={selectedPath || t('editor.noJsonFile')}>
      <FileText size={16} aria-hidden="true" />
      <span>{selectedPath || t('editor.noJsonFile')}</span>
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
    <div className="editor-filter-check-list" aria-label={t('editor.showRows')}>
      <StatusFilterCheckbox checked={showMissing} label={t('editor.missing')} onCheckedChange={setShowMissing} />
      <StatusFilterCheckbox checked={showEmpty} label={t('editor.emptyString')} onCheckedChange={setShowEmpty} />
      <StatusFilterCheckbox checked={showPending} label={t('editor.pending')} onCheckedChange={setShowPending} />
      <StatusFilterCheckbox checked={showChanged} label={t('editor.changed')} onCheckedChange={setShowChanged} />
      <StatusFilterCheckbox checked={showSkipped} label={t('editor.skipped')} onCheckedChange={setShowSkipped} />
    </div>
  );

  const filePickerPanel = (
    <>
      <div className="file-panel-header">
        <div>
          <SheetTitle asChild>
            <strong>{t('editor.jsonFiles', { count: manifest?.files.length || 0 })}</strong>
          </SheetTitle>
        </div>
        <button className="file-panel-close" type="button" onClick={() => setFilePickerOpen(false)} aria-label={t('editor.closeExplorer')}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <label className="editor-inline-search">
        <MagnifyingGlass size={17} aria-hidden="true" />
        <span className="sr-only">{t('editor.searchFiles')}</span>
        <input value={fileSearch} onChange={event => setFileSearch(event.target.value)} placeholder={t('editor.findJsonFile')} />
      </label>
      <div className="editor-file-menu-list">
        {fileGroups.length > 0 ? fileGroups.map(group => (
          <section key={group.directory}>
            {(() => {
              const groupStatus = getExplorerGroupStatus(group.files, t);
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
              const fileStatus = getExplorerFileStatus(candidate, t);
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
          <p className="editor-toolbar-panel-empty">{t('editor.noFileMatches')}</p>
        )}
      </div>
    </>
  );

  const filterPanel = (
    <>
      <div className="editor-toolbar-panel-header">
        <span>
          <strong>{activeFilterCount === 0 ? t('editor.allStates') : t('editor.filtersActive', { count: activeFilterCount })}</strong>
        </span>
        <em>{t('editor.keysRatio', { visible: visibleRows.length, total: file?.rows.length || 0 })}</em>
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
          aria-label={t('editor.openExplorer')}
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
        <div className="editor-history" aria-label={t('editor.draftHistory')}>
          <button type="button" disabled={undoStack.length === 0} onClick={undo} aria-label={t('editor.undoAria')}>
            <ArrowUUpLeft size={20} aria-hidden="true" />
            <span>{t('editor.undo')}</span>
          </button>
          <button type="button" disabled={redoStack.length === 0} onClick={redo} aria-label={t('editor.redoAria')}>
            <ArrowUUpRight size={20} aria-hidden="true" />
            <span>{t('editor.redo')}</span>
          </button>
        </div>
        <button
          className="editor-command-button editor-translate-button"
          type="button"
          disabled={selectedCells.length === 0 || jobRunning}
          onClick={() => openTranslatePreview(t('editor.translateSelectedCells'), selectedCells)}
        >
          <Translate size={20} aria-hidden="true" />
          <span>{t('editor.translateSelected')}</span>
          {selectedCells.length > 0 && <b>{selectedCells.length}</b>}
        </button>
        <Popover
          open={batchMenuOpen}
          onOpenChange={open => {
            if (jobRunning) {
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
              disabled={jobRunning}
            >
              <Sparkle size={20} aria-hidden="true" />
              <span>{t('editor.batch')}</span>
              <CaretDown size={16} aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="editor-toolbar-panel editor-batch-panel" aria-label={t('editor.batchActions')}>
            <div className="editor-toolbar-panel-header">
              <span>
                <strong>{t('editor.translateCurrentView')}</strong>
              </span>
            </div>
            <div className="editor-batch-action-list">
              <button type="button" onClick={() => openTranslatePreview(t('editor.translateVisiblePendingCells'), visiblePendingCells)}>{t('editor.translateVisiblePending')} <b>{visiblePendingCells.length}</b></button>
              <button type="button" onClick={() => openTranslatePreview(t('editor.translateVisibleMissingCells'), visibleMissingCells)}>{t('editor.translateVisibleMissing')} <b>{visibleMissingCells.length}</b></button>
              <button type="button" disabled={retryFailedCells.length === 0} onClick={() => openTranslatePreview(t('editor.retryFailedTranslations'), retryFailedCells)}>{t('editor.retryFailed')} <b>{retryFailedCells.length}</b></button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="editor-operation-right">
        {jobRunning && activeJob && (
          <div className="editor-translation-progress" role="status">
            {t('editor.translatingProgress', { completed: activeJob.completed, total: activeJob.total })}
            <button type="button" onClick={() => void cancelTranslation()}>{t('editor.cancelJob')}</button>
          </div>
        )}
        <button
          className={workspaceSearchOpen ? 'editor-command-button is-active' : 'editor-command-button'}
          type="button"
          aria-label={t('editor.searchAllCopy')}
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
          <span>{t('editor.workspace')}</span>
        </button>
        <label className="editor-inline-search editor-copy-search">
          <MagnifyingGlass size={17} aria-hidden="true" />
          <span className="sr-only">{t('editor.searchKeysCopy')}</span>
          <input value={rowSearch} onChange={event => setRowSearch(event.target.value)} placeholder={t('editor.searchKeysPlaceholder')} />
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
              aria-label={t('editor.filterRows')}
            >
              <Funnel size={20} aria-hidden="true" />
              {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
            </button>
          </PopoverTrigger>
          <PopoverContent className="editor-toolbar-panel editor-filter-panel" aria-label={t('editor.filterRows')}>
            {filterPanel}
          </PopoverContent>
        </Popover>
        <button
          className={activeDrawer === 'tools' ? 'editor-command-button is-active' : 'editor-command-button'}
          type="button"
          aria-label={t('editor.openDetails')}
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
      bottomBarLabel={t('editor.statusLabel')}
      operationBar={editorOperationBar}
      operationBarClassName="editor-operation-bar"
      operationBarLabel={t('editor.controlsLabel')}
      onNavigate={guardedNavigate}
      project={project}
      skipLabel={t('editor.skipLabel')}
      shellClassName="is-editor-shell"
      workspaceClassName="editor-workspace"
      liveStatus={status}
    >
      <div className="editor-table-stage">
        <section className="editor-table-panel" aria-label={t('editor.tableLabel')}>
          {manifestLoading || fileLoading ? (
            <div className="editor-table-loading" aria-label={t('editor.loadingFile')}>
              <div className="skeleton skeleton-metrics" />
              <div className="skeleton skeleton-route" />
              <div className="skeleton skeleton-route" />
            </div>
          ) : file && manifest && hasVisibleRows ? (
            <ContextMenu onOpenChange={open => { if (!open) setContextMenu(null); }}>
              <ContextMenuTrigger asChild>
                <span ref={contextMenuTriggerRef} className="editor-context-menu-anchor" aria-hidden="true" />
              </ContextMenuTrigger>
              <div className="editor-grid-context-trigger">
                <TranslationGrid
                  rows={visibleRows}
                  manifest={manifest}
                  drafts={drafts}
                  focusCell={focusRequest?.relativePath === file.relativePath ? focusRequest : undefined}
                  translationStates={translationStates}
                  onChangeValues={handleGridChanges}
                  onSelectionChange={setSelectedCells}
                  onContextMenu={openGridContextMenu}
                />
              </div>
              <ContextMenuContent className="editor-context-menu" onCloseAutoFocus={event => event.preventDefault()}>
                {contextMenu?.kind === 'cell' && (
                  <ContextMenuItem onSelect={() => openTranslatePreview(t('editor.translateSelectedCells'), contextMenu.selectedCells)}>
                    <span>{t('editor.translateSelectedCells')}</span>
                    <b>{contextMenu.selectedCells.length}</b>
                  </ContextMenuItem>
                )}
                {contextMenu?.kind === 'row' && (
                  <ContextMenuItem onSelect={() => openTranslatePreview(t('editor.translateRowTargets'), cellsForRowTargets(contextMenu.pointer))}>
                    <span>{t('editor.translateRowTargets')}</span>
                  </ContextMenuItem>
                )}
                {contextMenu?.kind === 'language' && (
                  <ContextMenuItem onSelect={() => openTranslatePreview(`${contextMenu.lang} · ${t('editor.translateColumnTargets')}`, cellsForLanguageTargets(contextMenu.lang))}>
                    <span>{t('editor.translateColumnTargets')}</span>
                  </ContextMenuItem>
                )}
                {contextMenu?.kind === 'master-language' && (
                  <ContextMenuItem onSelect={() => openMasterTranslatePreview(contextMenu.lang)}>
                    <span>{t('editor.translateFromOtherMaster')}</span>
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          ) : file && manifest ? (
            <div className="editor-table-empty is-filtered-empty">
              <MagnifyingGlass size={28} aria-hidden="true" />
              <strong>{t('editor.noMatchingKeys')}</strong>
              <span>{t('editor.noMatchingKeysBody', { path: file.relativePath })}</span>
            </div>
          ) : (
            <div className="editor-table-empty">
              <FileText size={28} aria-hidden="true" />
              <strong>{t('editor.selectValidJson')}</strong>
              <span>{t('editor.selectValidJsonBody')}</span>
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
        failedTranslations={failedTranslationList}
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

      <Dialog open={Boolean(translatePreview && currentPreview)} onOpenChange={open => { if (!open) setTranslatePreview(null); }}>
        {translatePreview && currentPreview && (
          <ModalContent className="translate-confirm-modal" size="lg" aria-describedby="translate-description">
            <ModalHeader icon={<Translate size={20} weight="bold" />} closeLabel={t('common.close')}>
              <ModalTitleBlock
                title={translatePreview.title}
                descriptionId="translate-description"
                description={(
                  <>
                    {t('editor.translateDescription', { ready: currentPreview.cells.length })}
                    {currentPreview.skipped.length > 0 && <> {t('editor.translateSkippedDescription', { skipped: currentPreview.skipped.length })}</>}
                  </>
                )}
              />
            </ModalHeader>
            <div className="translate-confirm-body">
              <dl className="translate-confirm-stats">
                <div><dt>{t('common.selected')}</dt><dd>{translatePreview.cells.length}</dd></div>
                <div><dt>{t('editor.ready')}</dt><dd>{currentPreview.cells.length}</dd></div>
                <div><dt>{t('common.skipped')}</dt><dd>{currentPreview.skipped.length}</dd></div>
                <div><dt>{t('common.cache')}</dt><dd>{translatePreview.forceRetranslate ? t('common.ignored') : t('editor.checkedOnStart')}</dd></div>
              </dl>
              <label className="translate-option">
                <Checkbox
                  checked={translatePreview.overwriteDrafts}
                  onCheckedChange={checked => setTranslatePreview(current => current && { ...current, overwriteDrafts: checked === true })}
                />
                <span>{t('editor.overwriteDrafts')}</span>
              </label>
              <label className="translate-option">
                <Checkbox
                  checked={translatePreview.forceRetranslate}
                  onCheckedChange={checked => setTranslatePreview(current => current && { ...current, forceRetranslate: checked === true })}
                />
                <span>{t('editor.forceRetranslate')}</span>
              </label>
              {currentPreview.skipped.length > 0 && (
                <div className="translate-skip-list">
                  {currentPreview.skipped.slice(0, translateSkippedExpanded ? currentPreview.skipped.length : 5).map(item => (
                    <span key={`${item.lang}:${item.pointer}`}>{item.lang} {item.pointer} · {item.reason}</span>
                  ))}
                  {currentPreview.skipped.length > 5 && (
                    <button
                      type="button"
                      className="translate-skip-more"
                      onClick={() => setTranslateSkippedExpanded(expanded => !expanded)}
                    >
                      {translateSkippedExpanded
                        ? t('editor.showFewerSkipped')
                        : t('editor.moreSkippedCells', { count: currentPreview.skipped.length - 5 })}
                    </button>
                  )}
                </div>
              )}
            </div>
            <ModalActions>
              <button type="button" className="button-tertiary" onClick={() => setTranslatePreview(null)}>{t('common.cancel')}</button>
              <button type="button" className="button-primary" disabled={currentPreview.cells.length === 0 || jobRunning} onClick={() => void confirmTranslation()}>
                {t('editor.startTranslation')}
              </button>
            </ModalActions>
          </ModalContent>
        )}
      </Dialog>

      <Dialog open={Boolean(masterTranslatePreview && currentMasterPreview)} onOpenChange={open => { if (!open) setMasterTranslatePreview(null); }}>
        {masterTranslatePreview && currentMasterPreview && (
          <ModalContent className="translate-confirm-modal" size="lg" aria-describedby="master-translate-description">
            <ModalHeader icon={<Translate size={20} weight="bold" />} closeLabel={t('common.close')}>
              <ModalTitleBlock
                title={t('editor.masterTranslateTitle', { lang: masterTranslatePreview.targetLang })}
                descriptionId="master-translate-description"
                description={(
                  <>
                    {t('editor.masterTranslateDescription')}
                    {' '}
                    {currentMasterPreview.skipped.length > 0 && <> {t('editor.masterTranslateSkipped', { count: currentMasterPreview.skipped.length })}</>}
                  </>
                )}
              />
            </ModalHeader>
            <div className="translate-confirm-body">
              <div className="translate-select-field">
                <span>{t('editor.fromMaster')}</span>
                <Select
                  value={masterTranslatePreview.sourceLang || undefined}
                  onValueChange={value => setMasterTranslatePreview(current => current && { ...current, sourceLang: value })}
                >
                  <SelectTrigger aria-label={t('editor.fromMaster')}>
                    <SelectValue placeholder={t('editor.chooseMaster')} />
                  </SelectTrigger>
                  <SelectContent>
                  {masterLanguages.filter(lang => lang !== masterTranslatePreview.targetLang).map(lang => (
                    <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                  ))}
                  </SelectContent>
                </Select>
              </div>
              <dl className="translate-confirm-stats">
                <div><dt>{t('common.target')}</dt><dd>{masterTranslatePreview.targetLang}</dd></div>
                <div><dt>{t('common.selected')}</dt><dd>{masterTranslatePreview.pointers.length}</dd></div>
                <div><dt>{t('editor.ready')}</dt><dd>{currentMasterPreview.cells.length}</dd></div>
                <div><dt>{t('common.skipped')}</dt><dd>{currentMasterPreview.skipped.length}</dd></div>
                <div><dt>{t('common.cache')}</dt><dd>{masterTranslatePreview.forceRetranslate ? t('common.ignored') : t('editor.checkedOnStart')}</dd></div>
              </dl>
              <label className="translate-option">
                <Checkbox
                  checked={masterTranslatePreview.overwriteExisting}
                  onCheckedChange={checked => setMasterTranslatePreview(current => current && { ...current, overwriteExisting: checked === true })}
                />
                <span>{t('editor.overwriteMasterCopy')}</span>
              </label>
              <label className="translate-option">
                <Checkbox
                  checked={masterTranslatePreview.overwriteDrafts}
                  onCheckedChange={checked => setMasterTranslatePreview(current => current && { ...current, overwriteDrafts: checked === true })}
                />
                <span>{t('editor.overwriteDrafts')}</span>
              </label>
              <label className="translate-option">
                <Checkbox
                  checked={masterTranslatePreview.forceRetranslate}
                  onCheckedChange={checked => setMasterTranslatePreview(current => current && { ...current, forceRetranslate: checked === true })}
                />
                <span>{t('editor.forceRetranslate')}</span>
              </label>
              {currentMasterPreview.skipped.length > 0 && (
                <div className="translate-skip-list">
                  {currentMasterPreview.skipped.slice(0, masterSkippedExpanded ? currentMasterPreview.skipped.length : 5).map(item => (
                    <span key={`${item.lang}:${item.pointer}`}>{item.lang} {item.pointer} · {item.reason}</span>
                  ))}
                  {currentMasterPreview.skipped.length > 5 && (
                    <button
                      type="button"
                      className="translate-skip-more"
                      onClick={() => setMasterSkippedExpanded(expanded => !expanded)}
                    >
                      {masterSkippedExpanded
                        ? t('editor.showFewerSkipped')
                        : t('editor.moreSkippedKeys', { count: currentMasterPreview.skipped.length - 5 })}
                    </button>
                  )}
                </div>
              )}
            </div>
            <ModalActions>
              <button type="button" className="button-tertiary" onClick={() => setMasterTranslatePreview(null)}>{t('common.cancel')}</button>
              <button type="button" className="button-primary" disabled={currentMasterPreview.cells.length === 0 || jobRunning} onClick={() => void confirmMasterTranslation()}>
                {t('editor.startMasterTranslation')}
              </button>
            </ModalActions>
          </ModalContent>
        )}
      </Dialog>

      <Dialog open={Boolean(pendingNavigation)} onOpenChange={open => { if (!open) setPendingNavigation(null); }}>
        {pendingNavigation && (
          <ModalContent className="leave-confirm-modal" aria-describedby="leave-description">
            <ModalHeader icon={<WarningCircle size={20} weight="fill" />} closeLabel={t('common.close')}>
              <ModalTitleBlock
                title={pendingNavigation.kind === 'file' ? t('editor.saveBeforeFile') : t('editor.saveBeforeLeave')}
                descriptionId="leave-description"
                description={(
                  <>
                    {t('editor.draftsBelongTo', { count: drafts.size, path: selectedPath })}{' '}
                    {pendingNavigation.kind === 'file'
                      ? t('editor.draftsCannotFollow')
                      : t('editor.draftsStayBrowser')}
                  </>
                )}
              />
            </ModalHeader>
            <ModalActions>
              <button type="button" className="button-tertiary" onClick={() => setPendingNavigation(null)}>{t('editor.stayHere')}</button>
              <button type="button" className="button-secondary is-danger" onClick={discardAndNavigate}>{t('editor.discardDraft')}</button>
              <button type="button" className="button-primary" disabled={saving} onClick={() => void saveAndNavigate()}>
                {pendingNavigation.kind === 'file' ? t('editor.saveContinue') : t('editor.saveLeave')}
              </button>
            </ModalActions>
          </ModalContent>
        )}
      </Dialog>

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

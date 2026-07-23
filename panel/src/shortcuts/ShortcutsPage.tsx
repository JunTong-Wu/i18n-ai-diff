import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowsClockwise,
  CheckCircle,
  ClipboardText,
  Code,
  Database,
  Lightning,
  Play,
  ShareNetwork,
  Sparkle,
  Translate,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  createTranslationRun,
  loadEditorManifest,
  loadTranslationRun,
  PanelApiError,
} from '../api';
import { normalizePanelErrorMessage } from '../components/feedback/panelErrorMessages';
import { usePanelErrorToast } from '../components/feedback/usePanelErrorToast';
import { Dialog } from '../components/ui/dialog';
import {
  ModalActions,
  ModalContent,
  ModalHeader,
  ModalTitleBlock,
} from '../components/ui/modal';
import { Checkbox } from '../components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { toast } from '../components/ui/sonner';
import { usePanelI18n } from '../i18n';
import { PanelLayout } from '../layout/PanelLayout';
import type {
  PanelProject,
  PanelTranslationRunJob,
  PanelTranslationRunRequest,
} from '../types';

type ShortcutMode = PanelTranslationRunRequest['mode'];

interface ShortcutsPageProps {
  project: PanelProject | null;
  onNavigate(href: string): void;
  onProjectChange(project: PanelProject): void;
}

interface ConfirmationState {
  title: string;
  description: string;
  warning: string;
  request: PanelTranslationRunRequest;
  command: string;
}

function ShortcutsPage({ project, onNavigate, onProjectChange }: ShortcutsPageProps) {
  const { formatNumber, t } = usePanelI18n();
  const [mode, setMode] = useState<ShortcutMode>('pending');
  const [writeToken, setWriteToken] = useState<string | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [masterSource, setMasterSource] = useState('');
  const [masterTarget, setMasterTarget] = useState('');
  const [masterForce, setMasterForce] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [activeJob, setActiveJob] = useState<PanelTranslationRunJob | null>(null);
  const [copying, setCopying] = useState(false);

  usePanelErrorToast(error, t('shortcuts.failedTitle'));

  const targetLangs = useMemo(
    () => project ? [...new Set(project.routes.flatMap(route => route.targetLangs))] : [],
    [project],
  );
  const masterLangs = useMemo(
    () => project ? project.routes.map(route => route.sourceLang) : [],
    [project],
  );
  const targetLangKey = targetLangs.join('\0');
  const masterLangKey = masterLangs.join('\0');

  useEffect(() => {
    const controller = new AbortController();
    setManifestLoading(true);
    setError(null);
    void loadEditorManifest(controller.signal)
      .then(manifest => {
        setWriteToken(manifest.writeToken || null);
      })
      .catch(requestError => {
        if ((requestError as Error).name !== 'AbortError') {
          setError((requestError as Error).message);
        }
      })
      .finally(() => setManifestLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setSelectedTargets(current => {
      const allowed = new Set(targetLangs);
      const kept = current.filter(lang => allowed.has(lang));
      return kept.length > 0 ? kept : targetLangs;
    });
  }, [targetLangKey]);

  useEffect(() => {
    setMasterSource(current => masterLangs.includes(current) ? current : masterLangs[0] || '');
    setMasterTarget(current => {
      if (masterLangs.includes(current) && current !== (masterSource || masterLangs[0])) return current;
      return masterLangs.find(lang => lang !== (masterSource || masterLangs[0])) || '';
    });
  }, [masterLangKey, masterLangs, masterSource]);

  const request = useMemo(
    () => buildRunRequest(mode, selectedTargets, targetLangs, masterSource, masterTarget, masterForce),
    [mode, selectedTargets, targetLangs, masterSource, masterTarget, masterForce],
  );
  const command = useMemo(() => request ? buildCommand(request) : 'i18n-ai-diff', [request]);
  const isRunning = activeJob?.status === 'queued' || activeJob?.status === 'running';
  const canRun = Boolean(project && request && writeToken && !isRunning && !manifestLoading);
  const selectedScope = mode === 'master-to-master'
    ? `${masterSource || '—'} → ${masterTarget || '—'}`
    : selectedTargets.length === targetLangs.length
      ? t('shortcuts.allTargets')
      : t('shortcuts.selectedTargets', { count: selectedTargets.length });
  const modeWarning = mode === 'force'
    ? t('shortcuts.forceWarning')
    : mode === 'master-to-master'
      ? t('shortcuts.masterWarning')
      : t('shortcuts.pendingWarning');

  const openConfirmation = useCallback(() => {
    if (!request) return;
    setConfirmation({
      request,
      command,
      title: shortcutModeTitle(mode, t),
      description: mode === 'master-to-master'
        ? t('shortcuts.masterDescription', { source: masterSource, target: masterTarget })
        : t('shortcuts.scopeDescription', { scope: selectedScope }),
      warning: modeWarning,
    });
  }, [command, masterSource, masterTarget, mode, modeWarning, request, selectedScope, t]);

  const runConfirmedShortcut = useCallback(async () => {
    if (!confirmation || !writeToken) return;
    setConfirmation(null);
    setError(null);
    try {
      const created = await createTranslationRun(confirmation.request, writeToken);
      setActiveJob(created);
      const finalJob = await pollTranslationRun(created.id);
      setActiveJob(finalJob);
      if (finalJob.status === 'completed' && finalJob.project) {
        onProjectChange(finalJob.project);
        toast.success(t('shortcuts.finished'), {
          description: summarizeStats(finalJob.stats, formatNumber, t),
        });
      } else if (finalJob.status === 'failed') {
        setError(finalJob.error || t('shortcuts.runFailed'));
      }
    } catch (requestError) {
      const message = requestError instanceof PanelApiError
        ? requestError.message
        : (requestError as Error).message;
      setError(message);
    }
  }, [confirmation, onProjectChange, writeToken]);

  const copyCommand = useCallback(async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(command);
      toast.success(t('shortcuts.commandCopied'), { description: command });
    } catch {
      setError(t('shortcuts.copyFailed'));
    } finally {
      setCopying(false);
    }
  }, [command]);

  const operationBar = (
    <>
      <div className="shortcuts-operation-left">
        <div className="shortcuts-title-cluster">
          <Lightning size={17} weight="fill" aria-hidden="true" />
          <h1>{t('shortcuts.title')}</h1>
        </div>
        <div className="shortcut-mode-tabs" role="tablist" aria-label={t('shortcuts.mode')}>
          {(['pending', 'force', 'master-to-master'] as ShortcutMode[]).map(candidate => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={mode === candidate}
              className={mode === candidate ? 'shortcut-mode-tab is-active' : 'shortcut-mode-tab'}
              onClick={() => setMode(candidate)}
            >
              {shortcutModeLabel(candidate, t)}
            </button>
          ))}
        </div>
      </div>
      <div className="shortcuts-operation-right">
        <button type="button" className="layout-control-button" onClick={() => void copyCommand()} disabled={copying || !request}>
          <ClipboardText size={16} aria-hidden="true" />
          <span>{copying ? t('shortcuts.copied') : t('shortcuts.copyCommand')}</span>
        </button>
        <button type="button" className="layout-primary-button" disabled={!canRun} onClick={openConfirmation}>
          {isRunning ? <ArrowsClockwise size={16} className="is-spinning" aria-hidden="true" /> : <Play size={16} weight="fill" aria-hidden="true" />}
          <span>{isRunning ? t('shortcuts.running') : t('shortcuts.runShortcut')}</span>
        </button>
      </div>
    </>
  );

  const bottomBar = (
    <>
      <div className="shortcuts-bottom-command" title={command}>
        <Code size={15} aria-hidden="true" />
        <code>{command}</code>
      </div>
      <div className={activeJob?.status === 'failed' ? 'shortcuts-bottom-status is-failed' : 'shortcuts-bottom-status'}>
        {activeJob?.status === 'completed'
          ? <CheckCircle size={15} weight="fill" aria-hidden="true" />
          : activeJob?.status === 'failed'
            ? <WarningCircle size={15} weight="fill" aria-hidden="true" />
            : isRunning
              ? <ArrowsClockwise size={15} className="is-spinning" aria-hidden="true" />
              : <Database size={15} aria-hidden="true" />}
        <span>{formatJobStatus(activeJob, t, formatNumber)}</span>
      </div>
    </>
  );

  return (
    <PanelLayout
      activeView="shortcuts"
      bottomBar={bottomBar}
      bottomBarClassName="shortcuts-bottom-bar"
      bottomBarLabel={t('shortcuts.statusLabel')}
      operationBar={operationBar}
      operationBarClassName="shortcuts-operation-bar"
      operationBarLabel={t('shortcuts.controlsLabel')}
      onNavigate={onNavigate}
      project={project}
      skipLabel={t('shortcuts.title')}
      shellClassName="is-shortcuts-shell"
      workspaceClassName="shortcuts-workspace"
      liveStatus={activeJob ? t('shortcuts.liveStatus', { status: shortcutJobStatusLabel(activeJob.status, t) }) : undefined}
    >
      <div className="workspace-content shortcuts-bento">
        <aside className="shortcuts-mode-alert" role="note" aria-label={t('shortcuts.directWrite')}>
          <WarningCircle size={18} weight="fill" aria-hidden="true" />
          <div>
            <strong>{t('shortcuts.directWrite')}</strong>
            <span>{modeWarning}</span>
          </div>
        </aside>

        <section className="shortcuts-setup-card bento-card" aria-labelledby="shortcut-setup-title">
          <div className="shortcuts-card-heading">
            <span className="shortcuts-card-icon is-violet" aria-hidden="true">
              <Sparkle size={23} weight="fill" />
            </span>
            <div>
          <h2 id="shortcut-setup-title">{shortcutModeTitle(mode, t)}</h2>
            </div>
          </div>

          {mode === 'master-to-master' ? (
            <MasterScope
              disabled={masterLangs.length < 2}
              force={masterForce}
              masterLangs={masterLangs}
              sourceLang={masterSource}
              targetLang={masterTarget}
              onForceChange={setMasterForce}
              onSourceChange={next => {
                setMasterSource(next);
                if (next === masterTarget) {
                  setMasterTarget(masterLangs.find(lang => lang !== next) || '');
                }
              }}
              onTargetChange={setMasterTarget}
            />
          ) : (
            <TargetScope
              routes={project?.routes || []}
              selectedTargets={selectedTargets}
              onToggleTarget={lang => setSelectedTargets(current => (
                current.includes(lang)
                  ? current.filter(candidate => candidate !== lang)
                  : [...current, lang]
              ))}
              onSelectAll={() => setSelectedTargets(targetLangs)}
              onClear={() => setSelectedTargets([])}
            />
          )}
        </section>

        <section className="shortcuts-command-card bento-card" aria-labelledby="shortcut-command-title">
          <div className="shortcuts-card-heading is-compact">
            <span className="shortcuts-card-icon is-cobalt" aria-hidden="true">
              <Code size={23} weight="bold" />
            </span>
            <div>
              <h2 id="shortcut-command-title">{t('shortcuts.commandLabel')}</h2>
            </div>
          </div>
          <pre className="shortcut-command-preview"><code>{command}</code></pre>
          <dl className="shortcut-command-meta">
            <div>
              <dt>{t('shortcuts.scope')}</dt>
              <dd>{selectedScope}</dd>
            </div>
            <div>
              <dt>{t('shortcuts.mode')}</dt>
              <dd>{shortcutModeLabel(mode, t)}</dd>
            </div>
          </dl>

          <div className={activeJob?.status === 'failed' ? 'shortcut-embedded-result is-failed' : 'shortcut-embedded-result'}>
            <div className="shortcut-result-title">
              {activeJob?.status === 'failed'
                ? <WarningCircle size={18} weight="fill" aria-hidden="true" />
                : activeJob?.status === 'completed'
                  ? <CheckCircle size={18} weight="fill" aria-hidden="true" />
                  : isRunning
                    ? <ArrowsClockwise size={18} className="is-spinning" aria-hidden="true" />
                    : <CheckCircle size={18} weight="fill" aria-hidden="true" />}
              <span>{activeJob ? shortcutJobStatusLabel(activeJob.status, t) : t('common.ready')}</span>
            </div>
            <div>
              {activeJob?.stats ? (
                <dl className="shortcuts-stats-grid" aria-label={t('shortcuts.lastStats')}>
                  <div><dt>{t('shortcuts.files')}</dt><dd>{formatNumber(activeJob.stats.totalFiles)}</dd></div>
                  <div><dt>{t('common.success')}</dt><dd>{formatNumber(activeJob.stats.successFiles)}</dd></div>
                  <div><dt>{t('common.added')}</dt><dd>{formatNumber(activeJob.stats.totalAdded)}</dd></div>
                  <div><dt>{t('common.changed')}</dt><dd>{formatNumber(activeJob.stats.totalUpdated)}</dd></div>
                </dl>
              ) : (
                <p className="shortcuts-muted-copy">{isRunning ? t('shortcuts.queueNote') : t('shortcuts.noRun')}</p>
              )}
              {activeJob?.error && <p className="shortcuts-error-copy">{normalizePanelErrorMessage(activeJob.error, t)}</p>}
            </div>
          </div>
        </section>
      </div>

      <Dialog open={Boolean(confirmation)} onOpenChange={open => { if (!open) setConfirmation(null); }}>
        {confirmation && (
          <ModalContent className="shortcut-confirm-modal" size="lg" aria-describedby="shortcut-confirm-description">
            <ModalHeader icon={<Translate size={20} weight="bold" />} closeLabel={t('common.close')}>
              <ModalTitleBlock
                title={confirmation.title}
                descriptionId="shortcut-confirm-description"
                description={confirmation.description}
              />
            </ModalHeader>
            <div className="shortcut-confirm-body">
              <pre className="shortcut-command-preview"><code>{confirmation.command}</code></pre>
              <div className="shortcut-warning-note">
                <WarningCircle size={18} weight="fill" aria-hidden="true" />
                <span>{confirmation.warning}</span>
              </div>
            </div>
            <ModalActions>
              <button type="button" className="button-tertiary" onClick={() => setConfirmation(null)}>{t('common.cancel')}</button>
              <button type="button" className="button-primary" disabled={!canRun} onClick={() => void runConfirmedShortcut()}>
                {t('shortcuts.runShortcut')}
              </button>
            </ModalActions>
          </ModalContent>
        )}
      </Dialog>
    </PanelLayout>
  );
}

export default ShortcutsPage;

function TargetScope({
  routes,
  selectedTargets,
  onToggleTarget,
  onSelectAll,
  onClear,
}: {
  routes: PanelProject['routes'];
  selectedTargets: string[];
  onToggleTarget(lang: string): void;
  onSelectAll(): void;
  onClear(): void;
}) {
  const { t } = usePanelI18n();
  return (
    <div className="shortcut-scope-panel">
      <div className="shortcut-inline-actions is-scope-actions">
        <button type="button" onClick={onSelectAll}>{t('common.all')}</button>
        <button type="button" onClick={onClear}>{t('common.none')}</button>
      </div>

      <div className="shortcut-route-scope">
        {routes.map(route => (
          <section key={route.sourceLang} className="shortcut-route-group" aria-label={t('shortcuts.routeTargets', { sourceLang: route.sourceLang })}>
            <div className="shortcut-route-source">
              <ShareNetwork size={18} aria-hidden="true" />
              <strong>{route.sourceLang}</strong>
              <span>{t('shortcuts.targetCount', { count: route.targets.length })}</span>
            </div>
            <div className="shortcut-language-list">
              {route.targets.map(target => (
                <label key={target.targetLang} className="shortcut-language-option">
                  <Checkbox
                    checked={selectedTargets.includes(target.targetLang)}
                    onCheckedChange={() => onToggleTarget(target.targetLang)}
                  />
                  <span>{target.targetLang}</span>
                  {target.pendingFiles > 0 && <em>{target.pendingFiles}</em>}
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function MasterScope({
  disabled,
  force,
  masterLangs,
  sourceLang,
  targetLang,
  onForceChange,
  onSourceChange,
  onTargetChange,
}: {
  disabled: boolean;
  force: boolean;
  masterLangs: string[];
  sourceLang: string;
  targetLang: string;
  onForceChange(value: boolean): void;
  onSourceChange(value: string): void;
  onTargetChange(value: string): void;
}) {
  const { t } = usePanelI18n();
  return (
    <div className="shortcut-scope-panel">
      <div className="shortcut-master-grid">
        <div className="shortcut-select-field">
          <span>{t('shortcuts.fromMaster')}</span>
          <Select value={sourceLang || undefined} disabled={disabled} onValueChange={onSourceChange}>
            <SelectTrigger aria-label={t('shortcuts.fromMaster')}>
              <SelectValue placeholder={t('shortcuts.chooseMaster')} />
            </SelectTrigger>
            <SelectContent>
              {masterLangs.map(lang => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="shortcut-select-field">
          <span>{t('shortcuts.toMaster')}</span>
          <Select value={targetLang || undefined} disabled={disabled} onValueChange={onTargetChange}>
            <SelectTrigger aria-label={t('shortcuts.toMaster')}>
              <SelectValue placeholder={t('shortcuts.chooseMaster')} />
            </SelectTrigger>
            <SelectContent>
              {masterLangs.filter(lang => lang !== sourceLang).map(lang => (
                <SelectItem key={lang} value={lang}>{lang}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <label className="shortcut-language-option is-wide">
        <Checkbox checked={force} disabled={disabled} onCheckedChange={checked => onForceChange(checked === true)} />
        <span>{t('shortcuts.overwriteMaster')}</span>
      </label>
    </div>
  );
}

function buildRunRequest(
  mode: ShortcutMode,
  selectedTargets: string[],
  targetLangs: string[],
  masterSource: string,
  masterTarget: string,
  masterForce: boolean,
): PanelTranslationRunRequest | null {
  if (mode === 'master-to-master') {
    if (!masterSource || !masterTarget || masterSource === masterTarget) return null;
    return {
      mode,
      masterToMaster: {
        sourceLang: masterSource,
        targetLang: masterTarget,
        ...(masterForce ? { force: true } : {}),
      },
    };
  }

  if (selectedTargets.length === 0) return null;
  const allTargetsSelected = selectedTargets.length === targetLangs.length
    && targetLangs.every(lang => selectedTargets.includes(lang));
  return {
    mode,
    ...(allTargetsSelected ? {} : { targetLangs: selectedTargets }),
  };
}

function buildCommand(request: PanelTranslationRunRequest): string {
  if (request.mode === 'master-to-master') {
    const options = request.masterToMaster!;
    return [
      'i18n-ai-diff',
      'translate-master',
      '--from',
      quoteArg(options.sourceLang),
      '--to',
      quoteArg(options.targetLang),
      ...(options.force ? ['-f'] : []),
      ...(options.files || []).flatMap(file => ['--file', quoteArg(file)]),
    ].join(' ');
  }
  return [
    'i18n-ai-diff',
    ...(request.mode === 'force' ? ['-f'] : []),
    ...(request.targetLangs?.length ? ['-l', ...request.targetLangs.map(quoteArg)] : []),
  ].join(' ');
}

async function pollTranslationRun(jobId: string): Promise<PanelTranslationRunJob> {
  let job = await loadTranslationRun(jobId);
  for (let attempt = 0; attempt < 900 && (job.status === 'queued' || job.status === 'running'); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 900));
    job = await loadTranslationRun(jobId);
  }
  return job;
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/u.test(value)) return value;
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function formatJobStatus(
  job: PanelTranslationRunJob | null,
  t: ReturnType<typeof usePanelI18n>['t'],
  formatNumber: ReturnType<typeof usePanelI18n>['formatNumber'],
): string {
  if (!job) return t('shortcuts.readyStatus');
  if (job.status === 'completed') return summarizeStats(job.stats, formatNumber, t);
  if (job.status === 'failed') return job.error || t('shortcuts.runFailed');
  return t('shortcuts.directWriteFlow', { status: shortcutJobStatusLabel(job.status, t) });
}

function summarizeStats(
  stats: PanelTranslationRunJob['stats'],
  formatNumber: ReturnType<typeof usePanelI18n>['formatNumber'],
  t: ReturnType<typeof usePanelI18n>['t'],
): string {
  if (!stats) return t('shortcuts.noStats');
  return `${formatNumber(stats.successFiles)}/${formatNumber(stats.totalFiles)} ${t('shortcuts.files')} · +${formatNumber(stats.totalAdded)} · ~${formatNumber(stats.totalUpdated)}`;
}

function shortcutJobStatusLabel(
  status: PanelTranslationRunJob['status'],
  t: ReturnType<typeof usePanelI18n>['t'],
): string {
  if (status === 'queued') return t('shortcuts.status.queued');
  if (status === 'running') return t('shortcuts.status.running');
  if (status === 'completed') return t('shortcuts.status.completed');
  return t('shortcuts.status.failed');
}

function shortcutModeTitle(mode: ShortcutMode, t: ReturnType<typeof usePanelI18n>['t']): string {
  if (mode === 'pending') return t('shortcuts.pendingTitle');
  if (mode === 'force') return t('shortcuts.forceTitle');
  return t('shortcuts.masterTitle');
}

function shortcutModeLabel(mode: ShortcutMode, t: ReturnType<typeof usePanelI18n>['t']): string {
  if (mode === 'pending') return t('shortcuts.pendingLabel');
  if (mode === 'force') return t('shortcuts.forceLabel');
  return t('shortcuts.masterLabel');
}

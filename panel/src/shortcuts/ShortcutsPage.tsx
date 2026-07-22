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

const modeCopy: Record<ShortcutMode, {
  title: string;
  label: string;
}> = {
  pending: {
    title: 'Translate pending copy',
    label: 'Incremental',
  },
  force: {
    title: 'Force refresh translations',
    label: 'Refresh',
  },
  'master-to-master': {
    title: 'Translate master to master',
    label: 'Special flow',
  },
};

function ShortcutsPage({ project, onNavigate, onProjectChange }: ShortcutsPageProps) {
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

  usePanelErrorToast(error, 'CLI shortcut failed');

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
  const editable = project?.capabilities.contentEditing === true && Boolean(writeToken);
  const canRun = Boolean(project && request && editable && !isRunning && !manifestLoading);
  const selectedScope = mode === 'master-to-master'
    ? `${masterSource || '—'} → ${masterTarget || '—'}`
    : selectedTargets.length === targetLangs.length
      ? 'All configured target languages'
      : `${selectedTargets.length} selected target language${selectedTargets.length === 1 ? '' : 's'}`;

  const openConfirmation = useCallback(() => {
    if (!request) return;
    setConfirmation({
      request,
      command,
      title: modeCopy[mode].title,
      description: mode === 'master-to-master'
        ? `${masterSource} will be translated into ${masterTarget}. This writes the target master files directly.`
        : `${selectedScope} will be processed across the project using CLI semantics.`,
      warning: mode === 'force'
        ? 'Force refresh clears the translation cache before running and may rewrite reviewed target copy.'
        : mode === 'master-to-master'
          ? 'This is a one-time helper. It does not change route ownership and writes the target master files directly.'
          : 'This writes local target files, cache, and snapshot directly. It does not create browser drafts.',
    });
  }, [command, masterSource, masterTarget, mode, request, selectedScope]);

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
        toast.success('CLI shortcut finished', {
          description: summarizeStats(finalJob.stats),
        });
      } else if (finalJob.status === 'failed') {
        setError(finalJob.error || 'Translation run failed');
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
      toast.success('Command copied', { description: command });
    } catch {
      setError('Unable to copy command to clipboard');
    } finally {
      setCopying(false);
    }
  }, [command]);

  const operationBar = (
    <>
      <div className="shortcuts-operation-left">
        <div className="shortcuts-title-cluster">
          <Lightning size={17} weight="fill" aria-hidden="true" />
          <h1>CLI shortcut</h1>
        </div>
        <div className="shortcut-mode-tabs" role="tablist" aria-label="CLI shortcut mode">
          {(['pending', 'force', 'master-to-master'] as ShortcutMode[]).map(candidate => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={mode === candidate}
              className={mode === candidate ? 'shortcut-mode-tab is-active' : 'shortcut-mode-tab'}
              onClick={() => setMode(candidate)}
            >
              {modeCopy[candidate].label}
            </button>
          ))}
        </div>
      </div>
      <div className="shortcuts-operation-right">
        <button type="button" className="layout-control-button" onClick={() => void copyCommand()} disabled={copying || !request}>
          <ClipboardText size={16} aria-hidden="true" />
          <span>{copying ? 'Copied' : 'Copy command'}</span>
        </button>
        <button type="button" className="layout-primary-button" disabled={!canRun} onClick={openConfirmation}>
          {isRunning ? <ArrowsClockwise size={16} className="is-spinning" aria-hidden="true" /> : <Play size={16} weight="fill" aria-hidden="true" />}
          <span>{isRunning ? 'Running…' : 'Run shortcut'}</span>
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
        <span>{formatJobStatus(activeJob)}</span>
      </div>
    </>
  );

  return (
    <PanelLayout
      activeView="shortcuts"
      bottomBar={bottomBar}
      bottomBarClassName="shortcuts-bottom-bar"
      bottomBarLabel="CLI shortcut status"
      operationBar={operationBar}
      operationBarClassName="shortcuts-operation-bar"
      operationBarLabel="CLI shortcut controls"
      onNavigate={onNavigate}
      project={project}
      skipLabel="CLI shortcut"
      shellClassName="is-shortcuts-shell"
      workspaceClassName="shortcuts-workspace"
      liveStatus={activeJob ? `CLI shortcut ${activeJob.status}` : undefined}
    >
      <div className="workspace-content shortcuts-bento">
        <section className="shortcuts-setup-card bento-card" aria-labelledby="shortcut-setup-title">
          <div className="shortcuts-card-heading">
            <span className="shortcuts-card-icon is-violet" aria-hidden="true">
              <Sparkle size={23} weight="fill" />
            </span>
            <div>
              <h2 id="shortcut-setup-title">{modeCopy[mode].title}</h2>
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
              <h2 id="shortcut-command-title">Copy or run</h2>
            </div>
          </div>
          <pre className="shortcut-command-preview"><code>{command}</code></pre>
          <dl className="shortcut-command-meta">
            <div>
              <dt>Scope</dt>
              <dd>{selectedScope}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{modeCopy[mode].label}</dd>
            </div>
          </dl>
        </section>

        <section className="shortcuts-run-card bento-card" aria-labelledby="shortcut-run-title">
          <div className="shortcuts-card-heading is-compact">
            <span className={activeJob?.status === 'failed' ? 'shortcuts-card-icon is-coral' : 'shortcuts-card-icon is-teal'} aria-hidden="true">
              {activeJob?.status === 'failed'
                ? <WarningCircle size={23} weight="fill" />
                : <CheckCircle size={23} weight="fill" />}
            </span>
            <div>
              <h2 id="shortcut-run-title">{activeJob ? sentenceCase(activeJob.status) : 'Ready'}</h2>
            </div>
          </div>
          {activeJob?.stats ? (
            <dl className="shortcuts-stats-grid" aria-label="Last run statistics">
              <div><dt>Files</dt><dd>{formatNumber(activeJob.stats.totalFiles)}</dd></div>
              <div><dt>Success</dt><dd>{formatNumber(activeJob.stats.successFiles)}</dd></div>
              <div><dt>Added</dt><dd>{formatNumber(activeJob.stats.totalAdded)}</dd></div>
              <div><dt>Changed</dt><dd>{formatNumber(activeJob.stats.totalUpdated)}</dd></div>
            </dl>
          ) : (
            <p className="shortcuts-muted-copy">{isRunning ? 'The run is using the same project queue as scan and save.' : 'No shortcut has run in this panel session yet.'}</p>
          )}
          {activeJob?.error && <p className="shortcuts-error-copy">{activeJob.error}</p>}
        </section>

        <section className="shortcuts-safety-card bento-card" aria-labelledby="shortcut-safety-title">
          <div className="shortcuts-card-heading is-compact">
            <span className="shortcuts-card-icon is-amber" aria-hidden="true">
              <WarningCircle size={23} weight="fill" />
            </span>
            <div>
              <h2 id="shortcut-safety-title">{editable ? 'Direct-write mode' : 'Read-only mode'}</h2>
            </div>
          </div>
          <ul className="shortcuts-safety-list">
            <li>Runs use the same core logic as the CLI.</li>
            <li>Results write local JSON files, cache, and snapshot directly.</li>
            <li>{editable ? 'This session was started with edit capability.' : 'Restart with i18n-ai-diff panel --edit to run shortcuts.'}</li>
          </ul>
        </section>
      </div>

      <Dialog open={Boolean(confirmation)} onOpenChange={open => { if (!open) setConfirmation(null); }}>
        {confirmation && (
          <ModalContent className="shortcut-confirm-modal" size="lg" aria-describedby="shortcut-confirm-description">
            <ModalHeader icon={<Translate size={20} weight="bold" />}>
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
              <button type="button" className="button-tertiary" onClick={() => setConfirmation(null)}>Cancel</button>
              <button type="button" className="button-primary" disabled={!canRun} onClick={() => void runConfirmedShortcut()}>
                Run shortcut
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
  return (
    <div className="shortcut-scope-panel">
      <div className="shortcut-inline-actions is-scope-actions">
        <button type="button" onClick={onSelectAll}>All</button>
        <button type="button" onClick={onClear}>None</button>
      </div>

      <div className="shortcut-route-scope">
        {routes.map(route => (
          <section key={route.sourceLang} className="shortcut-route-group" aria-label={`${route.sourceLang} route targets`}>
            <div className="shortcut-route-source">
              <ShareNetwork size={18} aria-hidden="true" />
              <strong>{route.sourceLang}</strong>
              <span>{route.targets.length} target{route.targets.length === 1 ? '' : 's'}</span>
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
  return (
    <div className="shortcut-scope-panel">
      <div className="shortcut-master-grid">
        <div className="shortcut-select-field">
          <span>From master</span>
          <Select value={sourceLang || undefined} disabled={disabled} onValueChange={onSourceChange}>
            <SelectTrigger aria-label="From master">
              <SelectValue placeholder="Choose master" />
            </SelectTrigger>
            <SelectContent>
              {masterLangs.map(lang => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="shortcut-select-field">
          <span>To master</span>
          <Select value={targetLang || undefined} disabled={disabled} onValueChange={onTargetChange}>
            <SelectTrigger aria-label="To master">
              <SelectValue placeholder="Choose master" />
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
        <span>Overwrite existing master copy · ignore cache</span>
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

function formatJobStatus(job: PanelTranslationRunJob | null): string {
  if (!job) return 'Ready to copy or run a CLI shortcut';
  if (job.status === 'completed') return summarizeStats(job.stats);
  if (job.status === 'failed') return job.error || 'Run failed';
  return `${sentenceCase(job.status)} · direct-write CLI flow`;
}

function summarizeStats(stats: PanelTranslationRunJob['stats']): string {
  if (!stats) return 'No stats reported';
  return `${formatNumber(stats.successFiles)}/${formatNumber(stats.totalFiles)} files · +${formatNumber(stats.totalAdded)} · ~${formatNumber(stats.totalUpdated)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function sentenceCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

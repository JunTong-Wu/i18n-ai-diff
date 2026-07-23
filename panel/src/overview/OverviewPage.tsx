import type { ReactNode } from 'react';
import {
  ArrowsClockwise,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  Cpu,
  Database,
  FileText,
  FolderOpen,
  Key,
  ShareNetwork,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import routeWaveUrl from '../assets/route-wave.svg';
import { normalizePanelErrorMessage } from '../components/feedback/panelErrorMessages';
import { usePanelErrorToast } from '../components/feedback/usePanelErrorToast';
import { usePanelI18n } from '../i18n';
import { projectRelativePath } from '../path-display';
import type {
  PanelProject,
  PanelTranslationFilePlan,
  PanelTranslationRoutePlan,
  PanelTranslationTargetPlan,
} from '../types';

const decorativeDots = ['cobalt', 'violet', 'teal', 'amber', 'coral'] as const;

interface OverviewPageProps {
  project: PanelProject;
  error: string | null;
}

export function OverviewPage({
  project,
  error,
}: OverviewPageProps) {
  const { formatNumber, t } = usePanelI18n();
  const pendingFiles = project.totals.pendingFiles;
  usePanelErrorToast(error, t('overview.scanFailed'));

  return (
    <div className="workspace-content overview-bento">
      <section className="routes-section bento-card" aria-labelledby="routes-title">
        <div className="section-heading">
          <h2 id="routes-title">{t('overview.masterRoutes')}</h2>
          <span>{t('overview.masterRouteCount', { count: formatNumber(project.routes.length) })}</span>
        </div>

        <div className="route-stack">
          {project.routes.map(route => (
            <RouteCard key={route.sourceLang} route={route} />
          ))}
        </div>
      </section>

      <Metrics project={project} />

      {project.changes.length > 0 && (
        <section className="changes-section bento-card" aria-labelledby="changes-title">
          <div className="section-heading">
            <div>
              <h2 id="changes-title">{t('overview.changePlan')}</h2>
            </div>
            <span>{t('overview.filesWaiting', { count: formatNumber(pendingFiles) })}</span>
          </div>
          <ChangePlan changes={project.changes} />
        </section>
      )}

      <ProjectDetails project={project} />
    </div>
  );
}

export function OverviewOperationBar({
  project,
  loading,
  refreshing,
  onScan,
}: {
  project: PanelProject;
  loading: boolean;
  refreshing: boolean;
  onScan(): void;
}) {
  const { formatNumber, t } = usePanelI18n();
  const isClear = project.totals.pendingFiles === 0;
  return (
    <>
      <div className="overview-operation-left">
        <div className="overview-title-cluster">
          <h1 id="overview-title">{t('overview.title')}</h1>
        </div>

        <div className={isClear ? 'overview-health-pill is-clear' : 'overview-health-pill is-pending'} role="status">
          {isClear
            ? <CheckCircle size={18} weight="fill" aria-hidden="true" />
            : <WarningCircle size={18} weight="fill" aria-hidden="true" />}
          <span>
            {isClear
              ? t('overview.healthClear')
              : t('overview.healthPending', { count: formatNumber(project.totals.pendingFiles) })}
          </span>
        </div>
      </div>

      <div className="overview-operation-right">
        <button
          className="scan-button overview-scan-button"
          type="button"
          disabled={loading || refreshing}
          onClick={onScan}
        >
          <ArrowsClockwise className={refreshing ? 'is-spinning' : undefined} size={23} weight="bold" aria-hidden="true" />
          <span>{refreshing ? t('overview.scanning') : t('overview.scan')}</span>
        </button>
      </div>
    </>
  );
}

export function OverviewBottomBar({ project }: { project: PanelProject }) {
  const { formatNumber, formatTime, t } = usePanelI18n();
  const isClear = project.totals.pendingFiles === 0;
  return (
    <>
      <div className={isClear ? 'overview-bottom-health' : 'overview-bottom-health is-pending'}>
        {isClear
          ? <CheckCircle size={16} weight="fill" aria-hidden="true" />
          : <WarningCircle size={16} weight="fill" aria-hidden="true" />}
        <span>{isClear ? t('overview.noWrite') : t('overview.keysNeedTranslation', { count: formatNumber(project.totals.pendingKeys) })}</span>
      </div>

      <dl className="overview-bottom-meta" aria-label={t('overview.scanSummary')}>
        <div>
          <dt>{t('overview.lastScan')}</dt>
          <dd><time dateTime={project.scannedAt}>{formatTime(project.scannedAt)}</time></dd>
        </div>
        <div>
          <dt>{t('common.status')}</dt>
          <dd><span className={isClear ? 'status-dot is-inline' : 'status-dot is-inline is-warning'} aria-hidden="true" />{isClear ? t('common.success') : t('common.pending')}</dd>
        </div>
        <div>
          <dt>{t('overview.filesScanned')}</dt>
          <dd>{formatNumber(project.totals.fileTasks)}</dd>
        </div>
      </dl>
    </>
  );
}

function Metrics({ project }: { project: PanelProject }) {
  const { formatNumber, t } = usePanelI18n();
  const metrics = [
    { value: project.totals.languages, label: t('overview.languages') },
    { value: project.totals.routes, label: t('overview.masterRoutes') },
    { value: project.totals.fileTasks, label: t('overview.fileTasks') },
    { value: project.totals.sourceFiles, label: t('overview.sourceFiles') },
    { value: project.totals.pendingFiles, label: t('overview.pendingFiles') },
    { value: project.totals.pendingKeys, label: t('overview.keysToTranslate') },
    { value: project.cache.entries ?? 0, label: t('overview.cacheEntries') },
  ];

  return (
    <section className="metrics-band" aria-label={t('overview.projectMetrics')}>
      <h2>{t('overview.projectMetrics')}</h2>
      <div className="metrics-grid">
        {metrics.map(metric => (
          <div className="metric" key={metric.label}>
            <strong>{formatNumber(metric.value)}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RouteCard({ route }: { route: PanelTranslationRoutePlan }) {
  const { t } = usePanelI18n();
  return (
    <article className="route-card">
      <div className="route-source">
        <span>{t('common.master')}</span>
        <h3>{route.sourceLang}</h3>
      </div>

      <div className="route-wave" aria-hidden="true">
        <img src={routeWaveUrl} alt="" />
      </div>

      <div className="route-content">
        <div>
          <span className="target-heading">{t('overview.targetLanguages')}</span>
          <ul className="target-list" aria-label={`${t('overview.targetLanguages')} ${route.sourceLang}`}>
            {route.targets.map((target, index) => (
              <TargetPill key={target.targetLang} target={target} index={index} />
            ))}
          </ul>
        </div>

        <div className="route-metrics" aria-label={t('overview.routeMetrics', { sourceLang: route.sourceLang })}>
          <RouteMetric icon={<FileText size={27} weight="regular" />} tone="cobalt" value={route.sourceFiles} label={t('overview.sourceFiles')} />
          <RouteMetric icon={<Key size={27} weight="regular" />} tone="violet" value={route.sourceKeys} label={t('overview.keys')} />
          <RouteMetric icon={<ClipboardText size={27} weight="regular" />} tone="coral" value={route.fileTasks} label={t('overview.tasks')} />
        </div>
      </div>
    </article>
  );
}

function TargetPill({ target, index }: { target: PanelTranslationTargetPlan; index: number }) {
  const { t } = usePanelI18n();
  const isPending = target.pendingFiles > 0;
  const dot = decorativeDots[index % decorativeDots.length];

  return (
    <li
      className={isPending ? 'target-pill is-pending' : 'target-pill'}
      title={isPending
        ? t('overview.filesPendingTitle', { count: target.pendingFiles })
        : t('overview.filesInSyncTitle', { existing: target.existingFiles, total: target.fileTasks })}
    >
      <span className={`target-dot is-${dot}`} aria-hidden="true" />
      <strong>{target.targetLang}</strong>
      <span className={isPending ? 'target-sync-label is-pending' : 'target-sync-label'}>
        {isPending ? t('common.pending') : t('common.inSync')}
      </span>
      {isPending && <span className="target-pending-count">{target.pendingFiles}</span>}
      <span className="sr-only">{isPending ? t('overview.pendingChanges') : t('common.inSync')}</span>
    </li>
  );
}

function RouteMetric({
  icon,
  tone,
  value,
  label,
}: {
  icon: ReactNode;
  tone: 'cobalt' | 'violet' | 'coral';
  value: number;
  label: string;
}) {
  const { formatNumber } = usePanelI18n();
  return (
    <div className="route-metric">
      <span className={`metric-icon is-${tone}`} aria-hidden="true">{icon}</span>
      <div>
        <strong>{formatNumber(value)}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function ChangePlan({ changes }: { changes: PanelTranslationFilePlan[] }) {
  const { formatNumber, t } = usePanelI18n();
  const totals = changes.reduce((sum, change) => ({
    added: sum.added + change.counts.added,
    modified: sum.modified + change.counts.modified,
    removed: sum.removed + change.counts.removed,
  }), { added: 0, modified: 0, removed: 0 });
  const routeCount = new Set(changes.map(change => `${change.sourceLang}->${change.targetLang}`)).size;
  const fileCount = new Set(changes.map(change => change.relativePath)).size;
  const visibleChanges = changes.slice(0, 6);

  return (
    <div className="change-plan">
      <div className="change-plan-summary">
        <span className="change-plan-icon" aria-hidden="true">
          <WarningCircle size={30} weight="fill" />
        </span>
        <div>
          <strong>{t('overview.pendingReviewSummary', { count: formatNumber(changes.length) })}</strong>
          <span>
            {t('overview.logicalRoutesSummary', { fileCount: formatNumber(fileCount), routeCount: formatNumber(routeCount) })}
          </span>
        </div>
      </div>

      <dl className="change-plan-totals" aria-label={t('overview.pendingKeyTotals')}>
        <div>
          <dt>{t('common.added')}</dt>
          <dd>{formatNumber(totals.added)}</dd>
        </div>
        <div>
          <dt>{t('common.changed')}</dt>
          <dd>{formatNumber(totals.modified)}</dd>
        </div>
        <div>
          <dt>{t('common.removed')}</dt>
          <dd>{formatNumber(totals.removed)}</dd>
        </div>
      </dl>

      <ul className="change-plan-list" aria-label={t('overview.pendingFilesList')}>
        {visibleChanges.map(change => (
          <li key={`${change.sourceLang}-${change.targetLang}-${change.relativePath}`}>
            <div className="change-file-copy">
              <span className="route-code">{change.sourceLang} → {change.targetLang}</span>
              <code title={change.relativePath}>{change.relativePath}</code>
            </div>
            <dl className="change-file-counts" aria-label={t('overview.pendingKeyChanges', { path: change.relativePath })}>
              <div>
                <dt>A</dt>
                <dd>{formatNumber(change.counts.added)}</dd>
              </div>
              <div>
                <dt>C</dt>
                <dd>{formatNumber(change.counts.modified)}</dd>
              </div>
              <div>
                <dt>R</dt>
                <dd>{formatNumber(change.counts.removed)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {changes.length > visibleChanges.length && (
        <p className="change-plan-note">{t('overview.showingPending', { visible: visibleChanges.length, total: formatNumber(changes.length) })}</p>
      )}
    </div>
  );
}

function ProjectDetails({ project }: { project: PanelProject }) {
  const { t } = usePanelI18n();
  const fields: Array<{
    label: string;
    value: string;
    fullValue?: string;
    icon: ReactNode;
    tone: string;
    wide?: boolean;
  }> = [
    {
      label: t('overview.projectMode'),
      value: project.mode === 'multi-master' ? t('common.multiMaster') : t('common.singleMaster'),
      icon: <ShareNetwork size={27} weight="regular" />,
      tone: 'cobalt',
    },
    { label: t('overview.model'), value: project.model, icon: <Sparkle size={27} weight="fill" />, tone: 'violet' },
    {
      label: t('common.cache'),
      value: project.cache.exists ? t('common.entriesVersion', { count: project.cache.entries ?? 0, version: project.cache.version ?? 'unknown' }) : t('common.notCreated'),
      icon: <Database size={27} weight="regular" />,
      tone: 'teal',
    },
    {
      label: t('overview.snapshot'),
      value: project.snapshot.exists ? t('common.readyVersion', { version: project.snapshot.version ?? 'unknown' }) : t('common.notCreated'),
      icon: <ClockCounterClockwise size={27} weight="regular" />,
      tone: 'coral',
    },
    {
      label: t('overview.config'),
      value: projectRelativePath(project.configPath, project.projectRoot),
      fullValue: project.configPath,
      icon: <Cpu size={27} weight="regular" />,
      tone: 'cobalt',
      wide: true,
    },
    {
      label: t('overview.locales'),
      value: projectRelativePath(project.localesDir, project.projectRoot),
      fullValue: project.localesDir,
      icon: <FolderOpen size={27} weight="regular" />,
      tone: 'amber',
      wide: true,
    },
  ];

  return (
    <section className="project-record" aria-labelledby="record-title">
      <div className="record-title">
        <h2 id="record-title">{t('overview.projectRecord')}</h2>
        <span className="record-version">v{project.version}</span>
      </div>
      <dl className="record-grid">
        {fields.map(field => (
          <div className={field.wide ? 'record-item is-wide' : 'record-item'} key={field.label}>
            <span className={`record-icon is-${field.tone}`} aria-hidden="true">{field.icon}</span>
            <div>
              <dt>{field.label}</dt>
              <dd className={field.fullValue ? 'is-path' : undefined} title={field.fullValue ?? field.value}>
                {field.value}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function LoadingState() {
  const { t } = usePanelI18n();
  return (
    <div className="loading-block" aria-label={t('overview.loadingProject')}>
      <div className="skeleton skeleton-banner" />
      <div className="skeleton skeleton-metrics" />
      <div className="skeleton skeleton-route" />
      <div className="skeleton skeleton-route" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry(): void }) {
  const { t } = usePanelI18n();
  return (
    <section className="error-state" role="status" aria-live="polite">
      <WarningCircle size={30} weight="fill" aria-hidden="true" />
      <div>
        <h2>{t('overview.openFailedTitle')}</h2>
        <p>{normalizePanelErrorMessage(message, t)}</p>
      </div>
      <button type="button" onClick={onRetry}>{t('common.tryAgain')}</button>
    </section>
  );
}

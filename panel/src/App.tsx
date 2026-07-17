import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
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
import { loadProject } from './api';
import routeWaveUrl from './assets/route-wave.svg';
import { PanelLayout } from './layout/PanelLayout';
import { projectRelativePath } from './path-display';
import type { PanelProject } from './types';
import type {
  TranslationFilePlan,
  TranslationRoutePlan,
  TranslationTargetPlan,
} from '../../src/types/index';

const decorativeDots = ['cobalt', 'violet', 'teal', 'amber', 'coral'] as const;
const EditorPage = lazy(() => import('./editor/EditorPage'));

function currentBrowserLocation() {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

export function App() {
  const [project, setProject] = useState<PanelProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState(currentBrowserLocation);

  const requestProject = useCallback(async (refresh: boolean, signal?: AbortSignal) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setProject(await loadProject(refresh, signal));
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') {
        setError((requestError as Error).message);
      }
    } finally {
      refresh ? setRefreshing(false) : setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void requestProject(false, controller.signal);
    return () => controller.abort();
  }, [requestProject]);

  useEffect(() => {
    const handlePopState = () => setLocation(currentBrowserLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((href: string) => {
    const destination = new URL(href, window.location.origin);
    const current = new URL(window.location.href);
    const nextPath = `${destination.pathname}${destination.search}`;
    const currentPath = `${current.pathname}${current.search}`;
    if (destination.origin !== current.origin || nextPath === currentPath) return;
    window.history.pushState(null, '', nextPath);
    setLocation({
      pathname: destination.pathname,
      search: destination.search,
    });
  }, []);

  const pendingFiles = project?.totals.pendingFiles ?? 0;
  const activeView = location.pathname === '/editor' ? 'editor' : 'overview';

  if (activeView === 'editor') {
    return (
      <Suspense fallback={(
        <PanelLayout
          activeView="editor"
          onNavigate={navigate}
          project={project}
          skipLabel="copy editor"
          shellClassName="is-editor-shell"
          workspaceClassName="editor-workspace"
        >
          <LoadingState />
        </PanelLayout>
      )}
      >
        <EditorPage project={project} onNavigate={navigate} onProjectChange={setProject} />
      </Suspense>
    );
  }

  return (
    <PanelLayout
      activeView="overview"
      onNavigate={navigate}
      project={project}
      skipLabel="project overview"
      liveStatus={refreshing
        ? 'Scanning translation project'
        : project
          ? `Scan complete. ${pendingFiles} pending files.`
          : ''}
    >
          {loading && !project && <LoadingState />}
          {error && !project && (
            <ErrorState message={error} onRetry={() => void requestProject(false)} />
          )}

          {project && (
            <div className="workspace-content overview-bento">
              <OverviewHero
                project={project}
                loading={loading}
                refreshing={refreshing}
                onScan={() => void requestProject(true)}
              />
              <Metrics project={project} />
              {error && <InlineError message={error} />}

              <section className="routes-section bento-card" aria-labelledby="routes-title">
                <div className="section-heading">
                  <h2 id="routes-title">Master routes</h2>
                  <span>{project.routes.length} master route{project.routes.length === 1 ? '' : 's'}</span>
                </div>

                <div className="route-stack">
                  {project.routes.map(route => (
                    <RouteCard key={route.sourceLang} route={route} />
                  ))}
                </div>
              </section>

              {project.changes.length > 0 && (
                <section className="changes-section" aria-labelledby="changes-title">
                  <div className="section-heading">
                    <div>
                      <p className="section-kicker">Pending work</p>
                      <h2 id="changes-title">Change plan</h2>
                    </div>
                    <span>{pendingFiles} file{pendingFiles === 1 ? '' : 's'} waiting</span>
                  </div>
                  <ChangePlan changes={project.changes} />
                </section>
              )}

              <ProjectDetails project={project} />
              <OperationalState project={project} />
            </div>
          )}
    </PanelLayout>
  );
}

function OverviewHero({
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
  return (
    <section className="overview-hero-card bento-card" aria-labelledby="overview-title">
      <div className="overview-hero-copy">
        <h1 id="overview-title">Translation workspace</h1>
        <p>Inspect every master, target, and pending change before translation touches a file.</p>
        <p>The overview stays read-only; file edits live in the copy editor.</p>
        <ProjectHealth project={project} />
      </div>

      <div className="overview-hero-action">
        <button
          className="scan-button"
          type="button"
          disabled={loading || refreshing}
          onClick={onScan}
        >
          <ArrowsClockwise className={refreshing ? 'is-spinning' : undefined} size={23} weight="bold" aria-hidden="true" />
          <span>{refreshing ? 'Scanning project…' : 'Scan project'}</span>
        </button>
        <div className="last-scan">
          <span>Last scanned</span>
          <time dateTime={project.scannedAt}>{formatScanClock(project.scannedAt)}</time>
        </div>
      </div>
    </section>
  );
}

function ProjectHealth({ project }: { project: PanelProject }) {
  const isClear = project.totals.pendingFiles === 0;
  return (
    <section className={isClear ? 'health-banner is-clear' : 'health-banner is-pending'} aria-label="Project health">
      {isClear
        ? <CheckCircle size={28} weight="fill" aria-hidden="true" />
        : <WarningCircle size={28} weight="fill" aria-hidden="true" />}
      <div>
        <strong>{isClear ? 'Reviewed translations are intact.' : 'Source changes need translation.'}</strong>
        <span>
          {isClear
            ? 'No source change requires a target file write.'
            : `${project.totals.pendingFiles} files contain ${formatNumber(project.totals.pendingKeys)} pending keys.`}
        </span>
      </div>
      <time dateTime={project.scannedAt}>{formatScanTime(project.scannedAt)}</time>
    </section>
  );
}

function Metrics({ project }: { project: PanelProject }) {
  const metrics = [
    { value: project.totals.languages, label: 'Languages' },
    { value: project.totals.routes, label: 'Master routes' },
    { value: project.totals.fileTasks, label: 'File tasks' },
    { value: project.totals.sourceFiles, label: 'Source files' },
    { value: project.totals.pendingFiles, label: 'Pending files' },
    { value: project.totals.pendingKeys, label: 'Keys to translate' },
    { value: project.cache.entries ?? 0, label: 'Cache entries' },
  ];

  return (
    <section className="metrics-band" aria-label="Project metrics">
      <h2>Project metrics</h2>
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

function RouteCard({ route }: { route: TranslationRoutePlan }) {
  return (
    <article className="route-card">
      <div className="route-source">
        <span>Master</span>
        <h3>{route.sourceLang}</h3>
        {route.pendingFiles > 0 && (
          <small>{route.pendingFiles} pending file{route.pendingFiles === 1 ? '' : 's'}</small>
        )}
      </div>

      <div className="route-wave" aria-hidden="true">
        <img src={routeWaveUrl} alt="" />
      </div>

      <div className="route-content">
        <div>
          <span className="target-heading">Target languages</span>
          <ul className="target-list" aria-label={`Targets translated from ${route.sourceLang}`}>
            {route.targets.map((target, index) => (
              <TargetPill key={target.targetLang} target={target} index={index} />
            ))}
          </ul>
        </div>

        <div className="route-metrics" aria-label={`${route.sourceLang} route metrics`}>
          <RouteMetric icon={<FileText size={27} weight="regular" />} tone="cobalt" value={route.sourceFiles} label="Source files" />
          <RouteMetric icon={<Key size={27} weight="regular" />} tone="violet" value={route.sourceKeys} label="Keys" />
          <RouteMetric icon={<ClipboardText size={27} weight="regular" />} tone="coral" value={route.fileTasks} label="Tasks" />
        </div>
      </div>
    </article>
  );
}

function TargetPill({ target, index }: { target: TranslationTargetPlan; index: number }) {
  const isPending = target.pendingFiles > 0;
  const dot = decorativeDots[index % decorativeDots.length];

  return (
    <li
      className={isPending ? 'target-pill is-pending' : 'target-pill'}
      title={isPending ? `${target.pendingFiles} files pending` : `${target.existingFiles}/${target.fileTasks} files in sync`}
    >
      <span className={`target-dot is-${dot}`} aria-hidden="true" />
      <strong>{target.targetLang}</strong>
      <span className={isPending ? 'target-sync-label is-pending' : 'target-sync-label'}>
        {isPending ? 'Pending' : 'In sync'}
      </span>
      {isPending && <span className="target-pending-count">{target.pendingFiles}</span>}
      <span className="sr-only">{isPending ? 'Pending changes' : 'In sync'}</span>
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

function ChangePlan({ changes }: { changes: TranslationFilePlan[] }) {
  return (
    <div className="change-table-wrap">
      <table className="change-table">
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">File</th>
            <th scope="col">Added</th>
            <th scope="col">Changed</th>
            <th scope="col">Removed</th>
          </tr>
        </thead>
        <tbody>
          {changes.slice(0, 20).map(change => (
            <tr key={`${change.sourceLang}-${change.targetLang}-${change.relativePath}`}>
              <td><span className="route-code">{change.sourceLang} → {change.targetLang}</span></td>
              <td><code title={change.relativePath}>{change.relativePath}</code></td>
              <td>{change.counts.added}</td>
              <td>{change.counts.modified}</td>
              <td>{change.counts.removed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {changes.length > 20 && <p className="table-note">Showing 20 of {changes.length} pending files.</p>}
    </div>
  );
}

function ProjectDetails({ project }: { project: PanelProject }) {
  const fields: Array<{
    label: string;
    value: string;
    fullValue?: string;
    icon: ReactNode;
    tone: string;
    wide?: boolean;
  }> = [
    {
      label: 'Project mode',
      value: project.mode === 'multi-master' ? 'Multi-master' : 'Single-master',
      icon: <ShareNetwork size={27} weight="regular" />,
      tone: 'cobalt',
    },
    { label: 'Model', value: project.model, icon: <Sparkle size={27} weight="fill" />, tone: 'violet' },
    {
      label: 'Cache',
      value: project.cache.exists ? `${project.cache.entries ?? 0} entries · v${project.cache.version}` : 'Not created',
      icon: <Database size={27} weight="regular" />,
      tone: 'teal',
    },
    {
      label: 'Snapshot',
      value: project.snapshot.exists ? `Ready · v${project.snapshot.version}` : 'Not created',
      icon: <ClockCounterClockwise size={27} weight="regular" />,
      tone: 'coral',
    },
    {
      label: 'Config',
      value: projectRelativePath(project.configPath, project.projectRoot),
      fullValue: project.configPath,
      icon: <Cpu size={27} weight="regular" />,
      tone: 'cobalt',
      wide: true,
    },
    {
      label: 'Locales',
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
        <h2 id="record-title">Project record</h2>
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

function OperationalState({ project }: { project: PanelProject }) {
  const isClear = project.totals.pendingFiles === 0;
  return (
    <section className="operational-state bento-card" aria-labelledby="operational-title">
      <div className={isClear ? 'operational-summary' : 'operational-summary is-pending'}>
        {isClear
          ? <CheckCircle size={30} weight="fill" aria-hidden="true" />
          : <WarningCircle size={30} weight="fill" aria-hidden="true" />}
        <div>
          <h2 id="operational-title">Operational state</h2>
          <strong>{isClear ? 'Reviewed translations are intact.' : 'Source changes need translation.'}</strong>
          <span>
            {isClear
              ? 'No source change requires a target file write.'
              : `${formatNumber(project.totals.pendingFiles)} pending files need review.`}
          </span>
        </div>
      </div>

      <div className="scan-history" aria-label="Scan history">
        <h3>Scan history</h3>
        <dl>
          <div>
            <dt>Last scan</dt>
            <dd>{formatScanClock(project.scannedAt)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd><span className={isClear ? 'status-dot is-inline' : 'status-dot is-inline is-warning'} aria-hidden="true" />{isClear ? 'Success' : 'Pending'}</dd>
          </div>
          <div>
            <dt>Files scanned</dt>
            <dd>{formatNumber(project.totals.fileTasks)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="loading-block" aria-label="Loading project">
      <div className="skeleton skeleton-banner" />
      <div className="skeleton skeleton-metrics" />
      <div className="skeleton skeleton-route" />
      <div className="skeleton skeleton-route" />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <section className="error-state" role="alert">
      <WarningCircle size={30} weight="fill" aria-hidden="true" />
      <div>
        <h2>The translation workspace could not be opened.</h2>
        <p>{message}</p>
      </div>
      <button type="button" onClick={onRetry}>Try again</button>
    </section>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="inline-error" role="alert">
      <WarningCircle size={21} weight="fill" aria-hidden="true" />
      <span><strong>Scan failed.</strong> {message}</span>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatScanTime(value: string): string {
  return `Scanned ${new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))}`;
}

function formatScanClock(value: string): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

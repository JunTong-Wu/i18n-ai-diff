import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { loadProject } from './api';
import { PanelLayout } from './layout/PanelLayout';
import {
  ErrorState,
  LoadingState,
  OverviewBottomBar,
  OverviewOperationBar,
  OverviewPage,
} from './overview/OverviewPage';
import type { PanelProject } from './types';

const EditorPage = lazy(() => import('./editor/EditorPage'));
const ShortcutsPage = lazy(() => import('./shortcuts/ShortcutsPage'));
const SettingsPage = lazy(() => import('./settings/SettingsPage'));

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
  const activeView = location.pathname === '/editor'
    ? 'editor'
    : location.pathname === '/shortcuts'
      ? 'shortcuts'
      : location.pathname === '/settings'
        ? 'settings'
      : 'overview';

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

  if (activeView === 'shortcuts') {
    return (
      <Suspense fallback={(
        <PanelLayout
          activeView="shortcuts"
          onNavigate={navigate}
          project={project}
          skipLabel="CLI shortcut"
          shellClassName="is-shortcuts-shell"
          workspaceClassName="shortcuts-workspace"
        >
          <LoadingState />
        </PanelLayout>
      )}
      >
        <ShortcutsPage project={project} onNavigate={navigate} onProjectChange={setProject} />
      </Suspense>
    );
  }

  if (activeView === 'settings') {
    return (
      <Suspense fallback={(
        <PanelLayout
          activeView="settings"
          onNavigate={navigate}
          project={project}
          skipLabel="settings"
          shellClassName="is-settings-shell"
          workspaceClassName="settings-workspace"
        >
          <LoadingState />
        </PanelLayout>
      )}
      >
        <SettingsPage project={project} onNavigate={navigate} />
      </Suspense>
    );
  }

  return (
    <PanelLayout
      activeView="overview"
      bottomBar={project ? <OverviewBottomBar project={project} /> : undefined}
      bottomBarClassName="overview-bottom-bar"
      bottomBarLabel="Overview status"
      onNavigate={navigate}
      operationBar={project ? (
        <OverviewOperationBar
          project={project}
          loading={loading}
          refreshing={refreshing}
          onScan={() => void requestProject(true)}
        />
      ) : undefined}
      operationBarClassName="overview-operation-bar"
      operationBarLabel="Project overview controls"
      project={project}
      skipLabel="project overview"
      shellClassName="is-overview-shell"
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
        <OverviewPage
          project={project}
          error={error}
        />
      )}
    </PanelLayout>
  );
}

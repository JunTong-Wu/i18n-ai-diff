import { SquaresFour, Table } from '@phosphor-icons/react';
import type { MouseEvent, ReactNode } from 'react';
import logoMarkUrl from '../assets/logo-mark.png';
import { projectDirectoryName } from '../path-display';
import type { PanelProject } from '../types';

export type PanelView = 'overview' | 'editor';

interface PanelLayoutProps {
  activeView: PanelView;
  children: ReactNode;
  onNavigate?(href: string): void;
  project: PanelProject | null;
  skipLabel: string;
  shellClassName?: string;
  topbarActions?: ReactNode;
  topbarContext?: ReactNode;
  workspaceClassName?: string;
  liveStatus?: ReactNode;
}

export function PanelLayout({
  activeView,
  children,
  onNavigate,
  project,
  skipLabel,
  shellClassName,
  topbarActions,
  topbarContext,
  workspaceClassName,
  liveStatus,
}: PanelLayoutProps) {
  const projectName = project ? projectDirectoryName(project.projectRoot) : 'Reading local project…';
  const sessionMode = project?.capabilities.contentEditing ? 'Local editing' : 'Local session';
  const sessionTooltip = project
    ? `${sessionMode}\nProject: ${projectName}\nRoot: ${project.projectRoot}`
    : sessionMode;
  const shellClasses = ['app-shell', shellClassName].filter(Boolean).join(' ');
  const workspaceClasses = ['workspace', workspaceClassName].filter(Boolean).join(' ');
  const createNavigationHandler = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onNavigate(href);
  };

  return (
    <>
      <a className="skip-link" href="#main">Skip to {skipLabel}</a>
      <div className={shellClasses}>
        <header className="topbar">
          <a className="topbar-brand" href="/" aria-label="i18n-ai-diff project overview" onClick={createNavigationHandler('/')}>
            <span className="brand-mark" aria-hidden="true">
              <img src={logoMarkUrl} alt="" />
            </span>
            <div>
              <strong>i18n AI Diff</strong>
            </div>
          </a>

          <nav className="topbar-nav" aria-label="Panel sections">
            <a
              className={activeView === 'overview' ? 'nav-item is-active' : 'nav-item'}
              href="/"
              aria-current={activeView === 'overview' ? 'page' : undefined}
              aria-label="Project overview"
              onClick={createNavigationHandler('/')}
            >
              <SquaresFour size={24} weight="fill" aria-hidden="true" />
              <span>Project overview</span>
            </a>
            <a
              className={activeView === 'editor' ? 'nav-item is-active' : 'nav-item'}
              href="/editor"
              aria-current={activeView === 'editor' ? 'page' : undefined}
              aria-label="Copy editor"
              onClick={createNavigationHandler('/editor')}
            >
              <Table size={24} weight="fill" aria-hidden="true" />
              <span>Copy editor</span>
            </a>
          </nav>

          {topbarContext && <div className="topbar-context">{topbarContext}</div>}

          <div className="topbar-right">
            {topbarActions && <div className="topbar-actions">{topbarActions}</div>}
            <div className="topbar-session" title={sessionTooltip} aria-label={`${sessionMode}: ${projectName}`}>
              <span className="status-dot" aria-hidden="true" />
              <span className="topbar-session-label">
                <small>{sessionMode}</small>
                <span aria-hidden="true">·</span>
                <strong>{projectName}</strong>
              </span>
            </div>
          </div>
        </header>

        <main className={workspaceClasses} id="main">
          {children}
        </main>
      </div>

      {liveStatus !== undefined && (
        <div className="sr-status" role="status" aria-live="polite">
          {liveStatus}
        </div>
      )}
    </>
  );
}

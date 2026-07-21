import { X } from '@phosphor-icons/react';
import type { PanelEditorManifest, PanelEditorTranslateJob } from '../types';
import { Sheet, SheetContent, SheetTitle } from '../components/ui/sheet';

interface ToolsDrawerProps {
  aiDraftCount: number;
  draftCount: number;
  editable: boolean;
  failedCount: number;
  isOpen: boolean;
  job: PanelEditorTranslateJob | null;
  languageCount: number;
  selectedMeta: PanelEditorManifest['files'][number] | undefined;
  status: string;
  totalRowCount: number;
  visibleRowCount: number;
  onClose(): void;
}

export function ToolsDrawer({
  aiDraftCount,
  draftCount,
  editable,
  failedCount,
  isOpen,
  job,
  languageCount,
  selectedMeta,
  status,
  totalRowCount,
  visibleRowCount,
  onClose,
}: ToolsDrawerProps) {
  return (
    <Sheet open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent className="editor-controls-drawer" side="right">
      <div className="file-panel-header">
        <div>
          <p className="section-kicker">Local editor</p>
          <SheetTitle asChild>
            <strong>Details and safety</strong>
          </SheetTitle>
        </div>
        <button className="file-panel-close" type="button" onClick={onClose} aria-label="Close editor details">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <section className="editor-state-card">
        <strong>Current file</strong>
        <dl className="editor-file-stats">
          <div>
            <dt>Visible keys</dt>
            <dd>{visibleRowCount}/{totalRowCount}</dd>
          </div>
          <div>
            <dt>Language files</dt>
            <dd>{selectedMeta ? `${selectedMeta.presentLanguages.length}/${languageCount}` : '0/0'}</dd>
          </div>
          <div>
            <dt>Missing files</dt>
            <dd>{selectedMeta?.missingLanguages.length ?? 0}</dd>
          </div>
        </dl>
      </section>

      <section className="editor-state-card">
        <strong>Draft status</strong>
        <p>{status || (draftCount > 0 ? `${draftCount} changes remain in this browser.` : 'Local files match the current editor draft.')}</p>
        <small>{aiDraftCount} AI draft{aiDraftCount === 1 ? '' : 's'} · {failedCount} failed translation{failedCount === 1 ? '' : 's'}</small>
      </section>

      <section className="editor-state-card">
        <strong>Translation job</strong>
        {job ? (
          <dl className="editor-file-stats">
            <div>
              <dt>Status</dt>
              <dd>{job.status}</dd>
            </div>
            <div>
              <dt>Progress</dt>
              <dd>{job.completed}/{job.total}</dd>
            </div>
            <div>
              <dt>Cache hits</dt>
              <dd>{job.results.filter(result => result.fromCache).length}</dd>
            </div>
          </dl>
        ) : (
          <p>No AI translation job has run in this file session.</p>
        )}
      </section>

      <section className="editor-state-card">
        <strong>Editing boundary</strong>
        <p>{editable ? 'Local editing is enabled. AI translations become drafts first; only Save writes files, snapshots, and accepted cache entries.' : 'Viewing in read-only mode. Restart with i18n-ai-diff panel --edit to save file changes or run AI translation drafts.'}</p>
        <small>Double-click or press Enter to edit. Shift+Enter adds a line.</small>
      </section>
      </SheetContent>
    </Sheet>
  );
}

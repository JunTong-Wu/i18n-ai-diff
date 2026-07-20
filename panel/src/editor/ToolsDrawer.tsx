import { Funnel, MagnifyingGlass, X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { PanelEditorManifest } from '../types';

interface ToolsDrawerProps {
  draftCount: number;
  editable: boolean;
  isOpen: boolean;
  languageCount: number;
  rowSearch: string;
  selectedMeta: PanelEditorManifest['files'][number] | undefined;
  showChanged: boolean;
  showMissing: boolean;
  showPending: boolean;
  status: string;
  totalRowCount: number;
  visibleRowCount: number;
  onClose(): void;
  onRowSearchChange(value: string): void;
  onToggleChanged(): void;
  onToggleMissing(): void;
  onTogglePending(): void;
}

export function ToolsDrawer({
  draftCount,
  editable,
  isOpen,
  languageCount,
  rowSearch,
  selectedMeta,
  showChanged,
  showMissing,
  showPending,
  status,
  totalRowCount,
  visibleRowCount,
  onClose,
  onRowSearchChange,
  onToggleChanged,
  onToggleMissing,
  onTogglePending,
}: ToolsDrawerProps) {
  return (
    <aside className={isOpen ? 'editor-drawer editor-controls-drawer is-open' : 'editor-drawer editor-controls-drawer'} aria-label="Editor tools">
      <div className="file-panel-header">
        <div>
          <p className="section-kicker">View controls</p>
          <strong>Search and filters</strong>
        </div>
        <button className="file-panel-close" type="button" onClick={onClose} aria-label="Close editor tools">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <label className="editor-search">
        <MagnifyingGlass size={18} aria-hidden="true" />
        <span className="sr-only">Search keys and copy</span>
        <input value={rowSearch} onChange={event => onRowSearchChange(event.target.value)} placeholder="Search keys or copy…" />
      </label>

      <div className="editor-filter-bar">
        <span><Funnel size={17} aria-hidden="true" /> Show rows</span>
        <FilterButton active={showMissing} onClick={onToggleMissing}>Missing</FilterButton>
        <FilterButton active={showPending} onClick={onTogglePending}>Pending</FilterButton>
        <FilterButton active={showChanged} onClick={onToggleChanged}>Changed</FilterButton>
        <span className="editor-row-count">{visibleRowCount} of {totalRowCount} keys</span>
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
            <dt>Draft changes</dt>
            <dd>{draftCount}</dd>
          </div>
        </dl>
      </section>

      <section className="editor-state-card">
        <strong>Draft status</strong>
        <p>{status || (draftCount > 0 ? `${draftCount} changes remain in this browser.` : 'Local files match the current editor draft.')}</p>
      </section>

      <section className="editor-state-card">
        <strong>Editing</strong>
        <p>{editable ? 'Local editing is enabled. Saves are explicit and revision-checked.' : 'Viewing in read-only mode. Restart with i18n-ai-diff panel --edit to save file changes.'}</p>
        <small>Double-click or press Enter to edit. Shift+Enter adds a line.</small>
      </section>
    </aside>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }) {
  return <button type="button" className={active ? 'filter-chip is-active' : 'filter-chip'} aria-pressed={active} onClick={onClick}>{children}</button>;
}

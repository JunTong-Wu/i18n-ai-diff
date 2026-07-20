import {
  CaretDown,
  CheckCircle,
  FileText,
  Folder,
  List,
  MagnifyingGlass,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import type { PanelEditorManifest } from '../types';

type FileGroup = Array<{
  directory: string;
  files: PanelEditorManifest['files'];
}>[number];

interface FileDrawerProps {
  fileGroups: FileGroup[];
  fileSearch: string;
  isOpen: boolean;
  manifest: PanelEditorManifest | null;
  manifestLoading: boolean;
  selectedPath: string;
  onClose(): void;
  onFileSearchChange(value: string): void;
  onRequestFile(relativePath: string): void;
}

export function FileDrawer({
  fileGroups,
  fileSearch,
  isOpen,
  manifest,
  manifestLoading,
  selectedPath,
  onClose,
  onFileSearchChange,
  onRequestFile,
}: FileDrawerProps) {
  return (
    <aside className={isOpen ? 'editor-drawer editor-file-panel is-open' : 'editor-drawer editor-file-panel'} aria-label="Locale files">
      <div className="file-panel-header">
        <div>
          <p className="section-kicker">Project files</p>
          <strong>{manifest?.files.length || 0} JSON files</strong>
        </div>
        <button className="file-panel-close" type="button" onClick={onClose} aria-label="Close file browser">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <label className="file-search">
        <MagnifyingGlass size={17} aria-hidden="true" />
        <span className="sr-only">Search locale files</span>
        <input value={fileSearch} onChange={event => onFileSearchChange(event.target.value)} placeholder="Find a JSON file…" />
      </label>
      <div className="file-tree">
        {fileGroups.map(group => (
          <details key={group.directory} open>
            <summary>
              <Folder size={17} weight="fill" aria-hidden="true" />
              <span title={group.directory}>{group.directory}</span>
              <small>{group.files.length}</small>
              <CaretDown className="folder-caret" size={14} aria-hidden="true" />
            </summary>
            <div className="file-group-list">
              {group.files.map(candidate => (
                <button
                  className={candidate.relativePath === selectedPath ? 'file-row is-active' : 'file-row'}
                  type="button"
                  key={candidate.relativePath}
                  onClick={() => onRequestFile(candidate.relativePath)}
                  title={candidate.relativePath}
                >
                  <FileText size={17} aria-hidden="true" />
                  <span>{fileName(candidate.relativePath)}</span>
                  {candidate.invalidLanguages.length > 0
                    ? <WarningCircle className="file-state is-error" size={16} weight="fill" aria-label="Invalid JSON" />
                    : candidate.pendingKeys > 0
                      ? <span className="file-count is-pending" title={`${candidate.pendingKeys} pending cells`}>{candidate.pendingKeys}</span>
                      : candidate.missingLanguages.length > 0
                        ? <span className="file-count" title={`${candidate.missingLanguages.length} missing language files`}>{candidate.missingLanguages.length}</span>
                        : <CheckCircle className="file-state is-clear" size={16} weight="fill" aria-label="Complete" />}
                </button>
              ))}
            </div>
          </details>
        ))}
        {!manifestLoading && fileGroups.length === 0 && (
          <div className="file-tree-empty"><List size={22} aria-hidden="true" />No matching JSON files</div>
        )}
      </div>
    </aside>
  );
}

function fileName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1);
}

import { WarningCircle } from '@phosphor-icons/react';
import type { DraftConflict } from './model';

interface ConflictModalProps {
  conflicts: DraftConflict[];
  onApply(): void;
  onResolve(identity: string, resolution: 'disk' | 'draft'): void;
}

export function ConflictModal({
  conflicts,
  onApply,
  onResolve,
}: ConflictModalProps) {
  return (
    <div className="editor-modal-layer" role="presentation">
      <section className="editor-modal conflict-modal" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <WarningCircle size={28} weight="fill" aria-hidden="true" />
        <div>
          <p className="section-kicker">External file change</p>
          <h2 id="conflict-title">Resolve overlapping cells</h2>
          <p>Unrelated disk changes are already preserved. Choose a value for each cell changed in both places.</p>
        </div>
        <div className="conflict-list">
          {conflicts.map(conflict => (
            <article className="conflict-item" key={conflict.identity}>
              <header><strong>{conflict.lang}</strong><code>{conflict.displayPath}</code></header>
              <div className="conflict-original">
                <span>Originally loaded</span>
                <small>{displayConflictValue(conflict.originalValue)}</small>
              </div>
              <div className="conflict-values">
                <button
                  type="button"
                  className={conflict.resolution === 'disk' ? 'conflict-choice is-selected' : 'conflict-choice'}
                  onClick={() => onResolve(conflict.identity, 'disk')}
                >
                  <span>Use disk</span>
                  <small>{displayConflictValue(conflict.diskValue)}</small>
                </button>
                <button
                  type="button"
                  className={conflict.resolution === 'draft' ? 'conflict-choice is-selected' : 'conflict-choice'}
                  disabled={!conflict.canKeepDraft}
                  onClick={() => onResolve(conflict.identity, 'draft')}
                >
                  <span>Keep my draft</span>
                  <small>{conflict.canKeepDraft ? displayConflictValue(conflict.draftValue) : 'The key no longer exists in any language.'}</small>
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="button-primary" disabled={conflicts.some(conflict => !conflict.resolution)} onClick={onApply}>
            Apply resolutions
          </button>
        </div>
      </section>
    </div>
  );
}

function displayConflictValue(value: string | undefined): string {
  if (value === undefined) return 'Missing';
  if (value === '') return 'Empty string';
  return value.length > 160 ? `${value.slice(0, 157)}…` : value;
}

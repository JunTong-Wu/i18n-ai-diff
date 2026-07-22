import { WarningCircle } from '@phosphor-icons/react';
import { Dialog } from '../components/ui/dialog';
import { ModalActions, ModalContent, ModalHeader, ModalTitleBlock } from '../components/ui/modal';
import { usePanelI18n } from '../i18n';
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
  const { t } = usePanelI18n();
  return (
    <Dialog open={conflicts.length > 0}>
      <ModalContent
        className="conflict-modal"
        size="xl"
        aria-describedby="conflict-description"
        onEscapeKeyDown={event => event.preventDefault()}
        onPointerDownOutside={event => event.preventDefault()}
      >
        <ModalHeader icon={<WarningCircle size={20} weight="fill" />} showClose={false}>
          <ModalTitleBlock
            title={t('conflict.title')}
            descriptionId="conflict-description"
            description={t('conflict.description')}
          />
        </ModalHeader>
        <div className="conflict-list">
          {conflicts.map(conflict => (
            <article className="conflict-item" key={conflict.identity}>
              <header><strong>{conflict.lang}</strong><code>{conflict.displayPath}</code></header>
              <div className="conflict-original">
                <span>{t('conflict.originallyLoaded')}</span>
                <small>{displayConflictValue(conflict.originalValue, t)}</small>
              </div>
              <div className="conflict-values">
                <button
                  type="button"
                  className={conflict.resolution === 'disk' ? 'conflict-choice is-selected' : 'conflict-choice'}
                  onClick={() => onResolve(conflict.identity, 'disk')}
                >
                  <span>{t('conflict.useDisk')}</span>
                  <small>{displayConflictValue(conflict.diskValue, t)}</small>
                </button>
                <button
                  type="button"
                  className={conflict.resolution === 'draft' ? 'conflict-choice is-selected' : 'conflict-choice'}
                  disabled={!conflict.canKeepDraft}
                  onClick={() => onResolve(conflict.identity, 'draft')}
                >
                  <span>{t('conflict.keepDraft')}</span>
                  <small>{conflict.canKeepDraft ? displayConflictValue(conflict.draftValue, t) : t('conflict.keyGone')}</small>
                </button>
              </div>
            </article>
          ))}
        </div>
        <ModalActions>
          <button type="button" className="button-primary" disabled={conflicts.some(conflict => !conflict.resolution)} onClick={onApply}>
            {t('conflict.apply')}
          </button>
        </ModalActions>
      </ModalContent>
    </Dialog>
  );
}

function displayConflictValue(value: string | undefined, t: ReturnType<typeof usePanelI18n>['t']): string {
  if (value === undefined) return t('common.missing');
  if (value === '') return t('common.emptyString');
  return value.length > 160 ? `${value.slice(0, 157)}…` : value;
}

import { X } from '@phosphor-icons/react';
import type { PanelEditorManifest, PanelEditorTranslateJob } from '../types';
import { normalizePanelErrorMessage } from '../components/feedback/panelErrorMessages';
import { Sheet, SheetContent, SheetTitle } from '../components/ui/sheet';
import { usePanelI18n } from '../i18n';

interface FailedTranslationItem {
  lang: string;
  pointer: string;
  error: string;
}

interface ToolsDrawerProps {
  draftCount: number;
  failedTranslations: FailedTranslationItem[];
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
  draftCount,
  failedTranslations,
  isOpen,
  job,
  languageCount,
  selectedMeta,
  status,
  totalRowCount,
  visibleRowCount,
  onClose,
}: ToolsDrawerProps) {
  const { t } = usePanelI18n();
  const visibleFailures = failedTranslations.slice(0, 5);
  const hiddenFailureCount = Math.max(0, failedTranslations.length - visibleFailures.length);

  return (
    <Sheet open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent className="editor-controls-drawer" side="right">
      <div className="file-panel-header">
        <div>
          <SheetTitle asChild>
            <strong>{t('details.title')}</strong>
          </SheetTitle>
        </div>
        <button className="file-panel-close" type="button" onClick={onClose} aria-label={t('details.close')}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <section className="editor-state-card">
        <strong>{t('details.currentFile')}</strong>
        <dl className="editor-file-stats">
          <div>
            <dt>{t('details.visibleKeys')}</dt>
            <dd>{visibleRowCount}/{totalRowCount}</dd>
          </div>
          <div>
            <dt>{t('details.languageFiles')}</dt>
            <dd>{selectedMeta ? `${selectedMeta.presentLanguages.length}/${languageCount}` : '0/0'}</dd>
          </div>
          <div>
            <dt>{t('details.missingFiles')}</dt>
            <dd>{selectedMeta?.missingLanguages.length ?? 0}</dd>
          </div>
        </dl>
      </section>

      <section className="editor-state-card">
        <strong>{t('details.draftStatus')}</strong>
        <p>{status || (draftCount > 0 ? t('details.changesRemain', { count: draftCount }) : t('details.filesMatchDraft'))}</p>
      </section>

      <section className="editor-state-card">
        <strong>{t('details.translationJob')}</strong>
        {job ? (
          <dl className="editor-file-stats">
            <div>
              <dt>{t('common.status')}</dt>
              <dd>{job.status}</dd>
            </div>
            <div>
              <dt>{t('details.progress')}</dt>
              <dd>{job.completed}/{job.total}</dd>
            </div>
            <div>
              <dt>{t('details.cacheHits')}</dt>
              <dd>{job.results.filter(result => result.fromCache).length}</dd>
            </div>
            {job.error && (
              <div className="editor-file-stats-full">
                <dt>{t('details.lastError')}</dt>
                <dd>{normalizePanelErrorMessage(job.error, t)}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p>{t('details.noJob')}</p>
        )}
        {failedTranslations.length > 0 && (
          <div className="editor-failed-cells" role="list" aria-label={t('details.failedCells')}>
            <strong>{t('details.failedCells')}</strong>
            {visibleFailures.map(item => (
              <div key={`${item.lang}\0${item.pointer}`} className="editor-failed-cell" role="listitem">
                <span>{item.lang} {item.pointer}</span>
                <p>{normalizePanelErrorMessage(item.error, t)}</p>
              </div>
            ))}
            {hiddenFailureCount > 0 && (
              <span className="editor-failed-more">{t('details.failedCellsMore', { count: hiddenFailureCount })}</span>
            )}
          </div>
        )}
      </section>

      <section className="editor-state-card">
        <strong>{t('details.editingBoundary')}</strong>
        <p>{t('details.writeBoundary')}</p>
      </section>
      </SheetContent>
    </Sheet>
  );
}

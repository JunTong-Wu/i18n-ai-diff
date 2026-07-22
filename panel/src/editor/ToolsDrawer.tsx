import { X } from '@phosphor-icons/react';
import type { PanelEditorManifest, PanelEditorTranslateJob } from '../types';
import { Sheet, SheetContent, SheetTitle } from '../components/ui/sheet';
import { usePanelI18n } from '../i18n';

interface ToolsDrawerProps {
  draftCount: number;
  editable: boolean;
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
  editable,
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
          </dl>
        ) : (
          <p>{t('details.noJob')}</p>
        )}
      </section>

      <section className="editor-state-card">
        <strong>{t('details.editingBoundary')}</strong>
        <p>{editable ? t('details.editableBoundary') : t('details.readonlyBoundary')}</p>
      </section>
      </SheetContent>
    </Sheet>
  );
}

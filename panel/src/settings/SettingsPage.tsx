import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowsClockwise,
  Code,
  FloppyDisk,
  GearSix,
  Key,
  ListPlus,
  Palette,
  Path,
  SlidersHorizontal,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  loadSettingsConfig,
  PanelApiError,
  saveSettingsConfig,
} from '../api';
import { usePanelErrorToast } from '../components/feedback/usePanelErrorToast';
import { Dialog } from '../components/ui/dialog';
import {
  ModalActions,
  ModalContent,
  ModalHeader,
  ModalTitleBlock,
} from '../components/ui/modal';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { toast } from '../components/ui/sonner';
import { Textarea } from '../components/ui/textarea';
import { usePanelI18n, type PanelLocale } from '../i18n';
import { PanelLayout } from '../layout/PanelLayout';
import { projectRelativePath } from '../path-display';
import type {
  PanelProject,
  PanelSettingsConfigFile,
} from '../types';

type SettingsDraft = PanelSettingsConfigFile['config'];

interface SettingsPageProps {
  project: PanelProject | null;
  onNavigate(href: string): void;
}

function SettingsPage({ project, onNavigate }: SettingsPageProps) {
  const { locale, setLocale, t } = usePanelI18n();
  const [settings, setSettings] = useState<PanelSettingsConfigFile | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [initialDraftKey, setInitialDraftKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingSave, setConfirmingSave] = useState(false);

  usePanelErrorToast(error, t('settings.failedTitle'));

  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadSettingsConfig(signal);
      setSettings(loaded);
      setDraft(cloneDraft(loaded.config));
      setInitialDraftKey(serializeDraft(loaded.config));
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') {
        setError((requestError as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings]);

  const dirty = useMemo(() => (
    draft ? serializeDraft(draft) !== initialDraftKey : false
  ), [draft, initialDraftKey]);
  const canSave = Boolean(settings?.writeToken && draft && settings.canWrite && dirty && !saving);
  const configPath = settings?.configPath || project?.configPath || '';
  const displayConfigPath = settings && configPath
    ? projectRelativePath(configPath, settings.projectRoot)
    : configPath || t('settings.readingConfig');
  const restartRequired = settings?.restartRequired === true;
  const bottomStatusLabel = settings?.saveUnsupportedReason
    ? t('settings.saveUnsupported')
    : restartRequired
      ? t('settings.restartWaiting')
      : t('settings.loadedSession');
  const bottomStatusWarning = restartRequired || Boolean(settings?.saveUnsupportedReason);

  const updateDraft = useCallback((recipe: (current: SettingsDraft) => SettingsDraft) => {
    setDraft(current => current ? recipe(cloneDraft(current)) : current);
  }, []);

  const saveConfirmed = useCallback(async () => {
    if (!settings?.writeToken || !draft) return;
    setSaving(true);
    setError(null);
    setConfirmingSave(false);
    try {
      const result = await saveSettingsConfig({
        revision: settings.revision,
        config: draft,
      }, settings.writeToken);
      const nextConfig = cloneDraft(result.config);
      setDraft(nextConfig);
      setInitialDraftKey(serializeDraft(nextConfig));
      setSettings(current => current ? {
        ...current,
        revision: result.revision,
        config: nextConfig,
        raw: result.raw,
        standardConfigPreview: result.standardConfigPreview,
        restartRequired: true,
        mode: nextConfig.routes.length > 1 ? 'multi-master' : 'single-master',
        warnings: result.warnings,
      } : current);
      toast.success(t('settings.saved'), {
        description: t('settings.restartToast'),
      });
    } catch (requestError) {
      const message = requestError instanceof PanelApiError
        ? requestError.message
        : (requestError as Error).message;
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [draft, settings]);

  const operationBar = (
    <>
      <div className="settings-operation-left">
        <div className="settings-title-cluster">
          <GearSix size={17} weight="fill" aria-hidden="true" />
          <h1>{t('settings.title')}</h1>
        </div>
        {restartRequired && (
          <span className="settings-operation-pill is-warning">{t('settings.restartRequired')}</span>
        )}
        {settings?.saveUnsupportedReason && (
          <span className="settings-operation-pill is-warning" title={settings.saveUnsupportedReason}>
            {t('settings.saveUnsupportedPill')}
          </span>
        )}
      </div>
      <div className="settings-operation-right">
        <button
          type="button"
          className="layout-control-button"
          disabled={!dirty || saving || !settings}
          onClick={() => {
            if (!settings) return;
            const nextConfig = cloneDraft(settings.config);
            setDraft(nextConfig);
            setInitialDraftKey(serializeDraft(nextConfig));
          }}
        >
          <ArrowsClockwise size={16} aria-hidden="true" />
          <span>{t('common.reset')}</span>
        </button>
        <button
          type="button"
          className="layout-primary-button"
          disabled={!canSave}
          onClick={() => setConfirmingSave(true)}
        >
          {saving ? <ArrowsClockwise size={16} className="is-spinning" aria-hidden="true" /> : <FloppyDisk size={16} aria-hidden="true" />}
          <span>{saving ? t('settings.saving') : t('settings.save')}</span>
        </button>
      </div>
    </>
  );

  const bottomBar = (
    <>
      <div className="settings-bottom-path" title={configPath}>
        <Path size={15} aria-hidden="true" />
        <span>{displayConfigPath}</span>
      </div>
      <div className={bottomStatusWarning ? 'settings-bottom-status is-warning' : 'settings-bottom-status'} title={settings?.saveUnsupportedReason}>
        <GearSix size={15} aria-hidden="true" />
        <span>{bottomStatusLabel}</span>
      </div>
    </>
  );

  return (
    <PanelLayout
      activeView="settings"
      bottomBar={bottomBar}
      bottomBarClassName="settings-bottom-bar"
      bottomBarLabel={t('settings.statusLabel')}
      operationBar={operationBar}
      operationBarClassName="settings-operation-bar"
      operationBarLabel={t('settings.controlsLabel')}
      onNavigate={onNavigate}
      project={project}
      skipLabel={t('nav.settings')}
      shellClassName="is-settings-shell"
      workspaceClassName="settings-workspace"
      liveStatus={saving ? t('settings.savingLive') : undefined}
    >
      <div className="workspace-content settings-bento">
        {loading && (
          <section className="settings-placeholder-card bento-card">
            <ArrowsClockwise className="is-spinning" size={22} aria-hidden="true" />
            <span>{t('settings.loading')}</span>
          </section>
        )}

        {!loading && !draft && (
          <section className="settings-placeholder-card bento-card is-error">
            <WarningCircle size={22} weight="fill" aria-hidden="true" />
            <span>{error || t('settings.loadFailed')}</span>
            <button type="button" className="layout-control-button" onClick={() => void loadSettings()}>
              {t('common.retry')}
            </button>
          </section>
        )}

        {settings && draft && (
          <>
            <section className="settings-routes-card bento-card" aria-labelledby="settings-routes-title">
              <SettingsCardHeading
                icon={<SlidersHorizontal size={23} weight="bold" />}
                tone="cobalt"
                title={t('settings.languageRoutes')}
                titleId="settings-routes-title"
                trailing={(
                  <span className="settings-mode-badge">
                    {settings.mode === 'multi-master' ? t('common.multiMaster') : t('common.singleMaster')}
                  </span>
                )}
              />

              <div className="settings-field-grid">
                <TextField
                  label={t('settings.localesDir')}
                  value={draft.localesDir}
                  onChange={value => updateDraft(current => ({ ...current, localesDir: value }))}
                />
                <TextField
                  label={t('settings.cacheFile')}
                  value={draft.cachePath}
                  onChange={value => updateDraft(current => ({ ...current, cachePath: value }))}
                />
              </div>

              <div className="settings-route-editor-list">
                {draft.routes.map((route, index) => (
                  <div key={`${index}-${route.sourceLang}`} className="settings-route-editor">
                    <TextField
                      label={t('settings.routeMaster', { index: index + 1 })}
                      value={route.sourceLang}
                      onChange={value => updateDraft(current => replaceRoute(current, index, {
                        ...route,
                        sourceLang: value,
                      }))}
                    />
                    <TextField
                      label={t('settings.targetLanguages')}
                      value={route.targetLangs.join(', ')}
                      placeholder="ja, ko"
                      onChange={value => updateDraft(current => replaceRoute(current, index, {
                        ...route,
                        targetLangs: splitCommaList(value),
                      }))}
                    />
                    <button
                      type="button"
                      className="settings-icon-button"
                      aria-label={t('settings.removeRoute', { index: index + 1 })}
                      disabled={draft.routes.length <= 1}
                      onClick={() => updateDraft(current => ({
                        ...current,
                        routes: current.routes.filter((_, routeIndex) => routeIndex !== index),
                      }))}
                    >
                      <Trash size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="settings-inline-add"
                onClick={() => updateDraft(current => ({
                  ...current,
                  routes: [...current.routes, { sourceLang: '', targetLangs: [] }],
                }))}
              >
                <ListPlus size={16} aria-hidden="true" />
                <span>{t('settings.addRoute')}</span>
              </button>
            </section>

            <section className="settings-panel-card bento-card" aria-labelledby="settings-panel-title">
              <SettingsCardHeading
                icon={<Palette size={23} weight="bold" />}
                tone="amber"
                title={t('settings.panelStyle')}
                titleId="settings-panel-title"
                compact
              />

              <div className="settings-panel-options">
                <div className="settings-select-field">
                  <span>{t('settings.panelLanguage')}</span>
                  <Select value={locale} onValueChange={value => setLocale(value as PanelLocale)}>
                    <SelectTrigger aria-label={t('settings.panelLanguage')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{t('settings.languageEnglish')}</SelectItem>
                      <SelectItem value="zh-CN">{t('settings.languageChinese')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="settings-panel-note">{t('settings.panelLanguageHelp')}</p>
              </div>
            </section>

            <section className="settings-rules-card bento-card" aria-labelledby="settings-rules-title">
              <SettingsCardHeading
                icon={<Code size={23} weight="bold" />}
                tone="teal"
                title={t('settings.aiBehavior')}
                titleId="settings-rules-title"
              />

              <div className="settings-number-grid">
                <NumberField
                  label={t('settings.concurrency')}
                  min={1}
                  max={10}
                  value={draft.concurrency}
                  onChange={value => updateDraft(current => ({ ...current, concurrency: value }))}
                />
                <NumberField
                  label={t('settings.batchSize')}
                  min={1}
                  max={100}
                  value={draft.batchSize}
                  onChange={value => updateDraft(current => ({ ...current, batchSize: value }))}
                />
              </div>

              <div className="settings-rules-grid">
                <TextAreaField
                  label={t('settings.customPrompt')}
                  value={draft.prompt}
                  placeholder={t('settings.promptPlaceholder')}
                  rows={9}
                  onChange={value => updateDraft(current => ({ ...current, prompt: value }))}
                />
                <TextAreaField
                  label={t('settings.skipKeys')}
                  value={draft.skipKeys.join('\n')}
                  placeholder={t('settings.skipPlaceholder')}
                  rows={9}
                  onChange={value => updateDraft(current => ({
                    ...current,
                    skipKeys: splitLineList(value),
                  }))}
                />
              </div>

              <div className="settings-watch-panel">
                <NumberField
                  label={t('settings.watchDebounce')}
                  min={0}
                  max={60000}
                  value={draft.watch.debounceMs}
                  onChange={value => updateDraft(current => ({
                    ...current,
                    watch: { ...current.watch, debounceMs: value },
                  }))}
                />
                <TextAreaField
                  label={t('settings.watchIgnored')}
                  value={draft.watch.ignored.join('\n')}
                  placeholder="node_modules/**"
                  rows={4}
                  onChange={value => updateDraft(current => ({
                    ...current,
                    watch: { ...current.watch, ignored: splitLineList(value) },
                  }))}
                />
              </div>
            </section>

            <section className="settings-llm-card bento-card" aria-labelledby="settings-llm-title">
              <SettingsCardHeading
                icon={<Key size={23} weight="bold" />}
                tone="violet"
                title={t('settings.modelRuntime')}
                titleId="settings-llm-title"
                compact
              />

              <div className="settings-runtime-list">
                <RuntimeField label={t('settings.model')} value={draft.llm.model || t('common.defaultModel')} />
                <RuntimeField label={t('settings.baseUrl')} value={draft.llm.baseURL || t('common.providerDefault')} />
                <RuntimeField label={t('settings.maxTokens')} value={String(draft.llm.maxTokens)} />
                <RuntimeField label={t('settings.temperature')} value={String(draft.llm.temperature)} />
                <RuntimeField label={t('settings.timeout')} value={`${draft.llm.timeout} ms`} />
                <RuntimeField label={t('settings.retries')} value={String(draft.llm.retries)} />
                <div className="settings-secret-note">
                  <Key size={16} aria-hidden="true" />
                  <span>{t('settings.runtimeNote')}</span>
                </div>
              </div>
            </section>

          </>
        )}
      </div>

      <Dialog open={confirmingSave} onOpenChange={open => { if (!open) setConfirmingSave(false); }}>
        {settings && draft && (
          <ModalContent className="settings-confirm-modal" size="lg" aria-describedby="settings-confirm-description">
            <ModalHeader icon={<GearSix size={20} weight="bold" />} closeLabel={t('common.close')}>
              <ModalTitleBlock
                title={t('settings.confirmTitle')}
                descriptionId="settings-confirm-description"
                description={t('settings.confirmDescription')}
              />
            </ModalHeader>
            <div className="settings-confirm-body">
              <div className="settings-confirm-note">
                <WarningCircle size={18} weight="fill" aria-hidden="true" />
                <span>{t('settings.confirmNote')}</span>
              </div>
              <dl className="settings-confirm-grid">
                <div>
                  <dt>{t('common.routes')}</dt>
                  <dd>{draft.routes.length}</dd>
                </div>
                <div>
                  <dt>{t('common.targets')}</dt>
                  <dd>{draft.routes.reduce((total, route) => total + route.targetLangs.length, 0)}</dd>
                </div>
                <div>
                  <dt>{t('common.runtime')}</dt>
                  <dd>{t('common.preserved')}</dd>
                </div>
                <div>
                  <dt>{t('common.restart')}</dt>
                  <dd>{t('common.required')}</dd>
                </div>
              </dl>
            </div>
            <ModalActions>
              <button type="button" className="button-tertiary" onClick={() => setConfirmingSave(false)}>{t('common.cancel')}</button>
              <button type="button" className="button-primary" disabled={!canSave} onClick={() => void saveConfirmed()}>
                {t('settings.save')}
              </button>
            </ModalActions>
          </ModalContent>
        )}
      </Dialog>
    </PanelLayout>
  );
}

export default SettingsPage;

function SettingsCardHeading({
  compact = false,
  icon,
  title,
  titleId,
  tone,
  trailing,
}: {
  compact?: boolean;
  icon: ReactNode;
  title: string;
  titleId: string;
  tone: 'cobalt' | 'violet' | 'teal' | 'amber' | 'coral';
  trailing?: ReactNode;
}) {
  return (
    <div className={compact ? 'settings-card-heading is-compact' : 'settings-card-heading'}>
      <span className={`settings-card-icon is-${tone}`} aria-hidden="true">
        {icon}
      </span>
      <div>
        <h2 id={titleId}>{title}</h2>
      </div>
      {trailing && <div className="settings-card-trailing">{trailing}</div>}
    </div>
  );
}

function RuntimeField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="settings-runtime-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TextField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange(value: string): void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function NumberField({
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange(value: number): void;
  step?: number;
  value: number;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={event => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  placeholder,
  rows,
  value,
}: {
  label: string;
  onChange(value: string): void;
  placeholder?: string;
  rows: number;
  value: string;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <Textarea
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={event => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function replaceRoute(
  current: SettingsDraft,
  index: number,
  route: SettingsDraft['routes'][number],
): SettingsDraft {
  return {
    ...current,
    routes: current.routes.map((candidate, routeIndex) => (
      routeIndex === index ? route : candidate
    )),
  };
}

function splitCommaList(value: string): string[] {
  return value.split(/[,\n]/u).map(item => item.trim()).filter(Boolean);
}

function splitLineList(value: string): string[] {
  return value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean);
}

function serializeDraft(draft: SettingsDraft): string {
  return JSON.stringify(draft);
}

function cloneDraft(draft: SettingsDraft): SettingsDraft {
  return JSON.parse(JSON.stringify(draft)) as SettingsDraft;
}

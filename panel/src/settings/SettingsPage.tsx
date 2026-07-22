import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowsClockwise,
  Code,
  FloppyDisk,
  GearSix,
  Key,
  ListPlus,
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
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { toast } from '../components/ui/sonner';
import { Textarea } from '../components/ui/textarea';
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
  const [settings, setSettings] = useState<PanelSettingsConfigFile | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [initialDraftKey, setInitialDraftKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingSave, setConfirmingSave] = useState(false);

  usePanelErrorToast(error, 'Settings failed');

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
  const editable = settings?.editable === true && Boolean(settings.writeToken);
  const canSave = Boolean(settings && draft && editable && settings.canWrite && dirty && !saving);
  const configPath = settings?.configPath || project?.configPath || '';
  const displayConfigPath = settings && configPath
    ? projectRelativePath(configPath, settings.projectRoot)
    : configPath || 'Reading config…';
  const restartRequired = settings?.restartRequired === true;

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
      toast.success('Settings saved', {
        description: 'Restart the panel for route, model, path, or watcher changes to apply.',
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
          <h1>Settings</h1>
        </div>
        {settings && (
          <span className={restartRequired ? 'settings-operation-pill is-warning' : 'settings-operation-pill'}>
            {settings.mode === 'multi-master' ? 'Multi-master' : 'Single-master'}
          </span>
        )}
        {restartRequired && (
          <span className="settings-operation-pill is-warning">Restart required</span>
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
          <span>Reset</span>
        </button>
        <button
          type="button"
          className="layout-primary-button"
          disabled={!canSave}
          onClick={() => setConfirmingSave(true)}
        >
          {saving ? <ArrowsClockwise size={16} className="is-spinning" aria-hidden="true" /> : <FloppyDisk size={16} aria-hidden="true" />}
          <span>{saving ? 'Saving…' : 'Save settings'}</span>
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
      <div className={restartRequired ? 'settings-bottom-status is-warning' : 'settings-bottom-status'}>
        <GearSix size={15} aria-hidden="true" />
        <span>{restartRequired ? 'Saved config is waiting for panel restart' : 'Config loaded in this panel session'}</span>
      </div>
    </>
  );

  return (
    <PanelLayout
      activeView="settings"
      bottomBar={bottomBar}
      bottomBarClassName="settings-bottom-bar"
      bottomBarLabel="Settings status"
      operationBar={operationBar}
      operationBarClassName="settings-operation-bar"
      operationBarLabel="Settings controls"
      onNavigate={onNavigate}
      project={project}
      skipLabel="settings"
      shellClassName="is-settings-shell"
      workspaceClassName="settings-workspace"
      liveStatus={saving ? 'Saving visual settings' : undefined}
    >
      <div className="workspace-content settings-bento">
        {loading && (
          <section className="settings-placeholder-card bento-card">
            <ArrowsClockwise className="is-spinning" size={22} aria-hidden="true" />
            <span>Loading i18n-translate config…</span>
          </section>
        )}

        {!loading && !draft && (
          <section className="settings-placeholder-card bento-card is-error">
            <WarningCircle size={22} weight="fill" aria-hidden="true" />
            <span>{error || 'Unable to load settings.'}</span>
            <button type="button" className="layout-control-button" onClick={() => void loadSettings()}>
              Retry
            </button>
          </section>
        )}

        {settings && draft && (
          <>
            <section className="settings-routes-card bento-card" aria-labelledby="settings-routes-title">
              <SettingsCardHeading
                icon={<SlidersHorizontal size={23} weight="bold" />}
                tone="cobalt"
                title="Language routes"
                titleId="settings-routes-title"
              />

              <div className="settings-field-grid">
                <TextField
                  label="Locales directory"
                  value={draft.localesDir}
                  onChange={value => updateDraft(current => ({ ...current, localesDir: value }))}
                />
                <TextField
                  label="Cache file"
                  value={draft.cachePath}
                  onChange={value => updateDraft(current => ({ ...current, cachePath: value }))}
                />
                <NumberField
                  label="Concurrency"
                  min={1}
                  max={10}
                  value={draft.concurrency}
                  onChange={value => updateDraft(current => ({ ...current, concurrency: value }))}
                />
                <NumberField
                  label="Batch size"
                  min={1}
                  max={100}
                  value={draft.batchSize}
                  onChange={value => updateDraft(current => ({ ...current, batchSize: value }))}
                />
              </div>

              <div className="settings-route-editor-list">
                {draft.routes.map((route, index) => (
                  <div key={`${index}-${route.sourceLang}`} className="settings-route-editor">
                    <TextField
                      label={`Route ${index + 1} master`}
                      value={route.sourceLang}
                      onChange={value => updateDraft(current => replaceRoute(current, index, {
                        ...route,
                        sourceLang: value,
                      }))}
                    />
                    <TextField
                      label="Target languages"
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
                      aria-label={`Remove route ${index + 1}`}
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
                <span>Add master route</span>
              </button>
            </section>

            <section className="settings-llm-card bento-card" aria-labelledby="settings-llm-title">
              <SettingsCardHeading
                icon={<Key size={23} weight="bold" />}
                tone="violet"
                title="Model runtime"
                titleId="settings-llm-title"
                compact
              />

              <div className="settings-stack-fields">
                <TextField
                  label="Model"
                  value={draft.llm.model}
                  onChange={value => updateDraft(current => ({
                    ...current,
                    llm: { ...current.llm, model: value },
                  }))}
                />
                <TextField
                  label="Base URL"
                  value={draft.llm.baseURL || ''}
                  placeholder="Optional OpenAI-compatible endpoint"
                  onChange={value => updateDraft(current => ({
                    ...current,
                    llm: { ...current.llm, baseURL: value },
                  }))}
                />
                <div className="settings-number-grid">
                  <NumberField
                    label="Max tokens"
                    min={1}
                    max={128000}
                    value={draft.llm.maxTokens}
                    onChange={value => updateDraft(current => ({
                      ...current,
                      llm: { ...current.llm, maxTokens: value },
                    }))}
                  />
                  <NumberField
                    label="Temperature"
                    min={0}
                    max={2}
                    step={0.1}
                    value={draft.llm.temperature}
                    onChange={value => updateDraft(current => ({
                      ...current,
                      llm: { ...current.llm, temperature: value },
                    }))}
                  />
                  <NumberField
                    label="Timeout"
                    min={1000}
                    max={600000}
                    value={draft.llm.timeout}
                    onChange={value => updateDraft(current => ({
                      ...current,
                      llm: { ...current.llm, timeout: value },
                    }))}
                  />
                  <NumberField
                    label="Retries"
                    min={0}
                    max={10}
                    value={draft.llm.retries}
                    onChange={value => updateDraft(current => ({
                      ...current,
                      llm: { ...current.llm, retries: value },
                    }))}
                  />
                </div>
                <div className="settings-secret-note">
                  <Key size={16} aria-hidden="true" />
                  <span>API key: environment only · {draft.llm.apiKeyEnv}</span>
                </div>
              </div>
            </section>

            <section className="settings-rules-card bento-card" aria-labelledby="settings-rules-title">
              <SettingsCardHeading
                icon={<Code size={23} weight="bold" />}
                tone="teal"
                title="Prompt and skip keys"
                titleId="settings-rules-title"
              />

              <div className="settings-rules-grid">
                <TextAreaField
                  label="Custom prompt"
                  value={draft.prompt}
                  placeholder="Brand terms, tone, formatting, domain vocabulary…"
                  rows={9}
                  onChange={value => updateDraft(current => ({ ...current, prompt: value }))}
                />
                <TextAreaField
                  label="Skip keys"
                  value={draft.skipKeys.join('\n')}
                  placeholder="One matcher per line"
                  rows={9}
                  onChange={value => updateDraft(current => ({
                    ...current,
                    skipKeys: splitLineList(value),
                  }))}
                />
              </div>

              <div className="settings-watch-panel">
                <label className="settings-checkbox-row">
                  <Checkbox
                    checked={draft.watch.enabled}
                    onCheckedChange={checked => updateDraft(current => ({
                      ...current,
                      watch: { ...current.watch, enabled: checked === true },
                    }))}
                  />
                  <span>Enable watch mode in generated config</span>
                </label>
                <NumberField
                  label="Watch debounce"
                  min={0}
                  max={60000}
                  value={draft.watch.debounceMs}
                  onChange={value => updateDraft(current => ({
                    ...current,
                    watch: { ...current.watch, debounceMs: value },
                  }))}
                />
                <TextAreaField
                  label="Watch ignored patterns"
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

            <section className="settings-preview-card bento-card" aria-labelledby="settings-preview-title">
              <SettingsCardHeading
                icon={<WarningCircle size={23} weight="fill" />}
                tone={settings.canWrite ? 'amber' : 'coral'}
                title={settings.canWrite ? 'Live draft preview' : 'Read-only format'}
                titleId="settings-preview-title"
                compact
              />

              <ul className="settings-warning-list">
                {[...(settings.saveUnsupportedReason ? [settings.saveUnsupportedReason] : []), ...settings.warnings].map(warning => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>

              <pre className="settings-config-preview"><code>{renderDraftPreview(draft)}</code></pre>
            </section>
          </>
        )}
      </div>

      <Dialog open={confirmingSave} onOpenChange={open => { if (!open) setConfirmingSave(false); }}>
        {settings && draft && (
          <ModalContent className="settings-confirm-modal" size="lg" aria-describedby="settings-confirm-description">
            <ModalHeader icon={<GearSix size={20} weight="bold" />}>
              <ModalTitleBlock
                title="Save visual settings"
                descriptionId="settings-confirm-description"
                description="This updates i18n-translate.config.mjs only. Locale JSON files, cache, and snapshots are not changed by this save."
              />
            </ModalHeader>
            <div className="settings-confirm-body">
              <div className="settings-confirm-note">
                <WarningCircle size={18} weight="fill" aria-hidden="true" />
                <span>Existing comments or custom JavaScript expressions in the config file will be replaced by the standard defineConfig format.</span>
              </div>
              <dl className="settings-confirm-grid">
                <div>
                  <dt>Routes</dt>
                  <dd>{draft.routes.length}</dd>
                </div>
                <div>
                  <dt>Targets</dt>
                  <dd>{draft.routes.reduce((total, route) => total + route.targetLangs.length, 0)}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{draft.llm.model || '—'}</dd>
                </div>
                <div>
                  <dt>Restart</dt>
                  <dd>Required</dd>
                </div>
              </dl>
            </div>
            <ModalActions>
              <button type="button" className="button-tertiary" onClick={() => setConfirmingSave(false)}>Cancel</button>
              <button type="button" className="button-primary" disabled={!canSave} onClick={() => void saveConfirmed()}>
                Save settings
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
}: {
  compact?: boolean;
  icon: ReactNode;
  title: string;
  titleId: string;
  tone: 'cobalt' | 'violet' | 'teal' | 'amber' | 'coral';
}) {
  return (
    <div className={compact ? 'settings-card-heading is-compact' : 'settings-card-heading'}>
      <span className={`settings-card-icon is-${tone}`} aria-hidden="true">
        {icon}
      </span>
      <div>
        <h2 id={titleId}>{title}</h2>
      </div>
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

function renderDraftPreview(draft: SettingsDraft): string {
  return JSON.stringify({
    ...draft,
    llm: {
      apiKey: 'process.env.OPENAI_API_KEY || ""',
      model: draft.llm.model,
      baseURL: draft.llm.baseURL || 'process.env.OPENAI_BASE_URL',
      maxTokens: draft.llm.maxTokens,
      temperature: draft.llm.temperature,
      timeout: draft.llm.timeout,
      retries: draft.llm.retries,
    },
  }, null, 2);
}

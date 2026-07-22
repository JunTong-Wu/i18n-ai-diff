import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  ResolvedTranslateConfig,
  SettingsConfigDraft,
  SettingsConfigFile,
  SettingsConfigSaveRequest,
  SettingsConfigSaveResult,
  SettingsRouteDraft,
} from '../types/index.js';
import { loadConfigWithMetadata } from './config-loader.js';

const SUPPORTED_WRITE_EXTENSIONS = new Set(['.mjs', '.ts']);

export class SettingsConfigError extends Error {
  constructor(
    message: string,
    readonly code = 'INVALID_SETTINGS_CONFIG',
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SettingsConfigError';
  }
}

export class TranslationSettingsService {
  private restartRequired = false;

  constructor(
    private readonly startupConfig: ResolvedTranslateConfig,
    private readonly configPath: string,
    private readonly projectRoot: string,
  ) {}

  async getConfig(editable: boolean, writeToken?: string): Promise<SettingsConfigFile> {
    const { raw, revision } = await this.readConfigFile();
    const loadWarnings: string[] = [];
    let resolvedConfig = this.startupConfig;
    try {
      const loaded = await loadConfigWithMetadata(this.configPath, this.projectRoot);
      resolvedConfig = loaded.config;
    } catch (error) {
      loadWarnings.push(`The config file on disk could not be loaded by this running panel: ${(error as Error).message}`);
    }
    const draft = toSettingsDraft(resolvedConfig, this.projectRoot);
    const standardConfigPreview = renderConfigModule(draft);
    const writeSupport = inspectWriteSupport(this.configPath);
    return {
      editable,
      ...(editable && writeToken ? { writeToken } : {}),
      projectRoot: this.projectRoot,
      configPath: this.configPath,
      revision,
      mode: resolvedConfig.routes.length > 1 ? 'multi-master' : 'single-master',
      config: draft,
      raw: standardConfigPreview,
      standardConfigPreview,
      canWrite: writeSupport.canWrite,
      ...(writeSupport.reason ? { saveUnsupportedReason: writeSupport.reason } : {}),
      restartRequired: this.restartRequired,
      warnings: [...loadWarnings, ...settingsWarnings(draft)],
    };
  }

  async saveConfig(request: SettingsConfigSaveRequest): Promise<SettingsConfigSaveResult> {
    const writeSupport = inspectWriteSupport(this.configPath);
    if (!writeSupport.canWrite) {
      throw new SettingsConfigError(
        writeSupport.reason || 'This config file format cannot be written by the visual settings page',
        'UNSUPPORTED_CONFIG_FORMAT',
      );
    }
    if (!request || typeof request !== 'object') {
      throw new SettingsConfigError('Settings save request is required');
    }
    const { raw: currentRaw, revision: currentRevision } = await this.readConfigFile();
    if (request.revision !== currentRevision) {
      throw new SettingsConfigError(
        'Config file changed on disk. Reload settings before saving.',
        'REVISION_CONFLICT',
        409,
        { expected: request.revision, actual: currentRevision },
      );
    }

    const normalized = normalizeSettingsDraft(request.config);
    const nextRaw = renderConfigModule(normalized);
    await atomicWriteFile(this.configPath, nextRaw);
    this.restartRequired = true;

    return {
      configPath: this.configPath,
      revision: revisionForContent(nextRaw),
      config: normalized,
      raw: nextRaw,
      standardConfigPreview: nextRaw,
      restartRequired: true,
      warnings: settingsWarnings(normalized),
    };
  }

  private async readConfigFile(): Promise<{ raw: string; revision: string }> {
    const raw = await fs.readFile(this.configPath, 'utf8');
    return {
      raw,
      revision: revisionForContent(raw),
    };
  }
}

export function toSettingsDraft(
  config: ResolvedTranslateConfig,
  projectRoot: string,
): SettingsConfigDraft {
  return {
    routes: config.routes.map(route => ({
      sourceLang: route.sourceLang,
      targetLangs: [...route.targetLangs],
    })),
    localesDir: toConfigPath(config.localesDir, projectRoot),
    skipKeys: [...(config.skipKeys || [])],
    llm: {
      apiKeyEnv: 'OPENAI_API_KEY',
      baseURL: config.llm.baseURL || '',
      model: config.llm.model || 'gpt-4o-mini',
      maxTokens: config.llm.maxTokens || 4096,
      temperature: config.llm.temperature ?? 0.3,
      timeout: config.llm.timeout || 60000,
      retries: config.llm.retries ?? 3,
    },
    prompt: config.prompt || '',
    watch: {
      enabled: config.watch?.enabled === true,
      debounceMs: config.watch?.debounceMs ?? 300,
      ignored: [...(config.watch?.ignored || [])],
    },
    cachePath: toConfigPath(
      config.cachePath || path.join(projectRoot, '.i18n-translate-cache.json'),
      projectRoot,
    ),
    concurrency: config.concurrency || 3,
    batchSize: config.batchSize || 20,
  };
}

export function normalizeSettingsDraft(config: SettingsConfigDraft): SettingsConfigDraft {
  if (!config || typeof config !== 'object') {
    throw new SettingsConfigError('Settings config is required');
  }

  const routes = normalizeRoutes(config.routes);
  const sourceLangs = new Set(routes.map(route => route.sourceLang));
  const targetOwners = new Map<string, string>();
  const errors: string[] = [];

  for (const [index, route] of routes.entries()) {
    const label = `routes[${index}]`;
    if (!route.sourceLang) {
      errors.push(`${label}.sourceLang is required`);
    }
    if (route.targetLangs.length === 0) {
      errors.push(`${label}.targetLangs must have at least one language`);
    }
    if (route.targetLangs.includes(route.sourceLang)) {
      errors.push(`${label}.targetLangs must not contain its sourceLang (${route.sourceLang})`);
    }
    for (const targetLang of route.targetLangs) {
      const owner = targetOwners.get(targetLang);
      if (owner && owner !== route.sourceLang) {
        errors.push(`target language ${targetLang} is assigned to multiple masters: ${owner}, ${route.sourceLang}`);
      } else {
        targetOwners.set(targetLang, route.sourceLang);
      }
      if (sourceLangs.has(targetLang)) {
        errors.push(`language ${targetLang} cannot be both a master and a target language`);
      }
    }
  }

  const localesDir = cleanString(config.localesDir, 'localesDir');
  const cachePath = cleanString(config.cachePath, 'cachePath');
  const prompt = typeof config.prompt === 'string' ? config.prompt : '';
  const skipKeys = uniqueStrings((config.skipKeys || []).map(value => cleanString(value, 'skipKeys')));
  const ignored = uniqueStrings((config.watch?.ignored || []).map(value => cleanString(value, 'watch.ignored')));

  const llm = {
    apiKeyEnv: 'OPENAI_API_KEY' as const,
    baseURL: cleanOptionalString(config.llm?.baseURL, 'llm.baseURL'),
    model: cleanString(config.llm?.model || 'gpt-4o-mini', 'llm.model'),
    maxTokens: normalizeInteger(config.llm?.maxTokens, 'llm.maxTokens', 1, 128_000),
    temperature: normalizeNumber(config.llm?.temperature, 'llm.temperature', 0, 2),
    timeout: normalizeInteger(config.llm?.timeout, 'llm.timeout', 1_000, 600_000),
    retries: normalizeInteger(config.llm?.retries, 'llm.retries', 0, 10),
  };

  const concurrency = normalizeInteger(config.concurrency, 'concurrency', 1, 10);
  const batchSize = normalizeInteger(config.batchSize, 'batchSize', 1, 100);
  const watch = {
    enabled: config.watch?.enabled === true,
    debounceMs: normalizeInteger(config.watch?.debounceMs ?? 300, 'watch.debounceMs', 0, 60_000),
    ignored,
  };

  if (!localesDir) errors.push('localesDir is required');
  if (!cachePath) errors.push('cachePath is required');
  if (!llm.model) errors.push('llm.model is required');
  if (llm.baseURL) {
    try {
      // eslint-disable-next-line no-new
      new URL(llm.baseURL);
    } catch {
      errors.push('llm.baseURL must be a valid URL when provided');
    }
  }

  if (errors.length > 0) {
    throw new SettingsConfigError('Config validation failed', 'CONFIG_VALIDATION_FAILED', 400, errors);
  }

  return {
    routes,
    localesDir,
    skipKeys,
    llm,
    prompt,
    watch,
    cachePath,
    concurrency,
    batchSize,
  };
}

export function renderConfigModule(config: SettingsConfigDraft): string {
  const normalized = normalizeSettingsDraft(config);
  return [
    "import fs from 'node:fs';",
    "import { defineConfig } from 'i18n-ai-diff';",
    '',
    "loadLocalEnv(new URL('.env', import.meta.url));",
    '',
    'export default defineConfig({',
    `  routes: ${renderRoutes(normalized.routes, 2)},`,
    `  localesDir: ${jsString(normalized.localesDir)},`,
    `  skipKeys: ${renderStringArray(normalized.skipKeys, 2)},`,
    '  llm: {',
    "    apiKey: process.env.OPENAI_API_KEY || '',",
    `    model: process.env.OPENAI_MODEL || ${jsString(normalized.llm.model)},`,
    normalized.llm.baseURL
      ? `    baseURL: process.env.OPENAI_BASE_URL || ${jsString(normalized.llm.baseURL)},`
      : '    baseURL: process.env.OPENAI_BASE_URL,',
    `    maxTokens: ${normalized.llm.maxTokens},`,
    `    temperature: ${normalized.llm.temperature},`,
    `    timeout: Number(process.env.OPENAI_TIMEOUT || ${normalized.llm.timeout}),`,
    `    retries: Number(process.env.OPENAI_RETRIES || ${normalized.llm.retries}),`,
    '  },',
    `  prompt: ${jsString(normalized.prompt)},`,
    '  watch: {',
    `    enabled: ${normalized.watch.enabled ? 'true' : 'false'},`,
    `    debounceMs: ${normalized.watch.debounceMs},`,
    `    ignored: ${renderStringArray(normalized.watch.ignored, 4)},`,
    '  },',
    `  concurrency: ${normalized.concurrency},`,
    `  batchSize: ${normalized.batchSize},`,
    `  cachePath: ${jsString(normalized.cachePath)},`,
    '});',
    '',
    'function loadLocalEnv(envUrl) {',
    "  let content = '';",
    '  try {',
    "    content = fs.readFileSync(envUrl, 'utf8');",
    '  } catch (error) {',
    "    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;",
    '    throw error;',
    '  }',
    '',
    '  for (const line of content.split(/\\r?\\n/)) {',
    '    const trimmed = line.trim();',
    "    if (!trimmed || trimmed.startsWith('#')) continue;",
    '',
    "    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)$/);",
    '    if (!match) continue;',
    '',
    '    const [, key, rawValue] = match;',
    '    if (process.env[key] !== undefined) continue;',
    '',
    '    process.env[key] = parseEnvValue(rawValue);',
    '  }',
    '}',
    '',
    'function parseEnvValue(rawValue) {',
    '  let value = rawValue.trim();',
    '  const quote = value[0];',
    '  if ((quote === \'"\' || quote === "\'") && value.endsWith(quote)) {',
    '    value = value.slice(1, -1);',
    '  } else {',
    "    value = value.replace(/\\s+#.*$/, '').trim();",
    '  }',
    '',
    '  return value;',
    '}',
    '',
  ].join('\n');
}

function normalizeRoutes(routes: SettingsRouteDraft[] | undefined): SettingsRouteDraft[] {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new SettingsConfigError('At least one master route is required', 'CONFIG_VALIDATION_FAILED');
  }

  const seenSources = new Set<string>();
  const normalized: SettingsRouteDraft[] = [];
  const errors: string[] = [];

  for (const [index, route] of routes.entries()) {
    const label = `routes[${index}]`;
    const sourceLang = cleanString(route?.sourceLang || '', `${label}.sourceLang`);
    if (seenSources.has(sourceLang)) {
      errors.push(`master language ${sourceLang} must be configured in a single route`);
    }
    seenSources.add(sourceLang);
    const targetLangs = uniqueStrings((route?.targetLangs || []).map(value => cleanString(value, `${label}.targetLangs`)));
    normalized.push({ sourceLang, targetLangs });
  }

  if (errors.length > 0) {
    throw new SettingsConfigError('Config validation failed', 'CONFIG_VALIDATION_FAILED', 400, errors);
  }

  return normalized;
}

function renderRoutes(routes: SettingsRouteDraft[], indent: number): string {
  const base = ' '.repeat(indent);
  const child = ' '.repeat(indent + 2);
  const grandchild = ' '.repeat(indent + 4);
  if (routes.length === 0) return '[]';
  return [
    '[',
    ...routes.flatMap(route => [
      `${child}{`,
      `${grandchild}sourceLang: ${jsString(route.sourceLang)},`,
      `${grandchild}targetLangs: ${renderStringArray(route.targetLangs, indent + 4)},`,
      `${child}},`,
    ]),
    `${base}]`,
  ].join('\n');
}

function renderStringArray(values: string[], indent: number): string {
  if (values.length === 0) return '[]';
  if (values.length <= 4 && values.every(value => value.length <= 18)) {
    return `[${values.map(jsString).join(', ')}]`;
  }
  const child = ' '.repeat(indent + 2);
  const base = ' '.repeat(indent);
  return [
    '[',
    ...values.map(value => `${child}${jsString(value)},`),
    `${base}]`,
  ].join('\n');
}

function settingsWarnings(config: SettingsConfigDraft): string[] {
  const warnings = [
    'Saving rewrites the config into the standard defineConfig format. Existing comments or custom JavaScript expressions in the config file are not preserved.',
    'API keys are never written by the settings page. Keep OPENAI_API_KEY in the environment or a local .env file.',
  ];
  if (config.routes.length === 1) {
    warnings.push('A single route still uses routes[].sourceLang internally, so single-master and multi-master behavior stay unified.');
  }
  return warnings;
}

function inspectWriteSupport(configPath: string): { canWrite: boolean; reason?: string } {
  const extension = path.extname(configPath).toLowerCase();
  if (SUPPORTED_WRITE_EXTENSIONS.has(extension)) {
    return { canWrite: true };
  }
  return {
    canWrite: false,
    reason: `The visual settings editor currently writes .mjs or .ts config files only. Current file: ${path.basename(configPath)}`,
  };
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new SettingsConfigError(`${field} must be a string`, 'CONFIG_VALIDATION_FAILED');
  }
  if (value.includes('\0')) {
    throw new SettingsConfigError(`${field} must not contain NUL bytes`, 'CONFIG_VALIDATION_FAILED');
  }
  return value.trim();
}

function cleanOptionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return '';
  return cleanString(value, field);
}

function normalizeInteger(value: unknown, field: string, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new SettingsConfigError(`${field} must be an integer between ${min} and ${max}`, 'CONFIG_VALIDATION_FAILED');
  }
  return number;
}

function normalizeNumber(value: unknown, field: string, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new SettingsConfigError(`${field} must be a number between ${min} and ${max}`, 'CONFIG_VALIDATION_FAILED');
  }
  return number;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function toConfigPath(absolutePath: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, absolutePath);
  if (!relative) return '.';
  if (relative.startsWith('..') || path.isAbsolute(relative)) return absolutePath;
  return `./${relative.split(path.sep).join('/')}`;
}

function revisionForContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const tempPath = path.join(directory, `.${basename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import * as babelParser from '@babel/parser';
import {
  ResolvedTranslateConfig,
  SettingsConfigDraft,
  SettingsConfigFile,
  SettingsConfigSaveRequest,
  SettingsConfigSaveResult,
  SettingsRouteDraft,
} from '../types/index.js';
import { loadConfigWithMetadata } from './config-loader.js';
import { normalizeLanguageCode, validateLanguageCode } from '../utils/language-code.js';

const SUPPORTED_WRITE_EXTENSIONS = new Set(['.mjs', '.ts']);
const MANAGED_SETTINGS_FIELDS = new Set([
  'routes',
  'baseLang',
  'targetLangs',
  'localesDir',
  'skipKeys',
  'prompt',
  'watch',
  'cachePath',
  'concurrency',
  'batchSize',
]);

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

  async getConfig(writeToken: string): Promise<SettingsConfigFile> {
    const { revision } = await this.readConfigFile();
    const loadWarnings: string[] = [];
    let resolvedConfig = this.startupConfig;
    try {
      const loaded = await loadConfigWithMetadata(this.configPath, this.projectRoot);
      resolvedConfig = loaded.config;
    } catch (error) {
      loadWarnings.push(`The config file on disk could not be loaded by this running panel: ${(error as Error).message}`);
    }
    const draft = toSettingsDraft(resolvedConfig, this.projectRoot);
    const standardConfigPreview = renderManagedConfigPreview(draft);
    const writeSupport = inspectWriteSupport(this.configPath);
    return {
      writeToken,
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
    const nextRaw = patchConfigModule(currentRaw, normalized, this.configPath);
    await atomicWriteFile(this.configPath, nextRaw);
    this.restartRequired = true;
    const safePreview = renderManagedConfigPreview(normalized);

    return {
      configPath: this.configPath,
      revision: revisionForContent(nextRaw),
      config: normalized,
      raw: safePreview,
      standardConfigPreview: safePreview,
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

  const llm = normalizeDisplayLlm(config.llm);

  const concurrency = normalizeInteger(config.concurrency, 'concurrency', 1, 10);
  const batchSize = normalizeInteger(config.batchSize, 'batchSize', 1, 100);
  const watch = {
    debounceMs: normalizeInteger(config.watch?.debounceMs ?? 300, 'watch.debounceMs', 0, 60_000),
    ignored,
  };

  if (!localesDir) errors.push('localesDir is required');
  if (!cachePath) errors.push('cachePath is required');
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

export function renderManagedConfigPreview(config: SettingsConfigDraft): string {
  const normalized = normalizeSettingsDraft(config);
  return [
    'defineConfig({',
    `  routes: ${renderRoutes(normalized.routes, 2)},`,
    `  localesDir: ${jsString(normalized.localesDir)},`,
    `  skipKeys: ${renderStringArray(normalized.skipKeys, 2)},`,
    `  prompt: ${jsString(normalized.prompt)},`,
    '  watch: {',
    `    debounceMs: ${normalized.watch.debounceMs},`,
    `    ignored: ${renderStringArray(normalized.watch.ignored, 4)},`,
    '  },',
    `  concurrency: ${normalized.concurrency},`,
    `  batchSize: ${normalized.batchSize},`,
    `  cachePath: ${jsString(normalized.cachePath)},`,
    '  // llm is preserved from the existing config source and is not rewritten here.',
    '})',
  ].join('\n');
}

export function patchConfigModule(raw: string, config: SettingsConfigDraft, configPath = 'i18n-translate.config.mjs'): string {
  const normalized = normalizeSettingsDraft(config);
  const configObject = findConfigObject(raw, configPath);
  const properties = collectObjectProperties(configObject);
  const useLegacySingleMaster = shouldPatchLegacySingleMaster(properties, normalized);
  const updates = buildManagedPropertyUpdates(normalized, useLegacySingleMaster);
  const deletions = useLegacySingleMaster
    ? ['routes']
    : ['baseLang', 'targetLangs'];
  return applyObjectPropertyPatch(raw, configObject, properties, updates, deletions);
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
    const sourceLang = normalizeLanguageCode(route?.sourceLang) as string;
    const sourceError = validateLanguageCode(sourceLang, `${label}.sourceLang`);
    if (sourceError) {
      errors.push(sourceError);
    } else if (seenSources.has(sourceLang)) {
      errors.push(`master language ${sourceLang} must be configured in a single route`);
    } else {
      seenSources.add(sourceLang);
    }
    const targetLangs = uniqueStrings((Array.isArray(route?.targetLangs) ? route.targetLangs : [])
      .map((value, targetIndex) => {
        const targetLang = normalizeLanguageCode(value) as string;
        const targetError = validateLanguageCode(targetLang, `${label}.targetLangs[${targetIndex}]`);
        if (targetError) errors.push(targetError);
        return targetError ? '' : targetLang;
      })
      .filter(Boolean));
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

interface ConfigObjectNode {
  type: 'ObjectExpression';
  start: number;
  end: number;
  properties: ConfigObjectPropertyNode[];
}

type ConfigObjectPropertyNode = ConfigNamedPropertyNode | ConfigSpreadNode;

interface ConfigNamedPropertyNode {
  type: 'ObjectProperty' | 'ObjectMethod';
  start: number;
  end: number;
  key: ConfigKeyNode;
  value?: ConfigAstNode;
  computed?: boolean;
  shorthand?: boolean;
}

interface ConfigSpreadNode {
  type: 'SpreadElement';
  start: number;
  end: number;
}

interface ConfigKeyNode {
  type: string;
  name?: string;
  value?: string | number;
}

interface ConfigAstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface CollectedProperty {
  node: ConfigNamedPropertyNode;
  name: string;
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

type ManagedPropertyRenderer = (indent: number) => string;

function findConfigObject(raw: string, configPath: string): ConfigObjectNode {
  let ast: ConfigAstNode;
  try {
    ast = babelParser.parse(raw, {
      sourceType: 'module',
      plugins: ['typescript'],
    }) as unknown as ConfigAstNode;
  } catch (error) {
    throw new SettingsConfigError(
      `Unable to parse ${path.basename(configPath)} for safe visual editing: ${(error as Error).message}`,
      'UNSUPPORTED_CONFIG_AST',
    );
  }

  const program = ast.program as { body?: ConfigAstNode[] } | undefined;
  for (const statement of program?.body || []) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const object = objectFromConfigExpression(statement.declaration as ConfigAstNode | undefined);
      if (object) return object;
    }
  }

  throw new SettingsConfigError(
    'The visual settings editor can only save config files whose default export is a direct defineConfig({ ... }) call or object literal.',
    'UNSUPPORTED_CONFIG_AST',
  );
}

function objectFromConfigExpression(node: ConfigAstNode | undefined): ConfigObjectNode | null {
  const expression = unwrapExpression(node);
  if (!expression) return null;
  if (expression.type === 'ObjectExpression') return assertObjectNode(expression);
  if (expression.type === 'CallExpression') {
    const args = expression.arguments as ConfigAstNode[] | undefined;
    const callee = expression.callee as ConfigAstNode | undefined;
    if (isDefineConfigCallee(callee)) {
      const firstArg = unwrapExpression(args?.[0]);
      if (firstArg?.type === 'ObjectExpression') return assertObjectNode(firstArg);
    }
  }
  return null;
}

function unwrapExpression(node: ConfigAstNode | undefined): ConfigAstNode | undefined {
  let current = node;
  while (
    current
    && ['TSAsExpression', 'TSSatisfiesExpression', 'TypeCastExpression', 'ParenthesizedExpression'].includes(current.type)
  ) {
    current = (current.expression as ConfigAstNode | undefined);
  }
  return current;
}

function isDefineConfigCallee(node: ConfigAstNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'Identifier') return node.name === 'defineConfig';
  if (node.type === 'MemberExpression') {
    const property = node.property as ConfigAstNode | undefined;
    return property?.type === 'Identifier' && property.name === 'defineConfig';
  }
  return false;
}

function assertObjectNode(node: ConfigAstNode): ConfigObjectNode {
  if (typeof node.start !== 'number' || typeof node.end !== 'number') {
    throw new SettingsConfigError('The config parser did not provide source ranges for the exported config object.', 'UNSUPPORTED_CONFIG_AST');
  }
  return node as unknown as ConfigObjectNode;
}

function collectObjectProperties(configObject: ConfigObjectNode): Map<string, CollectedProperty> {
  const properties = new Map<string, CollectedProperty>();
  for (const property of configObject.properties) {
    if (property.type === 'SpreadElement') {
      throw new SettingsConfigError(
        'The visual settings editor cannot safely save config objects with top-level spread properties. Move the spread inside a manually maintained field or edit the config by hand.',
        'UNSUPPORTED_CONFIG_AST',
      );
    }
    const name = propertyName(property);
    if (!name) {
      if (isManagedComputedProperty(property)) {
        throw new SettingsConfigError(
          'The visual settings editor cannot safely save computed config keys for managed settings fields.',
          'UNSUPPORTED_CONFIG_AST',
        );
      }
      continue;
    }
    if (properties.has(name)) {
      throw new SettingsConfigError(
        `The config object contains duplicate "${name}" properties, so the visual settings editor cannot safely patch it.`,
        'UNSUPPORTED_CONFIG_AST',
      );
    }
    properties.set(name, { node: property, name });
  }
  return properties;
}

function propertyName(property: ConfigNamedPropertyNode): string | null {
  if (property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name || null;
  if (property.key.type === 'StringLiteral' || property.key.type === 'Literal') {
    return typeof property.key.value === 'string' ? property.key.value : null;
  }
  return null;
}

function isManagedComputedProperty(property: ConfigNamedPropertyNode): boolean {
  const keyText = property.key?.value || property.key?.name;
  return typeof keyText === 'string' && MANAGED_SETTINGS_FIELDS.has(keyText);
}

function shouldPatchLegacySingleMaster(
  properties: Map<string, CollectedProperty>,
  config: SettingsConfigDraft,
): boolean {
  return !properties.has('routes')
    && properties.has('baseLang')
    && properties.has('targetLangs')
    && config.routes.length === 1;
}

function buildManagedPropertyUpdates(
  config: SettingsConfigDraft,
  useLegacySingleMaster: boolean,
): Map<string, ManagedPropertyRenderer> {
  const updates = new Map<string, ManagedPropertyRenderer>();
  if (useLegacySingleMaster) {
    const [route] = config.routes;
    updates.set('baseLang', () => jsString(route.sourceLang));
    updates.set('targetLangs', indent => renderStringArray(route.targetLangs, indent));
  } else {
    updates.set('routes', indent => renderRoutes(config.routes, indent));
  }
  updates.set('localesDir', () => jsString(config.localesDir));
  updates.set('skipKeys', indent => renderStringArray(config.skipKeys, indent));
  updates.set('prompt', () => jsString(config.prompt));
  updates.set('watch', indent => renderWatch(config.watch, indent));
  updates.set('cachePath', () => jsString(config.cachePath));
  updates.set('concurrency', () => String(config.concurrency));
  updates.set('batchSize', () => String(config.batchSize));
  return updates;
}

function applyObjectPropertyPatch(
  raw: string,
  configObject: ConfigObjectNode,
  properties: Map<string, CollectedProperty>,
  updates: Map<string, ManagedPropertyRenderer>,
  deletions: string[],
): string {
  const edits: TextEdit[] = [];
  for (const [name, renderValue] of updates) {
    const property = properties.get(name);
    if (!property) continue;
    if (property.node.type !== 'ObjectProperty' || !property.node.value) {
      throw new SettingsConfigError(
        `The visual settings editor cannot safely patch "${name}" because it is not a plain object property.`,
        'UNSUPPORTED_CONFIG_AST',
      );
    }
    const valueCode = renderValue(indentationBefore(raw, property.node.start).length);
    if (property.node.shorthand) {
      edits.push({
        start: property.node.start,
        end: property.node.end,
        text: `${renderPropertyKey(name)}: ${valueCode}`,
      });
    } else {
      edits.push({
        start: property.node.value.start,
        end: property.node.value.end,
        text: valueCode,
      });
    }
  }

  for (const name of deletions) {
    const property = properties.get(name);
    if (!property) continue;
    edits.push(deletionEditForProperty(raw, property.node));
  }

  const missingEntries = [...updates]
    .filter(([name]) => !properties.has(name))
    .map(([name, renderValue]) => ({ name, renderValue }));
  if (missingEntries.length > 0) {
    edits.push(insertionEditForProperties(raw, configObject, missingEntries));
  }

  return applyTextEdits(raw, edits);
}

function deletionEditForProperty(raw: string, property: ConfigNamedPropertyNode): TextEdit {
  let start = property.start;
  let end = property.end;
  const next = nextNonWhitespaceIndex(raw, end);
  if (next !== -1 && raw[next] === ',') {
    end = next + 1;
    while (end < raw.length && /[ \t]/u.test(raw[end])) end += 1;
    if (raw[end] === '\r' && raw[end + 1] === '\n') end += 2;
    else if (raw[end] === '\n') end += 1;
    return { start, end, text: '' };
  }

  const previous = previousNonWhitespaceIndex(raw, start - 1);
  if (previous !== -1 && raw[previous] === ',') {
    start = previous;
    while (start > 0 && /[ \t]/u.test(raw[start - 1])) start -= 1;
    return { start, end, text: '' };
  }
  return { start, end, text: '' };
}

function insertionEditForProperties(
  raw: string,
  configObject: ConfigObjectNode,
  entries: Array<{ name: string; renderValue: ManagedPropertyRenderer }>,
): TextEdit {
  const closeBrace = configObject.end - 1;
  const objectIndent = indentationBefore(raw, configObject.start);
  const propertyIndent = inferPropertyIndent(raw, configObject, objectIndent);
  const propertyIndentLength = propertyIndent.length;
  const previous = previousNonWhitespaceIndex(raw, closeBrace - 1);
  const hasExistingProperties = previous !== -1 && previous > configObject.start && raw[previous] !== '{';
  const needsLeadingComma = hasExistingProperties && raw[previous] !== ',';
  const text = [
    needsLeadingComma ? ',' : '',
    '\n',
    entries
      .map(entry => `${propertyIndent}${renderPropertyKey(entry.name)}: ${entry.renderValue(propertyIndentLength)}`)
      .join(',\n'),
    ',',
    '\n',
    objectIndent,
  ].join('');
  return { start: closeBrace, end: closeBrace, text };
}

function inferPropertyIndent(raw: string, configObject: ConfigObjectNode, objectIndent: string): string {
  const firstProperty = configObject.properties.find(property => property.type !== 'SpreadElement');
  if (firstProperty) {
    return indentationBefore(raw, firstProperty.start);
  }
  return `${objectIndent}  `;
}

function renderPropertyKey(name: string): string {
  if (/^[A-Za-z_$][\w$]*$/u.test(name)) return name;
  return jsString(name);
}

function renderWatch(watch: SettingsConfigDraft['watch'], indent: number): string {
  const base = ' '.repeat(indent);
  const child = ' '.repeat(indent + 2);
  return [
    '{',
    `${child}debounceMs: ${watch.debounceMs},`,
    `${child}ignored: ${renderStringArray(watch.ignored, indent + 2)},`,
    `${base}}`,
  ].join('\n');
}

function applyTextEdits(raw: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((left, right) => right.start - left.start);
  let next = raw;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const edit of sorted) {
    if (edit.end > lastStart) {
      throw new SettingsConfigError('Overlapping config edits were generated while saving settings.', 'UNSUPPORTED_CONFIG_AST');
    }
    next = `${next.slice(0, edit.start)}${edit.text}${next.slice(edit.end)}`;
    lastStart = edit.start;
  }
  return next;
}

function indentationBefore(raw: string, index: number): string {
  const lineStart = raw.lastIndexOf('\n', index - 1) + 1;
  const prefix = raw.slice(lineStart, index);
  return prefix.match(/^[ \t]*/u)?.[0] || '';
}

function nextNonWhitespaceIndex(raw: string, start: number): number {
  for (let index = start; index < raw.length; index += 1) {
    if (!/\s/u.test(raw[index])) return index;
  }
  return -1;
}

function previousNonWhitespaceIndex(raw: string, start: number): number {
  for (let index = start; index >= 0; index -= 1) {
    if (!/\s/u.test(raw[index])) return index;
  }
  return -1;
}

function settingsWarnings(config: SettingsConfigDraft): string[] {
  const warnings = [
    'Saving patches managed defineConfig fields in place. Custom imports, helper functions, comments outside managed properties, and LLM runtime expressions are preserved.',
    'Model runtime is shown as the current resolved value only. Edit the llm block in the config file when the project needs custom provider logic.',
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

function normalizeDisplayLlm(value: SettingsConfigDraft['llm'] | undefined): SettingsConfigDraft['llm'] {
  return {
    apiKeyEnv: 'OPENAI_API_KEY',
    baseURL: safeOptionalString(value?.baseURL),
    model: safeString(value?.model, 'gpt-4o-mini'),
    maxTokens: safeInteger(value?.maxTokens, 4096, 1, 128_000),
    temperature: safeNumber(value?.temperature, 0.3, 0, 2),
    timeout: safeInteger(value?.timeout, 60_000, 1_000, 600_000),
    retries: safeInteger(value?.retries, 3, 0, 10),
  };
}

function safeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.includes('\0')) return fallback;
  const cleaned = value.trim();
  return cleaned || fallback;
}

function safeOptionalString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.includes('\0')) return '';
  return value.trim();
}

function safeInteger(value: unknown, fallback: number, min: number, max: number): number {
  try {
    return normalizeInteger(value, 'llm.display', min, max);
  } catch {
    return fallback;
  }
}

function safeNumber(value: unknown, fallback: number, min: number, max: number): number {
  try {
    return normalizeNumber(value, 'llm.display', min, max);
  } catch {
    return fallback;
  }
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

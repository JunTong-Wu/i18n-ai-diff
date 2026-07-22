import {
  ResolvedTranslateConfig,
  TranslationRunRequest,
  TranslationStats,
} from '../types/index.js';
import { createTranslator } from './translator.js';
import { selectTargetLanguages } from './route-selector.js';

export class TranslationRunError extends Error {
  constructor(
    message: string,
    readonly code = 'INVALID_TRANSLATION_RUN',
    readonly status = 400,
  ) {
    super(message);
    this.name = 'TranslationRunError';
  }
}

export interface TranslationRunCoreResult {
  command: string;
  stats: TranslationStats;
}

export async function runTranslationShortcut(
  config: ResolvedTranslateConfig,
  request: TranslationRunRequest,
): Promise<TranslationRunCoreResult> {
  const normalized = normalizeTranslationRunRequest(config, request);
  const command = buildTranslationRunCommand(normalized);
  const runConfig = cloneResolvedConfig(config);

  if (normalized.mode === 'master-to-master') {
    const options = normalized.masterToMaster!;
    const translator = createTranslator(runConfig);
    await translator.initialize();
    const stats = await translator.translateMaster({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      files: options.files,
      force: options.force,
    });
    return { command, stats };
  }

  if (normalized.targetLangs?.length) {
    selectTargetLanguages(runConfig, normalized.targetLangs);
  }

  const translator = createTranslator(runConfig);
  await translator.initialize();

  if (normalized.mode === 'force') {
    if (normalized.targetLangs?.length) {
      await translator.clearCacheScope({ targetLangs: runConfig.targetLangs });
    } else {
      await translator.clearCache();
    }
    translator.setForce(true);
  }

  return {
    command,
    stats: await translator.translateAll(),
  };
}

export function normalizeTranslationRunRequest(
  config: ResolvedTranslateConfig,
  request: TranslationRunRequest,
): TranslationRunRequest {
  if (!request || typeof request !== 'object') {
    throw new TranslationRunError('Translation run request is required');
  }

  if (request.mode === 'pending' || request.mode === 'force') {
    const targetLangs = uniqueStrings(request.targetLangs || []);
    const configuredTargets = new Set<string>(config.routes.flatMap(route => route.targetLangs));
    const unknown = targetLangs.filter(lang => !configuredTargets.has(lang));
    if (unknown.length > 0) {
      throw new TranslationRunError(`Target languages are not configured: ${unknown.join(', ')}`);
    }
    return {
      mode: request.mode,
      ...(targetLangs.length > 0 ? { targetLangs } : {}),
    };
  }

  if (request.mode === 'master-to-master') {
    const options = request.masterToMaster;
    if (!options) {
      throw new TranslationRunError('masterToMaster options are required');
    }
    if (config.routes.length < 2) {
      throw new TranslationRunError('Master-to-master translation is only available in multi-master mode');
    }
    const masterLangs = new Set<string>(config.routes.map(route => route.sourceLang));
    if (!masterLangs.has(options.sourceLang)) {
      throw new TranslationRunError(`Source language must be a configured master: ${options.sourceLang}`);
    }
    if (!masterLangs.has(options.targetLang)) {
      throw new TranslationRunError(`Target language must be a configured master: ${options.targetLang}`);
    }
    if (options.sourceLang === options.targetLang) {
      throw new TranslationRunError('Source and target master languages must be different');
    }

    const files = uniqueStrings(options.files || []);
    return {
      mode: 'master-to-master',
      masterToMaster: {
        sourceLang: options.sourceLang,
        targetLang: options.targetLang,
        ...(files.length > 0 ? { files } : {}),
        ...(options.force ? { force: true } : {}),
      },
    };
  }

  throw new TranslationRunError(`Unsupported translation run mode: ${(request as { mode?: string }).mode || 'unknown'}`);
}

export function buildTranslationRunCommand(request: TranslationRunRequest): string {
  if (request.mode === 'master-to-master') {
    const options = request.masterToMaster!;
    return [
      'i18n-ai-diff',
      'translate-master',
      '--from',
      shellQuote(options.sourceLang),
      '--to',
      shellQuote(options.targetLang),
      ...(options.force ? ['-f'] : []),
      ...(options.files || []).flatMap(file => ['--file', shellQuote(file)]),
    ].join(' ');
  }

  return [
    'i18n-ai-diff',
    ...(request.mode === 'force' ? ['-f'] : []),
    ...(request.targetLangs?.length ? ['-l', ...request.targetLangs.map(shellQuote)] : []),
  ].join(' ');
}

function cloneResolvedConfig(config: ResolvedTranslateConfig): ResolvedTranslateConfig {
  return {
    ...config,
    routes: config.routes.map(route => ({
      sourceLang: route.sourceLang,
      targetLangs: [...route.targetLangs],
    })),
    targetLangs: [...config.targetLangs],
    skipKeys: [...config.skipKeys],
    watch: config.watch ? { ...config.watch, ignored: config.watch.ignored ? [...config.watch.ignored] : undefined } : undefined,
    llm: { ...config.llm },
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/u.test(value)) return value;
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

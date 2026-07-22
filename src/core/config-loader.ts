/**
 * 配置加载模块
 * 支持 .ts / .js / .json / package.json 等多种配置来源
 */

import { cosmiconfig } from 'cosmiconfig';
import {
  TranslateConfig,
  ResolvedTranslateConfig,
  UserConfig,
  LLMConfig,
  WatchConfig,
  TranslationRoute,
  UserTranslationRoute,
} from '../types/index.js';
import { info } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';
import { tsImport } from 'tsx/esm/api';

const moduleName = 'i18n-translate';

export interface LoadedConfig {
  config: ResolvedTranslateConfig;
  filepath: string;
}

/**
 * 默认配置
 */
const defaultConfig: Partial<TranslateConfig> = {
  baseLang: 'en',
  targetLangs: [],
  localesDir: './locales',
  skipKeys: [],
  watch: {
    debounceMs: 300,
    ignored: ['node_modules/**', '**/*.ts'],
  },
  concurrency: 3,
  batchSize: 20,
  cachePath: '.i18n-translate-cache.json',
};

/**
 * 默认LLM配置
 */
const defaultLLMConfig: LLMConfig = {
  apiKey: '',
  model: 'gpt-4o-mini',
  maxTokens: 4096,
  temperature: 0.3,
  timeout: 60000,
  retries: 3,
};

/**
 * 加载 TypeScript/ESM 配置文件
 * 使用 tsx 的程序化 API 加载，确保打包后的 Node CLI 也能直接读取 TypeScript。
 */
async function loadTypeScriptConfig(configPath: string): Promise<TranslateConfig> {
  const module = await tsImport(path.resolve(configPath), import.meta.url);
  // tsx 在 CommonJS 项目中加载 `export default` 时可能产生两层 default 包装。
  let config: unknown = module;
  while (
    config !== null
    && typeof config === 'object'
    && Object.keys(config).length === 1
    && 'default' in config
  ) {
    const nested = (config as { default: unknown }).default;
    if (nested === config) break;
    config = nested;
  }
  return config as TranslateConfig;
}

/**
 * 加载配置文件
 * @param configPath 可选的配置文件路径
 * @returns 合并后的配置对象
 */
export async function loadConfig(configPath?: string): Promise<ResolvedTranslateConfig> {
  return (await loadConfigWithMetadata(configPath)).config;
}

/**
 * 加载配置并返回配置文件来源。供需要展示项目元数据的调用方使用。
 */
export async function loadConfigWithMetadata(
  configPath?: string,
  cwd: string = process.cwd(),
): Promise<LoadedConfig> {
  let userConfig: Partial<TranslateConfig> = {};
  let filepath = '';

  if (configPath) {
    // 如果指定了配置文件路径
    const resolvedPath = path.resolve(cwd, configPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    filepath = resolvedPath;

    // 根据文件扩展名选择加载方式
    if (resolvedPath.endsWith('.ts')) {
      userConfig = await loadTypeScriptConfig(resolvedPath);
    } else {
      // 对于 JS/JSON 文件，使用 cosmiconfig
      const explorer = cosmiconfig(moduleName);
      const result = await explorer.load(resolvedPath);
      if (result) {
        userConfig = result.config as Partial<TranslateConfig>;
      }
    }
    info(`Loaded config: ${configPath}`);
  } else {
    // 否则搜索配置文件
    const explorer = cosmiconfig(moduleName, {
      searchPlaces: [
        'package.json',
        `.${moduleName}rc`,
        `.${moduleName}rc.json`,
        `.${moduleName}rc.yaml`,
        `.${moduleName}rc.yml`,
        `.${moduleName}rc.js`,
        `.${moduleName}rc.ts`,
        `.${moduleName}rc.mjs`,
        `.${moduleName}rc.cjs`,
        `${moduleName}.config.js`,
        `${moduleName}.config.ts`,
        `${moduleName}.config.mjs`,
        `${moduleName}.config.cjs`,
      ],
      loaders: {
        '.ts': async filepath => loadTypeScriptConfig(filepath),
      },
    });

    const result = await explorer.search(cwd);
    if (!result) {
      throw new Error(
        'Config file not found. Create i18n-translate.config.ts or configure in package.json.'
      );
    }

    userConfig = result.config as Partial<TranslateConfig>;
    filepath = result.filepath;
    info(`Loaded config: ${result.filepath}`);
  }

  // 验证并合并配置
  const mergedConfig = mergeConfig(userConfig, cwd);

  // 验证配置有效性
  validateConfig(mergedConfig);

  return { config: mergedConfig, filepath };
}

/**
 * 合并用户配置与默认配置
 * @param userConfig 用户配置
 * @returns 合并后的完整配置
 */
function mergeConfig(userConfig: Partial<TranslateConfig>, cwd: string): ResolvedTranslateConfig {
  const routes = normalizeRoutes(userConfig);
  const merged: ResolvedTranslateConfig = {
    ...defaultConfig,
    ...userConfig,
    routes,
    // 保留单母版字段，避免破坏已有的程序化调用方。多母版模式下取第一条路由
    // 作为 baseLang，并把所有目标语言展开到 targetLangs。
    baseLang: routes[0]?.sourceLang || userConfig.baseLang || defaultConfig.baseLang!,
    targetLangs: routes.flatMap(route => route.targetLangs),
    llm: {
      ...defaultLLMConfig,
      ...userConfig.llm,
    },
    watch: {
      ...defaultConfig.watch,
      ...userConfig.watch,
    } as WatchConfig,
  } as ResolvedTranslateConfig;

  // 处理 localesDir 路径
  if (merged.localesDir) {
    merged.localesDir = path.resolve(cwd, merged.localesDir);
  }

  // 处理 cachePath 路径
  if (merged.cachePath) {
    merged.cachePath = path.resolve(cwd, merged.cachePath);
  }

  return merged;
}

/**
 * 将单母版模式和多母版模式统一成内部 routes 模型。
 */
function normalizeRoutes(userConfig: Partial<TranslateConfig>): TranslationRoute[] {
  if (userConfig.routes !== undefined) {
    if (userConfig.baseLang !== undefined || userConfig.targetLangs !== undefined) {
      throw new Error('Config must use either multi-master routes or single-master baseLang + targetLangs, not both');
    }
    return userConfig.routes.map(normalizeRoute);
  }

  const baseLang = userConfig.baseLang || defaultConfig.baseLang;
  const targetLangs = userConfig.targetLangs || defaultConfig.targetLangs || [];

  if (!baseLang) return [];
  return [{ sourceLang: baseLang, targetLangs: [...targetLangs] }];
}

function normalizeRoute(route: UserTranslationRoute): TranslationRoute {
  const rawRoute = route as UserTranslationRoute & { sourceLang?: string; baseLang?: string };
  if (rawRoute.sourceLang && rawRoute.baseLang && rawRoute.sourceLang !== rawRoute.baseLang) {
    throw new Error('routes entries cannot define both sourceLang and baseLang with different values');
  }
  const sourceLang = rawRoute.sourceLang || rawRoute.baseLang;
  return {
    sourceLang: sourceLang!,
    targetLangs: [...route.targetLangs],
  };
}

/**
 * 验证配置有效性
 * @param config 配置对象
 * @throws 验证失败时抛出错误
 */
function validateConfig(config: ResolvedTranslateConfig): void {
  const errors: string[] = [];

  if (!config.routes || config.routes.length === 0) {
    errors.push('routes must have at least one route (or configure baseLang + targetLangs for single-master mode)');
  }

  if (!config.localesDir) {
    errors.push('localesDir is required');
  }

  if (!config.llm?.apiKey) {
    errors.push('llm.apiKey is required (set OPENAI_API_KEY env or specify in config)');
  }

  const targetOwners = new Map<string, string>();
  const sourceLangs = new Set(config.routes.map(route => route.sourceLang));
  const seenSources = new Set<string>();
  for (const [index, route] of config.routes.entries()) {
    const label = `routes[${index}]`;
    if (!route.sourceLang) {
      errors.push(`${label}.sourceLang is required`);
    } else if (seenSources.has(route.sourceLang)) {
      errors.push(`master language ${route.sourceLang} must be configured in a single route`);
    } else {
      seenSources.add(route.sourceLang);
    }
    if (!route.targetLangs || route.targetLangs.length === 0) {
      errors.push(`${label}.targetLangs must have at least one language`);
      continue;
    }
    if (route.targetLangs.includes(route.sourceLang)) {
      errors.push(`${label}.targetLangs must not contain its sourceLang (${route.sourceLang})`);
    }

    const duplicatesInRoute = route.targetLangs.filter((lang, i) => route.targetLangs.indexOf(lang) !== i);
    for (const lang of new Set(duplicatesInRoute)) {
      errors.push(`${label}.targetLangs contains duplicate language: ${lang}`);
    }

    for (const targetLang of route.targetLangs) {
      const owner = targetOwners.get(targetLang);
      if (owner) {
        errors.push(`target language ${targetLang} is assigned to multiple masters: ${owner}, ${route.sourceLang}`);
      } else {
        targetOwners.set(targetLang, route.sourceLang);
      }
      if (sourceLangs.has(targetLang)) {
        errors.push(`language ${targetLang} cannot be both a master and a target language`);
      }
    }
  }

  // 验证数值范围
  if (config.concurrency && (config.concurrency < 1 || config.concurrency > 10)) {
    errors.push('concurrency must be between 1 and 10');
  }

  if (config.batchSize && (config.batchSize < 1 || config.batchSize > 100)) {
    errors.push('batchSize must be between 1 and 100');
  }

  if (errors.length > 0) {
    throw new Error('Config validation failed:\n' + errors.map(e => `  - ${e}`).join('\n'));
  }
}

/**
 * 辅助函数：用于 TypeScript 配置文件的类型定义
 * @param config 配置对象
 * @returns 配置对象
 */
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

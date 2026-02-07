/**
 * 配置加载模块
 * 支持 .ts / .js / .json / package.json 等多种配置来源
 */

import { cosmiconfig, CosmiconfigResult } from 'cosmiconfig';
import { TranslateConfig, UserConfig, LLMConfig, WatchConfig } from '../types/index.js';
import { info, warn } from '../utils/logger.js';
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';

const moduleName = 'i18n-translate';

/**
 * 默认配置
 */
const defaultConfig: Partial<TranslateConfig> = {
  baseLang: 'en',
  targetLangs: [],
  localesDir: './locales',
  skipKeys: [],
  watch: {
    enabled: false,
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
 * 使用动态 import() 加载
 */
async function loadTypeScriptConfig(configPath: string): Promise<TranslateConfig> {
  // 使用 tsx 加载 TypeScript 文件
  const fileUrl = pathToFileURL(path.resolve(configPath)).href;
  const module = await import(fileUrl);
  const config = module.default || module;
  return config as TranslateConfig;
}

/**
 * 加载配置文件
 * @param configPath 可选的配置文件路径
 * @returns 合并后的配置对象
 */
export async function loadConfig(configPath?: string): Promise<TranslateConfig> {
  let userConfig: Partial<TranslateConfig> = {};
  let loadedPath: string | undefined;

  if (configPath) {
    // 如果指定了配置文件路径
    const resolvedPath = path.resolve(configPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

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
    loadedPath = configPath;
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
    });

    const result = await explorer.search();
    if (!result) {
      throw new Error(
        'Config file not found. Create i18n-translate.config.ts or configure in package.json.'
      );
    }

    if (result.filepath.endsWith('.ts')) {
      userConfig = await loadTypeScriptConfig(result.filepath);
    } else {
      userConfig = result.config as Partial<TranslateConfig>;
    }
    loadedPath = result.filepath;
    info(`Loaded config: ${result.filepath}`);
  }

  // 验证并合并配置
  const mergedConfig = mergeConfig(userConfig);

  // 验证配置有效性
  validateConfig(mergedConfig);

  return mergedConfig;
}

/**
 * 合并用户配置与默认配置
 * @param userConfig 用户配置
 * @returns 合并后的完整配置
 */
function mergeConfig(userConfig: Partial<TranslateConfig>): TranslateConfig {
  const merged: TranslateConfig = {
    ...defaultConfig,
    ...userConfig,
    llm: {
      ...defaultLLMConfig,
      ...userConfig.llm,
    },
    watch: {
      ...defaultConfig.watch,
      ...userConfig.watch,
    } as WatchConfig,
  } as TranslateConfig;

  // 处理 localesDir 路径
  if (merged.localesDir) {
    merged.localesDir = path.resolve(merged.localesDir);
  }

  // 处理 cachePath 路径
  if (merged.cachePath) {
    merged.cachePath = path.resolve(merged.cachePath);
  }

  return merged;
}

/**
 * 验证配置有效性
 * @param config 配置对象
 * @throws 验证失败时抛出错误
 */
function validateConfig(config: TranslateConfig): void {
  const errors: string[] = [];

  // 验证必需字段
  if (!config.baseLang) {
    errors.push('baseLang is required');
  }

  if (!config.targetLangs || config.targetLangs.length === 0) {
    errors.push('targetLangs must have at least one language');
  }

  if (!config.localesDir) {
    errors.push('localesDir is required');
  }

  if (!config.llm?.apiKey) {
    errors.push('llm.apiKey is required (set OPENAI_API_KEY env or specify in config)');
  }

  // 验证 targetLangs 不包含 baseLang
  if (config.targetLangs.includes(config.baseLang)) {
    errors.push('targetLangs must not contain baseLang');
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

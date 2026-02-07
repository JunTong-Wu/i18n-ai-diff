export { IETFBCP47 } from './types/IETFBCP47.js';
export type { IETFBCP47Type } from './types/IETFBCP47.js';

export type {
  UserConfig,
  TranslateConfig,
  LLMConfig,
  WatchConfig,
  DiffResult,
  TranslationTask,
  TranslationResult,
  FileProcessResult,
  TranslationStats,
  FlattenedJSON,
  NestedJSON,
} from './types/index.js';

export { loadConfig, defineConfig } from './core/config-loader.js';
export { Translator, createTranslator } from './core/translator.js';
export { FileWatcher, createFileWatcher } from './core/file-watcher.js';

/**
 * 核心类型定义
 */

/**
 * LLM服务配置
 */
export interface LLMConfig {
  /** API密钥 */
  apiKey: string;
  /** API基础URL，默认为OpenAI官方 */
  baseURL?: string;
  /** 模型名称，默认为 gpt-4o-mini */
  model?: string;
  /** 最大token数 */
  maxTokens?: number;
  /** 温度参数，控制创造性 */
  temperature?: number;
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 重试次数 */
  retries?: number;
}

/**
 * 监听模式配置
 */
export interface WatchConfig {
  /** 是否启用监听 */
  enabled: boolean;
  /** 防抖延迟（毫秒） */
  debounceMs: number;
  /** 忽略的文件模式 */
  ignored?: string[];
}

import { IETFBCP47Type } from './IETFBCP47.js';

export interface TranslateConfig {
  baseLang: IETFBCP47Type;
  targetLangs: (IETFBCP47Type)[];
  localesDir: string;
  skipKeys: string[];
  llm: LLMConfig;
  watch?: WatchConfig;
  cachePath?: string;
  concurrency?: number;
  batchSize?: number;
}

export interface UserConfig {
  baseLang: IETFBCP47Type;
  targetLangs: (IETFBCP47Type)[];
  localesDir: string;
  llm: LLMConfig;
  skipKeys?: string[];
  watch?: Partial<WatchConfig>;
  cachePath?: string;
  concurrency?: number;
  batchSize?: number;
}

/**
 * 差异分析结果
 */
export interface DiffResult {
  /** 新增的键路径 */
  added: string[];
  /** 值变更的键路径 */
  modified: string[];
  /** 已删除的键路径 */
  removed: string[];
  /** 被配置跳过的键 */
  skipped: string[];
  /** 保持不变的键 */
  unchanged: string[];
}

/**
 * 翻译任务
 */
export interface TranslationTask {
  /** 键路径 */
  key: string;
  /** 原始文本（英文） */
  sourceText: string;
  /** 目标语言 */
  targetLang: string;
  /** 文件路径 */
  filePath: string;
}

/**
 * 翻译结果
 */
export interface TranslationResult {
  /** 键路径 */
  key: string;
  /** 翻译后的文本 */
  translatedText: string;
  /** 目标语言 */
  targetLang: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * 文件处理结果
 */
export interface FileProcessResult {
  /** 文件路径 */
  filePath: string;
  /** 目标语言 */
  targetLang: string;
  /** 新增数量 */
  added: number;
  /** 更新数量 */
  updated: number;
  /** 跳过数量 */
  skipped: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 翻译统计信息
 */
export interface TranslationStats {
  /** 处理的总文件数 */
  totalFiles: number;
  /** 成功的文件数 */
  successFiles: number;
  /** 失败文件数 */
  failedFiles: number;
  /** 新增键总数 */
  totalAdded: number;
  /** 更新键总数 */
  totalUpdated: number;
  /** 跳过键总数 */
  totalSkipped: number;
  /** 预估节省的token数 */
  estimatedSavedTokens: number;
  /** 实际使用的token数 */
  actualUsedTokens: number;
}

/**
 * 缓存条目
 */
export interface CacheEntry {
  /** 原文 */
  sourceText: string;
  /** 译文 */
  translatedText: string;
  /** 目标语言 */
  targetLang: string;
  /** 缓存时间戳 */
  timestamp: number;
  /** 使用的模型 */
  model: string;
}

/**
 * 缓存数据结构
 */
export interface TranslationCache {
  /** 版本号 */
  version: string;
  /** 缓存条目，键为 hash(sourceText + targetLang) */
  entries: Record<string, CacheEntry>;
}

/**
 * 扁平化的JSON对象
 * 键为点分隔的路径，如 "common.regionSelector.title"
 */
export type FlattenedJSON = Record<string, string>;

/**
 * 嵌套的JSON对象
 */
export type NestedJSON = Record<string, unknown>;

/**
 * 语言文件信息
 */
export interface LanguageFileInfo {
  /** 语言代码 */
  lang: string;
  /** 相对于localesDir的文件路径 */
  relativePath: string;
  /** 绝对文件路径 */
  absolutePath: string;
  /** 文件内容（解析后的JSON） */
  content: NestedJSON;
}

/**
 * 文件变更类型
 */
export type FileChangeType = 'add' | 'change' | 'unlink';

/**
 * 文件变更事件
 */
export interface FileChangeEvent {
  /** 变更类型 */
  type: FileChangeType;
  /** 文件路径 */
  filePath: string;
  /** 语言代码 */
  lang: string;
}

/**
 * CLI选项
 */
export interface CLIOptions {
  /** 配置文件路径 */
  config?: string;
  /** 是否启用监听模式 */
  watch?: boolean;
  /** 指定目标语言 */
  langs?: string[];
  /** 是否强制重新翻译所有内容 */
  force?: boolean;
  /** 是否显示详细日志 */
  verbose?: boolean;
  /** 是否初始化配置文件 */
  init?: boolean;
}

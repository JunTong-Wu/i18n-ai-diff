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
 * 监听参数配置。是否进入监听模式由 CLI `--watch` 显式决定。
 */
export interface WatchConfig {
  /** 防抖延迟（毫秒） */
  debounceMs: number;
  /** 忽略的文件模式 */
  ignored?: string[];
}

/**
 * Project language identifier.
 *
 * Runtime validation accepts safe single-segment identifiers such as standard
 * BCP 47 tags (`zh-CN`, `pt-BR`) and project-specific variants (`zh_CN`,
 * `en_US`). Values are used as locale directory names, cache owners, and panel
 * labels, so callers should avoid path separators and other unsafe characters.
 */
export type LanguageCode = string;

/**
 * 翻译路由：一个源语言母版对应一组目标语言
 */
export interface TranslationRoute {
  /** 母版语言 */
  sourceLang: LanguageCode;
  /** 由该母版生成的目标语言 */
  targetLangs: LanguageCode[];
}

/**
 * 旧版多母版 route 字段。仅用于读取兼容；运行时会归一化为 TranslationRoute.sourceLang。
 */
export interface LegacyTranslationRoute {
  /** @deprecated 多母版 routes 请使用 sourceLang */
  baseLang: LanguageCode;
  targetLangs: LanguageCode[];
  sourceLang?: never;
}

export type UserTranslationRoute = TranslationRoute | LegacyTranslationRoute;

export interface TranslateConfig {
  /**
   * 翻译路由。通过 loadConfig 加载时始终存在；程序化 API 仍允许省略并使用单母版字段。
   */
  routes?: UserTranslationRoute[];
  /** 单母版兼容字段；多母版配置加载后为第一条路由的源语言 */
  baseLang: LanguageCode;
  /** 单母版兼容字段；多母版配置加载后为所有路由的目标语言 */
  targetLangs: LanguageCode[];
  localesDir: string;
  skipKeys: string[];
  llm: LLMConfig;
  prompt?: string;
  watch?: WatchConfig;
  cachePath?: string;
  concurrency?: number;
  batchSize?: number;
}

/** 已完成默认值合并和路由归一化的运行时配置 */
export interface ResolvedTranslateConfig extends Omit<TranslateConfig, 'routes'> {
  routes: TranslationRoute[];
}

interface UserConfigBase {
  localesDir: string;
  llm: LLMConfig;
  prompt?: string;
  skipKeys?: string[];
  watch?: Partial<WatchConfig>;
  cachePath?: string;
  concurrency?: number;
  batchSize?: number;
}

/** 用户配置：多母版模式和单母版模式二选一 */
export type UserConfig = UserConfigBase & (
  | {
      /** 多母版模式 */
      routes: UserTranslationRoute[];
      baseLang?: never;
      targetLangs?: never;
    }
  | {
      /** 单母版模式 */
      routes?: never;
      baseLang: LanguageCode;
      targetLangs: LanguageCode[];
    }
);

/**
 * 差异分析结果
 */
export interface DiffResult {
  /** 新增的键路径（RFC 6901 JSON Pointer） */
  added: string[];
  /** 值变更的键路径（RFC 6901 JSON Pointer） */
  modified: string[];
  /** 已删除的键路径（RFC 6901 JSON Pointer） */
  removed: string[];
  /** 被配置跳过的键（RFC 6901 JSON Pointer） */
  skipped: string[];
  /** 保持不变的键（RFC 6901 JSON Pointer） */
  unchanged: string[];
}

/**
 * 翻译任务
 */
export interface TranslationTask {
  /** 键路径（RFC 6901 JSON Pointer） */
  key: string;
  /** 母版源文本 */
  sourceText: string;
  /** 源语言（母版） */
  sourceLang: string;
  /** 目标语言 */
  targetLang: string;
  /** 文件路径 */
  filePath: string;
}

/**
 * 翻译结果
 */
export interface TranslationResult {
  /** 键路径（RFC 6901 JSON Pointer） */
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
  /** 源语言（母版） */
  sourceLang: string;
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
 * 面板中的跨文件 CLI 快捷运行模式。
 * 与 table editor 的单元格候选翻译不同，这些模式会按 CLI 语义直接写入本地文件。
 */
export type TranslationRunMode = 'pending' | 'force' | 'master-to-master';

export interface MasterToMasterRunOptions {
  /** 一次性翻译来源母版 */
  sourceLang: string;
  /** 一次性翻译目标母版 */
  targetLang: string;
  /** 限制到一个或多个逻辑 JSON 文件 */
  files?: string[];
  /** 覆盖已有目标母版文案并忽略缓存 */
  force?: boolean;
}

export interface TranslationRunRequest {
  /** CLI 快捷运行模式 */
  mode: TranslationRunMode;
  /** pending / force 模式下要处理的已配置目标语言；省略表示全部目标语言 */
  targetLangs?: string[];
  /** master-to-master 模式参数 */
  masterToMaster?: MasterToMasterRunOptions;
}

export interface TranslationRunResult {
  /** 等价 CLI 命令 */
  command: string;
  /** 本次运行后的翻译统计 */
  stats: TranslationStats;
  /** 运行后重新扫描到的项目状态 */
  project: ProjectScan;
}

export type TranslationRunJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface TranslationRunJob {
  id: string;
  status: TranslationRunJobStatus;
  createdAt: string;
  updatedAt: string;
  request: TranslationRunRequest;
  command: string;
  stats?: TranslationStats;
  project?: ProjectScan;
  error?: string;
}

/**
 * 面板设置页可视化编辑的翻译路由。
 */
export interface SettingsRouteDraft {
  /** 母版语言 */
  sourceLang: string;
  /** 由该母版生成的目标语言 */
  targetLangs: string[];
}

/**
 * 面板设置页展示的 LLM 运行时配置。
 * apiKey 不在面板中展示；Settings 保存不会重写用户配置中的 llm 块。
 */
export interface SettingsLLMDraft {
  apiKeyEnv: 'OPENAI_API_KEY';
  baseURL?: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
  retries: number;
}

export interface SettingsWatchDraft {
  debounceMs: number;
  ignored: string[];
}

/**
 * i18n-translate.config.* 的可视化配置草稿。
 * Settings 保存只 patch 托管字段；llm 随草稿回传用于展示，但不会写回源码。
 */
export interface SettingsConfigDraft {
  routes: SettingsRouteDraft[];
  localesDir: string;
  skipKeys: string[];
  llm: SettingsLLMDraft;
  prompt: string;
  watch: SettingsWatchDraft;
  cachePath: string;
  concurrency: number;
  batchSize: number;
}

export interface SettingsConfigFile {
  writeToken: string;
  projectRoot: string;
  configPath: string;
  revision: string;
  mode: 'single-master' | 'multi-master';
  config: SettingsConfigDraft;
  /** 安全预览文本；只展示托管字段，不包含从用户配置解析出的密钥字面量 */
  raw: string;
  /** @deprecated 兼容旧前端字段名；现在表示安全的托管字段预览，而不是完整标准配置源码。 */
  standardConfigPreview: string;
  canWrite: boolean;
  saveUnsupportedReason?: string;
  restartRequired: boolean;
  warnings: string[];
}

export interface SettingsConfigSaveRequest {
  revision: string;
  config: SettingsConfigDraft;
}

export interface SettingsConfigSaveResult {
  configPath: string;
  revision: string;
  config: SettingsConfigDraft;
  raw: string;
  standardConfigPreview: string;
  restartRequired: true;
  warnings: string[];
}

/**
 * 缓存条目
 */
export interface CacheEntry {
  /** 原文 */
  sourceText: string;
  /** 源语言（母版） */
  sourceLang: string;
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
 * 键为 RFC 6901 JSON Pointer，如 "/common/regionSelector/title"
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

export interface TranslationFilePlan {
  relativePath: string;
  sourceLang: string;
  targetLang: string;
  targetExists: boolean;
  needsWrite: boolean;
  counts: {
    source: number;
    added: number;
    modified: number;
    removed: number;
    skipped: number;
    unchanged: number;
  };
  keys: {
    added: string[];
    modified: string[];
    removed: string[];
  };
}

export interface TranslationTargetPlan {
  targetLang: string;
  fileTasks: number;
  existingFiles: number;
  pendingFiles: number;
  pendingKeys: number;
  removedKeys: number;
}

export interface TranslationRoutePlan {
  sourceLang: string;
  targetLangs: string[];
  sourceFiles: number;
  sourceKeys: number;
  fileTasks: number;
  pendingFiles: number;
  pendingKeys: number;
  removedKeys: number;
  targets: TranslationTargetPlan[];
}

export interface ProjectStateFile {
  path: string;
  exists: boolean;
  version: string | number | null;
  entries?: number;
}

export interface ProjectScan {
  projectRoot: string;
  configPath: string;
  mode: 'single-master' | 'multi-master';
  localesDir: string;
  model: string;
  scannedAt: string;
  routes: TranslationRoutePlan[];
  changes: TranslationFilePlan[];
  cache: ProjectStateFile;
  snapshot: ProjectStateFile;
  totals: {
    routes: number;
    languages: number;
    sourceFiles: number;
    sourceKeys: number;
    fileTasks: number;
    pendingFiles: number;
    pendingKeys: number;
    removedKeys: number;
  };
}

export interface EditorRouteColumn {
  sourceLang: string;
  languages: string[];
}

export interface EditorManifestFile {
  relativePath: string;
  presentLanguages: string[];
  missingLanguages: string[];
  invalidLanguages: string[];
  keyCount: number;
  pendingKeys: number;
}

export interface EditorManifest {
  writeToken: string;
  projectRoot?: string;
  routes: EditorRouteColumn[];
  languages: string[];
  files: EditorManifestFile[];
}

export type EditorCellKind = 'string' | 'empty' | 'missing' | 'unsupported';

export interface EditorCell {
  kind: EditorCellKind;
  value?: string;
  pending: boolean;
  skipped: boolean;
}

export interface EditorRow {
  id: string;
  pointer: string;
  segments: string[];
  displayPath: string;
  cells: Record<string, EditorCell>;
}

export interface EditorFile {
  relativePath: string;
  revisions: Record<string, string | null>;
  snapshotRevision: string | null;
  rows: EditorRow[];
}

export type EditorSearchStateFilter = 'pending' | 'empty' | 'missing' | 'skipped' | 'master' | 'target';

export interface EditorSearchRequest {
  query: string;
  languages?: string[];
  states?: EditorSearchStateFilter[];
  includeKeys?: boolean;
  limit?: number;
}

export interface EditorSearchMatchRange {
  start: number;
  end: number;
}

export interface EditorSearchResult {
  relativePath: string;
  pointer: string;
  segments: string[];
  displayPath: string;
  lang: string;
  sourceLang: string;
  isMaster: boolean;
  value: string;
  valueMatchRanges: EditorSearchMatchRange[];
  keyMatchRanges: EditorSearchMatchRange[];
  cell: EditorCell;
}

export interface EditorSearchResponse {
  query: string;
  results: EditorSearchResult[];
  total: number;
  limit: number;
  limited: boolean;
  searchedFiles: number;
}

export interface EditorPatch {
  lang: string;
  pointer: string;
  value: string;
}

export interface EditorAcceptedTranslation {
  lang: string;
  pointer: string;
  sourceLang: string;
  sourceText: string;
  translatedText: string;
}

export interface EditorSaveRequest {
  relativePath: string;
  revisions: Record<string, string | null>;
  snapshotRevision: string | null;
  changes: EditorPatch[];
  acceptedTranslations?: EditorAcceptedTranslation[];
}

export interface EditorSaveResult {
  savedLanguages: string[];
  snapshotUpdated: boolean;
  file: EditorFile;
  project: ProjectScan;
}

export interface EditorTranslateCell {
  lang: string;
  pointer: string;
}

export interface EditorTranslateOptions {
  overwriteDrafts?: boolean;
  forceRetranslate?: boolean;
}

export interface EditorTranslateRequest {
  relativePath: string;
  revisions: Record<string, string | null>;
  snapshotRevision: string | null;
  cells: EditorTranslateCell[];
  drafts?: EditorPatch[];
  options?: EditorTranslateOptions;
}

export interface EditorMasterTranslateOptions extends EditorTranslateOptions {
  overwriteExisting?: boolean;
}

export interface EditorMasterTranslateRequest {
  relativePath: string;
  revisions: Record<string, string | null>;
  snapshotRevision: string | null;
  sourceLang: string;
  targetLang: string;
  pointers: string[];
  drafts?: EditorPatch[];
  options?: EditorMasterTranslateOptions;
}

export type EditorTranslateResultStatus = 'translated' | 'skipped' | 'failed';

export interface EditorTranslateResult {
  lang: string;
  pointer: string;
  sourceLang?: string;
  sourceText?: string;
  translatedText?: string;
  fromCache?: boolean;
  status: EditorTranslateResultStatus;
  reason?: string;
  error?: string;
}

export type EditorTranslateJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface EditorTranslateJob {
  id: string;
  status: EditorTranslateJobStatus;
  createdAt: string;
  updatedAt: string;
  total: number;
  completed: number;
  results: EditorTranslateResult[];
  error?: string;
}

export type EditorSyncEventSource = 'filesystem' | 'browser';

export interface EditorFileSyncEvent {
  type: 'editor:file-changed';
  id: string;
  timestamp: string;
  source: EditorSyncEventSource;
  relativePath: string;
  languages: string[];
  changes: FileChangeType[];
}

export type EditorProjectSyncReason =
  | 'config'
  | 'cache'
  | 'snapshot'
  | 'locales-bulk'
  | 'watcher-error';

export interface EditorProjectSyncEvent {
  type: 'editor:project-changed';
  id: string;
  timestamp: string;
  source: EditorSyncEventSource;
  reason: EditorProjectSyncReason;
  relativePaths: string[];
  languages: string[];
  count: number;
}

export type EditorSyncEvent = EditorFileSyncEvent | EditorProjectSyncEvent;

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
  /** CLI -w/--watch 标记 */
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

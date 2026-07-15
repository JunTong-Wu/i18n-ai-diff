/**
 * 核心翻译引擎模块
 * 协调差异分析、缓存、LLM调用和结果合并
 */

import {
  TranslateConfig,
  ResolvedTranslateConfig,
  TranslationTask,
  FileProcessResult,
  TranslationStats,
  NestedJSON,
} from '../types/index.js';
import { LLMClient, createLLMClient } from '../llm/client.js';
import { batchTasksByTokenLimit } from '../llm/prompt-builder.js';
import { CacheManager, createCacheManager } from '../utils/cache-manager.js';
import {
  analyzeDiff,
  loadSnapshot,
  saveSnapshot,
  updateSnapshot,
  removeSnapshotKeys,
  removeSnapshotFile,
  setSnapshotOwner,
} from './diff-analyzer.js';
import { flatten, unflatten } from '../utils/json-utils.js';
import chalk from 'chalk';
import { info, warn, debug } from '../utils/logger.js';
import { FailureLogger, createFailureLogger } from '../utils/failure-logger.js';
import { ProgressBar, createProgressBar } from '../utils/progress-bar.js';
import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';

/**
 * 翻译引擎类
 */
export class Translator {
  private config: ResolvedTranslateConfig;
  private llmClient: LLMClient;
  private cacheManager: CacheManager;
  private failureLogger: FailureLogger;
  private limit: ReturnType<typeof pLimit>;
  private force: boolean = false;

  constructor(config: TranslateConfig) {
    this.config = resolveRuntimeConfig(config);
    this.llmClient = createLLMClient(this.config.llm);
    if (this.config.prompt) {
      this.llmClient.setCustomPrompt(this.config.prompt);
    }
    this.cacheManager = createCacheManager(this.config.cachePath || '.i18n-translate-cache.json');
    this.failureLogger = createFailureLogger('.i18n-translate-failures.json');
    this.limit = pLimit(this.config.concurrency || 5);
  }

  /**
   * 设置强制模式
   * @param force 是否强制重新翻译
   */
  setForce(force: boolean): void {
    this.force = force;
  }

  /**
   * 设置详细模式（记录失败的提示词和响应）
   * @param verbose 是否详细模式
   */
  setVerbose(verbose: boolean): void {
    this.failureLogger = createFailureLogger('.i18n-translate-failures.json', verbose);
  }

  /**
   * 初始化翻译引擎（加载缓存等）
   */
  async initialize(): Promise<void> {
    await this.cacheManager.load();
    await loadSnapshot(this.config.cachePath || '.i18n-translate-cache.json');
  }

  /**
   * 执行完整翻译流程
   * @returns 翻译统计信息
   */
  async translateAll(): Promise<TranslationStats> {
    const stats: TranslationStats = {
      totalFiles: 0,
      successFiles: 0,
      failedFiles: 0,
      totalAdded: 0,
      totalUpdated: 0,
      totalSkipped: 0,
      estimatedSavedTokens: 0,
      actualUsedTokens: 0,
    };

    // 获取所有需要处理的文件
    const files = await this.getAllFiles();
    stats.totalFiles = files.length;

    if (files.length === 0) {
      info('No files to translate');
      return stats;
    }

    info(`Found ${files.length} target files to process`);

    // 创建总体进度条
    const progressBar = createProgressBar({
      total: files.length,
      width: 30,
      title: 'Translating',
    });

    const filePromises = files.map(async fileInfo => {
      const tag = chalk.cyan(`[${fileInfo.sourceLang}→${fileInfo.targetLang}/${fileInfo.relativePath}]`);
      const result = await this.translateFile(
        fileInfo.relativePath,
        fileInfo.targetLang,
        progressBar,
        tag,
        fileInfo.sourceLang,
      );
      if (result.success) {
        progressBar.increment(`${chalk.green('✓')} ${tag} +${result.added} ~${result.updated} ↷${result.skipped}`);
      } else {
        progressBar.increment(`${chalk.red('✗')} ${tag} ${result.error}`);
      }
      return result;
    });

    const fileResults = await Promise.all(filePromises);
    progressBar.complete();

    for (const result of fileResults) {
      if (result.success) {
        stats.successFiles++;
        stats.totalAdded += result.added;
        stats.totalUpdated += result.updated;
        stats.totalSkipped += result.skipped;
      } else {
        stats.failedFiles++;
      }
    }

    const pruned = await this.pruneCache();
    if (pruned > 0) {
      info(`Pruned ${pruned} orphaned cache entries`);
    }

    await this.cacheManager.save();
    await saveSnapshot();

    await this.flushFailures();

    return stats;
  }

  /**
   * 翻译单个文件
   * @param relativePath 相对于 localesDir 的文件路径
   * @param targetLang 目标语言
   * @returns 处理结果
   */
  async translateFile(
    relativePath: string,
    targetLang: string,
    progressBar?: ProgressBar,
    tag?: string,
    sourceLang?: string,
  ): Promise<FileProcessResult> {
    const resolvedSourceLang = sourceLang || this.resolveSourceLang(targetLang);
    const result: FileProcessResult = {
      filePath: relativePath,
      targetLang,
      sourceLang: resolvedSourceLang,
      added: 0,
      updated: 0,
      skipped: 0,
      success: false,
    };

    try {
      // 读取基准文件和目标文件
      const baseFilePath = path.join(this.config.localesDir, resolvedSourceLang, relativePath);
      const targetFilePath = path.join(this.config.localesDir, targetLang, relativePath);

      let baseContent: NestedJSON;
      let targetContent: NestedJSON | null = null;

      try {
        const baseData = await fs.readFile(baseFilePath, 'utf-8');
        baseContent = JSON.parse(baseData);
      } catch (error) {
        throw new Error(`Failed to read base file: ${baseFilePath} - ${(error as Error).message}`);
      }

      try {
        const targetData = await fs.readFile(targetFilePath, 'utf-8');
        targetContent = JSON.parse(targetData);
      } catch {
        // 目标文件不存在，将创建新文件
        targetContent = null;
      }

      const diff = analyzeDiff(
        baseContent,
        this.force ? null : targetContent,
        this.config.skipKeys,
        relativePath,
        targetLang,
        resolvedSourceLang,
      );

      result.added = diff.added.length;
      result.updated = diff.modified.length;
      result.skipped = diff.skipped.length;

      const baseFlattened = flatten(baseContent);
      const targetFlattened = targetContent ? flatten(targetContent) : {};
      const skippedNeedsSync = diff.skipped.some(
        key => targetFlattened[key] !== baseFlattened[key]
      );

      for (const key of diff.unchanged) {
        updateSnapshot(relativePath, targetLang, key, baseFlattened[key], resolvedSourceLang);
      }
      if (diff.removed.length > 0) {
        removeSnapshotKeys(relativePath, targetLang, diff.removed, resolvedSourceLang);
      }

      if (diff.added.length === 0 && diff.modified.length === 0) {
        if (diff.removed.length > 0 || skippedNeedsSync || targetContent === null) {
          const mergedContent = this.mergeTranslations(baseContent, targetContent, new Map(), diff.skipped);
          await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
          await fs.writeFile(targetFilePath, JSON.stringify(mergedContent, null, 2), 'utf-8');
        }
        setSnapshotOwner(relativePath, targetLang, resolvedSourceLang);
        result.success = true;
        return result;
      }

      const tasks: TranslationTask[] = [];
      for (const key of [...diff.added, ...diff.modified]) {
        tasks.push({
          key,
          sourceText: baseFlattened[key],
          sourceLang: resolvedSourceLang,
          targetLang,
          filePath: relativePath,
        });
      }

      const translations = await this.executeTranslations(tasks, progressBar, tag);

      for (const key of translations.keys()) {
        const task = tasks.find(t => t.key === key);
        if (task) {
          updateSnapshot(relativePath, targetLang, key, task.sourceText, resolvedSourceLang);
        }
      }
      if (translations.size === tasks.length) {
        setSnapshotOwner(relativePath, targetLang, resolvedSourceLang);
      }

      const mergedContent = this.mergeTranslations(
        baseContent,
        targetContent,
        translations,
        diff.skipped
      );

      // 确保目标目录存在
      await fs.mkdir(path.dirname(targetFilePath), { recursive: true });

      // 写入文件
      await fs.writeFile(targetFilePath, JSON.stringify(mergedContent, null, 2), 'utf-8');

      const failedTranslations = tasks.length - translations.size;
      result.success = failedTranslations === 0;
      if (failedTranslations > 0) {
        result.error = `${failedTranslations} of ${tasks.length} keys failed to translate`;
      }

    } catch (error) {
      result.success = false;
      result.error = (error as Error).message;
    }

    return result;
  }

  /**
   * 执行翻译任务（带缓存检查）
   * @param tasks 翻译任务列表
   * @returns 翻译结果映射（key -> translatedText）
   */
  private async executeTranslations(tasks: TranslationTask[], progressBar?: ProgressBar, tag?: string): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const tasksToTranslate: TranslationTask[] = [];
    const log = (msg: string) => {
      const line = tag ? `${tag} ${msg}` : msg;
      if (progressBar) progressBar.log(line);
      else info(msg);
    };

    for (const task of tasks) {
      const cached = this.cacheManager.get(task.sourceText, task.targetLang, task.sourceLang);
      if (cached) {
        results.set(task.key, cached);
      } else {
        tasksToTranslate.push(task);
      }
    }

    if (tasksToTranslate.length === 0) {
      return results;
    }

    log(`${tasksToTranslate.length} keys (${tasks.length - tasksToTranslate.length} cached)`);

    const batches = batchTasksByTokenLimit(tasksToTranslate, this.config.batchSize || 20);

    const allBatchResults = await Promise.all(
      batches.map((batch, i) =>
        this.limit(() => {
          debug(`Batch ${i + 1}/${batches.length} (${batch.length} tasks)`);
          return this.llmClient.translateBatch(batch);
        })
      )
    );

    for (let i = 0; i < allBatchResults.length; i++) {
      const batch = batches[i];
      for (const res of allBatchResults[i]) {
        if (res.success) {
          results.set(res.key, res.translatedText);
          const task = batch.find(t => t.key === res.key);
          if (task) {
            this.cacheManager.set(
              task.sourceText,
              res.translatedText,
              task.targetLang,
              this.config.llm.model || 'unknown',
              task.sourceLang,
            );
          }
        } else {
          log(chalk.yellow(`⚠ ${res.key}: ${res.error}`));
          const failedTask = batch.find(t => t.key === res.key);
          if (failedTask) {
            this.failureLogger.recordFailure(failedTask, res.error || 'Unknown error');
          }
        }
      }
    }

    return results;
  }

  /**
   * 合并翻译结果到目标内容
   * @param baseContent 基准内容
   * @param targetContent 目标内容（可能为null）
   * @param translations 翻译结果
   * @param skippedKeys 跳过的键
   * @returns 合并后的内容
   */
  private mergeTranslations(
    baseContent: NestedJSON,
    targetContent: NestedJSON | null,
    translations: Map<string, string>,
    skippedKeys: string[]
  ): NestedJSON {
    // 从基准内容开始
    const baseFlattened = flatten(baseContent);
    const targetFlattened = targetContent ? flatten(targetContent) : {};
    const result: Record<string, string> = {};

    // 复制所有基准键
    for (const key in baseFlattened) {
      if (translations.has(key)) {
        // 优先使用翻译结果（如果翻译成功）
        result[key] = translations.get(key)!;
      } else if (skippedKeys.includes(key)) {
        // 跳过键保持母版原文
        result[key] = baseFlattened[key];
      } else if (targetFlattened[key] && targetFlattened[key] !== baseFlattened[key]) {
        // 目标文件中有值且与母版原文不同，保持现有翻译
        result[key] = targetFlattened[key];
      } else {
        // 否则使用母版原文（未翻译或新键）
        result[key] = baseFlattened[key];
      }
    }

    // 转换回嵌套结构
    return unflatten(result);
  }

  /**
   * 获取所有需要处理的文件
   * @returns 文件信息列表
   */
  private async getAllFiles(): Promise<Array<{ relativePath: string; sourceLang: string; targetLang: string }>> {
    const files: Array<{ relativePath: string; sourceLang: string; targetLang: string }> = [];

    for (const route of this.config.routes) {
      const baseDir = path.join(this.config.localesDir, route.baseLang);
      try {
        const jsonFiles = await this.scanJsonFiles(baseDir);

        for (const relativePath of jsonFiles) {
          for (const targetLang of route.targetLangs) {
            files.push({ relativePath, sourceLang: route.baseLang, targetLang });
          }
        }
      } catch (error) {
        throw new Error(`Failed to scan master directory ${route.baseLang}: ${(error as Error).message}`);
      }
    }

    return files;
  }

  /**
   * 递归扫描 JSON 文件
   * @param dir 目录路径
   * @param basePath 基础路径（用于计算相对路径）
   * @returns 相对路径列表
   */
  private async scanJsonFiles(dir: string, basePath: string = dir): Promise<string[]> {
    const files: string[] = [];

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      if (entry.isDirectory()) {
        const subFiles = await this.scanJsonFiles(fullPath, basePath);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(relativePath);
      }
    }

    return files;
  }

  private async pruneCache(): Promise<number> {
    const activeKeys = new Set<string>();
    for (const route of this.config.routes) {
      const baseDir = path.join(this.config.localesDir, route.baseLang);
      const jsonFiles = await this.scanJsonFiles(baseDir);

      for (const relativePath of jsonFiles) {
        const filePath = path.join(baseDir, relativePath);
        try {
          const data = await fs.readFile(filePath, 'utf-8');
          const content = JSON.parse(data) as NestedJSON;
          const flattened = flatten(content);
          for (const value of Object.values(flattened)) {
            for (const lang of route.targetLangs) {
              activeKeys.add(this.cacheManager.generateKey(value, lang, route.baseLang));
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }

    return this.cacheManager.prune(activeKeys);
  }

  getCacheStats(): ReturnType<CacheManager['getStats']> {
    return this.cacheManager.getStats();
  }

  /**
   * 清空缓存
   */
  async clearCache(): Promise<void> {
    this.cacheManager.clear();
    await this.cacheManager.save();
  }

  async saveCache(): Promise<void> {
    await this.cacheManager.save();
    await saveSnapshot();
    await this.flushFailures();
  }

  private async flushFailures(): Promise<void> {
    const failureCount = this.failureLogger.getFailureCount();
    if (failureCount === 0) return;
    await this.failureLogger.save();
    warn(`${failureCount} keys failed, see .i18n-translate-failures.md`);
    this.failureLogger.clear();
  }

  /**
   * 删除某条路由对应的目标文件及其快照。供监听模式处理母版文件删除事件。
   */
  async removeTargetFile(relativePath: string, targetLang: string): Promise<void> {
    const targetFilePath = path.join(this.config.localesDir, targetLang, relativePath);
    await fs.rm(targetFilePath, { force: true });
    removeSnapshotFile(relativePath, targetLang);
  }

  private resolveSourceLang(targetLang: string): string {
    const route = this.config.routes.find(candidate => candidate.targetLangs.some(lang => lang === targetLang));
    if (!route) {
      throw new Error(`No master route configured for target language: ${targetLang}`);
    }
    return route.baseLang;
  }
}

/**
 * 创建翻译引擎实例的工厂函数
 * @param config 翻译配置
 * @returns Translator 实例
 */
export function createTranslator(config: TranslateConfig): Translator {
  return new Translator(config);
}

function resolveRuntimeConfig(config: TranslateConfig): ResolvedTranslateConfig {
  const routes = config.routes?.length
    ? config.routes.map(route => ({ ...route, targetLangs: [...route.targetLangs] }))
    : [{ baseLang: config.baseLang, targetLangs: [...config.targetLangs] }];

  return {
    ...config,
    routes,
    baseLang: routes[0].baseLang,
    targetLangs: routes.flatMap(route => route.targetLangs),
  };
}

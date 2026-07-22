/**
 * 文件监听模块
 * 集成 chokidar，支持防抖和热更新
 */

import chokidar from 'chokidar';
import { TranslateConfig, ResolvedTranslateConfig } from '../types/index.js';
import { Translator } from './translator.js';
import { info, warn, error as logError, success, printWatchStart, printFileChange, printDivider } from '../utils/logger.js';
import path from 'path';

/**
 * 文件监听器类
 */
export class FileWatcher {
  private config: ResolvedTranslateConfig;
  private translator: Translator;
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanges: Map<string, { type: 'add' | 'change' | 'unlink'; sourceLang: string }> = new Map();
  private processing = false;

  constructor(config: TranslateConfig, translator: Translator) {
    const routes = config.routes?.length
      ? config.routes.map(route => {
          const rawRoute = route as typeof route & { sourceLang?: string; baseLang?: string };
          return {
            sourceLang: rawRoute.sourceLang || rawRoute.baseLang!,
            targetLangs: [...route.targetLangs],
          };
        })
      : [{ sourceLang: config.baseLang, targetLangs: config.targetLangs }];
    this.config = { ...config, routes };
    this.translator = translator;
  }

  /**
   * 启动文件监听
   */
  async start(): Promise<void> {
    if (this.watcher) {
      warn('Watcher is already running');
      return;
    }

    const watchConfig = this.config.watch || { debounceMs: 300 };
    const sourceLangs = [...new Set(this.config.routes.map(route => route.sourceLang))];
    const sourceDirs = sourceLangs.map(lang => path.join(this.config.localesDir, lang));

    info(`Watching masters: ${sourceLangs.join(', ')}`);

    this.watcher = chokidar.watch(sourceDirs, {
      ignored: watchConfig.ignored || ['node_modules/**', '**/*.ts'],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    // 绑定事件处理器
    this.watcher
      .on('add', (filePath) => this.handleChange(filePath, 'add'))
      .on('change', (filePath) => this.handleChange(filePath, 'change'))
      .on('unlink', (filePath) => this.handleChange(filePath, 'unlink'))
      .on('error', (error) => logError('Watch error:', error.message))
      .on('ready', () => {
        printWatchStart();
      });

    // 保持进程运行
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /**
   * 停止文件监听
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      info('File watcher stopped');
    }

    // 退出进程
    process.exit(0);
  }

  /**
   * 处理文件变更事件
   * @param filePath 文件路径
   * @param changeType 变更类型
   */
  private handleChange(filePath: string, changeType: 'add' | 'change' | 'unlink'): void {
    // 只处理 JSON 文件
    if (!filePath.endsWith('.json')) {
      return;
    }

    const sourceLang = this.resolveSourceLang(filePath);
    if (!sourceLang) {
      warn(`Ignored change outside configured master directories: ${filePath}`);
      return;
    }

    printFileChange(filePath, changeType);

    // 添加到待处理队列
    this.pendingChanges.set(filePath, { type: changeType, sourceLang });

    // 防抖处理
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const debounceMs = this.config.watch?.debounceMs || 300;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.processPendingChanges();
    }, debounceMs);
  }

  /**
   * 处理待处理的变更
   */
  private async processPendingChanges(): Promise<void> {
    if (this.processing || this.pendingChanges.size === 0) {
      return;
    }

    this.processing = true;
    try {
      while (this.pendingChanges.size > 0) {
        const changes = Array.from(this.pendingChanges.entries());
        this.pendingChanges.clear();
        let failedTargets = 0;

        info(`Processing ${changes.length} changed files...`);

        for (const [filePath, change] of changes) {
          const sourceLangDir = path.join(this.config.localesDir, change.sourceLang);
          const relativePath = path.relative(sourceLangDir, filePath);
          const targetLangs = this.config.routes
            .filter(route => route.sourceLang === change.sourceLang)
            .flatMap(route => route.targetLangs);

          for (const targetLang of targetLangs) {
            try {
              if (change.type === 'unlink') {
                await this.translator.removeTargetFile(relativePath, targetLang);
              } else {
                const result = await this.translator.translateFile(
                  relativePath,
                  targetLang,
                  undefined,
                  undefined,
                  change.sourceLang,
                );
                if (!result.success) {
                  throw new Error(result.error || 'Translation failed');
                }
              }
            } catch (error) {
              failedTargets++;
              logError(
                `Failed to process ${change.sourceLang}→${targetLang}: ${relativePath}`,
                (error as Error).message,
              );
            }
          }
        }

        await this.translator.saveCache();

        if (failedTargets > 0) {
          warn(`Changes processed with ${failedTargets} failed target(s)`);
        } else {
          success('Changes processed');
        }
        printDivider();
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * 检查监听器是否在运行
   */
  isRunning(): boolean {
    return this.watcher !== null;
  }

  private resolveSourceLang(filePath: string): string | undefined {
    for (const sourceLang of new Set(this.config.routes.map(route => route.sourceLang))) {
      const sourceDir = path.join(this.config.localesDir, sourceLang);
      const relative = path.relative(sourceDir, filePath);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return sourceLang;
      }
    }
    return undefined;
  }
}

/**
 * 创建文件监听器实例的工厂函数
 * @param config 翻译配置
 * @param translator 翻译引擎实例
 * @returns FileWatcher 实例
 */
export function createFileWatcher(config: TranslateConfig, translator: Translator): FileWatcher {
  return new FileWatcher(config, translator);
}

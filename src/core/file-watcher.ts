/**
 * 文件监听模块
 * 集成 chokidar，支持防抖和热更新
 */

import chokidar from 'chokidar';
import { TranslateConfig } from '../types/index.js';
import { Translator } from './translator.js';
import { info, warn, error as logError, success, printWatchStart, printFileChange, printDivider } from '../utils/logger.js';
import path from 'path';

/**
 * 文件监听器类
 */
export class FileWatcher {
  private config: TranslateConfig;
  private translator: Translator;
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanges: Set<string> = new Set();

  constructor(config: TranslateConfig, translator: Translator) {
    this.config = config;
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

    const watchConfig = this.config.watch || { enabled: false, debounceMs: 300 };
    const baseLangDir = path.join(this.config.localesDir, this.config.baseLang);

    info(`Watching: ${baseLangDir}`);

    this.watcher = chokidar.watch(baseLangDir, {
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

    printFileChange(filePath, changeType);

    // 添加到待处理队列
    this.pendingChanges.add(filePath);

    // 防抖处理
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const debounceMs = this.config.watch?.debounceMs || 300;
    this.debounceTimer = setTimeout(() => {
      this.processPendingChanges();
    }, debounceMs);
  }

  /**
   * 处理待处理的变更
   */
  private async processPendingChanges(): Promise<void> {
    if (this.pendingChanges.size === 0) {
      return;
    }

    const changes = Array.from(this.pendingChanges);
    this.pendingChanges.clear();

    info(`Processing ${changes.length} changed files...`);

    for (const filePath of changes) {
      try {
        // 计算相对路径
        const baseLangDir = path.join(this.config.localesDir, this.config.baseLang);
        const relativePath = path.relative(baseLangDir, filePath);

        // 为每个目标语言翻译该文件
        for (const targetLang of this.config.targetLangs) {
          await this.translator.translateFile(relativePath, targetLang);
        }
      } catch (error) {
        logError(`Failed to process change: ${filePath}`, (error as Error).message);
      }
    }

    await this.translator.saveCache();

    success('Changes processed');
    printDivider();
  }

  /**
   * 检查监听器是否在运行
   */
  isRunning(): boolean {
    return this.watcher !== null;
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

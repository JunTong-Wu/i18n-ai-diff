/**
 * 缓存管理器模块
 * 管理翻译缓存，避免重复翻译
 */

import { TranslationCache } from '../types/index.js';
import { info, warn, debug } from './logger.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const CACHE_VERSION = '1.0.0';

/**
 * 缓存管理器类
 */
export class CacheManager {
  private cachePath: string;
  private cache: TranslationCache;
  private dirty = false;

  constructor(cachePath: string) {
    this.cachePath = cachePath;
    this.cache = {
      version: CACHE_VERSION,
      entries: {},
    };
  }

  /**
   * 加载缓存文件
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.cachePath, 'utf-8');
      const parsed = JSON.parse(content) as TranslationCache;
      
      // 验证版本
      if (parsed.version !== CACHE_VERSION) {
        warn(`Cache version mismatch (${parsed.version} vs ${CACHE_VERSION}), resetting`);
        this.cache = { version: CACHE_VERSION, entries: {} };
        return;
      }

      this.cache = parsed;
      debug(`Cache loaded: ${Object.keys(this.cache.entries).length} entries`);
    } catch (error) {
      // 文件不存在或其他错误，使用空缓存
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        warn(`Failed to load cache: ${(error as Error).message}`);
      }
      this.cache = { version: CACHE_VERSION, entries: {} };
    }
  }

  /**
   * 保存缓存文件
   */
  async save(): Promise<void> {
    if (!this.dirty) {
      return;
    }

    try {
      // 确保目录存在
      const dir = path.dirname(this.cachePath);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(
        this.cachePath,
        JSON.stringify(this.cache, null, 2),
        'utf-8'
      );
      
      this.dirty = false;
      debug(`Cache saved: ${Object.keys(this.cache.entries).length} entries`);
    } catch (error) {
      warn(`Failed to save cache: ${(error as Error).message}`);
    }
  }

  /**
   * 从缓存获取翻译
   * @param sourceText 原文
   * @param targetLang 目标语言
   * @returns 缓存的翻译结果，如果没有则返回 undefined
   */
  get(sourceText: string, targetLang: string): string | undefined {
    const key = this.generateKey(sourceText, targetLang);
    const entry = this.cache.entries[key];
    
    if (entry && entry.sourceText === sourceText) {
      return entry.translatedText;
    }
    
    return undefined;
  }

  /**
   * 设置缓存
   * @param sourceText 原文
   * @param translatedText 译文
   * @param targetLang 目标语言
   * @param model 使用的模型
   */
  set(sourceText: string, translatedText: string, targetLang: string, model: string): void {
    const key = this.generateKey(sourceText, targetLang);
    
    this.cache.entries[key] = {
      sourceText,
      translatedText,
      targetLang,
      timestamp: Date.now(),
      model,
    };
    
    this.dirty = true;
  }

  /**
   * 批量设置缓存
   * @param items 缓存项列表
   * @param targetLang 目标语言
   * @param model 使用的模型
   */
  setBatch(
    items: Array<{ sourceText: string; translatedText: string }>,
    targetLang: string,
    model: string
  ): void {
    for (const item of items) {
      this.set(item.sourceText, item.translatedText, targetLang, model);
    }
  }

  /**
   * 检查缓存中是否存在
   * @param sourceText 原文
   * @param targetLang 目标语言
   * @returns 是否存在
   */
  has(sourceText: string, targetLang: string): boolean {
    return this.get(sourceText, targetLang) !== undefined;
  }

  /**
   * 清除过期缓存（可选，基于时间）
   * @param maxAge 最大缓存时间（毫秒），默认30天
   */
  cleanExpired(maxAge = 30 * 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    let removedCount = 0;

    for (const key in this.cache.entries) {
      if (this.cache.entries[key].timestamp + maxAge < now) {
        delete this.cache.entries[key];
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.dirty = true;
      debug(`Removed ${removedCount} expired cache entries`);
    }
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.entries = {};
    this.dirty = true;
    info('Cache cleared');
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    totalEntries: number;
    languages: Record<string, number>;
  } {
    const languages: Record<string, number> = {};

    for (const key in this.cache.entries) {
      const lang = this.cache.entries[key].targetLang;
      languages[lang] = (languages[lang] || 0) + 1;
    }

    return {
      totalEntries: Object.keys(this.cache.entries).length,
      languages,
    };
  }

  /**
   * 生成缓存键
   * @param sourceText 原文
   * @param targetLang 目标语言
   * @returns 缓存键
   */
  private generateKey(sourceText: string, targetLang: string): string {
    // 使用简单的哈希生成键
    const hash = crypto
      .createHash('md5')
      .update(`${sourceText}:${targetLang}`)
      .digest('hex');
    return hash;
  }

  /**
   * 计算预估节省的token数
   * @param hitCount 缓存命中数
   * @returns 预估节省的token数
   */
  static estimateSavedTokens(hitCount: number): number {
    // 粗略估算：平均每个缓存命中节省约100个token
    return hitCount * 100;
  }
}

/**
 * 创建缓存管理器实例的工厂函数
 * @param cachePath 缓存文件路径
 * @returns CacheManager 实例
 */
export function createCacheManager(cachePath: string): CacheManager {
  return new CacheManager(cachePath);
}

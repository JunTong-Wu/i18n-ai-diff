/**
 * LLM 客户端模块
 * 兼容 OpenAI API 标准，支持流式响应和重试机制
 */

import OpenAI from 'openai';
import { LLMConfig, TranslationResult, TranslationTask } from '../types/index.js';
import { buildBatchPrompt, BatchPromptResult } from './prompt-builder.js';
import { info, warn, error as logError, debug } from '../utils/logger.js';

/**
 * LLM 客户端类
 */
export class LLMClient {
  private client: OpenAI;
  private config: Required<LLMConfig>;

  constructor(config: LLMConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.openai.com/v1',
      model: config.model || 'gpt-4o-mini',
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.3,
      timeout: config.timeout || 60000,
      retries: config.retries || 3,
    };

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
    });
  }

  /**
   * 执行单次翻译请求
   * @param prompt 翻译提示词
   * @returns 翻译结果文本
   */
  async translate(prompt: string): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await this.client.chat.completions.create({
          model: this.config.model,
          messages: [
            {
              role: 'system',
              content: 'You are a professional translator. Return ONLY the requested format, no explanation.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
        }, { signal: controller.signal }).finally(() => clearTimeout(timer));

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('LLM returned empty content');
        }

        return content.trim();
      } catch (error) {
        lastError = error as Error;
        const isRetryable = this.isRetryableError(error);

        if (isRetryable && attempt < this.config.retries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 指数退避
          warn(`Request failed, retrying in ${delay}ms (${attempt + 1}/${this.config.retries}): ${lastError.message}`);
          await this.sleep(delay);
        } else {
          break;
        }
      }
    }

    throw new Error(`Translation failed after ${this.config.retries} retries: ${lastError?.message}`);
  }

  /**
   * 批量翻译
   * @param tasks 翻译任务列表
   * @param promptBuilder 提示词构建函数
   * @returns 翻译结果列表
   */
  async translateBatch(
    tasks: TranslationTask[],
  ): Promise<TranslationResult[]> {
    if (tasks.length === 0) {
      return [];
    }

    const targetLang = tasks[0].targetLang;
    debug(`Batch translating ${tasks.length} texts to ${targetLang}...`);

    try {
      const { prompt, idMap } = buildBatchPrompt(tasks);
      const response = await this.translate(prompt);

      debug(`[LLM RAW] keys=${tasks.map(t=>t.key).join(',')} response=\n---\n${response}\n---`);

      return this.parseBatchResponse(response, tasks, idMap);
    } catch (error) {
      logError(`Batch translation failed: ${(error as Error).message}`);
      return tasks.map(task => ({
        key: task.key,
        translatedText: '',
        targetLang: task.targetLang,
        success: false,
        error: (error as Error).message,
      }));
    }
  }

  private parseBatchResponse(response: string, tasks: TranslationTask[], idMap: Map<string, string>): TranslationResult[] {
    const reverseMap = new Map<string, string>();
    for (const [id, key] of idMap) reverseMap.set(id, key);

    const parsed = this.extractJsonFromResponse(response);
    const resultMap = new Map<string, string>();

    if (parsed) {
      for (const [id, value] of Object.entries(parsed)) {
        const key = reverseMap.get(id);
        if (key && typeof value === 'string') {
          resultMap.set(key, value.replace(/\\n/g, '\n'));
        }
      }
    }

    if (resultMap.size < tasks.length && tasks.length === 1) {
      const cleaned = response.trim()
        .replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '').trim();
      if (cleaned && !resultMap.has(tasks[0].key)) {
        resultMap.set(tasks[0].key, cleaned);
      }
    }

    const results: TranslationResult[] = [];
    for (const task of tasks) {
      const translatedText = resultMap.get(task.key);
      if (translatedText !== undefined && translatedText !== '') {
        results.push({ key: task.key, translatedText, targetLang: task.targetLang, success: true });
      } else {
        results.push({
          key: task.key, translatedText: '', targetLang: task.targetLang,
          success: false, error: 'Translation not found in response',
        });
      }
    }
    return results;
  }

  private extractJsonFromResponse(response: string): Record<string, string> | null {
    const trimmed = response.trim();

    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // fall through
    }

    const obj: Record<string, string> = {};
    const lineRegex = /"(T\d+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = lineRegex.exec(trimmed)) !== null) {
      obj[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return Object.keys(obj).length > 0 ? obj : null;
  }

  /**
   * 检查错误是否可重试
   * @param error 错误对象
   * @returns 是否可重试
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      return error.status === 429 || error.status === 500 || error.status === 503;
    }
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('timeout') || error.message.includes('aborted'))) {
      return true;
    }
    return false;
  }

  /**
   * 延迟函数
   * @param ms 毫秒
   * @returns Promise
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 测试 LLM 连接
   * @returns 是否连接成功
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch (error) {
      logError(`LLM connection test failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * 获取当前配置
   * @returns 配置对象
   */
  getConfig(): Required<LLMConfig> {
    return { ...this.config };
  }
}

/**
 * 创建 LLM 客户端实例的工厂函数
 * @param config LLM 配置
 * @returns LLMClient 实例
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  return new LLMClient(config);
}

/**
 * 翻译失败日志记录模块
 * 记录翻译失败的键，便于开发者手动修复
 */

import { TranslationTask, TranslationResult } from '../types/index.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * 失败记录
 */
interface FailureRecord {
  key: string;
  sourceText: string;
  targetLang: string;
  filePath: string;
  error: string;
  timestamp: string;
  prompt?: string;
  response?: string;
}

/**
 * 失败日志管理器
 */
export class FailureLogger {
  private failures: FailureRecord[] = [];
  private logPath: string;
  private verbose: boolean;

  constructor(logPath: string = '.i18n-translate-failures.json', verbose: boolean = false) {
    this.logPath = path.resolve(logPath);
    this.verbose = verbose;
  }

  /**
   * 记录翻译失败
   * @param task 翻译任务
   * @param error 错误信息
   * @param prompt 可选的提示词
   * @param response 可选的 LLM 响应
   */
  recordFailure(
    task: TranslationTask,
    error: string,
    prompt?: string,
    response?: string
  ): void {
    const record: FailureRecord = {
      key: task.key,
      sourceText: task.sourceText,
      targetLang: task.targetLang,
      filePath: task.filePath,
      error,
      timestamp: new Date().toISOString(),
    };

    if (this.verbose && prompt) {
      record.prompt = prompt;
    }
    if (this.verbose && response) {
      record.response = response;
    }

    this.failures.push(record);
  }

  /**
   * 从翻译结果中批量记录失败
   * @param results 翻译结果列表
   * @param tasks 原始任务列表
   */
  recordFailuresFromResults(
    results: TranslationResult[],
    tasks: TranslationTask[],
    prompt?: string,
    response?: string
  ): void {
    const taskMap = new Map(tasks.map(t => [t.key, t]));

    for (const result of results) {
      if (!result.success) {
        const task = taskMap.get(result.key);
        if (task) {
          this.recordFailure(task, result.error || 'Unknown error', prompt, response);
        }
      }
    }
  }

  /**
   * 保存失败日志到文件
   */
  async save(): Promise<void> {
    if (this.failures.length === 0) {
      return;
    }

    try {
      // 读取现有日志（如果存在）
      let existing: FailureRecord[] = [];
      try {
        const data = await fs.readFile(this.logPath, 'utf-8');
        const parsed = JSON.parse(data);
        existing = parsed.failures || [];
      } catch {
        // 文件不存在或无效，使用空数组
      }

      // 合并并去重（基于 key + targetLang + filePath）
      const keySet = new Set(existing.map(f => `${f.key}:${f.targetLang}:${f.filePath}`));
      const newFailures = this.failures.filter(f => {
        const key = `${f.key}:${f.targetLang}:${f.filePath}`;
        if (keySet.has(key)) {
          return false;
        }
        keySet.add(key);
        return true;
      });

      const allFailures = [...existing, ...newFailures];

      // 按文件和语言分组
      const grouped = this.groupByFileAndLang(allFailures);

      // 保存 JSON 格式
      await fs.writeFile(
        this.logPath,
        JSON.stringify({
          summary: {
            totalFailures: allFailures.length,
            lastUpdated: new Date().toISOString(),
            byLanguage: this.countByLanguage(allFailures),
          },
          failures: allFailures,
          grouped,
        }, null, 2),
        'utf-8'
      );

      // 同时生成 Markdown 报告（便于阅读）
      await this.generateMarkdownReport(allFailures);
    } catch (error) {
      console.error('Failed to save failure log:', error);
    }
  }

  /**
   * 按文件和语言分组
   */
  private groupByFileAndLang(failures: FailureRecord[]): Record<string, Record<string, FailureRecord[]>> {
    const grouped: Record<string, Record<string, FailureRecord[]>> = {};

    for (const failure of failures) {
      if (!grouped[failure.filePath]) {
        grouped[failure.filePath] = {};
      }
      if (!grouped[failure.filePath][failure.targetLang]) {
        grouped[failure.filePath][failure.targetLang] = [];
      }
      grouped[failure.filePath][failure.targetLang].push(failure);
    }

    return grouped;
  }

  /**
   * 按语言统计
   */
  private countByLanguage(failures: FailureRecord[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const failure of failures) {
      counts[failure.targetLang] = (counts[failure.targetLang] || 0) + 1;
    }
    return counts;
  }

  /**
   * 生成 Markdown 报告
   */
  private async generateMarkdownReport(failures: FailureRecord[]): Promise<void> {
    const mdPath = this.logPath.replace('.json', '.md');
    const grouped = this.groupByFileAndLang(failures);

    const lines: string[] = [
      '# i18n Translation Failure Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Total failures: ${failures.length}`,
      '',
      '---',
      '',
    ];

    for (const [filePath, langGroups] of Object.entries(grouped)) {
      for (const [lang, records] of Object.entries(langGroups)) {
        lines.push(`## ${filePath} (${lang})`, '');
        lines.push('| Key | Source Text | Error |');
        lines.push('|----|------|---------|');

        for (const record of records) {
          const key = record.key.replace(/\|/g, '\\|');
          const text = record.sourceText.replace(/\|/g, '\\|').substring(0, 50);
          const error = record.error.replace(/\|/g, '\\|').substring(0, 100);
          lines.push(`| ${key} | ${text} | ${error} |`);
        }

        lines.push('');
      }
    }

    lines.push('---', '', '## Manual Fix', '', '```json');
    lines.push('// Add translations for these keys in the target language JSON files');
    lines.push('// e.g. de/common.json');
    lines.push('```', '');

    await fs.writeFile(mdPath, lines.join('\n'), 'utf-8');
  }

  /**
   * 清空失败记录
   */
  clear(): void {
    this.failures = [];
  }

  /**
   * 获取失败数量
   */
  getFailureCount(): number {
    return this.failures.length;
  }

  /**
   * 获取所有失败记录
   */
  getFailures(): FailureRecord[] {
    return [...this.failures];
  }
}

/**
 * 创建失败日志管理器的工厂函数
 */
export function createFailureLogger(logPath?: string, verbose?: boolean): FailureLogger {
  return new FailureLogger(logPath, verbose);
}

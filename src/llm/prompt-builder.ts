import { TranslationTask } from '../types/index.js';

export interface BatchPromptResult {
  prompt: string;
  idMap: Map<string, string>;
}

export function buildBatchPrompt(tasks: TranslationTask[]): BatchPromptResult {
  if (tasks.length === 0) {
    return { prompt: '', idMap: new Map() };
  }

  const targetLang = tasks[0].targetLang;
  const idMap = new Map<string, string>();

  const entries: string[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const id = `T${i + 1}`;
    idMap.set(id, tasks[i].key);
    entries.push(`"${id}": "${tasks[i].sourceText.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
  }

  const prompt = [
    `Target language BCP 47 tag: "${targetLang}". Translate the values into that language. Return ONLY a JSON object.`,
    '',
    'Input:',
    `{${entries.join(', ')}}`,
    '',
    'Output:',
    `{"T1": "translated text 1", "T2": "translated text 2"}`,
    '',
    'IMPORTANT: Return ONLY the JSON object. Keep \\n in values as \\n.',
  ].join('\n');

  return { prompt, idMap };
}

function estimateTokens(prompt: string): number {
  // 粗略估算：英文约每4个字符1个token，中文约每1个字符1个token
  const charCount = prompt.length;
  const chineseChars = (prompt.match(/[\u4e00-\u9fa5]/g) || []).length;
  const nonChineseChars = charCount - chineseChars;
  
  return Math.ceil(chineseChars + nonChineseChars / 4);
}

/**
 * 根据token限制分批任务
 * @param tasks 任务列表
 * @param maxTokens 最大token限制
 * @returns 分批后的任务数组
 */
export function batchTasksByTokenLimit(
  tasks: TranslationTask[],
  maxTokens: number = 3000
): TranslationTask[][] {
  const batches: TranslationTask[][] = [];
  let currentBatch: TranslationTask[] = [];
  let currentTokenCount = 0;

  for (const task of tasks) {
    const taskTokens = estimateTokens(`${task.key}: ${task.sourceText}`);

    // 如果单个任务超过限制，单独成批
    if (taskTokens > maxTokens) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokenCount = 0;
      }
      batches.push([task]);
      continue;
    }

    // 检查加入当前批次是否会超限
    if (currentTokenCount + taskTokens > maxTokens && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [task];
      currentTokenCount = taskTokens;
    } else {
      currentBatch.push(task);
      currentTokenCount += taskTokens;
    }
  }

  // 添加最后一批
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}


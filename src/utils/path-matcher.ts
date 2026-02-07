/**
 * 路径匹配器模块
 * 支持 glob 模式匹配嵌套路径
 */

import { minimatch } from 'minimatch';

/**
 * 检查键是否匹配跳过模式
 * @param key 点分隔的键路径，如 "common.regionSelector.title"
 * @param patterns 跳过模式列表，支持 glob 语法
 * @returns 是否匹配（应该跳过）
 * 
 * @example
 * isKeySkipped('common.brandName', ['common.brandName']) // true
 * isKeySkipped('user.@DWARFLAB', ['**.@DWARFLAB']) // true
 * isKeySkipped('error.codes.E001', ['error.codes.*']) // true
 * isKeySkipped('footer.copyright', ['footer.**']) // true
 */
export function isKeySkipped(key: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }

  for (const pattern of patterns) {
    if (matchKeyPattern(key, pattern)) {
      return true;
    }
  }

  return false;
}



/**
 * 匹配单个键路径与模式
 * @param key 键路径
 * @param pattern 匹配模式
 * @returns 是否匹配
 */
function matchKeyPattern(key: string, pattern: string): boolean {
  // 处理 ** 开头的模式（匹配任意深度）
  if (pattern.startsWith('**.')) {
    const suffix = pattern.slice(3);
    // 检查 key 是否以 suffix 结尾，或者在任意层级包含 suffix
    const parts = key.split('.');
    for (let i = 0; i < parts.length; i++) {
      const subPath = parts.slice(i).join('.');
      if (minimatch(subPath, suffix, { dot: true })) {
        return true;
      }
    }
    return false;
  }

  // 处理 ** 结尾的模式（匹配任意后缀）
  if (pattern.endsWith('.**')) {
    const prefix = pattern.slice(0, -3);
    return key.startsWith(prefix);
  }

  // 处理中间包含 ** 的模式
  if (pattern.includes('.**.')) {
    const [prefix, suffix] = pattern.split('.**.');
    if (!key.startsWith(prefix)) return false;
    
    const remaining = key.slice(prefix.length + 1);
    const remainingParts = remaining.split('.');
    
    // 检查后缀是否匹配任意后缀部分
    for (let i = 0; i < remainingParts.length; i++) {
      const subPath = remainingParts.slice(i).join('.');
      if (minimatch(subPath, suffix, { dot: true })) {
        return true;
      }
    }
    return false;
  }

  // 标准 glob 匹配
  return minimatch(key, pattern, { dot: true });
}


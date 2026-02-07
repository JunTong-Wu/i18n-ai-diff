/**
 * JSON 工具模块
 * 提供嵌套/扁平化转换、路径操作等功能
 */

import { FlattenedJSON, NestedJSON } from '../types/index.js';

/**
 * 将嵌套JSON对象扁平化为点分隔键的对象
 * @param obj 嵌套JSON对象
 * @param prefix 当前键前缀（递归使用）
 * @param result 结果对象（递归使用）
 * @returns 扁平化的键值对对象
 * 
 * @example
 * flatten({ common: { hello: 'World' } })
 * // => { 'common.hello': 'World' }
 */
export function flatten(obj: NestedJSON, prefix = '', result: FlattenedJSON = {}): FlattenedJSON {
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      continue;
    }

    const value = obj[key];
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // 递归处理嵌套对象
      flatten(value as NestedJSON, newKey, result);
    } else if (typeof value === 'string') {
      // 只处理字符串值
      result[newKey] = value;
    }
    // 忽略其他类型（数字、布尔、数组等）
  }

  return result;
}

/**
 * 将扁平化的键值对对象展开为嵌套JSON对象
 * @param flattened 扁平化的键值对
 * @returns 嵌套JSON对象
 * 
 * @example
 * unflatten({ 'common.hello': 'World', 'common.bye': 'Bye' })
 * // => { common: { hello: 'World', bye: 'Bye' } }
 */
export function unflatten(flattened: FlattenedJSON): NestedJSON {
  const result: NestedJSON = {};

  for (const key in flattened) {
    if (!Object.prototype.hasOwnProperty.call(flattened, key)) {
      continue;
    }

    const value = flattened[key];
    const parts = key.split('.');
    let current: NestedJSON = result;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        // 最后一个部分，设置值
        current[part] = value;
      } else {
        // 中间部分，创建嵌套对象
        if (!current[part] || typeof current[part] !== 'object') {
          current[part] = {};
        }
        current = current[part] as NestedJSON;
      }
    }
  }

  return result;
}


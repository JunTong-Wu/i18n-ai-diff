/**
 * JSON 工具模块
 * 提供嵌套/扁平化转换、路径操作等功能
 */

import { FlattenedJSON, NestedJSON } from '../types/index.js';

/**
 * 将嵌套 JSON 对象扁平化为 RFC 6901 JSON Pointer 键的对象。
 *
 * 点号拼接无法区分真实 key 中的 "."、"/"、"~" 与层级分隔；内部稳定 ID 统一使用
 * JSON Pointer，例如 `/common/hello`、`/section/a.b/x~1y/~0name`。
 *
 * @param obj 嵌套 JSON 对象
 * @param prefix 兼容旧调用的前缀；不建议新代码传入
 * @param result 结果对象（递归使用）
 * @returns 扁平化的键值对对象
 *
 * @example
 * flatten({ common: { hello: 'World' } })
 * // => { '/common/hello': 'World' }
 */
export function flatten(obj: NestedJSON, prefix = '', result: FlattenedJSON = {}): FlattenedJSON {
  const initialSegments = prefix
    ? (isJsonPointer(prefix) ? decodeJsonPointerPath(prefix) : prefix.split('.'))
    : [];

  const walk = (current: NestedJSON, segments: string[]) => {
    for (const key in current) {
      if (!Object.prototype.hasOwnProperty.call(current, key)) {
        continue;
      }

      const value = current[key];
      const nextSegments = [...segments, key];

      if (isPlainObject(value)) {
        walk(value as NestedJSON, nextSegments);
      } else if (typeof value === 'string') {
        result[encodeJsonPointerPath(nextSegments)] = value;
      }
      // 忽略其他类型（数字、布尔、数组等）
    }
  };

  walk(obj, initialSegments);
  return result;
}

/**
 * 将扁平化的键值对对象展开为嵌套 JSON 对象。
 *
 * 新代码应传入 JSON Pointer 键；为了读取旧缓存/测试辅助数据，仍兼容旧点分隔键。
 *
 * @param flattened 扁平化的键值对
 * @returns 嵌套 JSON 对象
 *
 * @example
 * unflatten({ '/common/hello': 'World', '/common/bye': 'Bye' })
 * // => { common: { hello: 'World', bye: 'Bye' } }
 */
export function unflatten(flattened: FlattenedJSON): NestedJSON {
  const result: NestedJSON = {};

  for (const key in flattened) {
    if (!Object.prototype.hasOwnProperty.call(flattened, key)) {
      continue;
    }

    const value = flattened[key];
    const parts = isJsonPointer(key) ? decodeJsonPointerPath(key) : key.split('.');
    let current: NestedJSON = result;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        current[part] = value;
      } else {
        if (!isPlainObject(current[part])) {
          current[part] = {};
        }
        current = current[part] as NestedJSON;
      }
    }
  }

  return result;
}

export function encodeJsonPointerPath(segments: string[]): string {
  return segments.map(segment => `/${segment.replace(/~/gu, '~0').replace(/\//gu, '~1')}`).join('');
}

export function decodeJsonPointerPath(pointer: string): string[] {
  if (!isJsonPointer(pointer)) {
    throw new Error(`Invalid JSON Pointer: ${pointer}`);
  }
  return pointer.slice(1).split('/').map(segment => {
    if (/~(?![01])/u.test(segment)) {
      throw new Error(`Invalid JSON Pointer escape: ${pointer}`);
    }
    return segment.replace(/~1/gu, '/').replace(/~0/gu, '~');
  });
}

export function jsonPointerToDotPath(pointer: string): string {
  return decodeJsonPointerPath(pointer).join('.');
}

export function isJsonPointer(value: string): boolean {
  return value.startsWith('/') && !value.includes('\0');
}

function isPlainObject(value: unknown): value is NestedJSON {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

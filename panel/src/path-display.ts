function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized || '/';
}

function pathsEqual(left: string, right: string): boolean {
  const isWindowsPath = /^[a-z]:\//i.test(left) || /^[a-z]:\//i.test(right);
  return isWindowsPath
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
}

function pathStartsWith(value: string, prefix: string): boolean {
  const isWindowsPath = /^[a-z]:\//i.test(value) || /^[a-z]:\//i.test(prefix);
  return isWindowsPath
    ? value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    : value.startsWith(prefix);
}

export function projectDirectoryName(projectRoot: string): string {
  const normalizedRoot = normalizePath(projectRoot);
  return normalizedRoot.split('/').filter(Boolean).at(-1) ?? normalizedRoot;
}

export function projectRelativePath(fullPath: string, projectRoot: string): string {
  const normalizedPath = normalizePath(fullPath);
  const normalizedRoot = normalizePath(projectRoot);

  if (pathsEqual(normalizedPath, normalizedRoot)) {
    return '.';
  }

  const rootPrefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`;
  if (!pathStartsWith(normalizedPath, rootPrefix)) {
    return fullPath;
  }

  return `./${normalizedPath.slice(rootPrefix.length)}`;
}

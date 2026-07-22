export interface EditorFileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LAST_EDITOR_FILE_BY_PROJECT_KEY = 'i18n-ai-diff:table-editor:last-file-by-project';

export function readInitialEditorPath(search: string): string {
  return new URLSearchParams(search).get('file') || '';
}

export function resolveEditorPath(
  files: string[],
  currentPath: string,
  rememberedPath: string,
): string {
  if (currentPath && files.includes(currentPath)) return currentPath;
  if (rememberedPath && files.includes(rememberedPath)) return rememberedPath;
  return files[0] || '';
}

export function readRememberedEditorPath(storage: EditorFileStorage, projectRoot?: string): string {
  try {
    const rememberedByProject = readProjectMemory(storage);
    if (projectRoot && rememberedByProject[projectRoot]) return rememberedByProject[projectRoot];
    return '';
  } catch {
    return '';
  }
}

export function rememberEditorPath(
  storage: EditorFileStorage,
  relativePath: string,
  projectRoot?: string,
): void {
  if (!relativePath) return;
  try {
    if (projectRoot) {
      const rememberedByProject = readProjectMemory(storage);
      rememberedByProject[projectRoot] = relativePath;
      storage.setItem(LAST_EDITOR_FILE_BY_PROJECT_KEY, JSON.stringify(rememberedByProject));
    }
  } catch {
    // Remembering the last editor file is a convenience only. Private browsing
    // or storage limits should never block the local table editor.
  }
}

function readProjectMemory(storage: EditorFileStorage): Record<string, string> {
  const raw = storage.getItem(LAST_EDITOR_FILE_BY_PROJECT_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const memory: Record<string, string> = {};
    for (const [projectRoot, relativePath] of Object.entries(parsed)) {
      if (typeof projectRoot === 'string' && typeof relativePath === 'string') {
        memory[projectRoot] = relativePath;
      }
    }
    return memory;
  } catch {
    return {};
  }
}

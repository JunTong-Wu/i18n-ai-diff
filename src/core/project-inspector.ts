import fs from 'fs/promises';
import path from 'path';
import {
  NestedJSON,
  ProjectScan,
  ProjectStateFile,
  ResolvedTranslateConfig,
  TranslationFilePlan,
  TranslationRoutePlan,
  TranslationTargetPlan,
} from '../types/index.js';
import { flatten } from '../utils/json-utils.js';
import { analyzeDiff } from './diff-analyzer.js';

export async function scanProject(
  config: ResolvedTranslateConfig,
  projectRoot: string,
  configPath: string,
): Promise<ProjectScan> {
  const routes: TranslationRoutePlan[] = [];
  const changes: TranslationFilePlan[] = [];

  for (const route of config.routes) {
    const sourceDir = path.join(config.localesDir, route.baseLang);
    const sourceFiles = await scanJsonFiles(sourceDir);
    const targetMap = new Map<string, TranslationTargetPlan>();
    for (const targetLang of route.targetLangs) {
      targetMap.set(targetLang, {
        targetLang,
        fileTasks: sourceFiles.length,
        existingFiles: 0,
        pendingFiles: 0,
        pendingKeys: 0,
        removedKeys: 0,
      });
    }

    let sourceKeys = 0;
    let pendingFiles = 0;
    let pendingKeys = 0;
    let removedKeys = 0;

    for (const relativePath of sourceFiles) {
      const sourceContent = await readJson(path.join(sourceDir, relativePath));
      const sourceFlattened = flatten(sourceContent);
      sourceKeys += Object.keys(sourceFlattened).length;

      for (const targetLang of route.targetLangs) {
        const targetPath = path.join(config.localesDir, targetLang, relativePath);
        const target = await readOptionalJson(targetPath);
        const targetFlattened = target.content ? flatten(target.content) : {};
        const diff = analyzeDiff(
          sourceContent,
          target.content,
          config.skipKeys,
          relativePath,
          targetLang,
          route.baseLang,
        );
        const skippedNeedsSync = diff.skipped.some(
          key => targetFlattened[key] !== sourceFlattened[key],
        );
        const needsWrite = !target.exists
          || diff.added.length > 0
          || diff.modified.length > 0
          || diff.removed.length > 0
          || skippedNeedsSync;
        const targetSummary = targetMap.get(targetLang)!;
        if (target.exists) targetSummary.existingFiles += 1;

        if (needsWrite) {
          const filePlan: TranslationFilePlan = {
            relativePath,
            sourceLang: route.baseLang,
            targetLang,
            targetExists: target.exists,
            needsWrite,
            counts: {
              source: Object.keys(sourceFlattened).length,
              added: diff.added.length,
              modified: diff.modified.length,
              removed: diff.removed.length,
              skipped: diff.skipped.length,
              unchanged: diff.unchanged.length,
            },
            keys: {
              added: diff.added,
              modified: diff.modified,
              removed: diff.removed,
            },
          };
          changes.push(filePlan);
          pendingFiles += 1;
          pendingKeys += diff.added.length + diff.modified.length;
          removedKeys += diff.removed.length;
          targetSummary.pendingFiles += 1;
          targetSummary.pendingKeys += diff.added.length + diff.modified.length;
          targetSummary.removedKeys += diff.removed.length;
        }
      }
    }

    routes.push({
      sourceLang: route.baseLang,
      targetLangs: [...route.targetLangs],
      sourceFiles: sourceFiles.length,
      sourceKeys,
      fileTasks: sourceFiles.length * route.targetLangs.length,
      pendingFiles,
      pendingKeys,
      removedKeys,
      targets: [...targetMap.values()],
    });
  }

  const cachePath = config.cachePath || path.join(projectRoot, '.i18n-translate-cache.json');
  const snapshotPath = cachePath.replace(/\.json$/, '') + '.snapshot.json';
  const languages = new Set(config.routes.flatMap(route => [route.baseLang, ...route.targetLangs]));

  return {
    projectRoot,
    configPath,
    mode: config.routes.length > 1 ? 'multi-master' : 'single-master',
    localesDir: config.localesDir,
    model: config.llm.model || 'unknown',
    scannedAt: new Date().toISOString(),
    routes,
    changes,
    cache: await inspectStateFile(cachePath, true),
    snapshot: await inspectStateFile(snapshotPath),
    totals: {
      routes: routes.length,
      languages: languages.size,
      sourceFiles: routes.reduce((total, route) => total + route.sourceFiles, 0),
      sourceKeys: routes.reduce((total, route) => total + route.sourceKeys, 0),
      fileTasks: routes.reduce((total, route) => total + route.fileTasks, 0),
      pendingFiles: routes.reduce((total, route) => total + route.pendingFiles, 0),
      pendingKeys: routes.reduce((total, route) => total + route.pendingKeys, 0),
      removedKeys: routes.reduce((total, route) => total + route.removedKeys, 0),
    },
  };
}

export async function scanJsonFiles(dir: string, basePath: string = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await scanJsonFiles(fullPath, basePath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(path.relative(basePath, fullPath));
    }
  }

  return files;
}

async function readJson(filePath: string): Promise<NestedJSON> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as NestedJSON;
  } catch (error) {
    throw new Error(`Failed to read locale JSON ${filePath}: ${(error as Error).message}`);
  }
}

async function readOptionalJson(
  filePath: string,
): Promise<{ exists: boolean; content: NestedJSON | null }> {
  try {
    const content = JSON.parse(await fs.readFile(filePath, 'utf8')) as NestedJSON;
    return { exists: true, content };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, content: null };
    }
    throw new Error(`Failed to read locale JSON ${filePath}: ${(error as Error).message}`);
  }
}

async function inspectStateFile(filePath: string, includeEntries = false): Promise<ProjectStateFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      version?: string | number;
      entries?: Record<string, unknown>;
    };
    return {
      path: filePath,
      exists: true,
      version: parsed.version ?? null,
      ...(includeEntries ? { entries: Object.keys(parsed.entries || {}).length } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path: filePath, exists: false, version: null, ...(includeEntries ? { entries: 0 } : {}) };
    }
    throw new Error(`Failed to inspect state file ${filePath}: ${(error as Error).message}`);
  }
}

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  EditorAcceptedTranslation,
  EditorCell,
  EditorCellKind,
  EditorFile,
  EditorManifest,
  EditorManifestFile,
  EditorPatch,
  EditorRow,
  EditorSaveRequest,
  EditorSearchRequest,
  EditorSearchResponse,
  EditorSearchResult,
  EditorSearchStateFilter,
  EditorMasterTranslateRequest,
  EditorTranslateRequest,
  EditorTranslateResult,
  NestedJSON,
  ResolvedTranslateConfig,
  TranslationTask,
} from '../types/index.js';
import { createLLMClient, LLMClient } from '../llm/client.js';
import { batchTasksByTokenLimit } from '../llm/prompt-builder.js';
import { createCacheManager } from '../utils/cache-manager.js';
import { isKeySkipped } from '../utils/path-matcher.js';
import {
  analyzeDiff,
  SNAPSHOT_VERSION,
  SnapshotStore,
  snapshotPathForCache,
  sourceTextHash,
} from './diff-analyzer.js';
import pLimit from 'p-limit';

const MAX_CHANGES = 10_000;
const MAX_TRANSLATE_CELLS = 2_000;
const DEFAULT_SEARCH_LIMIT = 200;
const MAX_SEARCH_LIMIT = 500;

interface JsonFormat {
  bom: string;
  indent: string | number;
  newline: '\n' | '\r\n';
  trailingNewline: boolean;
}

interface LocaleRecord {
  filePath: string;
  raw: string;
  data: NestedJSON;
  revision: string;
  format: JsonFormat;
  mode: number;
}

interface SnapshotDocument {
  version: number;
  entries: Record<string, Record<string, string>>;
  owners: Record<string, string>;
}

interface SnapshotRecord {
  filePath: string;
  raw: string | null;
  revision: string | null;
  document: SnapshotDocument;
  needsBootstrap: boolean;
  mode?: number;
}

interface PendingMap {
  [lang: string]: Set<string>;
}

interface EditorTranslateHooks {
  signal?: AbortSignal;
  onProgress?: (results: EditorTranslateResult[]) => void;
}

export interface PlannedEditorWrite {
  filePath: string;
  original: string | null;
  content: string;
  mode?: number;
  tempPath?: string;
}

export interface EditorCoreSaveResult {
  savedLanguages: string[];
  snapshotUpdated: boolean;
  file: EditorFile;
}

export class EditorServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'EditorServiceError';
  }
}

export class TranslationEditorService {
  readonly languages: string[];
  private readonly languageSet: Set<string>;
  private readonly snapshotPath: string;
  private readonly cachePath: string;
  private readonly llmClient: LLMClient;
  private readonly translateLimit: ReturnType<typeof pLimit>;

  constructor(
    private readonly config: ResolvedTranslateConfig,
    private readonly projectRoot: string,
  ) {
    this.languages = [...new Set(config.routes.flatMap(route => [route.sourceLang, ...route.targetLangs]))];
    this.languageSet = new Set(this.languages);
    const cachePath = config.cachePath || path.join(projectRoot, '.i18n-translate-cache.json');
    this.cachePath = cachePath;
    this.snapshotPath = snapshotPathForCache(cachePath);
    this.llmClient = createLLMClient(this.config.llm);
    if (this.config.prompt) {
      this.llmClient.setCustomPrompt(this.config.prompt);
    }
    this.translateLimit = pLimit(this.config.concurrency || 5);
  }

  async getManifest(writeToken: string): Promise<EditorManifest> {
    const fileLanguages = new Map<string, Set<string>>();
    for (const lang of this.languages) {
      for (const relativePath of await this.scanLanguageFiles(lang)) {
        const present = fileLanguages.get(relativePath) || new Set<string>();
        present.add(lang);
        fileLanguages.set(relativePath, present);
      }
    }

    const files: EditorManifestFile[] = [];
    const snapshot = await this.readSnapshotRecord();
    for (const relativePath of [...fileLanguages.keys()].sort((left, right) => left.localeCompare(right))) {
      const records = new Map<string, LocaleRecord | null>();
      const invalidLanguages: string[] = [];
      for (const lang of this.languages) {
        try {
          records.set(lang, await this.readLocaleRecord(lang, relativePath));
        } catch (error) {
          if (error instanceof EditorServiceError && error.code === 'INVALID_JSON') {
            invalidLanguages.push(lang);
            records.set(lang, null);
          } else {
            throw error;
          }
        }
      }

      const orderedPaths = this.collectOrderedPaths(records);
      const pending = this.calculatePending(relativePath, records, snapshot);
      const cellStatusCounts = this.countManifestCellStates(records, orderedPaths);
      files.push({
        relativePath,
        presentLanguages: this.languages.filter(lang => fileLanguages.get(relativePath)?.has(lang)),
        missingLanguages: this.languages.filter(lang => !fileLanguages.get(relativePath)?.has(lang)),
        invalidLanguages,
        keyCount: orderedPaths.length,
        pendingKeys: Object.values(pending).reduce((total, keys) => total + keys.size, 0),
        emptyStringCells: cellStatusCounts.emptyStringCells,
        missingKeyCells: cellStatusCounts.missingKeyCells,
      });
    }

    return {
      writeToken,
      projectRoot: this.projectRoot,
      routes: this.config.routes.map(route => ({
        sourceLang: route.sourceLang,
        languages: [route.sourceLang, ...route.targetLangs],
      })),
      languages: [...this.languages],
      files,
    };
  }

  async getFile(relativePath: string): Promise<EditorFile> {
    const normalized = this.validateRelativePath(relativePath);
    await this.assertLogicalFileExists(normalized);
    const records = await this.readAllLanguageRecords(normalized);
    return this.buildEditorFile(normalized, records, await this.readSnapshotRecord());
  }

  async search(request: EditorSearchRequest): Promise<EditorSearchResponse> {
    const rawQuery = typeof request.query === 'string' ? request.query.trim() : '';
    if (rawQuery.length > 512) {
      throw new EditorServiceError('Search query must be 512 characters or fewer', 'SEARCH_QUERY_TOO_LONG', 413);
    }
    const query = rawQuery.toLocaleLowerCase();
    const includeKeys = request.includeKeys === true;
    const limit = normalizeSearchLimit(request.limit);
    const languages = this.normalizeSearchLanguages(request.languages);
    const states = normalizeSearchStates(request.states);
    const relativePaths = await this.collectLogicalFilePaths();

    if (!query && states.size === 0) {
      return {
        query: rawQuery,
        results: [],
        total: 0,
        limit,
        limited: false,
        searchedFiles: relativePaths.length,
      };
    }

    const snapshot = await this.readSnapshotRecord();
    const results: EditorSearchResult[] = [];
    let total = 0;

    for (const relativePath of relativePaths) {
      const records = await this.readSearchRecords(relativePath);
      const pending = this.calculatePending(relativePath, records, snapshot);
      for (const segments of this.collectOrderedPaths(records)) {
        const pointer = encodeJsonPointer(segments);
        const displayPath = segments.join(' › ');
        const skipped = isKeySkipped(pointer, this.config.skipKeys);

        for (const lang of languages) {
          const routeOwnership = this.routeOwnershipForLanguage(lang);
          const record = records.get(lang);
          const resolved = record ? getPathValue(record.data, segments) : { exists: false, value: undefined };
          const cell: EditorCell = {
            kind: editorCellKind(resolved),
            ...(typeof resolved.value === 'string' ? { value: resolved.value } : {}),
            pending: pending[lang]?.has(pointer) || false,
            skipped,
          };
          if (!searchCellMatchesStates(cell, routeOwnership.isMaster, states)) continue;

          const value = typeof resolved.value === 'string' ? resolved.value : '';
          const valueMatchRanges = query ? findMatchRanges(value, query) : [];
          const keyMatchRanges = includeKeys && query ? findMatchRanges(displayPath, query) : [];
          if (query && valueMatchRanges.length === 0 && keyMatchRanges.length === 0) continue;

          total += 1;
          if (results.length >= limit) continue;
          results.push({
            relativePath,
            pointer,
            segments,
            displayPath,
            lang,
            sourceLang: routeOwnership.sourceLang,
            isMaster: routeOwnership.isMaster,
            value,
            valueMatchRanges,
            keyMatchRanges,
            cell,
          });
        }
      }
    }

    return {
      query: rawQuery,
      results,
      total,
      limit,
      limited: total > results.length,
      searchedFiles: relativePaths.length,
    };
  }

  async translateCells(
    request: EditorTranslateRequest,
    hooks: EditorTranslateHooks = {},
  ): Promise<EditorTranslateResult[]> {
    const relativePath = this.validateRelativePath(request.relativePath);
    if (!Array.isArray(request.cells) || request.cells.length === 0) {
      throw new EditorServiceError('At least one cell is required', 'EMPTY_TRANSLATE_SELECTION');
    }
    if (request.cells.length > MAX_TRANSLATE_CELLS) {
      throw new EditorServiceError(`A translation job may contain at most ${MAX_TRANSLATE_CELLS} cells`, 'TOO_MANY_TRANSLATE_CELLS', 413);
    }

    await this.assertLogicalFileExists(relativePath);
    const records = await this.readAllLanguageRecords(relativePath);
    const snapshot = await this.readSnapshotRecord();
    this.assertRevisions(request, records, snapshot);

    const orderedPaths = this.collectOrderedPaths(records);
    const allowedPointers = new Set(orderedPaths.map(encodeJsonPointer));
    const drafts = this.normalizeDraftPatches(request.drafts || [], allowedPointers);
    const overwriteDrafts = request.options?.overwriteDrafts === true;
    const forceRetranslate = request.options?.forceRetranslate === true;
    const pending = this.calculatePending(relativePath, records, snapshot);
    const cache = createCacheManager(this.cachePath);
    await cache.load();

    const results: EditorTranslateResult[] = [];
    const publish = (result: EditorTranslateResult) => {
      results.push(result);
      hooks.onProgress?.([result]);
    };
    const taskGroups = new Map<string, TranslationTask[]>();
    const seenCells = new Set<string>();

    for (const cell of request.cells) {
      if (hooks.signal?.aborted) break;
      if (!cell || typeof cell.lang !== 'string' || typeof cell.pointer !== 'string') {
        throw new EditorServiceError('Every translation cell must include lang and pointer', 'INVALID_TRANSLATE_CELL');
      }
      if (!this.languageSet.has(cell.lang)) {
        throw new EditorServiceError(`Language is not configured: ${cell.lang}`, 'UNKNOWN_LANGUAGE');
      }
      const segments = decodeJsonPointer(cell.pointer);
      if (!allowedPointers.has(cell.pointer)) {
        throw new EditorServiceError(`Translating a new key is not supported: ${cell.pointer}`, 'NEW_KEY_NOT_ALLOWED');
      }
      const identity = draftIdentity(cell.lang, cell.pointer);
      if (seenCells.has(identity)) continue;
      seenCells.add(identity);

      const route = this.config.routes.find(candidate => candidate.targetLangs.some(lang => lang === cell.lang));
      if (!route) {
        publish({ lang: cell.lang, pointer: cell.pointer, status: 'skipped', reason: 'Master language cells cannot be translated' });
        continue;
      }

      const targetValue = getPathValue(records.get(cell.lang)?.data || {}, segments);
      if (targetValue.exists && typeof targetValue.value !== 'string') {
        publish({ lang: cell.lang, pointer: cell.pointer, sourceLang: route.sourceLang, status: 'skipped', reason: 'Target cell is not a string value' });
        continue;
      }

      const pointer = encodeJsonPointer(segments);
      if (isKeySkipped(pointer, this.config.skipKeys)) {
        publish({ lang: cell.lang, pointer: cell.pointer, sourceLang: route.sourceLang, status: 'skipped', reason: 'Skipped key' });
        continue;
      }

      if (!overwriteDrafts && drafts.has(identity)) {
        publish({ lang: cell.lang, pointer: cell.pointer, sourceLang: route.sourceLang, status: 'skipped', reason: 'Cell already has a local draft' });
        continue;
      }

      const sourceIdentity = draftIdentity(route.sourceLang, cell.pointer);
      const sourceDraft = drafts.get(sourceIdentity);
      const hasSourceDraft = sourceDraft !== undefined;
      const sourceValue = sourceDraft !== undefined
        ? { exists: true, value: sourceDraft }
        : getPathValue(records.get(route.sourceLang)?.data || {}, segments);

      if (!sourceValue.exists || typeof sourceValue.value !== 'string') {
        publish({ lang: cell.lang, pointer: cell.pointer, sourceLang: route.sourceLang, status: 'skipped', reason: 'Source cell is missing or not a string value' });
        continue;
      }
      if (sourceValue.value.length === 0) {
        publish({ lang: cell.lang, pointer: cell.pointer, sourceLang: route.sourceLang, sourceText: sourceValue.value, status: 'skipped', reason: 'Source cell is empty' });
        continue;
      }

      const needsTranslation = !targetValue.exists
        || targetValue.value === ''
        || pending[cell.lang]?.has(cell.pointer)
        || hasSourceDraft;
      if (!forceRetranslate && !needsTranslation) {
        publish({ lang: cell.lang, pointer: cell.pointer, sourceLang: route.sourceLang, sourceText: sourceValue.value, status: 'skipped', reason: 'Already reviewed; use Force retranslate to refresh' });
        continue;
      }

      if (!forceRetranslate) {
        const cached = cache.get(sourceValue.value, cell.lang, route.sourceLang);
        if (cached !== undefined) {
          publish({
            lang: cell.lang,
            pointer: cell.pointer,
            sourceLang: route.sourceLang,
            sourceText: sourceValue.value,
            translatedText: cached,
            fromCache: true,
            status: 'translated',
          });
          continue;
        }
      }

      const groupKey = `${route.sourceLang}\0${cell.lang}`;
      const group = taskGroups.get(groupKey) || [];
      group.push({
        key: cell.pointer,
        sourceText: sourceValue.value,
        sourceLang: route.sourceLang,
        targetLang: cell.lang,
        filePath: relativePath,
      });
      taskGroups.set(groupKey, group);
    }

    await Promise.all([...taskGroups.values()].flatMap(tasks => {
      const batches = batchTasksByTokenLimit(tasks, this.config.batchSize || 20);
      return batches.map(batch => this.translateLimit(async () => {
        if (hooks.signal?.aborted) return;
        const batchResults = await this.llmClient.translateBatch(batch);
        if (hooks.signal?.aborted) return;
        for (const translation of batchResults) {
          const task = batch.find(candidate => candidate.key === translation.key);
          if (!task) continue;
          publish(translation.success
            ? {
                lang: task.targetLang,
                pointer: task.key,
                sourceLang: task.sourceLang,
                sourceText: task.sourceText,
                translatedText: translation.translatedText,
                fromCache: false,
                status: 'translated',
              }
            : {
                lang: task.targetLang,
                pointer: task.key,
                sourceLang: task.sourceLang,
                sourceText: task.sourceText,
                status: 'failed',
                error: translation.error || 'Translation failed',
              });
        }
      }));
    }));

    return results;
  }

  async translateMasterCells(
    request: EditorMasterTranslateRequest,
    hooks: EditorTranslateHooks = {},
  ): Promise<EditorTranslateResult[]> {
    const relativePath = this.validateRelativePath(request.relativePath);
    if (!Array.isArray(request.pointers) || request.pointers.length === 0) {
      throw new EditorServiceError('At least one key pointer is required', 'EMPTY_MASTER_TRANSLATE_SELECTION');
    }
    if (request.pointers.length > MAX_TRANSLATE_CELLS) {
      throw new EditorServiceError(`A translation job may contain at most ${MAX_TRANSLATE_CELLS} cells`, 'TOO_MANY_TRANSLATE_CELLS', 413);
    }

    const masterLangs = new Set<string>(this.config.routes.map(route => route.sourceLang));
    if (this.config.routes.length < 2) {
      throw new EditorServiceError('Master-to-master translation is only available in multi-master mode', 'MULTI_MASTER_REQUIRED');
    }
    if (!masterLangs.has(request.sourceLang)) {
      throw new EditorServiceError(`Source language must be a configured master: ${request.sourceLang}`, 'MASTER_LANGUAGE_REQUIRED');
    }
    if (!masterLangs.has(request.targetLang)) {
      throw new EditorServiceError(`Target language must be a configured master: ${request.targetLang}`, 'MASTER_LANGUAGE_REQUIRED');
    }
    if (request.sourceLang === request.targetLang) {
      throw new EditorServiceError('Source and target master languages must be different', 'SAME_MASTER_LANGUAGE');
    }

    await this.assertLogicalFileExists(relativePath);
    const records = await this.readAllLanguageRecords(relativePath);
    const snapshot = await this.readSnapshotRecord();
    this.assertRevisions(request, records, snapshot);

    const orderedPaths = this.collectOrderedPaths(records);
    const allowedPointers = new Set(orderedPaths.map(encodeJsonPointer));
    const drafts = this.normalizeDraftPatches(request.drafts || [], allowedPointers);
    const overwriteDrafts = request.options?.overwriteDrafts === true;
    const overwriteExisting = request.options?.overwriteExisting === true;
    const forceRetranslate = request.options?.forceRetranslate === true;
    const cache = createCacheManager(this.cachePath);
    await cache.load();

    const results: EditorTranslateResult[] = [];
    const publish = (result: EditorTranslateResult) => {
      results.push(result);
      hooks.onProgress?.([result]);
    };
    const tasks: TranslationTask[] = [];
    const seenPointers = new Set<string>();

    for (const pointer of request.pointers) {
      if (hooks.signal?.aborted) break;
      if (typeof pointer !== 'string') {
        throw new EditorServiceError('Every master translation pointer must be a string', 'INVALID_POINTER');
      }
      const segments = decodeJsonPointer(pointer);
      if (!allowedPointers.has(pointer)) {
        throw new EditorServiceError(`Translating a new key is not supported: ${pointer}`, 'NEW_KEY_NOT_ALLOWED');
      }
      if (seenPointers.has(pointer)) continue;
      seenPointers.add(pointer);

      const targetIdentity = draftIdentity(request.targetLang, pointer);
      const targetValue = getPathValue(records.get(request.targetLang)?.data || {}, segments);
      if (targetValue.exists && typeof targetValue.value !== 'string') {
        publish({ lang: request.targetLang, pointer, sourceLang: request.sourceLang, status: 'skipped', reason: 'Target master cell is not a string value' });
        continue;
      }

      if (isKeySkipped(pointer, this.config.skipKeys)) {
        publish({ lang: request.targetLang, pointer, sourceLang: request.sourceLang, status: 'skipped', reason: 'Skipped key' });
        continue;
      }

      if (!overwriteDrafts && drafts.has(targetIdentity)) {
        publish({ lang: request.targetLang, pointer, sourceLang: request.sourceLang, status: 'skipped', reason: 'Cell already has a local draft' });
        continue;
      }

      const sourceIdentity = draftIdentity(request.sourceLang, pointer);
      const sourceDraft = drafts.get(sourceIdentity);
      const sourceValue = sourceDraft !== undefined
        ? { exists: true, value: sourceDraft }
        : getPathValue(records.get(request.sourceLang)?.data || {}, segments);
      if (!sourceValue.exists || typeof sourceValue.value !== 'string') {
        publish({ lang: request.targetLang, pointer, sourceLang: request.sourceLang, status: 'skipped', reason: 'Source master cell is missing or not a string value' });
        continue;
      }
      if (sourceValue.value.length === 0) {
        publish({ lang: request.targetLang, pointer, sourceLang: request.sourceLang, sourceText: sourceValue.value, status: 'skipped', reason: 'Source master cell is empty' });
        continue;
      }

      if (
        !overwriteExisting
        && targetValue.exists
        && targetValue.value !== sourceValue.value
      ) {
        publish({ lang: request.targetLang, pointer, sourceLang: request.sourceLang, sourceText: sourceValue.value, status: 'skipped', reason: 'Existing master copy; enable overwrite to replace' });
        continue;
      }

      if (!forceRetranslate) {
        const cached = cache.get(sourceValue.value, request.targetLang, request.sourceLang);
        if (cached !== undefined) {
          publish({
            lang: request.targetLang,
            pointer,
            sourceLang: request.sourceLang,
            sourceText: sourceValue.value,
            translatedText: cached,
            fromCache: true,
            status: 'translated',
          });
          continue;
        }
      }

      tasks.push({
        key: pointer,
        sourceText: sourceValue.value,
        sourceLang: request.sourceLang,
        targetLang: request.targetLang,
        filePath: relativePath,
      });
    }

    const batches = batchTasksByTokenLimit(tasks, this.config.batchSize || 20);
    await Promise.all(batches.map(batch => this.translateLimit(async () => {
      if (hooks.signal?.aborted) return;
      const batchResults = await this.llmClient.translateBatch(batch);
      if (hooks.signal?.aborted) return;
      for (const translation of batchResults) {
        const task = batch.find(candidate => candidate.key === translation.key);
        if (!task) continue;
        publish(translation.success
          ? {
              lang: task.targetLang,
              pointer: task.key,
              sourceLang: task.sourceLang,
              sourceText: task.sourceText,
              translatedText: translation.translatedText,
              fromCache: false,
              status: 'translated',
            }
          : {
              lang: task.targetLang,
              pointer: task.key,
              sourceLang: task.sourceLang,
              sourceText: task.sourceText,
              status: 'failed',
              error: translation.error || 'Translation failed',
            });
      }
    })));

    return results;
  }

  async saveFile(request: EditorSaveRequest): Promise<EditorCoreSaveResult> {
    const relativePath = this.validateRelativePath(request.relativePath);
    if (!Array.isArray(request.changes) || request.changes.length === 0) {
      throw new EditorServiceError('At least one change is required', 'EMPTY_CHANGESET');
    }
    if (request.changes.length > MAX_CHANGES) {
      throw new EditorServiceError(`A save may contain at most ${MAX_CHANGES} changes`, 'TOO_MANY_CHANGES', 413);
    }

    await this.assertLogicalFileExists(relativePath);
    const records = await this.readAllLanguageRecords(relativePath);
    const snapshot = await this.readSnapshotRecord();
    this.assertRevisions(request, records, snapshot);

    const orderedPaths = this.collectOrderedPaths(records);
    const allowedPointers = new Set(orderedPaths.map(encodeJsonPointer));
    const seenChanges = new Set<string>();
    const changedLanguages = new Set<string>();
    const effectiveChanges = [] as EditorSaveRequest['changes'];

    for (const change of request.changes) {
      if (!change || typeof change.lang !== 'string' || typeof change.pointer !== 'string' || typeof change.value !== 'string') {
        throw new EditorServiceError('Every change must include lang, pointer, and string value', 'INVALID_CHANGE');
      }
      if (!this.languageSet.has(change.lang)) {
        throw new EditorServiceError(`Language is not configured: ${change.lang}`, 'UNKNOWN_LANGUAGE');
      }
      const segments = decodeJsonPointer(change.pointer);
      if (!allowedPointers.has(change.pointer)) {
        throw new EditorServiceError(`Creating a new key is not supported: ${change.pointer}`, 'NEW_KEY_NOT_ALLOWED');
      }
      const identity = `${change.lang}\0${change.pointer}`;
      if (seenChanges.has(identity)) {
        throw new EditorServiceError(`Duplicate change: ${change.lang} ${change.pointer}`, 'DUPLICATE_CHANGE');
      }
      seenChanges.add(identity);

      let record = records.get(change.lang) || null;
      if (!record) {
        record = this.createEmptyRecord(change.lang, relativePath);
        records.set(change.lang, record);
      }
      const current = getPathValue(record.data, segments);
      if (current.exists && typeof current.value !== 'string') {
        throw new EditorServiceError(
          `Cannot replace a non-string value at ${change.pointer} in ${change.lang}`,
          'PATH_TYPE_CONFLICT',
        );
      }
      if (current.exists && current.value === change.value) continue;
      changedLanguages.add(change.lang);
      effectiveChanges.push(change);
    }

    if (effectiveChanges.length === 0) {
      return {
        savedLanguages: [],
        snapshotUpdated: false,
        file: this.buildEditorFile(relativePath, records, snapshot),
      };
    }

    let snapshotUpdated = false;
    if (snapshot.needsBootstrap) {
      snapshot.document = await this.bootstrapSnapshot();
      snapshotUpdated = true;
    }
    if (this.baselineAffectedFile(snapshot.document, relativePath, records)) {
      snapshotUpdated = true;
    }
    for (const change of effectiveChanges) {
      const segments = decodeJsonPointer(change.pointer);
      setStringAtPath(
        records.get(change.lang)!.data,
        segments,
        change.value,
        this.orderTemplateForMissingPath(records, change.lang, segments),
      );
    }
    if (this.reviewEditedTargets(snapshot.document, relativePath, records, effectiveChanges)) {
      snapshotUpdated = true;
    }
    const acceptedCacheItems = this.collectAcceptedTranslationCacheItems(
      request.acceptedTranslations,
      records,
      effectiveChanges,
    );

    const writes: PlannedEditorWrite[] = [];
    for (const lang of changedLanguages) {
      const record = records.get(lang)!;
      writes.push({
        filePath: record.filePath,
        original: record.revision ? record.raw : null,
        content: serializeJson(record.data, record.format),
        mode: record.mode,
      });
    }
    if (snapshotUpdated) {
      writes.push({
        filePath: snapshot.filePath,
        original: snapshot.raw,
        content: JSON.stringify(snapshot.document, null, 2),
        mode: snapshot.mode,
      });
    }

    await commitEditorWrites(writes);
    await this.writeAcceptedTranslationsToCache(acceptedCacheItems);
    const refreshedRecords = await this.readAllLanguageRecords(relativePath);
    const refreshedSnapshot = await this.readSnapshotRecord();
    return {
      savedLanguages: this.languages.filter(lang => changedLanguages.has(lang)),
      snapshotUpdated,
      file: this.buildEditorFile(relativePath, refreshedRecords, refreshedSnapshot),
    };
  }

  private async readAllLanguageRecords(relativePath: string): Promise<Map<string, LocaleRecord | null>> {
    const records = new Map<string, LocaleRecord | null>();
    for (const lang of this.languages) {
      records.set(lang, await this.readLocaleRecord(lang, relativePath));
    }
    return records;
  }

  private async readSearchRecords(relativePath: string): Promise<Map<string, LocaleRecord | null>> {
    const records = new Map<string, LocaleRecord | null>();
    for (const lang of this.languages) {
      try {
        records.set(lang, await this.readLocaleRecord(lang, relativePath));
      } catch (error) {
        if (error instanceof EditorServiceError && error.code === 'INVALID_JSON') {
          records.set(lang, null);
        } else {
          throw error;
        }
      }
    }
    return records;
  }

  private buildEditorFile(
    relativePath: string,
    records: Map<string, LocaleRecord | null>,
    snapshot: SnapshotRecord,
  ): EditorFile {
    const pending = this.calculatePending(relativePath, records, snapshot);
    const rows: EditorRow[] = this.collectOrderedPaths(records).map(segments => {
      const pointer = encodeJsonPointer(segments);
      const skipped = isKeySkipped(pointer, this.config.skipKeys);
      const cells: Record<string, EditorCell> = {};
      for (const lang of this.languages) {
        const record = records.get(lang);
        const resolved = record ? getPathValue(record.data, segments) : { exists: false, value: undefined };
        cells[lang] = {
          kind: editorCellKind(resolved),
          ...(typeof resolved.value === 'string' ? { value: resolved.value } : {}),
          pending: pending[lang]?.has(pointer) || false,
          skipped,
        };
      }
      return {
        id: pointer,
        pointer,
        segments,
        displayPath: segments.join(' › '),
        cells,
      };
    });

    return {
      relativePath,
      revisions: Object.fromEntries(this.languages.map(lang => [lang, records.get(lang)?.revision || null])),
      snapshotRevision: snapshot.revision,
      rows,
    };
  }

  private collectOrderedPaths(records: Map<string, LocaleRecord | null>): string[][] {
    const paths: string[][] = [];
    const seen = new Set<string>();
    const addRecord = (record: LocaleRecord | null | undefined) => {
      if (!record) return;
      for (const segments of collectStringLeafPaths(record.data)) {
        const pointer = encodeJsonPointer(segments);
        if (seen.has(pointer)) continue;
        seen.add(pointer);
        paths.push(segments);
      }
    };

    for (const route of this.config.routes) addRecord(records.get(route.sourceLang));
    for (const route of this.config.routes) {
      for (const targetLang of route.targetLangs) addRecord(records.get(targetLang));
    }
    return paths;
  }

  private countManifestCellStates(
    records: Map<string, LocaleRecord | null>,
    orderedPaths: string[][],
  ): { emptyStringCells: number; missingKeyCells: number } {
    let emptyStringCells = 0;
    let missingKeyCells = 0;

    for (const segments of orderedPaths) {
      for (const lang of this.languages) {
        const record = records.get(lang);
        const resolved = record ? getPathValue(record.data, segments) : { exists: false, value: undefined };
        const kind = editorCellKind(resolved);
        if (kind === 'empty') emptyStringCells += 1;
        if (kind === 'missing') missingKeyCells += 1;
      }
    }

    return { emptyStringCells, missingKeyCells };
  }

  private orderTemplateForMissingPath(
    records: Map<string, LocaleRecord | null>,
    targetLang: string,
    segments: string[],
  ): NestedJSON | undefined {
    for (const lang of this.orderDonorLanguages(targetLang)) {
      const record = records.get(lang);
      if (!record) continue;
      const candidate = getPathValue(record.data, segments);
      if (candidate.exists && typeof candidate.value === 'string') return record.data;
    }
    return undefined;
  }

  private orderDonorLanguages(targetLang: string): string[] {
    const languages: string[] = [];
    const add = (lang: string) => {
      if (lang !== targetLang && !languages.includes(lang)) languages.push(lang);
    };
    const targetRoute = this.config.routes.find(route => route.targetLangs.some(lang => lang === targetLang));
    if (targetRoute) add(targetRoute.sourceLang);
    for (const route of this.config.routes) add(route.sourceLang);
    for (const route of this.config.routes) {
      for (const lang of route.targetLangs) add(lang);
    }
    return languages;
  }

  private calculatePending(
    relativePath: string,
    records: Map<string, LocaleRecord | null>,
    snapshot: SnapshotRecord,
  ): PendingMap {
    const pending: PendingMap = {};
    const nativeRelativePath = toNativeRelativePath(relativePath);
    const snapshotStore = SnapshotStore.fromDocument(snapshot.document, {
      snapshotPath: snapshot.filePath,
      legacyBootstrap: snapshot.needsBootstrap,
    });
    for (const route of this.config.routes) {
      const source = records.get(route.sourceLang);
      if (!source) continue;
      for (const targetLang of route.targetLangs) {
        const target = records.get(targetLang);
        const diff = analyzeDiff(
          source.data,
          target?.data || null,
          this.config.skipKeys,
          nativeRelativePath,
          targetLang,
          route.sourceLang,
          snapshotStore,
        );
        pending[targetLang] = new Set([...diff.added, ...diff.modified]);
      }
    }
    return pending;
  }

  private assertRevisions(
    request: Pick<EditorSaveRequest, 'revisions' | 'snapshotRevision'>,
    records: Map<string, LocaleRecord | null>,
    snapshot: SnapshotRecord,
  ): void {
    const mismatches = this.languages.filter(
      lang => request.revisions?.[lang] !== (records.get(lang)?.revision || null),
    );
    if (request.snapshotRevision !== snapshot.revision) mismatches.push('snapshot');
    if (mismatches.length > 0) {
      throw new EditorServiceError(
        'Files changed on disk after the editor loaded them',
        'REVISION_CONFLICT',
        409,
        { mismatches },
      );
    }
  }

  private normalizeDraftPatches(
    drafts: EditorPatch[],
    allowedPointers: Set<string>,
  ): Map<string, string> {
    if (!Array.isArray(drafts)) {
      throw new EditorServiceError('Drafts must be an array', 'INVALID_DRAFTS');
    }
    const normalized = new Map<string, string>();
    for (const draft of drafts) {
      if (!draft || typeof draft.lang !== 'string' || typeof draft.pointer !== 'string' || typeof draft.value !== 'string') {
        throw new EditorServiceError('Every draft must include lang, pointer, and string value', 'INVALID_DRAFT');
      }
      if (!this.languageSet.has(draft.lang)) {
        throw new EditorServiceError(`Language is not configured: ${draft.lang}`, 'UNKNOWN_LANGUAGE');
      }
      decodeJsonPointer(draft.pointer);
      if (!allowedPointers.has(draft.pointer)) {
        throw new EditorServiceError(`Drafting a new key is not supported: ${draft.pointer}`, 'NEW_KEY_NOT_ALLOWED');
      }
      normalized.set(draftIdentity(draft.lang, draft.pointer), draft.value);
    }
    return normalized;
  }

  private collectAcceptedTranslationCacheItems(
    acceptedTranslations: EditorAcceptedTranslation[] | undefined,
    records: Map<string, LocaleRecord | null>,
    effectiveChanges: EditorSaveRequest['changes'],
  ): EditorAcceptedTranslation[] {
    if (acceptedTranslations === undefined) return [];
    if (!Array.isArray(acceptedTranslations)) {
      throw new EditorServiceError('Accepted translations must be an array', 'INVALID_ACCEPTED_TRANSLATIONS');
    }
    if (acceptedTranslations.length === 0) return [];
    if (acceptedTranslations.length > MAX_CHANGES) {
      throw new EditorServiceError(`A save may accept at most ${MAX_CHANGES} AI translations`, 'TOO_MANY_ACCEPTED_TRANSLATIONS', 413);
    }

    const changedValues = new Map(effectiveChanges.map(change => [
      draftIdentity(change.lang, change.pointer),
      change.value,
    ]));
    const cacheItems: EditorAcceptedTranslation[] = [];

    for (const accepted of acceptedTranslations) {
      if (
        !accepted
        || typeof accepted.lang !== 'string'
        || typeof accepted.pointer !== 'string'
        || typeof accepted.sourceLang !== 'string'
        || typeof accepted.sourceText !== 'string'
        || typeof accepted.translatedText !== 'string'
      ) {
        throw new EditorServiceError('Every accepted translation must include lang, pointer, sourceLang, sourceText, and translatedText', 'INVALID_ACCEPTED_TRANSLATION');
      }
      if (!this.languageSet.has(accepted.lang) || !this.languageSet.has(accepted.sourceLang)) {
        throw new EditorServiceError('Accepted translation uses an unknown language', 'UNKNOWN_LANGUAGE');
      }
      const route = this.config.routes.find(candidate => (
        candidate.sourceLang === accepted.sourceLang
        && candidate.targetLangs.some(lang => lang === accepted.lang)
      ));
      const masterLangs = new Set<string>(this.config.routes.map(candidate => candidate.sourceLang));
      const masterToMaster = this.config.routes.length > 1
        && accepted.sourceLang !== accepted.lang
        && masterLangs.has(accepted.sourceLang)
        && masterLangs.has(accepted.lang);
      if (!route && !masterToMaster) continue;
      const segments = decodeJsonPointer(accepted.pointer);
      const sourceValue = getPathValue(records.get(accepted.sourceLang)?.data || {}, segments);
      const targetValue = getPathValue(records.get(accepted.lang)?.data || {}, segments);
      if (!sourceValue.exists || sourceValue.value !== accepted.sourceText) continue;
      if (!targetValue.exists || targetValue.value !== accepted.translatedText) continue;
      if (changedValues.get(draftIdentity(accepted.lang, accepted.pointer)) !== accepted.translatedText) continue;
      cacheItems.push(accepted);
    }

    return cacheItems;
  }

  private async writeAcceptedTranslationsToCache(
    cacheItems: EditorAcceptedTranslation[],
  ): Promise<void> {
    if (cacheItems.length === 0) return;
    const cache = createCacheManager(this.cachePath);
    await cache.load();
    for (const item of cacheItems) {
      cache.set(
        item.sourceText,
        item.translatedText,
        item.lang,
        this.config.llm.model || 'unknown',
        item.sourceLang,
      );
    }
    await cache.save();
  }

  private async readLocaleRecord(lang: string, relativePath: string): Promise<LocaleRecord | null> {
    const filePath = this.localeFilePath(lang, relativePath);
    await this.assertNoSymlinkPath(filePath);
    try {
      const [raw, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(bom ? raw.slice(1) : raw);
      } catch (error) {
        throw new EditorServiceError(
          `Invalid locale JSON ${lang}/${relativePath}: ${(error as Error).message}`,
          'INVALID_JSON',
          422,
          { lang, relativePath },
        );
      }
      if (!isObjectRecord(parsed)) {
        throw new EditorServiceError(
          `Locale JSON must contain an object at its root: ${lang}/${relativePath}`,
          'INVALID_JSON',
          422,
          { lang, relativePath },
        );
      }
      return {
        filePath,
        raw,
        data: parsed,
        revision: revisionOf(raw),
        format: detectJsonFormat(raw),
        mode: stat.mode,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private createEmptyRecord(lang: string, relativePath: string): LocaleRecord {
    return {
      filePath: this.localeFilePath(lang, relativePath),
      raw: '',
      data: {},
      revision: '',
      format: { bom: '', indent: 2, newline: '\n', trailingNewline: false },
      mode: 0o644,
    };
  }

  private async readSnapshotRecord(): Promise<SnapshotRecord> {
    await this.assertSnapshotNotSymlink();
    try {
      const [raw, stat] = await Promise.all([
        fs.readFile(this.snapshotPath, 'utf8'),
        fs.stat(this.snapshotPath),
      ]);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      const parsedObject = isObjectRecord(parsed) ? parsed : null;
      const valid = parsedObject !== null
        && parsedObject.version === SNAPSHOT_VERSION
        && isObjectRecord(parsedObject.entries)
        && isObjectRecord(parsedObject.owners);
      return {
        filePath: this.snapshotPath,
        raw,
        revision: revisionOf(raw),
        document: valid
          ? {
              version: SNAPSHOT_VERSION,
              entries: parsedObject!.entries as SnapshotDocument['entries'],
              owners: parsedObject!.owners as SnapshotDocument['owners'],
            }
          : emptySnapshot(),
        needsBootstrap: !valid,
        mode: stat.mode,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return {
        filePath: this.snapshotPath,
        raw: null,
        revision: null,
        document: emptySnapshot(),
        needsBootstrap: true,
      };
    }
  }

  private async bootstrapSnapshot(): Promise<SnapshotDocument> {
    const document = emptySnapshot();
    for (const route of this.config.routes) {
      for (const relativePath of await this.scanLanguageFiles(route.sourceLang)) {
        let source: LocaleRecord | null;
        try {
          source = await this.readLocaleRecord(route.sourceLang, relativePath);
        } catch {
          continue;
        }
        if (!source) continue;
        for (const targetLang of route.targetLangs) {
          let target: LocaleRecord | null;
          try {
            target = await this.readLocaleRecord(targetLang, relativePath);
          } catch {
            continue;
          }
          if (!target) continue;
          this.establishBaseline(document, relativePath, route.sourceLang, targetLang, source.data, target.data, true);
        }
      }
    }
    return document;
  }

  private baselineAffectedFile(
    document: SnapshotDocument,
    relativePath: string,
    records: Map<string, LocaleRecord | null>,
  ): boolean {
    let changed = false;

    for (const route of this.config.routes) {
      const source = records.get(route.sourceLang);
      if (!source) continue;
      for (const targetLang of route.targetLangs) {
        const target = records.get(targetLang);
        if (!target) continue;
        changed = this.establishBaseline(
          document,
          relativePath,
          route.sourceLang,
          targetLang,
          source.data,
          target.data,
          false,
        ) || changed;
      }
    }
    return changed;
  }

  private establishBaseline(
    document: SnapshotDocument,
    relativePath: string,
    sourceLang: string,
    targetLang: string,
    sourceData: NestedJSON,
    targetData: NestedJSON,
    replace: boolean,
  ): boolean {
    const nativeRelativePath = toNativeRelativePath(relativePath);
    const ownerKey = `${targetLang}:${nativeRelativePath}`;
    const entryKey = `${sourceLang}:${targetLang}:${nativeRelativePath}`;
    const suffix = `:${targetLang}:${nativeRelativePath}`;
    let changed = false;
    if (replace || document.owners[ownerKey] !== sourceLang) {
      for (const key of Object.keys(document.entries)) {
        if (key !== entryKey && key.endsWith(suffix)) {
          delete document.entries[key];
          changed = true;
        }
      }
      document.entries[entryKey] = {};
      if (document.owners[ownerKey] !== sourceLang) changed = true;
      document.owners[ownerKey] = sourceLang;
      changed = true;
    }
    const entries = document.entries[entryKey] || (document.entries[entryKey] = {});
    for (const segments of collectStringLeafPaths(sourceData)) {
      const target = getPathValue(targetData, segments);
      if (!target.exists || typeof target.value !== 'string') continue;
      const pointer = encodeJsonPointer(segments);
      if (entries[pointer]) continue;
      const sourceValue = getPathValue(sourceData, segments).value as string;
      entries[pointer] = sourceTextHash(sourceValue);
      changed = true;
    }
    return changed;
  }

  private reviewEditedTargets(
    document: SnapshotDocument,
    relativePath: string,
    records: Map<string, LocaleRecord | null>,
    changes: EditorSaveRequest['changes'],
  ): boolean {
    let changed = false;
    const nativeRelativePath = toNativeRelativePath(relativePath);
    for (const change of changes) {
      const route = this.config.routes.find(candidate => candidate.targetLangs.some(lang => lang === change.lang));
      if (!route) continue;
      const source = records.get(route.sourceLang);
      if (!source) continue;
      const segments = decodeJsonPointer(change.pointer);
      const sourceValue = getPathValue(source.data, segments);
      if (!sourceValue.exists || typeof sourceValue.value !== 'string') continue;

      const ownerKey = `${change.lang}:${nativeRelativePath}`;
      const entryKey = `${route.sourceLang}:${change.lang}:${nativeRelativePath}`;
      const suffix = `:${change.lang}:${nativeRelativePath}`;
      for (const key of Object.keys(document.entries)) {
        if (key !== entryKey && key.endsWith(suffix)) {
          delete document.entries[key];
          changed = true;
        }
      }
      document.owners[ownerKey] = route.sourceLang;
      const entries = document.entries[entryKey] || (document.entries[entryKey] = {});
      entries[change.pointer] = sourceTextHash(sourceValue.value);
      changed = true;
    }
    return changed;
  }

  private async scanLanguageFiles(lang: string): Promise<string[]> {
    await this.assertLocalesRootNotSymlink();
    const root = path.join(this.config.localesDir, lang);
    try {
      const stat = await fs.lstat(root);
      if (stat.isSymbolicLink()) {
        throw new EditorServiceError(`Symbolic-link language directories are not editable: ${lang}`, 'SYMLINK_PATH', 403);
      }
      if (!stat.isDirectory()) return [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const walk = async (dir: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      const files: string[] = [];
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...await walk(fullPath));
        else if (entry.isFile() && entry.name.endsWith('.json')) {
          files.push(toPosixRelativePath(path.relative(root, fullPath)));
        }
      }
      return files;
    };
    return walk(root);
  }

  private async collectLogicalFilePaths(): Promise<string[]> {
    const files = new Set<string>();
    for (const lang of this.languages) {
      for (const relativePath of await this.scanLanguageFiles(lang)) files.add(relativePath);
    }
    return [...files].sort((left, right) => left.localeCompare(right));
  }

  private normalizeSearchLanguages(languages: string[] | undefined): string[] {
    if (languages === undefined || languages.length === 0) return [...this.languages];
    if (!Array.isArray(languages)) {
      throw new EditorServiceError('Search languages must be an array', 'INVALID_SEARCH_FILTER');
    }
    const selected = new Set<string>();
    for (const lang of languages) {
      if (typeof lang !== 'string' || !this.languageSet.has(lang)) {
        throw new EditorServiceError(`Language is not configured: ${String(lang)}`, 'UNKNOWN_LANGUAGE');
      }
      selected.add(lang);
    }
    return this.languages.filter(lang => selected.has(lang));
  }

  private routeOwnershipForLanguage(lang: string): { sourceLang: string; isMaster: boolean } {
    const sourceRoute = this.config.routes.find(route => route.sourceLang === lang);
    if (sourceRoute) return { sourceLang: sourceRoute.sourceLang, isMaster: true };
    const targetRoute = this.config.routes.find(route => route.targetLangs.some(targetLang => targetLang === lang));
    return { sourceLang: targetRoute?.sourceLang || lang, isMaster: false };
  }

  private async assertLogicalFileExists(relativePath: string): Promise<void> {
    for (const lang of this.languages) {
      const filePath = this.localeFilePath(lang, relativePath);
      try {
        const stat = await fs.lstat(filePath);
        if (stat.isSymbolicLink()) {
          throw new EditorServiceError('Symbolic-link locale files cannot be edited', 'SYMLINK_PATH', 403);
        }
        if (stat.isFile()) return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    throw new EditorServiceError(`Locale file is not part of this project: ${relativePath}`, 'FILE_NOT_FOUND', 404);
  }

  private validateRelativePath(relativePath: string): string {
    if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) {
      throw new EditorServiceError('A valid JSON relative path is required', 'INVALID_PATH');
    }
    if (relativePath.includes('\\') || path.posix.isAbsolute(relativePath)) {
      throw new EditorServiceError('Absolute and backslash paths are not allowed', 'INVALID_PATH');
    }
    const normalized = path.posix.normalize(relativePath);
    if (normalized !== relativePath || normalized === '..' || normalized.startsWith('../') || !normalized.endsWith('.json')) {
      throw new EditorServiceError('The path must be a normalized project-relative JSON file', 'INVALID_PATH');
    }
    return normalized;
  }

  private localeFilePath(lang: string, relativePath: string): string {
    return path.join(this.config.localesDir, lang, ...relativePath.split('/'));
  }

  private async assertNoSymlinkPath(filePath: string): Promise<void> {
    const root = path.resolve(this.config.localesDir);
    await this.assertLocalesRootNotSymlink();
    const relative = path.relative(root, filePath);
    let current = root;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) {
          throw new EditorServiceError('Symbolic-link locale paths cannot be read or written', 'SYMLINK_PATH', 403);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
    }
  }

  private async assertLocalesRootNotSymlink(): Promise<void> {
    try {
      const stat = await fs.lstat(path.resolve(this.config.localesDir));
      if (stat.isSymbolicLink()) {
        throw new EditorServiceError('Symbolic-link locales directories cannot be read or written', 'SYMLINK_PATH', 403);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  private async assertSnapshotNotSymlink(): Promise<void> {
    try {
      if ((await fs.lstat(this.snapshotPath)).isSymbolicLink()) {
        throw new EditorServiceError('Symbolic-link snapshot files cannot be updated', 'SYMLINK_PATH', 403);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function encodeJsonPointer(segments: string[]): string {
  return segments.map(segment => `/${segment.replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

export function decodeJsonPointer(pointer: string): string[] {
  if (!pointer.startsWith('/') || pointer.includes('\0')) {
    throw new EditorServiceError(`Invalid JSON Pointer: ${pointer}`, 'INVALID_POINTER');
  }
  return pointer.slice(1).split('/').map(segment => {
    if (/~(?![01])/u.test(segment)) {
      throw new EditorServiceError(`Invalid JSON Pointer escape: ${pointer}`, 'INVALID_POINTER');
    }
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

export function collectStringLeafPaths(value: NestedJSON): string[][] {
  const paths: string[][] = [];
  const walk = (current: unknown, segments: string[]) => {
    if (!isObjectRecord(current)) return;
    for (const [key, child] of Object.entries(current)) {
      const next = [...segments, key];
      if (typeof child === 'string') paths.push(next);
      else if (isObjectRecord(child)) walk(child, next);
    }
  };
  walk(value, []);
  return paths;
}

export function setStringAtPath(
  root: NestedJSON,
  segments: string[],
  value: string,
  orderTemplate?: NestedJSON,
): void {
  if (segments.length === 0) {
    throw new EditorServiceError('The JSON root cannot be edited as a string', 'INVALID_POINTER');
  }
  let current: NestedJSON = root;
  let templateCurrent: unknown = orderTemplate;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    if (isLast) {
      defineOrderedProperty(current, segment, value, templateCurrent);
      return;
    }
    const existing = Object.prototype.hasOwnProperty.call(current, segment) ? current[segment] : undefined;
    if (existing === undefined) {
      const next: NestedJSON = {};
      defineOrderedProperty(current, segment, next, templateCurrent);
      current = next;
    } else if (isObjectRecord(existing)) {
      current = existing;
    } else {
      throw new EditorServiceError(
        `Cannot create a nested string through non-object segment: ${segment}`,
        'PATH_TYPE_CONFLICT',
      );
    }
    templateCurrent = isObjectRecord(templateCurrent) ? templateCurrent[segment] : undefined;
  }
}

function defineOrderedProperty(
  target: NestedJSON,
  key: string,
  value: unknown,
  templateParent: unknown,
): void {
  const descriptor = {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  };
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    Object.defineProperty(target, key, descriptor);
    return;
  }
  if (!isObjectRecord(templateParent) || !Object.prototype.hasOwnProperty.call(templateParent, key)) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  const descriptors = Object.getOwnPropertyDescriptors(target);
  const orderedKeys = Object.keys(target);
  const insertionIndex = orderedInsertionIndex(orderedKeys, Object.keys(templateParent), key);
  for (const existingKey of orderedKeys) delete target[existingKey];
  const nextKeys = [...orderedKeys];
  nextKeys.splice(insertionIndex, 0, key);
  for (const nextKey of nextKeys) {
    Object.defineProperty(target, nextKey, nextKey === key ? descriptor : descriptors[nextKey]);
  }
}

function orderedInsertionIndex(targetKeys: string[], templateKeys: string[], key: string): number {
  const templateIndex = templateKeys.indexOf(key);
  if (templateIndex === -1) return targetKeys.length;

  for (let index = templateIndex - 1; index >= 0; index -= 1) {
    const targetIndex = targetKeys.indexOf(templateKeys[index]);
    if (targetIndex !== -1) return targetIndex + 1;
  }
  for (let index = templateIndex + 1; index < templateKeys.length; index += 1) {
    const targetIndex = targetKeys.indexOf(templateKeys[index]);
    if (targetIndex !== -1) return targetIndex;
  }
  return targetKeys.length;
}

function getPathValue(root: NestedJSON, segments: string[]): { exists: boolean; value: unknown } {
  let current: unknown = root;
  for (const segment of segments) {
    if (!isObjectRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = current[segment];
  }
  return { exists: true, value: current };
}

function draftIdentity(lang: string, pointer: string): string {
  return `${lang}\0${pointer}`;
}

function isObjectRecord(value: unknown): value is NestedJSON {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function revisionOf(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function detectJsonFormat(raw: string): JsonFormat {
  const body = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  const indentMatch = body.split(/\r?\n/u).find(line => /^[\t ]+"/u.test(line))?.match(/^([\t ]+)/u);
  return {
    bom: raw.startsWith('\uFEFF') ? '\uFEFF' : '',
    indent: indentMatch?.[1] || 2,
    newline,
    trailingNewline: /\r?\n$/u.test(body),
  };
}

function serializeJson(data: NestedJSON, format: JsonFormat): string {
  const json = JSON.stringify(data, null, format.indent).replace(/\n/g, format.newline);
  return `${format.bom}${json}${format.trailingNewline ? format.newline : ''}`;
}

function emptySnapshot(): SnapshotDocument {
  return { version: SNAPSHOT_VERSION, entries: {}, owners: {} };
}

function toPosixRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function toNativeRelativePath(relativePath: string): string {
  return relativePath.split('/').join(path.sep);
}

function normalizeSearchLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

function normalizeSearchStates(states: EditorSearchStateFilter[] | undefined): Set<EditorSearchStateFilter> {
  const allowed = new Set<EditorSearchStateFilter>(['pending', 'empty', 'missing', 'skipped', 'master', 'target']);
  if (states === undefined || states.length === 0) return new Set();
  if (!Array.isArray(states)) {
    throw new EditorServiceError('Search states must be an array', 'INVALID_SEARCH_FILTER');
  }
  const normalized = new Set<EditorSearchStateFilter>();
  for (const state of states) {
    if (!allowed.has(state)) {
      throw new EditorServiceError(`Unsupported search state: ${String(state)}`, 'INVALID_SEARCH_FILTER');
    }
    normalized.add(state);
  }
  return normalized;
}

function searchCellMatchesStates(
  cell: EditorCell,
  isMaster: boolean,
  states: Set<EditorSearchStateFilter>,
): boolean {
  if (states.size === 0) return true;
  return (
    (states.has('pending') && cell.pending)
    || (states.has('empty') && cell.kind === 'empty')
    || (states.has('missing') && cell.kind === 'missing')
    || (states.has('skipped') && cell.skipped)
    || (states.has('master') && isMaster)
    || (states.has('target') && !isMaster)
  );
}

function editorCellKind(resolved: { exists: boolean; value: unknown }): EditorCellKind {
  if (!resolved.exists) return 'missing';
  if (typeof resolved.value !== 'string') return 'unsupported';
  return resolved.value.length === 0 ? 'empty' : 'string';
}

function findMatchRanges(value: string, lowerQuery: string): Array<{ start: number; end: number }> {
  if (!lowerQuery) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  const lowerValue = value.toLocaleLowerCase();
  let start = lowerValue.indexOf(lowerQuery);
  while (start !== -1) {
    ranges.push({ start, end: start + lowerQuery.length });
    if (ranges.length >= 20) break;
    start = lowerValue.indexOf(lowerQuery, start + Math.max(lowerQuery.length, 1));
  }
  return ranges;
}

export async function commitEditorWrites(writes: PlannedEditorWrite[]): Promise<void> {
  const staged: PlannedEditorWrite[] = [];
  const committed: PlannedEditorWrite[] = [];
  try {
    for (const write of writes) {
      await fs.mkdir(path.dirname(write.filePath), { recursive: true });
      write.tempPath = path.join(
        path.dirname(write.filePath),
        `.${path.basename(write.filePath)}.i18n-ai-diff-${crypto.randomBytes(8).toString('hex')}.tmp`,
      );
      const handle = await fs.open(write.tempPath, 'wx', write.mode || 0o644);
      try {
        await handle.writeFile(write.content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      staged.push(write);
    }

    for (const write of staged) {
      await fs.rename(write.tempPath!, write.filePath);
      write.tempPath = undefined;
      committed.push(write);
    }
  } catch (error) {
    for (const write of [...committed].reverse()) {
      try {
        if (write.original === null) await fs.rm(write.filePath, { force: true });
        else await restoreOriginal(write.filePath, write.original, write.mode);
      } catch {
        // Preserve the first failure; callers receive a failed save and can inspect the files.
      }
    }
    throw error;
  } finally {
    await Promise.all(staged.map(write => write.tempPath ? fs.rm(write.tempPath, { force: true }) : Promise.resolve()));
  }
}

async function restoreOriginal(filePath: string, content: string, mode?: number): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.i18n-ai-diff-rollback-${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  const handle = await fs.open(tempPath, 'wx', mode || 0o644);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tempPath, filePath);
}

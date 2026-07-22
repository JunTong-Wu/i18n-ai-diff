import {
  EditorFile,
  EditorManifest,
  EditorSaveRequest,
  EditorSaveResult,
  EditorSearchRequest,
  EditorSearchResponse,
  EditorSyncEvent,
  EditorMasterTranslateRequest,
  EditorTranslateRequest,
  EditorTranslateResult,
  ProjectScan,
  ResolvedTranslateConfig,
  SettingsConfigFile,
  SettingsConfigSaveRequest,
  SettingsConfigSaveResult,
  TranslationRunRequest,
  TranslationRunResult,
} from '../types/index.js';
import { loadConfigWithMetadata } from './config-loader.js';
import { createSnapshotStore, SnapshotStore } from './diff-analyzer.js';
import { TranslationEditorService } from './editor-service.js';
import { PanelFileEventHub } from './panel-event-hub.js';
import { scanProject } from './project-inspector.js';
import { TranslationSettingsService } from './settings-service.js';
import { runTranslationShortcut } from './translation-runner.js';

export interface ProjectSessionOptions {
  configPath?: string;
  cwd?: string;
}

export class ProjectSession {
  readonly config: ResolvedTranslateConfig;
  readonly configPath: string;
  readonly projectRoot: string;
  private readonly editor: TranslationEditorService;
  private readonly events: PanelFileEventHub;
  private readonly settings: TranslationSettingsService;
  private readonly snapshotStore: SnapshotStore;
  private activeScan?: Promise<ProjectScan>;
  private serial: Promise<void> = Promise.resolve();

  private constructor(
    config: ResolvedTranslateConfig,
    configPath: string,
    projectRoot: string,
  ) {
    this.config = config;
    this.configPath = configPath;
    this.projectRoot = projectRoot;
    this.snapshotStore = createSnapshotStore(config.cachePath || '.i18n-translate-cache.json');
    this.editor = new TranslationEditorService(config, projectRoot);
    this.events = new PanelFileEventHub(config, configPath);
    this.settings = new TranslationSettingsService(config, configPath, projectRoot);
  }

  static async open(options: ProjectSessionOptions = {}): Promise<ProjectSession> {
    const projectRoot = options.cwd || process.cwd();
    const loaded = await loadConfigWithMetadata(options.configPath, projectRoot);
    return new ProjectSession(loaded.config, loaded.filepath, projectRoot);
  }

  async scan(): Promise<ProjectScan> {
    if (this.activeScan) return this.activeScan;
    this.activeScan = this.runExclusive(async () => {
      await this.snapshotStore.load();
      return scanProject(this.config, this.projectRoot, this.configPath, this.snapshotStore);
    });

    try {
      return await this.activeScan;
    } finally {
      this.activeScan = undefined;
    }
  }

  async getEditorManifest(editable: boolean, writeToken?: string): Promise<EditorManifest> {
    return this.runExclusive(async () => {
      return this.editor.getManifest(editable, writeToken);
    });
  }

  async getEditorFile(relativePath: string): Promise<EditorFile> {
    return this.runExclusive(async () => {
      return this.editor.getFile(relativePath);
    });
  }

  async searchEditorCopy(request: EditorSearchRequest): Promise<EditorSearchResponse> {
    return this.runExclusive(async () => {
      return this.editor.search(request);
    });
  }

  async saveEditorFile(request: EditorSaveRequest): Promise<EditorSaveResult> {
    return this.runExclusive(async () => {
      const result = await this.editor.saveFile(request);
      await this.snapshotStore.load();
      const project = await scanProject(this.config, this.projectRoot, this.configPath, this.snapshotStore);
      return { ...result, project };
    });
  }

  async translateEditorCells(
    request: EditorTranslateRequest,
    hooks: {
      signal?: AbortSignal;
      onProgress?: (results: EditorTranslateResult[]) => void;
    } = {},
  ): Promise<EditorTranslateResult[]> {
    return this.runExclusive(async () => {
      return this.editor.translateCells(request, hooks);
    });
  }

  async translateEditorMasterCells(
    request: EditorMasterTranslateRequest,
    hooks: {
      signal?: AbortSignal;
      onProgress?: (results: EditorTranslateResult[]) => void;
    } = {},
  ): Promise<EditorTranslateResult[]> {
    return this.runExclusive(async () => {
      return this.editor.translateMasterCells(request, hooks);
    });
  }

  async runTranslationShortcut(request: TranslationRunRequest): Promise<TranslationRunResult> {
    return this.runExclusive(async () => {
      const result = await runTranslationShortcut(this.config, request);
      await this.snapshotStore.load();
      const project = await scanProject(this.config, this.projectRoot, this.configPath, this.snapshotStore);
      return { ...result, project };
    });
  }

  async getSettingsConfig(editable: boolean, writeToken?: string): Promise<SettingsConfigFile> {
    return this.runExclusive(async () => {
      return this.settings.getConfig(editable, writeToken);
    });
  }

  async saveSettingsConfig(request: SettingsConfigSaveRequest): Promise<SettingsConfigSaveResult> {
    return this.runExclusive(async () => {
      return this.settings.saveConfig(request);
    });
  }

  subscribeToEditorEvents(listener: (event: EditorSyncEvent) => void): () => void {
    return this.events.subscribe(listener);
  }

  async close(): Promise<void> {
    await this.events.close();
  }

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.serial.then(task, task);
    this.serial = run.then(() => undefined, () => undefined);
    return run;
  }
}

export async function createProjectSession(
  options: ProjectSessionOptions = {},
): Promise<ProjectSession> {
  return ProjectSession.open(options);
}

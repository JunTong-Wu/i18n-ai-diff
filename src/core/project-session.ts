import {
  EditorFile,
  EditorManifest,
  EditorSaveRequest,
  EditorSaveResult,
  EditorTranslateRequest,
  EditorTranslateResult,
  ProjectScan,
  ResolvedTranslateConfig,
} from '../types/index.js';
import { loadConfigWithMetadata } from './config-loader.js';
import { createSnapshotStore, SnapshotStore } from './diff-analyzer.js';
import { TranslationEditorService } from './editor-service.js';
import { scanProject } from './project-inspector.js';

export interface ProjectSessionOptions {
  configPath?: string;
  cwd?: string;
}

export class ProjectSession {
  readonly config: ResolvedTranslateConfig;
  readonly configPath: string;
  readonly projectRoot: string;
  private readonly editor: TranslationEditorService;
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

import { ProjectScan, ResolvedTranslateConfig } from '../types/index.js';
import { loadConfigWithMetadata } from './config-loader.js';
import { loadSnapshot } from './diff-analyzer.js';
import { scanProject } from './project-inspector.js';

export interface ProjectSessionOptions {
  configPath?: string;
  cwd?: string;
}

export class ProjectSession {
  readonly config: ResolvedTranslateConfig;
  readonly configPath: string;
  readonly projectRoot: string;
  private activeScan?: Promise<ProjectScan>;

  private constructor(
    config: ResolvedTranslateConfig,
    configPath: string,
    projectRoot: string,
  ) {
    this.config = config;
    this.configPath = configPath;
    this.projectRoot = projectRoot;
  }

  static async open(options: ProjectSessionOptions = {}): Promise<ProjectSession> {
    const projectRoot = options.cwd || process.cwd();
    const loaded = await loadConfigWithMetadata(options.configPath, projectRoot);
    return new ProjectSession(loaded.config, loaded.filepath, projectRoot);
  }

  async scan(): Promise<ProjectScan> {
    if (this.activeScan) return this.activeScan;
    this.activeScan = (async () => {
      await loadSnapshot(this.config.cachePath || '.i18n-translate-cache.json');
      return scanProject(this.config, this.projectRoot, this.configPath);
    })();

    try {
      return await this.activeScan;
    } finally {
      this.activeScan = undefined;
    }
  }
}

export async function createProjectSession(
  options: ProjectSessionOptions = {},
): Promise<ProjectSession> {
  return ProjectSession.open(options);
}

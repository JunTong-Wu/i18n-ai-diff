import type {
  EditorCell,
  EditorFile,
  EditorManifest,
  EditorManifestFile,
  EditorPatch,
  EditorRow,
  EditorAcceptedTranslation,
  EditorSearchRequest,
  EditorSearchResponse,
  EditorSearchResult,
  EditorSearchStateFilter,
  EditorSaveRequest,
  EditorSaveResult,
  EditorMasterTranslateOptions,
  EditorMasterTranslateRequest,
  EditorTranslateCell,
  EditorTranslateJob,
  EditorTranslateOptions,
  EditorTranslateRequest,
  EditorTranslateResult,
  EditorSyncEvent,
  ProjectScan,
  SettingsConfigFile,
  SettingsConfigSaveRequest,
  SettingsConfigSaveResult,
  TranslationRunJob,
  TranslationRunRequest,
  TranslationRunResult,
} from '../types/index.js';

export interface PanelProjectRuntimeFields {
  version: string;
  localOnly: true;
}

export type PanelProject = ProjectScan & PanelProjectRuntimeFields;

export interface PanelHealth {
  status: 'ok';
  version: string;
  localOnly: true;
}

export type PanelTranslationFilePlan = ProjectScan['changes'][number];
export type PanelTranslationRoutePlan = ProjectScan['routes'][number];
export type PanelTranslationTargetPlan = PanelTranslationRoutePlan['targets'][number];

export type PanelEditorManifestFile = EditorManifestFile;
export type PanelEditorManifest = EditorManifest;
export type PanelEditorCell = EditorCell;
export type PanelEditorRow = EditorRow;
export type PanelEditorFile = EditorFile;
export type PanelEditorPatch = EditorPatch;
export type PanelEditorAcceptedTranslation = EditorAcceptedTranslation;
export type PanelEditorSearchRequest = EditorSearchRequest;
export type PanelEditorSearchResponse = EditorSearchResponse;
export type PanelEditorSearchResult = EditorSearchResult;
export type PanelEditorSearchStateFilter = EditorSearchStateFilter;
export type PanelEditorSaveRequest = EditorSaveRequest;
export type PanelEditorSaveResult = Omit<EditorSaveResult, 'project'> & {
  project: PanelProject;
};
export type PanelEditorMasterTranslateOptions = EditorMasterTranslateOptions;
export type PanelEditorMasterTranslateRequest = EditorMasterTranslateRequest;
export type PanelEditorTranslateCell = EditorTranslateCell;
export type PanelEditorTranslateOptions = EditorTranslateOptions;
export type PanelEditorTranslateRequest = EditorTranslateRequest;
export type PanelEditorTranslateResult = EditorTranslateResult;
export type PanelEditorTranslateJob = EditorTranslateJob;
export type PanelEditorSyncEvent = EditorSyncEvent;
export type PanelTranslationRunRequest = TranslationRunRequest;
export type PanelTranslationRunResult = Omit<TranslationRunResult, 'project'> & {
  project: PanelProject;
};
export type PanelTranslationRunJob = Omit<TranslationRunJob, 'project'> & {
  project?: PanelProject;
};
export type PanelSettingsConfigFile = SettingsConfigFile;
export type PanelSettingsConfigSaveRequest = SettingsConfigSaveRequest;
export type PanelSettingsConfigSaveResult = SettingsConfigSaveResult;

export interface PanelContractContext {
  packageVersion: string;
}

export function toPanelProject(
  scan: ProjectScan,
  context: PanelContractContext,
): PanelProject {
  return {
    ...scan,
    version: context.packageVersion,
    localOnly: true,
  };
}

export function toPanelEditorSaveResult(
  result: EditorSaveResult,
  context: PanelContractContext,
): PanelEditorSaveResult {
  return {
    ...result,
    project: toPanelProject(result.project, context),
  };
}

export function toPanelTranslationRunResult(
  result: TranslationRunResult,
  context: PanelContractContext,
): PanelTranslationRunResult {
  return {
    ...result,
    project: toPanelProject(result.project, context),
  };
}

export function toPanelTranslationRunJob(
  job: TranslationRunJob,
  context: PanelContractContext,
): PanelTranslationRunJob {
  const { project, ...rest } = job;
  return {
    ...rest,
    ...(project ? { project: toPanelProject(project, context) } : {}),
  };
}

export function toPanelHealth(context: PanelContractContext): PanelHealth {
  return {
    status: 'ok',
    version: context.packageVersion,
    localOnly: true,
  };
}

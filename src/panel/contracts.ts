import type {
  EditorCell,
  EditorFile,
  EditorManifest,
  EditorManifestFile,
  EditorPatch,
  EditorRow,
  EditorSaveRequest,
  EditorSaveResult,
  ProjectScan,
} from '../types/index.js';

export interface PanelCapabilities {
  contentEditing: boolean;
}

export interface PanelProjectRuntimeFields {
  version: string;
  localOnly: true;
  capabilities: PanelCapabilities;
}

export type PanelProject = ProjectScan & PanelProjectRuntimeFields;

export interface PanelHealth {
  status: 'ok';
  version: string;
  localOnly: true;
  editable: boolean;
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
export type PanelEditorSaveRequest = EditorSaveRequest;
export type PanelEditorSaveResult = Omit<EditorSaveResult, 'project'> & {
  project: PanelProject;
};

export interface PanelContractContext {
  packageVersion: string;
  editable: boolean;
}

export function toPanelProject(
  scan: ProjectScan,
  context: PanelContractContext,
): PanelProject {
  return {
    ...scan,
    version: context.packageVersion,
    localOnly: true,
    capabilities: { contentEditing: context.editable },
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

export function toPanelHealth(context: PanelContractContext): PanelHealth {
  return {
    status: 'ok',
    version: context.packageVersion,
    localOnly: true,
    editable: context.editable,
  };
}

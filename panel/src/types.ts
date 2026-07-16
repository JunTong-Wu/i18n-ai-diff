import type {
  EditorFile,
  EditorManifest,
  EditorSaveRequest,
  EditorSaveResult,
  ProjectScan,
} from '../../src/types/index';

export type PanelProject = ProjectScan & {
  version: string;
  localOnly: true;
  capabilities: {
    contentEditing: boolean;
  };
};

export type PanelEditorManifest = EditorManifest;
export type PanelEditorFile = EditorFile;
export type PanelEditorSaveRequest = EditorSaveRequest;
export type PanelEditorSaveResult = EditorSaveResult;

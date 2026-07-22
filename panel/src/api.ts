import type {
  PanelEditorFile,
  PanelEditorManifest,
  PanelEditorSaveRequest,
  PanelEditorSaveResult,
  PanelEditorSyncEvent,
  PanelEditorTranslateJob,
  PanelEditorTranslateRequest,
  PanelProject,
} from './types';

export class PanelApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PanelApiError';
  }
}

export async function loadProject(
  refresh = false,
  signal?: AbortSignal,
): Promise<PanelProject> {
  const response = await fetch(refresh ? '/api/scan' : '/api/project', {
    method: refresh ? 'POST' : 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  return readResponse<PanelProject>(response);
}

export async function loadEditorManifest(signal?: AbortSignal): Promise<PanelEditorManifest> {
  return readResponse<PanelEditorManifest>(await fetch('/api/editor/manifest', {
    headers: { Accept: 'application/json' },
    signal,
  }));
}

export async function loadEditorFile(
  relativePath: string,
  signal?: AbortSignal,
): Promise<PanelEditorFile> {
  const query = new URLSearchParams({ path: relativePath });
  return readResponse<PanelEditorFile>(await fetch(`/api/editor/file?${query}`, {
    headers: { Accept: 'application/json' },
    signal,
  }));
}

export async function saveEditorFile(
  request: PanelEditorSaveRequest,
  writeToken: string,
): Promise<PanelEditorSaveResult> {
  return readResponse<PanelEditorSaveResult>(await fetch('/api/editor/file', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-I18n-Panel-Token': writeToken,
    },
    body: JSON.stringify(request),
  }));
}

export async function createEditorTranslateJob(
  request: PanelEditorTranslateRequest,
  writeToken: string,
): Promise<PanelEditorTranslateJob> {
  return readResponse<PanelEditorTranslateJob>(await fetch('/api/editor/translate-jobs', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-I18n-Panel-Token': writeToken,
    },
    body: JSON.stringify(request),
  }));
}

export async function loadEditorTranslateJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<PanelEditorTranslateJob> {
  return readResponse<PanelEditorTranslateJob>(await fetch(`/api/editor/translate-jobs/${encodeURIComponent(jobId)}`, {
    headers: { Accept: 'application/json' },
    signal,
  }));
}

export async function cancelEditorTranslateJob(
  jobId: string,
  writeToken: string,
): Promise<PanelEditorTranslateJob> {
  return readResponse<PanelEditorTranslateJob>(await fetch(`/api/editor/translate-jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      'X-I18n-Panel-Token': writeToken,
    },
  }));
}

export function connectEditorEvents(
  onEvent: (event: PanelEditorSyncEvent) => void,
  onConnectionChange?: (state: 'connected' | 'disconnected') => void,
): () => void {
  const source = new EventSource('/api/editor/events');
  const handleSyncEvent = (event: MessageEvent<string>) => {
    onEvent(JSON.parse(event.data) as PanelEditorSyncEvent);
  };
  source.addEventListener('editor:file-changed', handleSyncEvent);
  source.addEventListener('editor:project-changed', handleSyncEvent);
  source.addEventListener('editor:connected', () => onConnectionChange?.('connected'));
  source.onopen = () => onConnectionChange?.('connected');
  source.onerror = () => onConnectionChange?.('disconnected');
  return () => {
    source.removeEventListener('editor:file-changed', handleSyncEvent);
    source.removeEventListener('editor:project-changed', handleSyncEvent);
    source.close();
  };
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as {
    data?: T;
    error?: { code?: string; message?: string; details?: unknown };
  };
  if (!response.ok || body.data === undefined) {
    throw new PanelApiError(
      body.error?.message || `Panel request failed (${response.status})`,
      response.status,
      body.error?.code,
      body.error?.details,
    );
  }
  return body.data;
}

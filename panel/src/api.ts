import type { PanelProject } from './types';

export async function loadProject(
  refresh = false,
  signal?: AbortSignal,
): Promise<PanelProject> {
  const response = await fetch(refresh ? '/api/scan' : '/api/project', {
    method: refresh ? 'POST' : 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  const body = await response.json() as {
    data?: PanelProject;
    error?: { message?: string };
  };

  if (!response.ok || !body.data) {
    throw new Error(body.error?.message || `Panel request failed (${response.status})`);
  }
  return body.data;
}

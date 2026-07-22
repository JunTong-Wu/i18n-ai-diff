import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import http, { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  EditorFile,
  EditorManifest,
  EditorSaveRequest,
  EditorSaveResult,
  EditorSyncEvent,
  EditorTranslateJob,
  EditorTranslateRequest,
  EditorTranslateResult,
  ProjectScan,
} from '../types/index.js';
import { EditorServiceError } from '../core/editor-service.js';
import { warn } from '../utils/logger.js';
import {
  toPanelEditorSaveResult,
  toPanelHealth,
  toPanelProject,
} from './contracts.js';

const LOOPBACK_HOST = '127.0.0.1';

export interface PanelServerOptions {
  port?: number;
  open?: boolean;
  packageVersion: string;
  clientRoot?: string;
  editable?: boolean;
}

export interface RunningPanelServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

interface PanelSession {
  scan(): Promise<ProjectScan>;
  getEditorManifest?(editable: boolean, writeToken?: string): Promise<EditorManifest>;
  getEditorFile?(relativePath: string): Promise<EditorFile>;
  saveEditorFile?(request: EditorSaveRequest): Promise<EditorSaveResult>;
  translateEditorCells?(
    request: EditorTranslateRequest,
    hooks?: {
      signal?: AbortSignal;
      onProgress?: (results: EditorTranslateResult[]) => void;
    },
  ): Promise<EditorTranslateResult[]>;
  subscribeToEditorEvents?(listener: (event: EditorSyncEvent) => void): () => void;
  close?(): Promise<void> | void;
}

interface ServerTranslateJob extends EditorTranslateJob {
  controller: AbortController;
}

export async function startPanelServer(
  session: PanelSession,
  options: PanelServerOptions,
): Promise<RunningPanelServer> {
  const clientRoot = options.clientRoot
    || fileURLToPath(new URL('./client/', import.meta.url));
  const editable = options.editable === true;
  const contractContext = {
    packageVersion: options.packageVersion,
    editable,
  };
  const writeToken = editable ? crypto.randomBytes(32).toString('base64url') : undefined;
  const translateJobs = new Map<string, ServerTranslateJob>();
  let serverUrl = '';
  const runTranslateJob = async (job: ServerTranslateJob, body: EditorTranslateRequest) => {
    if (!session.translateEditorCells) {
      job.status = 'failed';
      job.error = 'Editor translation API is unavailable';
      job.updatedAt = new Date().toISOString();
      return;
    }
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    try {
      const finalResults = await session.translateEditorCells(body, {
        signal: job.controller.signal,
        onProgress: results => {
          if (isTranslateJobCancelled(job)) return;
          job.results.push(...results);
          job.completed = job.results.length;
          job.updatedAt = new Date().toISOString();
        },
      });
      if (isTranslateJobCancelled(job) || job.controller.signal.aborted) return;
      if (job.results.length < finalResults.length) {
        job.results = finalResults;
        job.completed = finalResults.length;
      }
      job.status = 'completed';
      job.updatedAt = new Date().toISOString();
    } catch (error) {
      if (job.controller.signal.aborted) {
        job.status = 'cancelled';
      } else {
        job.status = 'failed';
        job.error = (error as Error).message;
      }
      job.updatedAt = new Date().toISOString();
    }
  };

  const server = http.createServer(async (request, response) => {
    applySecurityHeaders(response);
    if (!isAllowedHost(request.headers.host)) {
      sendJson(response, 403, { error: { message: 'Invalid host' } });
      return;
    }

    const requestUrl = new URL(request.url || '/', serverUrl || `http://${LOOPBACK_HOST}`);
    if (!isAllowedOrigin(request, serverUrl)) {
      sendJson(response, 403, { error: { message: 'Invalid origin' } });
      return;
    }

    try {
      if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
        sendJson(response, 200, {
          data: toPanelHealth(contractContext),
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/editor/events') {
        if (!session.subscribeToEditorEvents) {
          sendJson(response, 501, { error: { code: 'EDITOR_EVENTS_UNAVAILABLE', message: 'Editor event stream is unavailable' } });
          return;
        }
        openEditorEventStream(
          request,
          response,
          listener => session.subscribeToEditorEvents!(listener),
        );
        return;
      }

      if (
        (request.method === 'GET' && requestUrl.pathname === '/api/project')
        || (request.method === 'POST' && requestUrl.pathname === '/api/scan')
      ) {
        const scan = await session.scan();
        sendJson(response, 200, {
          data: toPanelProject(scan, contractContext),
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/editor/manifest') {
        if (!session.getEditorManifest) {
          sendJson(response, 501, { error: { code: 'EDITOR_UNAVAILABLE', message: 'Editor API is unavailable' } });
          return;
        }
        sendJson(response, 200, {
          data: await session.getEditorManifest(editable, writeToken),
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/editor/file') {
        if (!session.getEditorFile) {
          sendJson(response, 501, { error: { code: 'EDITOR_UNAVAILABLE', message: 'Editor API is unavailable' } });
          return;
        }
        const relativePath = requestUrl.searchParams.get('path');
        if (!relativePath) {
          sendJson(response, 400, { error: { code: 'INVALID_PATH', message: 'File path is required' } });
          return;
        }
        sendJson(response, 200, { data: await session.getEditorFile(relativePath) });
        return;
      }

      if (request.method === 'PUT' && requestUrl.pathname === '/api/editor/file') {
        if (!editable) {
          sendJson(response, 403, {
            error: { code: 'EDIT_MODE_DISABLED', message: 'Restart the panel with --edit to write locale files' },
          });
          return;
        }
        if (!session.saveEditorFile) {
          sendJson(response, 501, { error: { code: 'EDITOR_UNAVAILABLE', message: 'Editor API is unavailable' } });
          return;
        }
        if (!writeToken || request.headers['x-i18n-panel-token'] !== writeToken) {
          sendJson(response, 403, { error: { code: 'INVALID_WRITE_TOKEN', message: 'Invalid editor write token' } });
          return;
        }
        if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          sendJson(response, 415, { error: { code: 'INVALID_CONTENT_TYPE', message: 'Expected application/json' } });
          return;
        }
        const body = await readJsonBody(request, 5 * 1024 * 1024) as EditorSaveRequest;
        const result = await session.saveEditorFile(body);
        sendJson(response, 200, { data: toPanelEditorSaveResult(result, contractContext) });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/editor/translate-jobs') {
        if (!editable) {
          sendJson(response, 403, {
            error: { code: 'EDIT_MODE_DISABLED', message: 'Restart the panel with --edit to run AI translations' },
          });
          return;
        }
        if (!session.translateEditorCells) {
          sendJson(response, 501, { error: { code: 'EDITOR_TRANSLATION_UNAVAILABLE', message: 'Editor translation API is unavailable' } });
          return;
        }
        if (!writeToken || request.headers['x-i18n-panel-token'] !== writeToken) {
          sendJson(response, 403, { error: { code: 'INVALID_WRITE_TOKEN', message: 'Invalid editor write token' } });
          return;
        }
        if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          sendJson(response, 415, { error: { code: 'INVALID_CONTENT_TYPE', message: 'Expected application/json' } });
          return;
        }
        const body = await readJsonBody(request, 5 * 1024 * 1024) as EditorTranslateRequest;
        const now = new Date().toISOString();
        const job: ServerTranslateJob = {
          id: crypto.randomUUID(),
          status: 'queued',
          createdAt: now,
          updatedAt: now,
          total: Array.isArray(body.cells) ? body.cells.length : 0,
          completed: 0,
          results: [],
          controller: new AbortController(),
        };
        translateJobs.set(job.id, job);
        void runTranslateJob(job, body);
        sendJson(response, 202, { data: publicTranslateJob(job) });
        return;
      }

      const translateJobMatch = requestUrl.pathname.match(/^\/api\/editor\/translate-jobs\/([^/]+)$/u);
      if (translateJobMatch && (request.method === 'GET' || request.method === 'DELETE')) {
        const job = translateJobs.get(translateJobMatch[1]);
        if (!job) {
          sendJson(response, 404, { error: { code: 'TRANSLATE_JOB_NOT_FOUND', message: 'Translation job not found' } });
          return;
        }
        if (request.method === 'DELETE') {
          if (!editable) {
            sendJson(response, 403, {
              error: { code: 'EDIT_MODE_DISABLED', message: 'Restart the panel with --edit to run AI translations' },
            });
            return;
          }
          if (!writeToken || request.headers['x-i18n-panel-token'] !== writeToken) {
            sendJson(response, 403, { error: { code: 'INVALID_WRITE_TOKEN', message: 'Invalid editor write token' } });
            return;
          }
          if (job.status === 'queued' || job.status === 'running') {
            job.controller.abort();
            job.status = 'cancelled';
            job.updatedAt = new Date().toISOString();
          }
        }
        sendJson(response, 200, { data: publicTranslateJob(job) });
        return;
      }

      if (requestUrl.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: { message: 'API route not found' } });
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: { message: 'Method not allowed' } });
        return;
      }

      await serveStatic(clientRoot, requestUrl.pathname, request, response);
    } catch (error) {
      if (response.headersSent) {
        warn(`Panel response failed after headers were sent: ${(error as Error).message}`);
        response.destroy(error as Error);
        return;
      }
      if (error instanceof EditorServiceError) {
        sendJson(response, error.status, {
          error: { code: error.code, message: error.message, details: error.details },
        });
        return;
      }
      sendJson(response, 500, {
        error: { message: (error as Error).message || 'Unexpected panel error' },
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4178, LOOPBACK_HOST, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to resolve panel server address');
  }
  serverUrl = `http://${LOOPBACK_HOST}:${address.port}`;

  if (options.open !== false) {
    openBrowser(serverUrl);
  }

  return {
    url: serverUrl,
    port: address.port,
    close: async () => {
      await session.close?.();
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections?.();
      });
    },
  };
}

function openEditorEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  subscribe: (listener: (event: EditorSyncEvent) => void) => () => void,
): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders?.();

  const unsubscribe = subscribe(event => {
    writeEditorSse(response, event.type, event);
  });
  writeEditorSse(response, 'editor:connected', {
    type: 'editor:connected',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });

  const heartbeat = setInterval(() => {
    response.write(': ping\n\n');
  }, 25_000);

  request.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function writeEditorSse(response: ServerResponse, eventName: string, payload: unknown): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new EditorServiceError('Request body is too large', 'REQUEST_TOO_LARGE', 413);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new EditorServiceError('Request body must be valid JSON', 'INVALID_JSON_BODY');
  }
}

function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host);
}

function isAllowedOrigin(request: IncomingMessage, serverUrl: string): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const origin = request.headers.origin;
  return origin === serverUrl || origin === serverUrl.replace('127.0.0.1', 'localhost');
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
      + "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

function publicTranslateJob(job: ServerTranslateJob): EditorTranslateJob {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    total: job.total,
    completed: job.completed,
    results: job.results,
    ...(job.error ? { error: job.error } : {}),
  };
}

function isTranslateJobCancelled(job: ServerTranslateJob): boolean {
  return job.status === 'cancelled';
}

async function serveStatic(
  clientRoot: string,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const decoded = decodeURIComponent(pathname);
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const root = path.resolve(clientRoot);
  let filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    sendJson(response, 404, { error: { message: 'File not found' } });
    return;
  }

  let file: Buffer;
  try {
    file = await fs.readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    if (path.extname(relativePath)) {
      sendJson(response, 404, { error: { message: 'File not found' } });
      return;
    }
    filePath = path.join(root, 'index.html');
    file = await fs.readFile(filePath);
  }

  response.statusCode = 200;
  response.setHeader('Content-Type', contentType(filePath));
  response.setHeader(
    'Cache-Control',
    relativePath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
  if (request.method === 'HEAD') response.end();
  else response.end(file);
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };
  return types[extension] || 'application/octet-stream';
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin'
    ? { executable: 'open', args: [url] }
    : process.platform === 'win32'
      ? { executable: 'cmd', args: ['/c', 'start', '', url] }
      : { executable: 'xdg-open', args: [url] };

  try {
    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', error => warn(`Could not open browser: ${error.message}`));
    child.unref();
  } catch (error) {
    warn(`Could not open browser: ${(error as Error).message}`);
  }
}

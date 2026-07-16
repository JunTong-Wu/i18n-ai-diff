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
  ProjectScan,
} from '../types/index.js';
import { EditorServiceError } from '../core/editor-service.js';
import { warn } from '../utils/logger.js';

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
}

export async function startPanelServer(
  session: PanelSession,
  options: PanelServerOptions,
): Promise<RunningPanelServer> {
  const clientRoot = options.clientRoot
    || fileURLToPath(new URL('./client/', import.meta.url));
  const editable = options.editable === true;
  const writeToken = editable ? crypto.randomBytes(32).toString('base64url') : undefined;
  let serverUrl = '';
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
          data: { status: 'ok', version: options.packageVersion, localOnly: true, editable },
        });
        return;
      }

      if (
        (request.method === 'GET' && requestUrl.pathname === '/api/project')
        || (request.method === 'POST' && requestUrl.pathname === '/api/scan')
      ) {
        const scan = await session.scan();
        sendJson(response, 200, {
          data: {
            ...scan,
            version: options.packageVersion,
            localOnly: true,
            capabilities: { contentEditing: editable },
          },
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
        sendJson(response, 200, { data: await session.saveEditorFile(body) });
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
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
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

import { spawn } from 'child_process';
import fs from 'fs/promises';
import http, { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProjectScan } from '../types/index.js';
import { warn } from '../utils/logger.js';

const LOOPBACK_HOST = '127.0.0.1';

export interface PanelServerOptions {
  port?: number;
  open?: boolean;
  packageVersion: string;
  clientRoot?: string;
}

export interface RunningPanelServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

interface PanelSession {
  scan(): Promise<ProjectScan>;
}

export async function startPanelServer(
  session: PanelSession,
  options: PanelServerOptions,
): Promise<RunningPanelServer> {
  const clientRoot = options.clientRoot
    || fileURLToPath(new URL('./client/', import.meta.url));
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
          data: { status: 'ok', version: options.packageVersion, localOnly: true },
        });
        return;
      }

      if (
        (request.method === 'GET' && requestUrl.pathname === '/api/project')
        || (request.method === 'POST' && requestUrl.pathname === '/api/scan')
      ) {
        const scan = await session.scan();
        sendJson(response, 200, {
          data: { ...scan, version: options.packageVersion, localOnly: true },
        });
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

function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host);
}

function isAllowedOrigin(request: IncomingMessage, serverUrl: string): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const origin = request.headers.origin;
  return !origin || origin === serverUrl || origin === serverUrl.replace('127.0.0.1', 'localhost');
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

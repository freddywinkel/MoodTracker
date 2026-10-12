// Local browser-test server. This is not bundled or deployed with the app.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Map(['dist', 'dist-upgrade'].map(name => [name, resolve(workspace, name)]));
let serving = allowed.get('dist');
const port = Number(process.env.MOOD_QA_PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/__qa/health') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ directory: serving }));
      return;
    }
    if (url.pathname === '/__qa/switch' && request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length > 1024) throw new Error('Request too large');
      }
      const { directory } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const next = allowed.get(directory);
      if (!next || !(await stat(resolve(next, 'index.html'))).isFile()) {
        response.writeHead(400).end('Choose a built test fixture');
        return;
      }
      serving = next;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ directory }));
      return;
    }
    if (request.method !== 'GET' || !url.pathname.startsWith('/MoodTracker/')) {
      response.writeHead(404).end('Not found');
      return;
    }
    const suffix = decodeURIComponent(url.pathname.slice('/MoodTracker/'.length));
    const file = resolve(serving, suffix || 'index.html');
    if (!file.startsWith(serving + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const content = await readFile(file);
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    if (suffix === 'sw.js') response.setHeader('Service-Worker-Allowed', '/MoodTracker/');
    response.end(content);
  } catch (error) {
    response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end('Unable to serve test fixture');
  }
}).listen(port, '127.0.0.1', () => console.log(`MoodTracker test fixture on http://127.0.0.1:${port}/MoodTracker/`));

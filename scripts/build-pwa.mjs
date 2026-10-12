import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, sep } from 'node:path';
import sharp from 'sharp';
const root = resolve(process.env.MOOD_OUT_DIR || 'dist');
const base = '/MoodTracker/';
await mkdir(resolve(root, 'icons'), { recursive: true });
const icon = await readFile(resolve('public/icon.svg'));
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(icon).resize(size, size).png().toFile(resolve(root, 'icons', name));
}
const maskable = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#397363' } }).composite([{ input: await sharp(icon).resize(360, 360).png().toBuffer(), top: 76, left: 76 }]).png().toBuffer();
await writeFile(resolve(root, 'icons/maskable-512.png'), maskable);
await copyFile(resolve(root, 'index.html'), resolve(root, '404.html'));
await writeFile(resolve(root, '.nojekyll'), '');
async function walk(path) {
  const list = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = resolve(path, entry.name);
    if (entry.isDirectory()) list.push(...await walk(full));
    else list.push(full);
  }
  return list;
}
const files = (await walk(root)).filter(path => !['sw.js', '.nojekyll'].includes(relative(root, path))).sort();
const hash = createHash('sha256');
for (const file of files) hash.update(relative(root, file)).update(await readFile(file));
const cacheName = 'moodtracker-shell-v1-' + hash.digest('hex').slice(0, 16);
const urls = files.map(path => base + relative(root, path).split(sep).join('/'));
const serviceWorker = `/* Generated application shell. Journal data lives in IndexedDB, never in this cache. */
const CACHE = ${JSON.stringify(cacheName)};
const BASE = ${JSON.stringify(base)};
const SHELL = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const url of SHELL) {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (!response.ok) throw new Error('Application shell unavailable');
        await cache.put(url, response);
      }
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
  // Updates wait for the user; never force a reload during a check-in.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Only this app's caches are eligible. IndexedDB is never touched.
    for (const name of await caches.keys()) {
      if (name.startsWith('moodtracker-shell-v1-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'MOODTRACKER_APPLY_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode === 'navigate') {
      return (await cache.match(BASE + 'index.html')) || fetch(request);
    }
    const stored = await cache.match(request, { ignoreSearch: false });
    return stored || fetch(request);
  })());
});
`;
await writeFile(resolve(root, 'sw.js'), serviceWorker);
console.log('PWA shell ready: ' + cacheName + ' (' + files.length + ' bundled files)');

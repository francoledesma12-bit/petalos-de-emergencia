import { chromium } from 'playwright-core';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import http from 'node:http';

const fps = Number(process.env.FPS || 12);
const seconds = 104.92080000000001;
const framesDir = resolve('frames');
const root = resolve('dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
// Se conservan capturas anteriores; la numeración nueva reemplaza las necesarias.
await mkdir(framesDir, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true, args: ['--no-sandbox', '--disable-web-security'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}/?t=0`);
  await page.evaluate(() => document.fonts.ready);
  if (process.env.PREVIEW) {
    for (const [i,t] of [5,16,27,40,51,62,73,83,96].entries()) {
      await page.evaluate(value => window.renderFrame(value), t);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(framesDir, `preview-${i}.png`) });
    }
    process.stdout.write('Siete escenas de vista previa capturadas.\n');
    process.exit(0);
  }
  for (let i = 0; i < fps * seconds; i++) {
    await page.evaluate(t => window.renderFrame(t), i / fps);
    await page.screenshot({ path: join(framesDir, `frame-${String(i).padStart(5, '0')}.png`) });
    if (i % (fps * 10) === 0) process.stdout.write(`Capturados ${Math.floor(i / fps)} de ${seconds} s\n`);
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }

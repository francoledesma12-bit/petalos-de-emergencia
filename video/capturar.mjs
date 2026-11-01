import { chromium } from 'playwright-core';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fps = Number(process.env.FPS || 12);
const seconds = 75;
const framesDir = resolve('frames');
await rm(framesDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true, args: ['--no-sandbox', '--disable-web-security'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?t=0');
  await page.addStyleTag({ path: resolve('dist/demo.css') });
  await page.evaluate(() => document.fonts.ready);
  if (process.env.PREVIEW) {
    for (const [i,t] of [4,13,23,36,49,59,70].entries()) {
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
} finally { await browser.close(); }

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve('dist');
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.png':'image/png' };
const server = http.createServer(async (req,res) => {
  try { const path = resolve(root, '.' + (req.url === '/' ? '/index.html' : new URL(req.url,'http://local').pathname)); if (!path.startsWith(root)) {res.writeHead(403).end();return;} const body=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream'}).end(body); }
  catch {res.writeHead(404).end();}
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const port=server.address().port;
const browser=await chromium.launch({executablePath:'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:resolve('recordings'),size:{width:1280,height:720}}});
  const page=await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(()=>document.fonts.ready);
  const duration=Number(process.env.DURATION||75000);
  console.log(`Grabando ${duration/1000} s…`);
  await page.waitForTimeout(duration);
  const path=await page.video().path();
  await context.close();
  console.log(path);
} finally {await browser.close();await new Promise(done=>server.close(done));}

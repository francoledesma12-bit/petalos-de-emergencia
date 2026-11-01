import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
try {
  for (const [role, key, url, heading] of [['dueno','test-dueno','panel','Hoy, bajo control.'],['taller','test-taller','taller','Qué armamos ahora.'],['reparto','test-reparto','reparto','Flores en camino.']]) {
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:3188/panel');
    await page.locator('#clave').fill(key);
    await page.locator('#login-form button').click();
    await page.waitForURL(new RegExp(`/${url}$`)).catch(()=>{});
    await page.getByRole('heading', { name: heading }).waitFor({ timeout: 15000 });
    const map = url==='taller' ? true : await page.locator('.leaflet-container').count()===1;
    console.log(`${role}: página=${new URL(page.url()).pathname}, mapa=${map?'sí':'no'}, errores=${errors.length?errors.join(' | '):'ninguno'}`);
    await context.close();
  }
} finally { await browser.close(); }

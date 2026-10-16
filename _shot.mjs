// Usage: node shot.mjs <baseUrl> <outDir> <path> [width] [actions]
import { chromium } from 'playwright-core';
const [, , base, out, path, width = '1440', actions = ''] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(base + path, { waitUntil: 'networkidle' });
for (const a of actions.split(';').filter(Boolean)) {
  const [kind, arg] = a.split('=');
  if (kind === 'click') await page.getByRole('button', { name: arg }).first().click();
  if (kind === 'link') await page.getByRole('link', { name: arg }).first().click();
  if (kind === 'goto') await page.goto(base + arg, { waitUntil: 'networkidle' });
  if (kind === 'wait') await page.waitForTimeout(Number(arg));
  await page.waitForLoadState('networkidle');
}
await page.waitForTimeout(600);
const name = `${out}/${path.replace(/[^a-z0-9]+/gi, '_') || 'home'}-${width}.png`;
await page.screenshot({ path: name, fullPage: true });
console.log(name);
console.log(logs.join('\n'));
await browser.close();

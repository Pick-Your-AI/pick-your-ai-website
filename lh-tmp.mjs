import { mkdir, rm, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { preview } from 'vite';

const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/builder'];
const runs = Number(process.env.RUNS ?? 3);
const out = '/tmp/lh-out';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
process.chdir('/home/karutoil/pickyour.ai');
const server = await preview({
  preview: { host: '127.0.0.1', port: 4319, strictPort: true },
  root: '/home/karutoil/pickyour.ai',
});
try {
  for (const path of paths) {
    const scores = [];
    for (let run = 1; run <= runs; run++) {
      const chrome = await launch({
        chromePath: chromium.executablePath(),
        chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage'],
      });
      try {
        const result = await lighthouse(`http://127.0.0.1:4319${path}`, {
          port: chrome.port,
          output: ['json'],
          onlyCategories: ['performance', 'accessibility'],
          logLevel: 'error',
        });
        const name = path.replace(/\//g, '_') || '_root';
        await writeFile(`${out}/${name}-${run}.json`, result.report);
        const lhr = result.lhr;
        scores.push(lhr.categories.performance.score);
        const m = (k) => lhr.audits[k].numericValue.toFixed(0);
        console.log(
          `${path} run ${run}: perf=${lhr.categories.performance.score} a11y=${lhr.categories.accessibility.score} fcp=${m('first-contentful-paint')} lcp=${m('largest-contentful-paint')} tbt=${m('total-blocking-time')} cls=${lhr.audits['cumulative-layout-shift'].numericValue.toFixed(3)} si=${m('speed-index')}`,
        );
      } finally {
        await chrome.kill();
      }
    }
    scores.sort();
    console.log(`  -> median ${scores[Math.floor(scores.length / 2)]}`);
  }
} finally {
  await new Promise((r) => server.httpServer.close(r));
}

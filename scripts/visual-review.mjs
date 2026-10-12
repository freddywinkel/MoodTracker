import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const context = await browser.newContext({ timezoneId: 'Europe/Amsterdam' });
const page = await context.newPage();
const base = process.env.MOOD_REVIEW_URL || 'http://127.0.0.1:4174/MoodTracker/';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('qa-artifacts', { recursive: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByLabel('Check-in date', { exact: true }).waitFor();
    await page.screenshot({ path: `qa-artifacts/empty-today-${viewport.width}.png`, fullPage: true });
  }
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.screenshot({ path: 'qa-artifacts/settings-phone.png', fullPage: true });
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).click();
  await page.screenshot({ path: 'qa-artifacts/dark-today-phone.png', fullPage: true });
  await writeFile('qa-artifacts/visual-review.json', JSON.stringify({ base, errors, physicalDevice: false }, null, 2));
  if (errors.length) throw new Error('Browser errors during visual review.');
  console.log('Visual review screenshots ready.');
} finally { await context.close(); await browser.close(); }

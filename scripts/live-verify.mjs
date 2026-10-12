import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const url = 'https://freddywinkel.github.io/MoodTracker/';
const watchUpgrade = process.argv.includes('--watch-upgrade');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, timezoneId: 'Europe/Amsterdam', locale: 'en-GB' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const report = { url, physicalDevice: false, checkedAt: new Date().toISOString(), checks: [], errors };
const check = label => { report.checks.push(label); console.log(label); };
async function nav(name) {
  const item = page.getByRole('navigation').getByRole('button', { name, exact: true });
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'page');
}
async function saved() { await page.getByTestId('save-status').filter({ hasText: 'Saved' }).waitFor(); }
async function backup() {
  await nav('Settings');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download full backup', exact: true }).click();
  const file = await waiting;
  return JSON.parse(await readFile(await file.path(), 'utf8'));
}
try {
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  assert.match(await page.title(), /MoodTracker/);
  await page.getByLabel('Check-in date', { exact: true }).waitFor();
  const date = await page.getByLabel('Check-in date', { exact: true }).inputValue();
  const manifest = await (await context.request.get(url + 'manifest.webmanifest')).json();
  for (const key of ['id', 'start_url', 'scope']) assert.equal(manifest[key], '/MoodTracker/');
  const worker = await context.request.get(url + 'sw.js');
  assert.equal(worker.status(), 200);
  check('Live HTTPS, stable manifest, and service worker verified');
  await page.getByRole('group', { name: 'Mood', exact: true }).getByRole('button', { name: 'Good', exact: true }).click();
  await page.getByLabel('Main sleep hours', { exact: true }).fill('7');
  await page.getByLabel('Main sleep minutes', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'No additional sleep', exact: true }).click();
  await saved();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('group', { name: 'Mood', exact: true }).getByRole('button', { name: 'Good', exact: true }).waitFor();
  const before = await backup();
  assert.equal(before.entries.length, 1);
  assert.equal(before.entries[0].date, date);
  assert.equal(before.entries[0].mood, 1);
  assert.equal(before.entries[0].mainSleep, 450);
  assert.equal(before.entries[0].additionalSleep, 0);
  check('Live check-in, reload, and full JSON export verified');
  await nav('Today');
  await mkdir(resolve('qa-artifacts'), { recursive: true });
  await page.screenshot({ path: resolve('qa-artifacts/live-ipad.png'), fullPage: true });
  if (watchUpgrade) {
    await nav('Settings');
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await nav('Today'); // Navigation flushes the setting before the next action.
    console.log('READY_FOR_LIVE_UPGRADE: old shell active with saved journal; deploy 1.0.1 now');
    const timeout = Date.now() + 600_000;
    while (Date.now() < timeout) {
      await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration?.update(); });
      if (await page.getByRole('button', { name: 'Update now', exact: true }).first().isVisible()) break;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    assert.ok(await page.getByRole('button', { name: 'Update now', exact: true }).first().isVisible(), 'live waiting worker never appeared');
    await page.getByRole('button', { name: /^A little more, if you like/ }).click();
    await page.getByLabel(/^Anything else to remember/).fill('Fictional release check: saved immediately before an app update.');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60_000 }),
      page.getByRole('button', { name: 'Update now', exact: true }).first().click(),
    ]);
    await page.getByLabel('Check-in date', { exact: true }).waitFor();
    await nav('Settings');
    await page.getByText('1.0.1', { exact: true }).waitFor();
    const after = await backup();
    assert.equal(after.entries[0].id, before.entries[0].id);
    assert.equal(after.entries[0].mood, 1);
    assert.equal(after.entries[0].mainSleep, 450);
    assert.equal(after.entries[0].note, 'Fictional release check: saved immediately before an app update.');
    assert.equal(after.settings.theme, 'dark');
    check('Actual live 1.0.0 → 1.0.1 update preserved entry ID, latest pending note, sleep, mood and theme');
  }
  await context.setOffline(true);
  await page.reload();
  await nav('Today');
  await page.getByRole('group', { name: 'Mood', exact: true }).getByRole('button', { name: 'Very good', exact: true }).click();
  await saved();
  await nav('History');
  assert.ok(await page.getByRole('button', { name: `Edit ${date}`, exact: true }).isVisible());
  const offline = await backup();
  assert.equal(offline.entries[0].mood, 2);
  check('Live-installed shell reopened offline; editing, history and export verified');
  assert.equal(errors.length, 0, 'browser page errors occurred');
  await writeFile(resolve('qa-artifacts/live-verification.json'), JSON.stringify(report, null, 2));
  console.log('LIVE_VERIFICATION_PASSED');
} finally {
  await context.close();
  await browser.close();
}

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Backup } from '../src/types';

const DATE = '2026-10-12';
const EARLIER = '2026-10-11';
const evidence = new WeakMap<BrowserContext, { errors: string[]; console: string[]; externalRequests: string[] }>();

async function openApp(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-12T20:00:00Z'));
  await page.goto('./');
  await expect(page.getByLabel('Check-in date', { exact: true })).toHaveValue(DATE);
}

async function navigate(page: Page, name: string) {
  const item = page.getByRole('navigation').getByRole('button', { name, exact: true });
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'page');
}

async function saved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveText('Saved locally');
}

async function chooseMood(page: Page, name = 'Good') {
  await moodOptions(page).getByRole('button', { name, exact: true }).click();
  await saved(page);
}

async function selectDate(page: Page, date: string) {
  await page.getByLabel('Check-in date', { exact: true }).fill(date);
  await expect(page.getByLabel('Check-in date', { exact: true })).toHaveValue(date);
  await expect(page.getByLabel('Check-in date', { exact: true })).toHaveAttribute('value', date);
  await expect(moodOptions(page)).toBeVisible();
}

async function downloadBackup(page: Page): Promise<{ data: Backup; bytes: Buffer }> {
  await navigate(page, 'Settings');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download full backup', exact: true }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const data = JSON.parse(bytes.toString('utf8')) as Backup;
  expect(data.app).toBe('moodtracker');
  expect(data.version).toBe(1);
  return { data, bytes };
}

async function restoreFile(page: Page, bytes: Buffer) {
  await navigate(page, 'Settings');
  await page.locator('input[type="file"]').setInputFiles({ name: 'moodtracker-backup.json', mimeType: 'application/json', buffer: bytes });
}

async function removeDay(page: Page) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: `Delete entry for ${DATE}`, exact: true }).click();
}

const optionalToggle = (page: Page) => page.getByRole('button', { name: /^A little more, if you like/ });
const noteField = (page: Page) => page.getByLabel(/^Anything else to remember/);
const moodOptions = (page: Page) => page.getByRole('group', { name: 'Mood', exact: true });

async function readyOffline(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test.beforeEach(async ({ request, context, page }) => {
  const record = { errors: [] as string[], console: [] as string[], externalRequests: [] as string[] };
  evidence.set(context, record);
  const observe = (surface: Page) => {
    surface.on('pageerror', error => record.errors.push(error.message));
    surface.on('console', message => { if (['error', 'warning'].includes(message.type())) record.console.push(`${message.type()}: ${message.text()}`); });
  };
  observe(page);
  context.on('page', observe);
  context.on('request', request => {
    const url = request.url();
    if (/^https?:/.test(url) && new URL(url).hostname !== '127.0.0.1') record.externalRequests.push(url);
  });
  const response = await request.post('/__qa/switch', { data: { directory: 'dist' } });
  expect(response.ok()).toBe(true);
});

test.afterEach(async ({ context }, info) => {
  const record = evidence.get(context)!;
  await info.attach('browser-errors-and-network', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
  expect(record.errors, 'Uncaught browser errors').toEqual([]);
  expect(record.externalRequests, 'The journal must not make third-party network requests').toEqual([]);
});

test('a fresh journal has unanswered fields and stores a partial day across reloads', async ({ page }) => {
  await openApp(page);
  for (const label of ['Main sleep hours', 'Main sleep minutes', 'Additional sleep hours', 'Additional sleep minutes']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  }
  for (const group of ['Mood', 'Mental drive', 'Physical fatigue', 'Interest / enjoyment']) {
    await expect(page.getByRole('group', { name: group, exact: true }).locator('[aria-pressed="true"]')).toHaveCount(0);
  }
  await navigate(page, 'History');
  await expect(page.getByRole('heading', { name: 'Your first day belongs here.', exact: true })).toBeVisible();
  await navigate(page, 'Today');
  await chooseMood(page, 'Okay / neutral');
  await page.reload();
  await expect(moodOptions(page).getByRole('button', { name: 'Okay / neutral', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const { data } = await downloadBackup(page);
  expect(data.entries).toHaveLength(1);
  expect(data.entries[0]).toMatchObject({ date: DATE, mood: 0, mainSleep: null, additionalSleep: null, fatigue: null, enjoyment: null });
});

test('sleep distinguishes unknown from zero, optional details survive collapse, and editing a date keeps one record', async ({ page }) => {
  await openApp(page);
  await page.getByLabel('Main sleep hours', { exact: true }).fill('7');
  await page.getByLabel('Main sleep minutes', { exact: true }).fill('30');
  await saved(page);
  await expect(page.getByTestId('total-sleep')).toContainText('Shown when both are known');
  await page.getByRole('button', { name: 'No additional sleep', exact: true }).click();
  await saved(page);
  await expect(page.getByTestId('total-sleep')).toContainText('7h 30m');
  await optionalToggle(page).click();
  await noteField(page).fill('A quiet walk helped me settle.');
  await saved(page);
  await optionalToggle(page).click();
  await page.reload();
  await optionalToggle(page).click();
  await expect(noteField(page)).toHaveValue('A quiet walk helped me settle.');
  await selectDate(page, EARLIER);
  await chooseMood(page, 'Low');
  await chooseMood(page, 'Very good');
  const { data } = await downloadBackup(page);
  expect(data.entries).toHaveLength(2);
  expect(data.entries.find(entry => entry.date === DATE)).toMatchObject({ mainSleep: 450, additionalSleep: 0, note: 'A quiet walk helped me settle.' });
  expect(data.entries.filter(entry => entry.date === EARLIER)).toHaveLength(1);
  expect(data.entries.find(entry => entry.date === EARLIER)?.mood).toBe(2);
});

test('history editing and deletion change the actual observations in insights', async ({ page }) => {
  await openApp(page);
  await chooseMood(page);
  await navigate(page, 'History');
  await page.getByRole('button', { name: `Edit ${DATE}`, exact: true }).click();
  await chooseMood(page, 'Low');
  await navigate(page, 'Insights');
  await expect(page.getByTestId('mood-observations')).toContainText('1');
  await expect(page.getByTestId('mood-summary')).toHaveText('Middle recorded response: Low');
  await navigate(page, 'History');
  await removeDay(page);
  await expect(page.getByRole('heading', { name: 'Your first day belongs here.', exact: true })).toBeVisible();
  await navigate(page, 'Insights');
  await expect(page.getByTestId('mood-observations')).toContainText('0');
});

test('JSON backup previews and restores transactionally with explicit merge and replace choices', async ({ page }) => {
  await openApp(page);
  await chooseMood(page, 'Low');
  const exported = await downloadBackup(page);
  await navigate(page, 'Today');
  await chooseMood(page, 'Very good');
  await selectDate(page, EARLIER);
  await chooseMood(page, 'Good');

  await restoreFile(page, exported.bytes);
  await expect(page.getByRole('heading', { name: 'Review your backup', exact: true })).toBeVisible();
  await page.getByLabel(/^Merge with this journal/).check();
  await page.getByRole('combobox', { name: 'When the same date already exists', exact: true }).selectOption('incoming');
  await page.getByLabel('I have reviewed the backup and merge choices.', { exact: true }).check();
  await page.getByRole('button', { name: 'Confirm merge', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your backup', exact: true })).toHaveCount(0);
  const merged = await downloadBackup(page);
  expect(merged.data.entries).toHaveLength(2);
  expect(merged.data.entries.find(entry => entry.date === DATE)?.mood).toBe(-1);
  expect(merged.data.entries.find(entry => entry.date === EARLIER)?.mood).toBe(1);

  await restoreFile(page, exported.bytes);
  await page.getByLabel(/^Replace this journal/).check();
  await page.getByLabel('I understand this will replace all current local data.', { exact: true }).check();
  await page.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your backup', exact: true })).toHaveCount(0);
  const replaced = await downloadBackup(page);
  expect(replaced.data.entries).toHaveLength(1);
  expect(replaced.data.entries[0]).toMatchObject({ date: DATE, mood: -1 });

  await restoreFile(page, Buffer.from('{"app":"moodtracker","version":1,"entries":[{"date":"bad"}]}'));
  await expect(page.getByRole('alert')).toContainText(/backup|invalid|missing/i);
  const afterInvalid = await downloadBackup(page);
  expect(afterInvalid.data.entries).toEqual(replaced.data.entries);
});

test('a completed offline installation supports reload, editing, history and backup', async ({ page, context }) => {
  await openApp(page);
  await chooseMood(page, 'Good');
  await readyOffline(page);
  await page.reload();
  await readyOffline(page);
  await context.setOffline(true);
  await page.reload();
  await chooseMood(page, 'Very good');
  await navigate(page, 'History');
  await expect(page.getByRole('button', { name: `Edit ${DATE}`, exact: true })).toBeVisible();
  const { data } = await downloadBackup(page);
  expect(data.entries[0]).toMatchObject({ date: DATE, mood: 2 });
});

test('stale windows cannot overwrite changes or resurrect a deleted day', async ({ page, context }) => {
  await openApp(page);
  await chooseMood(page, 'Good');
  const stale = await context.newPage();
  await stale.addInitScript(() => {
    // A suspended/background tab may not receive a change notification before saving.
    class SleepingChannel { addEventListener() {} postMessage() {} close() {} }
    Object.defineProperty(window, 'BroadcastChannel', { value: SleepingChannel });
  });
  await openApp(stale);
  await chooseMood(page, 'Low');
  await moodOptions(stale).getByRole('button', { name: 'Very good', exact: true }).click();
  await expect(stale.getByRole('alert')).toContainText('another tab');
  expect((await downloadBackup(page)).data.entries[0].mood).toBe(-1);
  stale.once('dialog', dialog => dialog.accept());
  await stale.reload();
  await navigate(page, 'History');
  await removeDay(page);
  await moodOptions(stale).getByRole('button', { name: 'Very good', exact: true }).click();
  await expect(stale.getByRole('alert')).toContainText('another tab');
  expect((await downloadBackup(page)).data.entries).toHaveLength(0);
});

test('Amsterdam dates follow the local calendar boundary', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-12T22:30:00Z'));
  await page.goto('./');
  await expect(page.getByLabel('Check-in date', { exact: true })).toHaveValue('2026-10-13');
});

test('clearing a journal prevents stale settings from resurrecting support details', async ({ page, context }) => {
  await openApp(page);
  await page.locator('header').getByRole('button', { name: 'My support', exact: true }).click();
  await page.getByLabel('Contact name', { exact: true }).fill('Synthetic support contact');
  await page.getByLabel('Contact details', { exact: true }).fill('Synthetic details for deletion QA');
  await navigate(page, 'Settings');

  const stale = await context.newPage();
  await stale.addInitScript(() => {
    class SleepingChannel { addEventListener() {} postMessage() {} close() {} }
    Object.defineProperty(window, 'BroadcastChannel', { value: SleepingChannel });
  });
  await openApp(stale);
  await stale.locator('header').getByRole('button', { name: 'My support', exact: true }).click();
  await expect(stale.getByLabel('Contact name', { exact: true })).toHaveValue('Synthetic support contact');
  await navigate(stale, 'Settings');

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete all local data', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('All local entries and settings have been deleted.');
  await stale.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(stale.getByRole('alert')).toContainText('settings changed in another tab');
  const cleared = await downloadBackup(page);
  expect(cleared.data.settings).toMatchObject({ contactName: '', contactDetails: '', supportPlan: '' });
  stale.once('dialog', dialog => dialog.accept());
  await stale.getByRole('button', { name: 'Reload settings', exact: true }).click();
  await expect(stale.getByRole('alert')).toHaveCount(0);
  await stale.locator('header').getByRole('button', { name: 'My support', exact: true }).click();
  await expect(stale.getByLabel('Contact name', { exact: true })).toHaveValue('');
  await expect(stale.getByLabel('Contact details', { exact: true })).toHaveValue('');
});

test('a failed storage write never claims Saved and offers an export of the unsaved values', async ({ page }) => {
  await openApp(page);
  await chooseMood(page, 'Good');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'drafts') throw new DOMException('Injected storage limit for browser QA', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await moodOptions(page).getByRole('button', { name: 'Low', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Couldn’t save');
  await expect(page.getByRole('alert')).toContainText('Couldn’t save locally');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export entered values', exact: true }).click();
  const file = await pending;
  const raw = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(raw).toMatchObject({ app: 'moodtracker-unsaved-form', date: DATE, form: { mood: -1 } });
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(moodOptions(page).getByRole('button', { name: 'Good', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await chooseMood(page, 'Low');
  expect((await downloadBackup(page)).data.entries[0].mood).toBe(-1);
});

test('an invalid sleep draft survives reload and never becomes a chart observation', async ({ page }) => {
  await openApp(page);
  await chooseMood(page, 'Good');
  await page.getByLabel('Main sleep hours', { exact: true }).fill('25');
  await expect(page.getByTestId('save-status')).toHaveText('Draft saved · check sleep');
  await page.reload();
  await expect(page.getByLabel('Main sleep hours', { exact: true })).toHaveValue('25');
  await expect(page.getByTestId('save-status')).toHaveText('Draft saved · check sleep');
  await navigate(page, 'Insights');
  const sleep = page.locator('.trend-card.metric-sleep');
  await expect(sleep.locator('.observation-count')).toHaveText('0 days');
  await expect(sleep.getByRole('img')).toHaveCount(0);
  const backup = await downloadBackup(page);
  expect(backup.data.entries[0].mainSleep).toBeNull();
  expect(backup.data.drafts[0].form.mainHours).toBe('25');
});

test('appearance, keyboard choices and narrow through desktop layouts stay usable', async ({ page }) => {
  await openApp(page);
  await navigate(page, 'Settings');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await navigate(page, 'Today');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await navigate(page, 'Settings');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await navigate(page, 'Today');
  const choice = moodOptions(page).getByRole('button', { name: 'Good', exact: true });
  await choice.focus();
  await page.keyboard.press('Space');
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await saved(page);
  await mkdir('qa-artifacts', { recursive: true });
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => document.fonts.ready);
    for (const screen of ['Today', 'History', 'Insights', 'Settings']) {
      await navigate(page, screen);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${screen} has horizontal page overflow at ${viewport.width}px`).toBe(true);
    }
    await navigate(page, 'Today');
    await page.screenshot({ path: `qa-artifacts/today-${viewport.width}x${viewport.height}.png`, fullPage: true });
  }
});

test('the main screens and support pass focused WCAG checks in both themes', async ({ page }, info) => {
  test.setTimeout(120_000);
  await openApp(page);
  await chooseMood(page, 'Good');
  for (const theme of ['Light', 'Dark']) {
    await navigate(page, 'Settings');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
    for (const screen of ['Today', 'History', 'Insights', 'Settings', 'Support']) {
      if (screen === 'Support') await page.locator('header').getByRole('button', { name: 'My support', exact: true }).click();
      else await navigate(page, screen);
      if (screen === 'Today' && await optionalToggle(page).getAttribute('aria-expanded') !== 'true') await optionalToggle(page).click();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      await info.attach(`accessibility-${theme}-${screen}`, { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });
      expect.soft(result.violations, `${theme} ${screen} accessibility violations`).toEqual([]);
    }
  }
});

test('a waiting app update retains the latest entry, settings and offline availability', async ({ page, context, request }) => {
  test.setTimeout(120_000);
  const env = { ...process.env, MOOD_BUILD_ID: 'update-test-v2', MOOD_OUT_DIR: 'dist-upgrade' };
  execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build'], { env, stdio: 'pipe' });
  execFileSync(process.execPath, [resolve('scripts/build-pwa.mjs')], { env, stdio: 'pipe' });
  await openApp(page);
  await chooseMood(page, 'Good');
  await readyOffline(page);
  await navigate(page, 'Settings');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('header').getByRole('button', { name: 'My support', exact: true }).click();
  await page.getByLabel('Contact name', { exact: true }).fill('QA support contact');
  await page.getByLabel('Contact details', { exact: true }).fill('Only a synthetic contact');
  await navigate(page, 'Settings');
  const switched = await request.post('/__qa/switch', { data: { directory: 'dist-upgrade' } });
  expect(switched.ok()).toBe(true);
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Update now', exact: true }).first()).toBeVisible();
  await navigate(page, 'Today');
  await optionalToggle(page).click();
  await noteField(page).fill('Saved just before updating.');
  await page.getByRole('button', { name: 'Update now', exact: true }).click();
  await expect(page.getByLabel('Check-in date', { exact: true })).toHaveValue(DATE);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await navigate(page, 'Settings');
  await expect(page.getByText('update-test-v2', { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('moodtracker-shell-v1-')).length)).toBe(1);
  const restored = await downloadBackup(page);
  expect(restored.data.entries[0]).toMatchObject({ date: DATE, mood: 1, note: 'Saved just before updating.' });
  expect(restored.data.settings).toMatchObject({ theme: 'dark', contactName: 'QA support contact', contactDetails: 'Only a synthetic contact' });
  await context.setOffline(true);
  await page.reload();
  await navigate(page, 'Today');
  await chooseMood(page, 'Very good');
  expect((await downloadBackup(page)).data.entries[0].mood).toBe(2);
  await context.setOffline(false);
  await request.post('/__qa/switch', { data: { directory: 'dist' } });
});

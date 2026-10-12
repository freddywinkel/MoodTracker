import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { applyBackup, clearData, closeJournal, ConflictError, createBackup, DATABASE_NAME, deleteEntry, getEntries, getSettings, loadDay, loadSettings, openJournal, persistForm, saveSettings } from './storage';
import { DEFAULT_SETTINGS, emptyForm } from './types';

beforeEach(async () => { await closeJournal(); await deleteDB(DATABASE_NAME); });
afterEach(async () => { await closeJournal(); });
const day = '2026-10-12';
async function record(date = day, mood = 0) {
  const current = await loadDay(date);
  return persistForm({ ...current.form, mood }, current.revision);
}
describe('durable journal writes', () => {
  it('stores partial entries without converting missing observations to zero', async () => {
    await record();
    await closeJournal();
    const entries = await getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].mood).toBe(0);
    expect(entries[0].additionalSleep).toBeNull();
    expect((await loadDay(day)).form.use).toBeNull();
  });
  it('does not create a journal entry from an untouched empty form', async () => {
    await persistForm(emptyForm(day), 0);
    expect(await getEntries()).toEqual([]);
  });
  it('preserves invalid raw drafts without damaging the last valid entry', async () => {
    await record();
    const saved = await loadDay(day);
    const result = await persistForm({ ...saved.form, mainHours: '7', mainMinutes: '99', note: 'unfinished' }, saved.revision);
    expect(result.errors).not.toEqual([]);
    await closeJournal();
    expect((await loadDay(day)).form.mainMinutes).toBe('99');
    expect((await getEntries())[0].mainSleep).toBeNull();
    expect((await getEntries())[0].note).toBe('');
  });
  it('keeps one stable entry ID per date across edits', async () => {
    await record();
    const previous = (await getEntries())[0];
    const saved = await loadDay(day);
    await persistForm({ ...saved.form, mood: 2 }, saved.revision);
    const entries = await getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(previous.id);
    expect(entries[0].createdAt).toBe(previous.createdAt);
    expect(entries[0].revision).toBeGreaterThan(previous.revision);
  });
  it('rejects concurrent stale saves instead of overwriting another window', async () => {
    const first = await loadDay(day);
    const second = await loadDay(day);
    await persistForm({ ...first.form, mood: 1 }, first.revision);
    await expect(persistForm({ ...second.form, mood: -2 }, second.revision)).rejects.toBeInstanceOf(ConflictError);
    expect((await getEntries())[0].mood).toBe(1);
  });
  it('does not resurrect a deleted date from a pending stale save', async () => {
    await record();
    const stale = await loadDay(day);
    await deleteEntry(day);
    await expect(persistForm({ ...stale.form, note: 'stale' }, stale.revision)).rejects.toBeInstanceOf(ConflictError);
    expect(await getEntries()).toEqual([]);
    expect((await loadDay(day)).form.mood).toBeNull();
  });
  it('clears journal, raw drafts and support settings, and rejects old writes', async () => {
    await record();
    const stale = await loadDay(day);
    const emptyStale = await loadDay('2026-10-11');
    await saveSettings({ ...DEFAULT_SETTINGS, contactName: 'Fictional friend', supportPlan: 'Fictional plan' });
    await clearData();
    expect((await createBackup()).entries).toEqual([]);
    expect((await createBackup()).drafts).toEqual([]);
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    await expect(persistForm(stale.form, stale.revision)).rejects.toBeInstanceOf(ConflictError);
    await expect(persistForm({ ...emptyStale.form, mood: 1 }, emptyStale.revision)).rejects.toBeInstanceOf(ConflictError);
    const fresh = await loadDay(day);
    await persistForm({ ...fresh.form, mood: 2 }, fresh.revision);
    expect((await getEntries())[0].mood).toBe(2);
  });
});
describe('backup transactions', () => {
  it('merge/keep preserves a local invalid draft that has no committed entry', async () => {
    await record();
    const backup = await createBackup();
    await clearData();
    const loaded = await loadDay(day);
    await persistForm({ ...loaded.form, mainMinutes: '99', note: 'My unfinished work' }, loaded.revision);
    await applyBackup(backup, 'merge', 'keep');
    expect((await loadDay(day)).form).toMatchObject({ mainMinutes: '99', note: 'My unfinished work', mood: null });
    expect(await getEntries()).toHaveLength(0);
  });
  it('merge incoming entries keeps existing local support and appearance settings', async () => {
    await record();
    const backup = await createBackup();
    await saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark', supportPlan: 'My local plan' });
    backup.settings.supportPlan = 'Incoming plan';
    await applyBackup(backup, 'merge', 'incoming');
    expect(await getSettings()).toMatchObject({ theme: 'dark', supportPlan: 'My local plan' });
  });
  it('round-trips entries, invalid drafts, stable IDs, scale meanings, and support settings', async () => {
    await record();
    const current = await loadDay(day);
    await persistForm({ ...current.form, mainMinutes: '99', note: 'Unfinished fictional draft' }, current.revision);
    await saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark', contactName: 'Fictional friend', supportPlan: 'A fictional plan' });
    const before = await createBackup();
    await clearData();
    await applyBackup(before, 'replace', 'incoming');
    const after = await createBackup();
    const meaningfulEntries = (backup: typeof before) => backup.entries.map(({ revision: _revision, ...entry }) => entry);
    expect(meaningfulEntries(after)).toEqual(meaningfulEntries(before));
    expect(after.drafts.map(({ revision: _revision, ...draft }) => draft)).toEqual(before.drafts.map(({ revision: _revision, ...draft }) => draft));
    expect(after.settings).toEqual(before.settings);
    expect(after.scaleDefinitions).toEqual(before.scaleDefinitions);
  });
  it('repeated restore merges without duplicates, preserving local conflicting entries by choice', async () => {
    await record();
    const backup = await createBackup();
    const current = await loadDay(day);
    await persistForm({ ...current.form, mood: 2 }, current.revision);
    await applyBackup(backup, 'merge', 'keep');
    expect((await getEntries())[0].mood).toBe(2);
    await applyBackup(backup, 'merge', 'incoming');
    expect((await getEntries())[0].mood).toBe(0);
    await applyBackup(backup, 'merge', 'incoming');
    expect(await getEntries()).toHaveLength(1);
  });
  it('rejects invalid restore before writes and preserves the full journal', async () => {
    await record();
    const before = await createBackup();
    await expect(applyBackup({ ...before, version: 999 }, 'replace', 'incoming')).rejects.toThrow('unsupported');
    const after = await createBackup();
    expect(after.entries).toEqual(before.entries);
    expect(after.drafts).toEqual(before.drafts);
    expect(after.settings).toEqual(before.settings);
  });
  it('rolls back all accepted rows and settings when any write fails', async () => {
    await record();
    const before = await createBackup();
    const first = { ...before.entries[0], id: 'first-new-id', date: '2026-10-10' };
    const second = { ...before.entries[0], date: '2026-10-11' }; // ID clashes with a current entry, not within the backup.
    const backup = { ...before, entries: [first, second], drafts: [], settings: { ...before.settings, theme: 'dark' as const } };
    await expect(applyBackup(backup, 'merge', 'incoming')).rejects.toThrow();
    const after = await createBackup();
    expect(after.entries).toEqual(before.entries);
    expect(after.settings).toEqual(before.settings);
  });
  it('invalidates a prior tab revision after a restored draft changes', async () => {
    await record();
    const before = await createBackup();
    const stale = await loadDay(day);
    before.drafts[0].form.note = 'Restored draft';
    await applyBackup(before, 'merge', 'incoming');
    await expect(persistForm({ ...stale.form, mood: 1 }, stale.revision)).rejects.toBeInstanceOf(ConflictError);
  });
});
describe('settings conflict protection', () => {
  it('rejects stale settings updates across windows', async () => {
    const first = await loadSettings();
    const second = await loadSettings();
    await saveSettings({ ...first.settings, contactName: 'New fictional contact' }, first.revision);
    await expect(saveSettings({ ...second.settings, theme: 'dark' }, second.revision)).rejects.toThrow('another window');
    expect((await getSettings()).contactName).toBe('New fictional contact');
  });
  it('does not resurrect erased contacts from a stale theme update', async () => {
    const initial = await loadSettings();
    await saveSettings({ ...initial.settings, contactName: 'Fictional contact', supportPlan: 'Fictional plan' }, initial.revision);
    const stale = await loadSettings();
    await clearData();
    await expect(saveSettings({ ...stale.settings, theme: 'dark' }, stale.revision)).rejects.toThrow('another window');
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
describe('additive database migration', () => {
  it('upgrades a version-1 journal without clearing data or settings', async () => {
    await record();
    const entry = (await getEntries())[0];
    await closeJournal();
    await deleteDB(DATABASE_NAME);
    const old = await openDB(DATABASE_NAME, 1, { upgrade(db) { const store = db.createObjectStore('entries', { keyPath: 'date' }); store.createIndex('by-id', 'id', { unique: true }); db.createObjectStore('settings'); } });
    await old.put('entries', { ...entry, revision: 47 });
    await old.put('settings', { ...DEFAULT_SETTINGS, supportPlan: 'Preserve this plan' }, 'user');
    old.close();
    const db = await openJournal();
    expect(db.version).toBe(2);
    expect((await getEntries())[0].id).toBe(entry.id);
    expect((await getSettings()).supportPlan).toBe('Preserve this plan');
    const loaded = await loadDay(day);
    const saved = await persistForm({ ...loaded.form, mood: 1 }, loaded.revision);
    expect(saved.revision).toBeGreaterThan(47);
  });
});

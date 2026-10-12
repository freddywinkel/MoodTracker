import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { DEFAULT_SETTINGS, SCALES, SCALE_VERSION, BACKUP_VERSION, emptyForm, type Backup, type DailyEntry, type DailyForm, type DraftRecord, type Settings } from './types';
import { entryToForm, parseForm } from './domain';
import { validateBackup } from './reports';

// This identity is deliberately independent of the application release version.
export const DATABASE_NAME = 'moodtracker-journal';
export const DATABASE_VERSION = 2;
interface JournalDatabase extends DBSchema {
  entries: { key: string; value: DailyEntry; indexes: { 'by-id': string } };
  drafts: { key: string; value: DraftRecord };
  settings: { key: string; value: Settings };
  meta: { key: string; value: number };
}
type WriteTransaction = IDBPTransaction<JournalDatabase, ['entries', 'drafts', 'settings', 'meta'], 'readwrite'>;
let databasePromise: Promise<IDBPDatabase<JournalDatabase>> | undefined;
const localListeners = new Set<() => void>();
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('moodtracker-data') : null;
channel?.addEventListener('message', () => localListeners.forEach(listener => listener()));
function notifyChange() {
  channel?.postMessage('changed');
  localListeners.forEach(listener => listener());
}
export function onDataChange(callback: () => void): () => void {
  localListeners.add(callback);
  return () => localListeners.delete(callback);
}
export class ConflictError extends Error {
  constructor(message = 'This day changed in another window. Reload its saved version before continuing. Your current changes are still visible.') { super(message); this.name = 'ConflictError'; }
}
export function openJournal(): Promise<IDBPDatabase<JournalDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<JournalDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const entries = db.createObjectStore('entries', { keyPath: 'date' });
          entries.createIndex('by-id', 'id', { unique: true });
          db.createObjectStore('settings');
        }
        if (oldVersion < 2) {
          db.createObjectStore('drafts', { keyPath: 'date' });
          db.createObjectStore('meta');
          // Additive migration: preserve existing journal and settings.
          const store = transaction.objectStore('entries');
          void store.openCursor().then(async cursor => {
            let maximumRevision = 0;
            while (cursor) {
              const value = cursor.value;
              maximumRevision = Math.max(maximumRevision, value.revision ?? 0);
              await cursor.update({ ...value, revision: value.revision ?? 0, scaleVersion: value.scaleVersion ?? SCALE_VERSION });
              cursor = await cursor.continue();
            }
            await transaction.objectStore('meta').put(maximumRevision, 'counter');
          });
        }
      },
      blocking() {
        void databasePromise?.then(db => db.close());
        databasePromise = undefined;
        notifyChange();
      },
      terminated() { databasePromise = undefined; notifyChange(); },
      blocked() { notifyChange(); },
    }).catch(error => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}
export async function closeJournal() {
  const promise = databasePromise;
  databasePromise = undefined;
  if (promise) (await promise).close();
}
function writeTransaction(db: IDBPDatabase<JournalDatabase>): WriteTransaction {
  return db.transaction(['entries', 'drafts', 'settings', 'meta'], 'readwrite');
}
async function currentRevision(tx: WriteTransaction, date: string): Promise<number> {
  const draft = await tx.objectStore('drafts').get(date);
  const entry = await tx.objectStore('entries').get(date);
  return draft?.revision ?? entry?.revision ?? await tx.objectStore('meta').get('deleted:' + date) ?? await tx.objectStore('meta').get('clearRevision') ?? 0;
}
async function nextRevision(tx: WriteTransaction): Promise<number> {
  const counter = (await tx.objectStore('meta').get('counter') ?? 0) + 1;
  await tx.objectStore('meta').put(counter, 'counter');
  return counter;
}
export async function loadDay(date: string): Promise<{ form: DailyForm; revision: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid calendar date.');
  const db = await openJournal();
  const tx = db.transaction(['entries', 'drafts', 'meta']);
  const draft = await tx.objectStore('drafts').get(date);
  const entry = await tx.objectStore('entries').get(date);
  const revision = draft?.revision ?? entry?.revision ?? await tx.objectStore('meta').get('deleted:' + date) ?? await tx.objectStore('meta').get('clearRevision') ?? 0;
  await tx.done;
  return { form: draft?.form ?? (entry ? entryToForm(entry) : emptyForm(date)), revision };
}
export async function persistForm(form: DailyForm, expectedRevision: number): Promise<{ revision: number; errors: string[] }> {
  const parsed = parseForm(form);
  const db = await openJournal();
  const tx = writeTransaction(db);
  try {
    if (await currentRevision(tx, form.date) !== expectedRevision) throw new ConflictError();
    const previous = await tx.objectStore('entries').get(form.date);
    const revision = await nextRevision(tx);
    const now = new Date().toISOString();
    await tx.objectStore('drafts').put({ date: form.date, revision, updatedAt: now, form: structuredClone(form) });
    if (parsed.errors.length === 0) {
      if (parsed.hasContent) {
        await tx.objectStore('entries').put({ ...parsed.values, id: previous?.id ?? crypto.randomUUID(), date: form.date, createdAt: previous?.createdAt ?? now, updatedAt: now, revision, scaleVersion: SCALE_VERSION });
      } else {
        await tx.objectStore('entries').delete(form.date);
      }
    }
    await tx.done; // Request success alone is not transaction success.
    notifyChange();
    return { revision, errors: parsed.errors };
  } catch (error) {
    try { tx.abort(); } catch { /* already completed/aborted */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
export async function getEntries(): Promise<DailyEntry[]> {
  const entries = await (await openJournal()).getAll('entries');
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
export async function getSettings(): Promise<Settings> {
  return (await loadSettings()).settings;
}
export async function loadSettings(): Promise<{ settings: Settings; revision: number }> {
  const tx = (await openJournal()).transaction(['settings', 'meta']);
  const settings = { ...DEFAULT_SETTINGS, ...await tx.objectStore('settings').get('user') };
  const revision = await tx.objectStore('meta').get('settingsRevision') ?? await tx.objectStore('meta').get('clearRevision') ?? 0;
  await tx.done;
  return { settings, revision };
}
export async function saveSettings(settings: Settings, expectedRevision?: number): Promise<number> {
  if (!['light', 'dark', 'system'].includes(settings.theme)) throw new Error('Invalid appearance.');
  try { new Intl.DateTimeFormat('en', { timeZone: settings.timezone }); } catch { throw new Error('Invalid timezone.'); }
  for (const key of ['contactName', 'contactDetails', 'clinician', 'supportPlan'] as const) {
    if (typeof settings[key] !== 'string' || settings[key].length > 4000) throw new Error('Support details must be at most 4,000 characters.');
  }
  const db = await openJournal();
  const tx = writeTransaction(db);
  try {
    const current = await tx.objectStore('meta').get('settingsRevision') ?? await tx.objectStore('meta').get('clearRevision') ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== current) throw new ConflictError('These settings changed in another window. Reload before saving so deleted or newer support details are not overwritten.');
    const revision = await nextRevision(tx);
    await tx.objectStore('settings').put(structuredClone(settings), 'user');
    await tx.objectStore('meta').put(revision, 'settingsRevision');
    await tx.done;
    notifyChange();
    return revision;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed/aborted */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
export async function createBackup(): Promise<Backup> {
  const db = await openJournal();
  // A single readonly transaction is a consistent snapshot across stores.
  const tx = db.transaction(['entries', 'drafts', 'settings']);
  const entries = await tx.objectStore('entries').getAll();
  const drafts = await tx.objectStore('drafts').getAll();
  const settings = { ...DEFAULT_SETTINGS, ...await tx.objectStore('settings').get('user') };
  await tx.done;
  return { app: 'moodtracker', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), scaleDefinitions: structuredClone(SCALES), entries, drafts, settings };
}
function content(entry: DailyEntry): string {
  const { updatedAt: _updated, createdAt: _created, revision: _revision, id: _id, ...values } = entry;
  return JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
}
export async function applyBackup(input: Backup, mode: 'merge' | 'replace', conflicts: 'keep' | 'incoming'): Promise<{ added: number; updated: number; kept: number }> {
  const backup = validateBackup(input); // Validation finishes before any write transaction.
  if (!['merge', 'replace'].includes(mode) || !['keep', 'incoming'].includes(conflicts)) throw new Error('Choose a restore mode.');
  const db = await openJournal();
  const tx = writeTransaction(db);
  const result = { added: 0, updated: 0, kept: 0 };
  try {
    if (mode === 'replace') {
      const clearRevision = await nextRevision(tx);
      await tx.objectStore('entries').clear();
      await tx.objectStore('drafts').clear();
      await tx.objectStore('settings').clear();
      await tx.objectStore('meta').clear();
      await tx.objectStore('meta').put(clearRevision, 'counter');
      await tx.objectStore('meta').put(clearRevision, 'clearRevision');
    }
    const acceptedDates = new Set<string>();
    for (const entry of backup.entries) {
      const existing = await tx.objectStore('entries').get(entry.date);
      const draft = await tx.objectStore('drafts').get(entry.date);
      if ((existing && content(existing) === content(entry)) || (conflicts === 'keep' && (existing || draft))) { result.kept++; continue; }
      const revision = await nextRevision(tx);
      await tx.objectStore('entries').put({ ...entry, revision });
      // A local draft must never mask a newly accepted restored entry.
      await tx.objectStore('drafts').put({ date: entry.date, revision, updatedAt: entry.updatedAt, form: entryToForm(entry) });
      acceptedDates.add(entry.date);
      existing ? result.updated++ : result.added++;
    }
    for (const draft of backup.drafts) {
      const existing = await tx.objectStore('drafts').get(draft.date);
      const entry = await tx.objectStore('entries').get(draft.date);
      if (mode === 'merge' && !acceptedDates.has(draft.date) && (existing || entry) && conflicts === 'keep') continue;
      const revision = acceptedDates.has(draft.date) ? (existing?.revision ?? entry?.revision ?? await nextRevision(tx)) : await nextRevision(tx);
      await tx.objectStore('drafts').put({ ...draft, revision });
    }
    if (mode === 'replace' || !await tx.objectStore('settings').get('user')) {
      await tx.objectStore('settings').put(backup.settings, 'user');
      await tx.objectStore('meta').put(await nextRevision(tx), 'settingsRevision');
    }
    await tx.done;
    notifyChange();
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed/aborted */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
export async function deleteEntry(date: string): Promise<void> {
  const tx = writeTransaction(await openJournal());
  const revision = await nextRevision(tx);
  await tx.objectStore('entries').delete(date);
  await tx.objectStore('drafts').delete(date);
  await tx.objectStore('meta').put(revision, 'deleted:' + date);
  await tx.done;
  notifyChange();
}
export async function clearData(): Promise<void> {
  const tx = writeTransaction(await openJournal());
  const revision = await nextRevision(tx);
  await tx.objectStore('entries').clear();
  await tx.objectStore('drafts').clear();
  await tx.objectStore('settings').clear();
  await tx.objectStore('meta').clear();
  // Only non-personal invalidation counters remain; stale tabs cannot recreate deleted data.
  await tx.objectStore('meta').put(revision, 'counter');
  await tx.objectStore('meta').put(revision, 'clearRevision');
  await tx.done;
  notifyChange();
}

import { totalSleep, validDate, entryToForm } from './domain';
import { APP_ID, BACKUP_VERSION, SCALES, SCALE_VERSION, type Backup, type DailyEntry, type DailyForm, type DraftRecord, type Metric, type Settings } from './types';

const MAX_RECORDS = 50_000;
type ObjectValue = Record<string, unknown>;
function fail(message: string): never { throw new Error(`Invalid backup: ${message}`); }
function object(value: unknown, label: string): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as ObjectValue;
}
function keys(value: ObjectValue, expected: string[], label: string) {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) fail(`${label} has missing or unsupported fields.`);
}
function string(value: unknown, label: string, maximum = 4000, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > maximum || (nonempty && value.trim() === '')) fail(`${label} must be ${nonempty ? 'a nonempty' : 'a'} string of at most ${maximum} characters.`);
}
function timestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !validDate(value.slice(0, 10))) fail(`${label} must be a valid UTC timestamp.`);
  const [, h, m, s] = value.slice(10).match(/^T(\d{2}):(\d{2}):(\d{2})/) ?? [];
  if (Number(h) > 23 || Number(m) > 59 || Number(s) > 59 || !Number.isFinite(Date.parse(value))) fail(`${label} must be a valid UTC timestamp.`);
}
function revision(value: unknown, label: string) { if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${label} must be a nonnegative whole number.`); }
function date(value: unknown, label: string): asserts value is string { if (!validDate(value)) fail(`${label} must be a valid calendar date.`); }
function rating(value: unknown, metric: Metric, label: string) {
  const scale = SCALES[metric];
  if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < scale.min || value > scale.max)) fail(`${label} has an invalid rating.`);
}
function nullableChoices(value: unknown, label: string) {
  if (value !== null && value !== 'none' && value !== 'occurred' && value !== 'prefer-not') fail(`${label} has an invalid substance-use answer.`);
}
function nullableBoolean(value: unknown, label: string) { if (value !== null && typeof value !== 'boolean') fail(`${label} must be true, false, or null.`); }
function sleep(value: unknown, label: string) { if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1440)) fail(`${label} must be null or a whole number of minutes from 0 to 1440.`); }

const ratingKeys = Object.keys(SCALES) as Metric[];
const writtenKeys = ['changeNote', 'supportedBy', 'note'] as const;
const formKeys = ['date', 'mainHours', 'mainMinutes', 'additionalHours', 'additionalMinutes', ...ratingKeys, 'use', 'significantChange', ...writtenKeys];
function validateForm(value: unknown, label: string): DailyForm {
  const form = object(value, label); keys(form, formKeys, label); date(form.date, `${label}.date`);
  // Drafts can contain an unfinished or invalid duration; restore must preserve the user's work.
  for (const field of ['mainHours', 'mainMinutes', 'additionalHours', 'additionalMinutes']) string(form[field], `${label}.${field}`, 4000);
  for (const metric of ratingKeys) rating(form[metric], metric, `${label}.${metric}`);
  nullableChoices(form.use, label); nullableBoolean(form.significantChange, `${label}.significantChange`);
  for (const field of writtenKeys) string(form[field], `${label}.${field}`);
  return form as unknown as DailyForm;
}

function validateEntry(value: unknown, index: number): DailyEntry {
  const label = `entries[${index}]`; const entry = object(value, label);
  keys(entry, ['id', 'date', 'createdAt', 'updatedAt', 'revision', 'scaleVersion', 'mainSleep', 'additionalSleep', ...ratingKeys, 'use', 'significantChange', ...writtenKeys], label);
  string(entry.id, `${label}.id`, 200, true); date(entry.date, `${label}.date`);
  timestamp(entry.createdAt, `${label}.createdAt`); timestamp(entry.updatedAt, `${label}.updatedAt`); revision(entry.revision, `${label}.revision`);
  if (entry.scaleVersion !== SCALE_VERSION) fail(`${label} uses an unsupported rating scale.`);
  sleep(entry.mainSleep, `${label}.mainSleep`); sleep(entry.additionalSleep, `${label}.additionalSleep`);
  for (const metric of ratingKeys) rating(entry[metric], metric, `${label}.${metric}`);
  nullableChoices(entry.use, label); nullableBoolean(entry.significantChange, `${label}.significantChange`);
  for (const field of writtenKeys) string(entry[field], `${label}.${field}`);
  return entry as unknown as DailyEntry;
}

function validateSettings(value: unknown): Settings {
  const settings = object(value, 'settings');
  keys(settings, ['theme', 'timezone', 'contactName', 'contactDetails', 'clinician', 'supportPlan', 'lastExportAt'], 'settings');
  if (!['system', 'light', 'dark'].includes(settings.theme as string)) fail('settings.theme is unsupported.');
  string(settings.timezone, 'settings.timezone', 100, true);
  try { new Intl.DateTimeFormat('en', { timeZone: settings.timezone }); } catch { fail('settings.timezone is unsupported.'); }
  for (const field of ['contactName', 'contactDetails', 'clinician', 'supportPlan']) string(settings[field], `settings.${field}`);
  if (settings.lastExportAt !== null) timestamp(settings.lastExportAt, 'settings.lastExportAt');
  return settings as unknown as Settings;
}

function validateScales(value: unknown) {
  const scales = object(value, 'scaleDefinitions'); keys(scales, ratingKeys, 'scaleDefinitions');
  for (const metric of ratingKeys) {
    const expected = SCALES[metric]; const found = object(scales[metric], `scaleDefinitions.${metric}`);
    keys(found, ['label', 'min', 'max', 'labels'], `scaleDefinitions.${metric}`);
    if (found.label !== expected.label || found.min !== expected.min || found.max !== expected.max || !Array.isArray(found.labels) || found.labels.length !== expected.labels.length || found.labels.some((label, index) => label !== expected.labels[index])) fail('rating scale definitions have changed or are unsupported.');
  }
}

/** Validate the entire backup before any caller is allowed to mutate the journal. */
export function validateBackup(value: unknown): Backup {
  const backup = object(value, 'root'); keys(backup, ['app', 'version', 'exportedAt', 'scaleDefinitions', 'entries', 'drafts', 'settings'], 'root');
  if (backup.app !== APP_ID) fail('this file belongs to a different application.');
  if (backup.version !== BACKUP_VERSION) fail('this backup version is unsupported.');
  timestamp(backup.exportedAt, 'exportedAt'); validateScales(backup.scaleDefinitions);
  if (!Array.isArray(backup.entries) || backup.entries.length > MAX_RECORDS || !Array.isArray(backup.drafts) || backup.drafts.length > MAX_RECORDS) fail(`entries and drafts must be arrays with no more than ${MAX_RECORDS} records each.`);
  const entries = backup.entries.map(validateEntry); const ids = new Set<string>(); const dates = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id) || dates.has(entry.date)) fail('entries contain duplicate IDs or dates.');
    ids.add(entry.id); dates.add(entry.date);
  }
  const draftDates = new Set<string>();
  const drafts: DraftRecord[] = backup.drafts.map((value, index) => {
    const label = `drafts[${index}]`; const draft = object(value, label); keys(draft, ['date', 'revision', 'updatedAt', 'form'], label);
    date(draft.date, `${label}.date`); revision(draft.revision, `${label}.revision`); timestamp(draft.updatedAt, `${label}.updatedAt`);
    const form = validateForm(draft.form, `${label}.form`);
    if (form.date !== draft.date || draftDates.has(draft.date)) fail('draft dates must match their form and cannot be duplicated.');
    draftDates.add(draft.date);
    return draft as unknown as DraftRecord;
  });
  const settings = validateSettings(backup.settings);
  return structuredClone({ app: APP_ID, version: BACKUP_VERSION, exportedAt: backup.exportedAt as string, scaleDefinitions: SCALES, entries, drafts, settings });
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  // Prefix untrusted text before quoting. Numeric negative rating cells remain real numbers.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvExport(entries: DailyEntry[], includePrivate = false): string {
  const headers = ['Date', 'Main sleep (minutes)', 'Additional sleep (minutes)', 'Total sleep (minutes)', 'Mood', 'Mental drive', 'Physical fatigue', 'Interest / enjoyment'];
  if (includePrivate) headers.push('Strongest craving', 'Substance use', 'Significant mood change', 'Mood change note', 'Something supportive', 'Note');
  const lines = [headers.map(csvCell).join(',')];
  for (const entry of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const row: (string | number | boolean | null)[] = [entry.date, entry.mainSleep, entry.additionalSleep, totalSleep(entry), entry.mood, entry.drive, entry.fatigue, entry.enjoyment];
    if (includePrivate) row.push(entry.craving, entry.use, entry.significantChange, entry.changeNote, entry.supportedBy, entry.note);
    lines.push(row.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function backupPreview(backup: Backup, currentEntries: DailyEntry[], currentDrafts: DraftRecord[] = []): { newEntries: number; conflicts: number; unchanged: number } {
  const currentByDate = new Map(currentEntries.map(entry => [entry.date, entry]));
  const draftsByDate = new Map(currentDrafts.map(draft => [draft.date, draft]));
  const counts = { newEntries: 0, conflicts: 0, unchanged: 0 };
  const contentKeys: (keyof DailyEntry)[] = ['date', 'scaleVersion', 'mainSleep', 'additionalSleep', ...ratingKeys, 'use', 'significantChange', ...writtenKeys];
  for (const entry of backup.entries) {
    const current = currentByDate.get(entry.date);
    const draft = draftsByDate.get(entry.date);
    const sourceDraft = backup.drafts.find(item => item.date === entry.date)?.form ?? entryToForm(entry);
    const draftConflicts = !!draft && Object.keys(sourceDraft).some(key => draft.form[key as keyof DailyForm] !== sourceDraft[key as keyof DailyForm]);
    if (draftConflicts || (!current && draft)) counts.conflicts++;
    else if (!current) counts.newEntries++;
    else if (contentKeys.every(key => entry[key] === current[key])) counts.unchanged++;
    else counts.conflicts++;
  }
  return counts;
}

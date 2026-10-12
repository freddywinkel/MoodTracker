import { describe, expect, it } from 'vitest';
import { backupPreview, csvExport, validateBackup } from './reports';
import { APP_ID, BACKUP_VERSION, DEFAULT_SETTINGS, SCALES, SCALE_VERSION, emptyForm, type Backup, type DailyEntry } from './types';

function entry(overrides: Partial<DailyEntry> = {}): DailyEntry {
  return { id: 'entry-1', date: '2026-10-12', createdAt: '2026-10-12T18:00:00.000Z', updatedAt: '2026-10-12T18:00:00.000Z', revision: 1, scaleVersion: SCALE_VERSION,
    mainSleep: 480, additionalSleep: 0, mood: -2, drive: null, fatigue: 0, enjoyment: 2, craving: 1, use: 'prefer-not', significantChange: false,
    changeNote: '', supportedBy: '', note: '', ...overrides };
}
function backup(): Backup {
  return structuredClone({ app: APP_ID, version: BACKUP_VERSION, exportedAt: '2026-10-12T18:01:00.000Z', scaleDefinitions: SCALES,
    entries: [entry({ note: 'A private thought' })],
    drafts: [{ date: '2026-10-13', revision: 0, updatedAt: '2026-10-12T18:00:00.000Z', form: { ...emptyForm('2026-10-13'), mainMinutes: '99', note: 'An unfinished edit' } }],
    settings: { ...DEFAULT_SETTINGS, theme: 'dark', contactName: 'Sam', contactDetails: 'My chosen contact', clinician: 'My clinician', supportPlan: 'Call Sam when I choose to.', lastExportAt: '2026-10-12T18:01:00.000Z' } });
}

describe('complete validated backups', () => {
  it('round-trips entries, invalid unfinished duration drafts, settings, contacts, and scale definitions', () => {
    const original = backup(); const result = validateBackup(JSON.parse(JSON.stringify(original)));
    expect(result).toEqual(original); expect(result).not.toBe(original);
    result.entries[0]!.note = 'Changed later'; expect(original.entries[0]!.note).toBe('A private thought');
    expect(result.drafts[0]!.form.mainMinutes).toBe('99');
  });

  it.each([
    ['foreign application', (value: Backup) => { value.app = 'other' as Backup['app']; }],
    ['future backup version', (value: Backup) => { value.version = 2; }],
    ['different entry scale', (value: Backup) => { value.entries[0]!.scaleVersion = 2; }],
    ['modified scale meaning', (value: Backup) => { (value.scaleDefinitions.mood.labels as unknown as string[])[0] = 'Changed'; }],
    ['rollover date', (value: Backup) => { value.entries[0]!.date = '2026-02-30'; }],
    ['invalid timestamp', (value: Backup) => { value.entries[0]!.updatedAt = '2026-10-12T25:00:00Z'; }],
    ['negative sleep', (value: Backup) => { value.entries[0]!.mainSleep = -1; }],
    ['too much sleep', (value: Backup) => { value.entries[0]!.mainSleep = 1441; }],
    ['fractional sleep', (value: Backup) => { value.entries[0]!.mainSleep = 480.5; }],
    ['invalid rating', (value: Backup) => { value.entries[0]!.mood = 3; }],
    ['wrong rating type', (value: Backup) => { value.entries[0]!.mood = '0' as unknown as number; }],
    ['negative revision', (value: Backup) => { value.entries[0]!.revision = -1; }],
    ['oversized note', (value: Backup) => { value.entries[0]!.note = 'x'.repeat(4001); }],
    ['unsupported timezone', (value: Backup) => { value.settings.timezone = 'Moon/Base'; }],
    ['invalid theme', (value: Backup) => { value.settings.theme = 'pink' as Backup['settings']['theme']; }],
    ['mismatched draft date', (value: Backup) => { value.drafts[0]!.form.date = '2026-10-14'; }],
  ])('rejects %s without mutating its input', (_, mutate) => {
    const value = backup(); mutate(value); const before = structuredClone(value);
    expect(() => validateBackup(value)).toThrow('Invalid backup:'); expect(value).toEqual(before);
  });

  it('rejects duplicate IDs, duplicate dates, and duplicate drafts', () => {
    const sameId = backup(); sameId.entries.push(entry({ date: '2026-10-11' })); expect(() => validateBackup(sameId)).toThrow('duplicate IDs or dates');
    const sameDate = backup(); sameDate.entries.push(entry({ id: 'different-id' })); expect(() => validateBackup(sameDate)).toThrow('duplicate IDs or dates');
    const sameDraft = backup(); sameDraft.drafts.push(structuredClone(sameDraft.drafts[0]!)); expect(() => validateBackup(sameDraft)).toThrow('duplicated');
  });

  it('rejects missing null values, unsupported fields, and excessive record counts', () => {
    const missing = backup(); delete (missing.entries[0] as Partial<DailyEntry>).drive; expect(() => validateBackup(missing)).toThrow('missing or unsupported fields');
    const extra = { ...backup(), telemetry: {} }; expect(() => validateBackup(extra)).toThrow('missing or unsupported fields');
    const huge = backup(); huge.entries = new Array(50_001).fill(entry()); expect(() => validateBackup(huge)).toThrow('50000');
  });
});

describe('CSV privacy and spreadsheet safety', () => {
  it('excludes written notes and substance details by default', () => {
    const output = csvExport([entry({ note: 'SECRET NOTE', use: 'occurred', supportedBy: 'SECRET SUPPORT' })]);
    expect(output).not.toContain('SECRET'); expect(output).not.toContain('occurred'); expect(output).not.toContain('Strongest craving');
    expect(output).toContain('"2026-10-12",480,0,480,-2,,0,2');
  });

  it('escapes hostile text and quotes while leaving numeric negative ratings as numbers', () => {
    const output = csvExport([entry({ changeNote: '=HYPERLINK("https://example.invalid")', supportedBy: '  +SUM(1,1)', note: '@command\n"quoted", text' })], true);
    expect(output).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
    expect(output).toContain('"\'  +SUM(1,1)"'); expect(output).toContain('"\'@command\n""quoted"", text"');
    expect(output).toContain(',480,-2,,0,2,1,'); expect(output).not.toContain("'-2");
    expect(csvExport([entry({ note: '\tmalicious' })], true)).toContain('"\'\tmalicious"');
  });

  it('keeps unknown totals empty and sorts dates without changing source entries', () => {
    const entries = [entry({ date: '2026-10-12', additionalSleep: null }), entry({ id: 'earlier', date: '2026-10-10' })];
    const output = csvExport(entries); const lines = output.split('\r\n');
    expect(lines[1]).toContain('2026-10-10'); expect(lines[2]).toContain('"2026-10-12",480,,,-2'); expect(entries[0]!.date).toBe('2026-10-12');
  });
});

describe('restore preview', () => {
  it('compares content by date without treating timestamps, revisions, or IDs as changed answers', () => {
    const incoming = backup(); incoming.entries = [entry(), entry({ id: 'entry-2', date: '2026-10-11' }), entry({ id: 'entry-3', date: '2026-10-10' })];
    const existing = [entry({ id: 'other-id', updatedAt: '2026-10-12T19:00:00.000Z', revision: 7 }), entry({ id: 'other-2', date: '2026-10-11', mood: 2 })];
    expect(backupPreview(incoming, existing)).toEqual({ newEntries: 1, conflicts: 1, unchanged: 1 });
  });
});

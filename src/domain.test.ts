import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, dateRange, entriesInRange, entryToForm, formatDate, formatSleep, parseForm, ratingSummary, sleepSummary, today, totalSleep, validDate } from './domain';
import { SCALE_VERSION, emptyForm, type DailyEntry } from './types';

function entry(overrides: Partial<DailyEntry> = {}): DailyEntry {
  return { id: 'entry-1', date: '2026-10-12', createdAt: '2026-10-12T18:00:00.000Z', updatedAt: '2026-10-12T18:00:00.000Z', revision: 1, scaleVersion: SCALE_VERSION,
    mainSleep: null, additionalSleep: null, mood: null, drive: null, fatigue: null, enjoyment: null, craving: null, use: null, significantChange: null,
    changeNote: '', supportedBy: '', note: '', ...overrides };
}

afterEach(() => vi.useRealTimers());

describe('calendar dates', () => {
  it('uses Amsterdam midnight, including the daylight-saving transition', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T22:59:59Z')); expect(today()).toBe('2026-03-28');
    vi.setSystemTime(new Date('2026-03-28T23:00:00Z')); expect(today()).toBe('2026-03-29');
    vi.setSystemTime(new Date('2026-03-29T21:59:59Z')); expect(today()).toBe('2026-03-29');
    vi.setSystemTime(new Date('2026-03-29T22:00:00Z')); expect(today()).toBe('2026-03-30');
    expect(today('UTC')).toBe('2026-03-29');
    vi.setSystemTime(new Date('2026-10-25T22:59:59Z')); expect(today()).toBe('2026-10-25');
    vi.setSystemTime(new Date('2026-10-25T23:00:00Z')); expect(today()).toBe('2026-10-26');
  });

  it('increments calendar days across DST, year boundaries and leap days', () => {
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-25', -1)).toBe('2026-10-24');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(dateRange('2026-03-28', '2026-03-31')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    expect(dateRange('2026-03-31', '2026-03-28')).toEqual([]);
  });

  it('rejects rollover dates rather than silently changing their day', () => {
    for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-1-1', '0000-01-01', 'invalid']) expect(validDate(value)).toBe(false);
    expect(validDate('2024-02-29')).toBe(true);
    expect(validDate('0099-01-01')).toBe(true);
    expect(() => addDays('2026-02-29', 1)).toThrow();
    expect(formatDate('2026-10-12')).toBe('Monday, 12 October 2026');
  });
});

describe('daily form validation', () => {
  it('keeps unanswered fields distinct from a recorded zero', () => {
    const blank = parseForm(emptyForm('2026-10-12'));
    expect(blank.errors).toEqual([]); expect(blank.hasContent).toBe(false);
    expect(blank.values.mainSleep).toBeNull(); expect(blank.values.additionalSleep).toBeNull();
    const explicitZero = parseForm({ ...emptyForm('2026-10-12'), additionalHours: '0', fatigue: 0, mood: 0, significantChange: false });
    expect(explicitZero.errors).toEqual([]); expect(explicitZero.hasContent).toBe(true);
    expect(explicitZero.values.additionalSleep).toBe(0); expect(explicitZero.values.fatigue).toBe(0); expect(explicitZero.values.mood).toBe(0);
    expect(explicitZero.values.mainSleep).toBeNull(); expect(explicitZero.values.significantChange).toBe(false);
  });

  it('accepts a partial hours/minutes pair and preserves the other sleep answer', () => {
    const hours = parseForm({ ...emptyForm('2026-10-12'), mainHours: '8' });
    expect(hours.values.mainSleep).toBe(480); expect(hours.values.additionalSleep).toBeNull(); expect(hours.errors).toEqual([]);
    const minutes = parseForm({ ...emptyForm('2026-10-12'), additionalMinutes: '45' });
    expect(minutes.values.additionalSleep).toBe(45); expect(minutes.errors).toEqual([]);
    expect(parseForm({ ...emptyForm('2026-10-12'), mainHours: '24', mainMinutes: '0' }).values.mainSleep).toBe(1440);
  });

  it.each([
    ['negative hours', { mainHours: '-1' }], ['fractional hours', { mainHours: '7.5' }], ['invalid minutes', { mainMinutes: '60' }],
    ['more than a day', { mainHours: '24', mainMinutes: '1' }], ['scientific notation', { additionalHours: '1e2' }],
    ['invalid date', { date: '2026-02-30' }], ['out-of-range mood', { mood: 3 }], ['fractional rating', { enjoyment: 1.5 }],
    ['too-long note', { note: 'x'.repeat(4001) }],
  ])('retains an error for %s', (_, changes) => {
    expect(parseForm({ ...emptyForm('2026-10-12'), ...changes }).errors.length).toBeGreaterThan(0);
  });

  it('round-trips the full record including optional details and zero sleep', () => {
    const saved = entry({ mainSleep: 485, additionalSleep: 0, mood: -2, drive: 2, fatigue: 3, enjoyment: 0, craving: 1, use: 'prefer-not', significantChange: true, changeNote: 'Afternoon change', supportedBy: 'A walk', note: '  Words kept as written.  ' });
    const form = entryToForm(saved); expect(form.mainHours).toBe('8'); expect(form.mainMinutes).toBe('5');
    expect(form.additionalHours).toBe('0'); expect(form.additionalMinutes).toBe('0');
    const { values, errors } = parseForm(form);
    expect(errors).toEqual([]);
    const { id: _id, date: _date, createdAt: _created, updatedAt: _updated, revision: _revision, scaleVersion: _scale, ...content } = saved;
    expect(values).toEqual(content);
  });
});

describe('honest insights', () => {
  it('requires both sleep components for a valid total, including explicit zero', () => {
    expect(totalSleep(entry({ mainSleep: 480 }))).toBeNull();
    expect(totalSleep(entry({ mainSleep: 480, additionalSleep: 0 }))).toBe(480);
    expect(totalSleep(entry({ mainSleep: 0, additionalSleep: 0 }))).toBe(0);
    expect(formatSleep(null)).toBe('Unrecorded'); expect(formatSleep(0)).toBe('0h 0m'); expect(formatSleep(485)).toBe('8h 5m');
  });

  it('does not invent values for missing dates or unanswered ratings', () => {
    const entries = [entry({ date: '2026-10-12', mood: 0 }), entry({ id: 'entry-2', date: '2026-10-10', mood: -2 }), entry({ id: 'entry-3', date: '2026-10-09' })];
    const visible = entriesInRange(entries, '2026-10-09', '2026-10-12');
    expect(visible.map(item => item.date)).toEqual(['2026-10-09', '2026-10-10', '2026-10-12']);
    expect(entries[0]!.date).toBe('2026-10-12');
    const summary = ratingSummary(visible, 'mood');
    expect(summary.count).toBe(2); expect(summary.distribution.map(item => item.count)).toEqual([1, 0, 1, 0, 0]);
    expect(summary.median).toBe('Very low / Okay / neutral');
    expect(ratingSummary([entry()], 'mood').count).toBe(0);
  });

  it('calculates sleep statistics only from complete observed totals', () => {
    const stats = sleepSummary([entry({ mainSleep: 480, additionalSleep: 0 }), entry({ mainSleep: 420, additionalSleep: 60 }), entry({ mainSleep: 600 }), entry({ mainSleep: 0, additionalSleep: 0 })]);
    expect(stats).toEqual({ count: 3, mean: 320, min: 0, max: 480 });
    expect(sleepSummary([entry({ mainSleep: 480 })])).toEqual({ count: 0, mean: null, min: null, max: null });
  });
});

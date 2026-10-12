import { SCALES, type DailyEntry, type DailyForm, type Metric } from './types';

export type EntryValues = Omit<DailyEntry, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'revision' | 'scaleVersion'>;

/** Calendar dates deliberately use UTC arithmetic; the journal never stores a date as an instant. */
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function today(timezone = 'Europe/Amsterdam'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(date: string, amount: number): string {
  if (!validDate(date) || !Number.isSafeInteger(amount)) throw new Error('A valid date and whole number of days are required.');
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + amount);
  const result = instant.toISOString().slice(0, 10);
  if (!validDate(result)) throw new Error('The resulting date is outside the supported calendar.');
  return result;
}

export function dateRange(start: string, end: string): string[] {
  if (!validDate(start) || !validDate(end)) throw new Error('A valid start and end date are required.');
  if (start > end) return [];
  const count = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (count > 366_000) throw new Error('Please choose a shorter date range.');
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

export function formatDate(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }): string {
  if (!validDate(date)) return date;
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

function splitSleep(minutes: number | null): [string, string] {
  return minutes === null ? ['', ''] : [String(Math.floor(minutes / 60)), String(minutes % 60)];
}

export function entryToForm(entry: DailyEntry): DailyForm {
  const [mainHours, mainMinutes] = splitSleep(entry.mainSleep);
  const [additionalHours, additionalMinutes] = splitSleep(entry.additionalSleep);
  return { date: entry.date, mainHours, mainMinutes, additionalHours, additionalMinutes,
    mood: entry.mood, drive: entry.drive, fatigue: entry.fatigue, enjoyment: entry.enjoyment,
    craving: entry.craving, use: entry.use, significantChange: entry.significantChange,
    changeNote: entry.changeNote, supportedBy: entry.supportedBy, note: entry.note };
}

export function parseForm(form: DailyForm): { values: EntryValues; errors: string[]; hasContent: boolean } {
  const errors: string[] = [];
  if (!validDate(form.date)) errors.push('Choose a valid calendar date.');
  const duration = (hours: string, minutes: string, label: string): number | null => {
    if (typeof hours !== 'string' || typeof minutes !== 'string') { errors.push(`${label} must use hours and minutes.`); return null; }
    const h = hours.trim(); const m = minutes.trim();
    if (h === '' && m === '') return null;
    if ((h !== '' && !/^\d+$/.test(h)) || (m !== '' && !/^\d+$/.test(m))) { errors.push(`${label} must use nonnegative whole numbers.`); return null; }
    const hourValue = h === '' ? 0 : Number(h); const minuteValue = m === '' ? 0 : Number(m);
    if (!Number.isSafeInteger(hourValue) || !Number.isSafeInteger(minuteValue) || minuteValue > 59) { errors.push(`${label} minutes must be between 0 and 59.`); return null; }
    const result = hourValue * 60 + minuteValue;
    if (result > 1440) { errors.push(`${label} cannot exceed 24 hours.`); return null; }
    return result;
  };
  const values: EntryValues = {
    mainSleep: duration(form.mainHours, form.mainMinutes, 'Main sleep'),
    additionalSleep: duration(form.additionalHours, form.additionalMinutes, 'Additional sleep'),
    mood: form.mood, drive: form.drive, fatigue: form.fatigue, enjoyment: form.enjoyment,
    craving: form.craving, use: form.use, significantChange: form.significantChange,
    changeNote: form.changeNote, supportedBy: form.supportedBy, note: form.note,
  };
  for (const metric of Object.keys(SCALES) as Metric[]) {
    const value = form[metric]; const scale = SCALES[metric];
    if (value !== null && (!Number.isInteger(value) || value < scale.min || value > scale.max)) errors.push(`${scale.label} must be one of the labelled choices.`);
  }
  if (form.use !== null && !['none', 'occurred', 'prefer-not'].includes(form.use)) errors.push('Choose a valid substance-use answer.');
  if (form.significantChange !== null && typeof form.significantChange !== 'boolean') errors.push('Choose a valid mood-change answer.');
  for (const field of ['changeNote', 'supportedBy', 'note'] as const) {
    if (typeof form[field] !== 'string' || form[field].length > 4000) errors.push('Each written answer must contain no more than 4,000 characters.');
  }
  const hasContent = Object.values(values).some(value => value !== null && (typeof value !== 'string' || value.trim() !== '')) ||
    [form.mainHours, form.mainMinutes, form.additionalHours, form.additionalMinutes].some(value => typeof value === 'string' && value.trim() !== '');
  return { values, errors: [...new Set(errors)], hasContent };
}

export function totalSleep(entry: Pick<DailyEntry, 'mainSleep' | 'additionalSleep'>): number | null {
  return entry.mainSleep === null || entry.additionalSleep === null ? null : entry.mainSleep + entry.additionalSleep;
}

export function entriesInRange(entries: DailyEntry[], start: string, end: string): DailyEntry[] {
  if (!validDate(start) || !validDate(end)) throw new Error('A valid start and end date are required.');
  return entries.filter(entry => entry.date >= start && entry.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}

export function ratingSummary(entries: DailyEntry[], metric: Metric): { count: number; distribution: { value: number; label: string; count: number }[]; median: string } {
  const scale = SCALES[metric];
  const values = entries.map(entry => entry[metric]).filter((value): value is number => value !== null && Number.isInteger(value) && value >= scale.min && value <= scale.max).sort((a, b) => a - b);
  const distribution = scale.labels.map((label, index) => ({ value: scale.min + index, label, count: values.filter(value => value === scale.min + index).length }));
  if (values.length === 0) return { count: 0, distribution, median: 'No entries' };
  const lower = values[Math.floor((values.length - 1) / 2)]!; const upper = values[Math.floor(values.length / 2)]!;
  const label = (value: number) => scale.labels[value - scale.min]!;
  return { count: values.length, distribution, median: lower === upper ? label(lower) : `${label(lower)} / ${label(upper)}` };
}

export function sleepSummary(entries: DailyEntry[]): { count: number; mean: number | null; min: number | null; max: number | null } {
  const values = entries.map(totalSleep).filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) return { count: 0, mean: null, min: null, max: null };
  return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length, min: Math.min(...values), max: Math.max(...values) };
}

export function formatSleep(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return 'Unrecorded';
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}

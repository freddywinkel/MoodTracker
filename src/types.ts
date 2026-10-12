export const SCALE_VERSION = 1;
export const BACKUP_VERSION = 1;
export const APP_ID = 'moodtracker';
export type Rating = number | null;
export type Theme = 'system' | 'light' | 'dark';
export interface DailyForm {
  date: string;
  mainHours: string;
  mainMinutes: string;
  additionalHours: string;
  additionalMinutes: string;
  mood: Rating;
  drive: Rating;
  fatigue: Rating;
  enjoyment: Rating;
  craving: Rating;
  use: 'none' | 'occurred' | 'prefer-not' | null;
  significantChange: boolean | null;
  changeNote: string;
  supportedBy: string;
  note: string;
}
export interface DailyEntry {
  id: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  scaleVersion: number;
  mainSleep: number | null;
  additionalSleep: number | null;
  mood: Rating;
  drive: Rating;
  fatigue: Rating;
  enjoyment: Rating;
  craving: Rating;
  use: DailyForm['use'];
  significantChange: boolean | null;
  changeNote: string;
  supportedBy: string;
  note: string;
}
export interface DraftRecord { date: string; revision: number; updatedAt: string; form: DailyForm }
export interface Settings {
  theme: Theme;
  timezone: string;
  contactName: string;
  contactDetails: string;
  clinician: string;
  supportPlan: string;
  lastExportAt: string | null;
}
export const DEFAULT_SETTINGS: Settings = { theme: 'system', timezone: 'Europe/Amsterdam', contactName: '', contactDetails: '', clinician: '', supportPlan: '', lastExportAt: null };
export const SCALES = {
  mood: { label: 'Mood', min: -2, max: 2, labels: ['Very low', 'Low', 'Okay / neutral', 'Good', 'Very good'] },
  drive: { label: 'Mental drive', min: -2, max: 2, labels: ['Very slowed', 'Slower', 'Usual', 'Faster / more driven', 'Hard to slow down'] },
  fatigue: { label: 'Physical fatigue', min: 0, max: 3, labels: ['None', 'Mild', 'Moderate', 'Strong'] },
  enjoyment: { label: 'Interest / enjoyment', min: 0, max: 3, labels: ['None', 'A little', 'Some', 'Plenty'] },
  craving: { label: 'Strongest craving', min: 0, max: 3, labels: ['None', 'Manageable', 'Intrusive', 'Hard to resist'] },
} as const;
export type Metric = keyof typeof SCALES;
export interface Backup {
  app: 'moodtracker';
  version: number;
  exportedAt: string;
  scaleDefinitions: typeof SCALES;
  entries: DailyEntry[];
  drafts: DraftRecord[];
  settings: Settings;
}
export const emptyForm = (date: string): DailyForm => ({ date, mainHours: '', mainMinutes: '', additionalHours: '', additionalMinutes: '', mood: null, drive: null, fatigue: null, enjoyment: null, craving: null, use: null, significantChange: null, changeNote: '', supportedBy: '', note: '' });

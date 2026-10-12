import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpFromLine, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CloudOff, Heart, History, Leaf, LoaderCircle, Moon, MoreHorizontal, Printer, RefreshCw, Settings as SettingsIcon, Share2, ShieldCheck, Sparkles, Sun, Trash2, X } from 'lucide-react';
import { DEFAULT_SETTINGS, SCALES, emptyForm, type Backup, type DailyEntry, type DailyForm, type Metric, type Settings, type Theme } from './types';
import { addDays, formatDate, formatSleep, parseForm, ratingSummary, today, totalSleep, validDate } from './domain';
import { backupPreview, csvExport, validateBackup } from './reports';
import { applyBackup, clearData, createBackup, deleteEntry, getEntries, loadSettings, loadDay, onDataChange, persistForm, saveSettings } from './storage';
import { applyUpdate, checkForUpdate, getPwaState, registerPwa } from './pwa';
import { copy, metricDescriptions, saveCopy } from './strings';
import './styles.css';

type Screen = 'today' | 'history' | 'insights' | 'settings' | 'support';
type SaveState = 'idle' | 'saving' | 'saved' | 'invalid' | 'error' | 'conflict';
const mainMetrics: Metric[] = ['mood', 'drive', 'fatigue', 'enjoyment'];
const route = (): Screen => ['today', 'history', 'insights', 'settings', 'support'].includes(location.hash.slice(1)) ? location.hash.slice(1) as Screen : 'today';
const ratingLabel = (metric: Metric, value: number | null) => value === null ? 'Unrecorded' : SCALES[metric].labels[value - SCALES[metric].min] ?? 'Unrecorded';
const dayLabel = (date: string, short = false) => formatDate(date, short ? { day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const compactDay = (date: string) => formatDate(date, { day: 'numeric', month: 'short' });
const rangeDays = (start: string, end: string) => { const days: string[] = []; for (let day = start; day <= end && days.length < 3660; day = addDays(day, 1)) days.push(day); return days; };
const messageFor = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Your entered values are still here.';
const answered = (entry: DailyEntry) => mainMetrics.some(metric => entry[metric] !== null) || entry.mainSleep !== null || entry.additionalSleep !== null || entry.craving !== null || entry.use !== null || entry.significantChange !== null || !!entry.note || !!entry.changeNote || !!entry.supportedBy;

function Logo() { return <span className="brand-symbol" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M11 26c0-9 7-17 17-18-1 10-7 18-17 18Z" /><path d="M11 26c7-1 14 2 18 8-8 2-15-1-18-8Z" /><path d="M12 30 26 12" /></svg></span>; }
function EmptyState({ icon, title, children, action }: { icon: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{children}</p>{action}</div>; }

function RatingField({ metric, value, onChange }: { metric: Metric; value: number | null; onChange: (value: number | null) => void }) {
  const scale = SCALES[metric];
  return <fieldset className={`rating-field metric-${metric}`}><legend>{scale.label}</legend><div className="field-heading"><p>{metricDescriptions[metric]}</p>{value !== null && <button type="button" className="text-button subtle" onClick={() => onChange(null)} aria-label={`Clear ${scale.label.toLowerCase()}`}><X size={13} /> Clear</button>}</div><div className={`rating-options options-${scale.labels.length}`} >{scale.labels.map((label, index) => <button type="button" key={label} className={`rating-option ${value === index + scale.min ? 'selected' : ''}`} aria-pressed={value === index + scale.min} onClick={() => onChange(value === index + scale.min ? null : index + scale.min)}><span className={`rating-indicator indicator-${index}`} aria-hidden="true">{metric === 'mood' ? ['−', '−', '·', '+', '+'][index] : index + scale.min}</span><span>{label}</span>{value === index + scale.min && <Check className="choice-check" size={13} aria-hidden="true" />}</button>)}</div></fieldset>;
}

function SleepField({ kind, form, onChange, errors }: { kind: 'main' | 'additional'; form: DailyForm; onChange: (patch: Partial<DailyForm>) => void; errors: string[] }) {
  const hoursKey = `${kind}Hours` as 'mainHours' | 'additionalHours';
  const minutesKey = `${kind}Minutes` as 'mainMinutes' | 'additionalMinutes';
  const label = kind === 'main' ? copy.mainSleep : copy.additionalSleep;
  const entered = form[hoursKey] !== '' || form[minutesKey] !== '';
  return <fieldset className="sleep-field"><legend>{label}</legend><p>{kind === 'main' ? copy.mainSleepDescription : copy.additionalSleepDescription}</p><div className="sleep-inputs"><label><span className="sr-only">{label} hours</span><input aria-invalid={errors.some(error => error.toLowerCase().includes(kind))} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} placeholder="—" aria-label={`${label} hours`} value={form[hoursKey]} onChange={event => onChange({ [hoursKey]: event.target.value })} /><span>hours</span></label><span className="sleep-divider">:</span><label><span className="sr-only">{label} minutes</span><input aria-invalid={errors.some(error => error.toLowerCase().includes(kind))} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} placeholder="—" aria-label={`${label} minutes`} value={form[minutesKey]} onChange={event => onChange({ [minutesKey]: event.target.value })} /><span>minutes</span></label></div><div className="sleep-actions">{kind === 'additional' && <button type="button" className={`pill-button ${form.additionalHours === '0' && form.additionalMinutes === '0' ? 'active' : ''}`} onClick={() => onChange({ additionalHours: '0', additionalMinutes: '0' })}>No additional sleep</button>}{entered && <button type="button" className="text-button subtle" onClick={() => onChange({ [hoursKey]: '', [minutesKey]: '' })}><X size={13} /> Set to unknown</button>}</div></fieldset>;
}

function TrendChart({ entries, dates, metric }: { entries: DailyEntry[]; dates: string[]; metric: Metric | 'sleep' }) {
  const scale = metric === 'sleep' ? null : SCALES[metric];
  const sleepValues = entries.map(totalSleep).filter((value): value is number => value !== null);
  const min = scale?.min ?? 0, max = scale?.max ?? Math.max(720, Math.ceil(Math.max(0, ...sleepValues) / 240) * 240);
  const map = new Map(entries.map(entry => [entry.date, metric === 'sleep' ? totalSleep(entry) : entry[metric]]));
  const points = dates.map((date, index) => ({ date, value: map.get(date) ?? null, x: 44 + (index / Math.max(1, dates.length - 1)) * 532 }));
  const y = (value: number) => 135 - ((value - min) / (max - min)) * 110;
  const values = points.map(point => point.value).filter((value): value is number => value !== null);
  const sorted = [...values].sort((a, b) => a - b);
  const summary = metric === 'sleep' ? null : ratingSummary(entries, metric);
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const label = metric === 'sleep' ? copy.totalSleep : scale!.label;
  const ticks = metric === 'sleep' ? [0, max / 4, max / 2, max * 3 / 4, max] : Array.from({ length: max - min + 1 }, (_, index) => min + index);
  return <section className={`card trend-card metric-${metric}`}><div className="card-heading"><div><h2>{label}</h2><p>{metric === 'sleep' ? copy.totalSleepDescription : metricDescriptions[metric]}</p></div><span className="observation-count" data-testid={`${metric}-observations`}>{values.length} {values.length === 1 ? 'day' : 'days'}</span></div>{!values.length ? <div className="chart-empty">No {label.toLowerCase()} recorded in this period.</div> : <><div className="chart-container"><svg role="img" aria-label={`${label} by day. ${values.length} recorded days. Missing days are gaps. Open the table below for exact values.`} viewBox="0 0 600 165">{ticks.map(tick => <g key={tick}><line x1="44" x2="576" y1={y(tick)} y2={y(tick)} className="chart-grid" /><text x="34" y={y(tick) + 4} textAnchor="end" className="chart-tick">{metric === 'sleep' ? `${tick / 60}h` : tick}</text></g>)}{points.map((point, index) => { const previous = points[index - 1]; return point.value !== null && previous?.value !== null && previous?.value !== undefined ? <line key={`line-${point.date}`} x1={previous.x} y1={y(previous.value)} x2={point.x} y2={y(point.value)} className="chart-line" /> : null; })}{points.map(point => point.value === null ? null : <circle key={point.date} cx={point.x} cy={y(point.value)} r={dates.length > 30 ? 2.8 : 4} className="chart-dot"><title>{compactDay(point.date)}: {metric === 'sleep' ? formatSleep(point.value) : ratingLabel(metric, point.value)}</title></circle>)}<text x="44" y="159" className="chart-tick">{compactDay(dates[0])}</text><text x="576" y="159" textAnchor="end" className="chart-tick">{compactDay(dates[dates.length - 1])}</text></svg></div>{metric === 'sleep' ? <div className="sleep-statistics"><span><small>Average</small><strong>{formatSleep(Math.round(average!))}</strong></span><span><small>Range</small><strong>{formatSleep(sorted[0])} – {formatSleep(sorted[sorted.length - 1])}</strong></span></div> : <><p className="median-text" data-testid={`${metric}-summary`}>Middle recorded response: <strong>{summary!.median}</strong></p><div className="distribution">{scale!.labels.map((category, index) => { const count = values.filter(value => value === index + min).length; return <div key={category}><span>{category}</span><div className="distribution-track"><i style={{ width: `${count / values.length * 100}%` }} /></div><b>{count}</b></div>; })}</div></>}</>}<details className="table-details"><summary>View daily values <ChevronDown size={14} /></summary><div className="table-scroll"><table><thead><tr><th>Date</th><th>{label}</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><td>{compactDay(point.date)}</td><td>{point.value === null ? 'Unrecorded' : metric === 'sleep' ? formatSleep(point.value) : ratingLabel(metric, point.value)}</td></tr>)}</tbody></table></div></details></section>;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(route);
  const [date, setDate] = useState(today());
  const [form, setForm] = useState<DailyForm>(emptyForm(today()));
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pwa, setPwa] = useState(getPwaState());
  const [updateLater, setUpdateLater] = useState(false);
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [periodEnd, setPeriodEnd] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [exportStart, setExportStart] = useState(addDays(today(), -29));
  const [exportEnd, setExportEnd] = useState(today());
  const [includePrivate, setIncludePrivate] = useState(false);
  const [restore, setRestore] = useState<Backup | null>(null);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [restoreConflicts, setRestoreConflicts] = useState<'keep' | 'incoming'>('keep');
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [restoreName, setRestoreName] = useState('');
  const [restorePreview, setRestorePreview] = useState<ReturnType<typeof backupPreview> | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsConflict, setSettingsConflict] = useState(false);
  const formRef = useRef(form), revisionRef = useRef(0), dateRef = useRef(date);
  const pendingForm = useRef<DailyForm | null>(null), savingPromise = useRef<Promise<boolean> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings), settingsRevisionRef = useRef(0), pendingSettings = useRef<Settings | null>(null), settingsPromise = useRef<Promise<boolean> | null>(null);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef(screen), hashIgnore = useRef(false), fileRef = useRef<HTMLInputElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const refreshEntries = useCallback(async () => setEntries((await getEntries()).filter(answered).sort((a, b) => b.date.localeCompare(a.date))), []);

  const flushForm = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (savingPromise.current) { const success = await savingPromise.current; return success && pendingForm.current ? flushForm() : success; }
    if (!pendingForm.current) return true;
    const operation = (async () => {
      while (pendingForm.current) {
        const snapshot = pendingForm.current; pendingForm.current = null;
        setSaveState('saving');
        try {
          const result = await persistForm(snapshot, revisionRef.current);
          revisionRef.current = result.revision;
          setFormErrors(result.errors);
          setSaveState(pendingForm.current ? 'saving' : result.errors.length ? 'invalid' : 'saved');
          await refreshEntries();
        } catch (cause) {
          if (!pendingForm.current) pendingForm.current = snapshot;
          const isConflict = cause instanceof Error && cause.name === 'ConflictError';
          setSaveState(isConflict ? 'conflict' : 'error');
          setError(isConflict ? 'This day changed in another tab. Your entered values are still here. Export them or reload this day before editing again.' : `Couldn’t save locally. ${messageFor(cause)}`);
          return false;
        }
      }
      return true;
    })();
    savingPromise.current = operation;
    const result = await operation;
    savingPromise.current = null;
    return result;
  }, [refreshEntries]);

  const flushSettings = useCallback(async (): Promise<boolean> => {
    if (settingsTimer.current) { clearTimeout(settingsTimer.current); settingsTimer.current = null; }
    if (settingsPromise.current) { const success = await settingsPromise.current; return success && pendingSettings.current ? flushSettings() : success; }
    if (!pendingSettings.current) return true;
    const operation = (async () => {
      setSettingsSaving(true);
      while (pendingSettings.current) {
        const snapshot = pendingSettings.current; pendingSettings.current = null;
        try { settingsRevisionRef.current = await saveSettings(snapshot, settingsRevisionRef.current); } catch (cause) { if (!pendingSettings.current) pendingSettings.current = snapshot; const conflict = cause instanceof Error && cause.name === 'ConflictError'; setSettingsConflict(conflict); setError(conflict ? 'Your settings changed in another tab. Your entered values are still here. Export them or reload settings before editing again.' : `Couldn’t save your settings. ${messageFor(cause)}`); setSettingsSaving(false); return false; }
      }
      setSettingsSaving(false); return true;
    })();
    settingsPromise.current = operation;
    const result = await operation; settingsPromise.current = null; return result;
  }, []);
  const flush = useCallback(async () => await flushForm() && await flushSettings(), [flushForm, flushSettings]);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadDay(dateRef.current), getEntries(), loadSettings()]).then(([day, all, snapshot]) => {
      if (!mounted) return;
      formRef.current = day.form; revisionRef.current = day.revision; setForm(day.form);
      setEntries(all.filter(answered).sort((a, b) => b.date.localeCompare(a.date)));
      settingsRef.current = snapshot.settings; settingsRevisionRef.current = snapshot.revision; setSettings(snapshot.settings);
      const parsed = parseForm(day.form); setFormErrors(parsed.errors);
      setSaveState(parsed.errors.length ? 'invalid' : parsed.hasContent ? 'saved' : 'idle'); setReady(true);
    }).catch(cause => { setError(`Your local journal could not be opened. ${messageFor(cause)}`); });
    void registerPwa(state => { if (mounted) setPwa(state); }).catch(cause => { if (mounted) setNotice(`Offline setup needs another try: ${messageFor(cause)}`); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => { document.documentElement.dataset.theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme; };
    update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, [settings.theme]);
  useEffect(() => onDataChange(() => { void refreshEntries().catch(cause => setError(messageFor(cause))); }), [refreshEntries]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (pendingForm.current || savingPromise.current || pendingSettings.current || settingsPromise.current) { void flush(); event.preventDefault(); event.returnValue = ''; } };
    document.addEventListener('visibilitychange', onHide); window.addEventListener('beforeunload', beforeUnload);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('beforeunload', beforeUnload); };
  }, [flush]);

  const navigate = useCallback(async (next: Screen) => {
    if (busy) return;
    if (!await flush()) return;
    screenRef.current = next; setScreen(next);
    if (location.hash !== `#${next}`) { hashIgnore.current = true; location.hash = next; }
    setError(''); setNotice(''); window.scrollTo({ top: 0, behavior: 'instant' });
    setTimeout(() => headlineRef.current?.focus(), 0);
  }, [flush, busy]);
  useEffect(() => {
    const change = () => { if (hashIgnore.current) { hashIgnore.current = false; return; } const next = route(); if (next !== screenRef.current) void navigate(next).then(() => { if (screenRef.current !== next) { hashIgnore.current = true; location.hash = screenRef.current; } }); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, [navigate]);

  const changeForm = (patch: Partial<DailyForm>) => {
    if (saveState === 'conflict' || busy) return;
    const next = { ...formRef.current, ...patch };
    formRef.current = next; pendingForm.current = next; setForm(next); setSaveState('saving'); setError('');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushForm(), 400);
  };
  const changeSettings = (patch: Partial<Settings>) => {
    if (settingsConflict) return;
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next; pendingSettings.current = next; setSettings(next); setSettingsSaving(true);
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    settingsTimer.current = setTimeout(() => void flushSettings(), 400);
  };
  const selectDate = async (next: string, goToToday = false) => {
    if (!validDate(next) || busy || !await flush()) return;
    setBusy(true);
    try { const day = await loadDay(next); dateRef.current = next; formRef.current = day.form; revisionRef.current = day.revision; pendingForm.current = null; setDate(next); setForm(day.form); const parsed = parseForm(day.form); setFormErrors(parsed.errors); setSaveState(parsed.errors.length ? 'invalid' : parsed.hasContent ? 'saved' : 'idle'); setError(''); if (goToToday) await navigate('today'); }
    catch (cause) { setError(messageFor(cause)); } finally { setBusy(false); }
  };
  const download = (name: string, contents: string, type: string) => {
    const blob = new Blob([contents], { type }), url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const backup = async (share = false) => {
    if (!await flush()) return;
    setBusy(true);
    try {
      const data = await createBackup(), contents = JSON.stringify(data, null, 2), filename = `MoodTracker-backup-${today()}.json`;
      const file = new File([contents], filename, { type: 'application/json' });
      if (share && navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'MoodTracker backup' }); setNotice('Backup shared. Keep it somewhere you can find again.'); }
      else { download(filename, contents, 'application/json'); setNotice('Backup download started. Check that the file was saved.'); }
      changeSettings({ lastExportAt: new Date().toISOString() }); await flushSettings();
    } catch (cause) { if (cause instanceof Error && cause.name === 'AbortError') setNotice('Sharing cancelled.'); else setError(`Couldn’t create a backup. ${messageFor(cause)}`); }
    finally { setBusy(false); }
  };
  const exportUnsaved = () => download(`MoodTracker-unsaved-${dateRef.current}.json`, JSON.stringify({ app: 'moodtracker-unsaved-form', date: dateRef.current, form: formRef.current, settings: settingsRef.current }, null, 2), 'application/json');
  const reloadSettings = async () => {
    if (!window.confirm('Reload settings from local storage? Any unsaved settings shown here will be discarded. Export entered values first if you want to keep them.')) return;
    try { if (settingsTimer.current) clearTimeout(settingsTimer.current); pendingSettings.current = null; const snapshot = await loadSettings(); settingsRef.current = snapshot.settings; settingsRevisionRef.current = snapshot.revision; setSettings(snapshot.settings); setSettingsConflict(false); setSettingsSaving(false); setError(''); }
    catch (cause) { setError(messageFor(cause)); }
  };
  const readRestore = async (file?: File) => {
    if (!file || !await flush()) return;
    setError(''); setNotice('');
    try { if (file.size > 20_000_000) throw new Error('Choose a JSON backup smaller than 20 MB.'); const result = validateBackup(JSON.parse(await file.text())); const current = await createBackup(); setRestorePreview(backupPreview(result, current.entries, current.drafts)); setRestore(result); setRestoreName(file.name); setRestoreMode('merge'); setRestoreConflicts('keep'); setRestoreConfirmed(false); }
    catch (cause) { setError(`This backup cannot be restored. ${messageFor(cause)}`); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const restoreBackup = async () => {
    if (!restore || !restoreConfirmed || !await flush()) return;
    setBusy(true);
    try { const result = await applyBackup(restore, restoreMode, restoreConflicts); const [all, loaded, prefs] = await Promise.all([getEntries(), loadDay(dateRef.current), loadSettings()]); setEntries(all.filter(answered).sort((a, b) => b.date.localeCompare(a.date))); formRef.current = loaded.form; revisionRef.current = loaded.revision; setForm(loaded.form); settingsRef.current = prefs.settings; settingsRevisionRef.current = prefs.revision; setSettings(prefs.settings); const parsed = parseForm(loaded.form); setSaveState(parsed.errors.length ? 'invalid' : parsed.hasContent ? 'saved' : 'idle'); setFormErrors(parsed.errors); setRestore(null); setNotice(`Restore complete: ${result.added} added, ${result.updated} updated, ${result.kept} kept.`); }
    catch (cause) { setError(`Nothing was restored. ${messageFor(cause)}`); } finally { setBusy(false); }
  };
  const removeEntry = async (target: string) => {
    if (!await flush() || !window.confirm(`Delete the entry and any draft for ${dayLabel(target)}? This cannot be undone.`)) return;
    try { await deleteEntry(target); await refreshEntries(); if (dateRef.current === target) { const loaded = await loadDay(target); formRef.current = loaded.form; revisionRef.current = loaded.revision; setForm(loaded.form); setSaveState('idle'); setFormErrors([]); } setNotice('Day deleted.'); } catch (cause) { setError(messageFor(cause)); }
  };
  const removeAll = async () => {
    if (!await flush() || !window.confirm('Delete all MoodTracker entries, drafts, and personal settings from this browser? Export a backup first if you want to keep them. This cannot be undone.')) return;
    setBusy(true);
    try { await clearData(); const [day, prefs] = await Promise.all([loadDay(dateRef.current), loadSettings()]); formRef.current = day.form; revisionRef.current = day.revision; setForm(day.form); setEntries([]); settingsRef.current = prefs.settings; settingsRevisionRef.current = prefs.revision; setSettings(prefs.settings); setSaveState('idle'); setFormErrors([]); setNotice('All local entries and settings have been deleted.'); } catch (cause) { setError(messageFor(cause)); } finally { setBusy(false); }
  };
  const installUpdate = async () => {
    if (!await flush()) return;
    setBusy(true);
    try { await applyUpdate(); } catch (cause) { setError(`Couldn’t apply the update. ${messageFor(cause)}`); setBusy(false); }
  };
  const checkUpdate = async () => { setBusy(true); setNotice(''); try { await checkForUpdate(); const state = getPwaState(); setPwa(state); setUpdateLater(false); setNotice(state.updateAvailable ? 'An update is ready. Your saved journal will stay in this browser.' : 'Update check complete. No new version is ready.'); } catch (cause) { setError(`Couldn’t check for an update. ${messageFor(cause)}`); } finally { setBusy(false); } };
  const downloadCsv = async () => {
    if (!await flush()) return;
    setBusy(true);
    try { const all = (await getEntries()).filter(entry => entry.date >= exportStart && entry.date <= exportEnd); download(`MoodTracker-${exportStart}-to-${exportEnd}.csv`, csvExport(all, includePrivate), 'text/csv;charset=utf-8'); setNotice('CSV download started.'); }
    catch (cause) { setError(`Couldn’t create a CSV export. ${messageFor(cause)}`); }
    finally { setBusy(false); }
  };
  const printReport = async () => {
    if (!await flush()) return;
    try { await refreshEntries(); window.setTimeout(() => window.print(), 100); }
    catch (cause) { setError(`Couldn’t prepare the report. ${messageFor(cause)}`); }
  };

  const filteredExport = entries.filter(entry => entry.date >= exportStart && entry.date <= exportEnd).sort((a, b) => a.date.localeCompare(b.date));
  const dates = rangeDays(addDays(periodEnd, -(period - 1)), periodEnd);
  const periodEntries = entries.filter(entry => entry.date >= dates[0] && entry.date <= periodEnd);
  const parsedCurrent = parseForm(form);
  const sleepTotal = parsedCurrent.errors.length ? null : totalSleep(parsedCurrent.values);
  const todayDate = today();
  const monthFirst = `${month}-01`, monthStart = new Date(`${monthFirst}T12:00:00Z`), offset = (monthStart.getUTCDay() + 6) % 7;
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  const monthLabel = formatDate(monthFirst, { month: 'long', year: 'numeric' });
  const changeMonth = (step: number) => { const value = new Date(`${month}-01T12:00:00Z`); value.setUTCMonth(value.getUTCMonth() + step); setMonth(value.toISOString().slice(0, 7)); };
  const backupReminder = entries.length > 0 && (!settings.lastExportAt || Date.now() - Date.parse(settings.lastExportAt) > 14 * 86_400_000);
  const fullShareSupported = !!navigator.share && !!navigator.canShare?.({ files: [new File([''], 'backup.json', { type: 'application/json' })] });

  return <div className="app-shell">
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
    <header className="app-header"><button type="button" className="brand" onClick={() => void navigate('today')} aria-label="MoodTracker home"><Logo /><span>{copy.appName}<small>{copy.appSubtitle}</small></span></button><div className="header-actions"><span className={`offline-badge ${pwa.offlineReady ? 'ready' : ''}`} title={pwa.offlineReady ? 'Offline app is ready in this browser' : 'Offline setup is finishing'}><CloudOff size={14} /><span>{pwa.offlineReady ? copy.offlineReady : copy.localJournal}</span></span><button type="button" className="icon-button support-button" aria-label="My support" onClick={() => void navigate('support')}><Heart size={19} /></button></div></header>
    <nav className="main-nav" aria-label="Main navigation">{([{ id: 'today', label: copy.today, icon: Leaf }, { id: 'history', label: copy.history, icon: CalendarDays }, { id: 'insights', label: copy.insights, icon: Sparkles }, { id: 'settings', label: copy.settings, icon: SettingsIcon }] as const).map(item => <button key={item.id} type="button" aria-current={screen === item.id ? 'page' : undefined} className={screen === item.id ? 'active' : ''} onClick={() => void navigate(item.id)}><item.icon size={18} /><span>{item.label}</span></button>)}</nav>
    <main id="main" tabIndex={-1} className={`main-content screen-${screen}`}>
      {pwa.updateAvailable && !updateLater && <div className="update-banner"><RefreshCw size={19} /><div><strong>{copy.updateTitle}</strong><span>{copy.updateDescription}</span></div><button type="button" className="button small" disabled={busy} onClick={() => void installUpdate()}>{copy.updateNow}</button><button type="button" className="icon-button" aria-label="Remind me about the update later" onClick={() => setUpdateLater(true)}><X size={17} /></button></div>}
      {error && <div className="alert error-alert" role="alert"><CircleHelp size={19} /><div><strong>{error}</strong>
        {saveState === 'error' && <div className="alert-actions"><button className="text-button" type="button" onClick={() => void flush()}>Try saving again</button><button className="text-button" type="button" onClick={exportUnsaved}>Export entered values</button></div>}
        {saveState === 'conflict' && <div className="alert-actions"><button className="text-button" type="button" onClick={exportUnsaved}>Export entered values</button><button className="text-button" type="button" onClick={async () => { if (!window.confirm('Reload this day from local storage? Any unsaved values shown here will be discarded. Export them first if you want to keep them.')) return; pendingForm.current = null; try { const day = await loadDay(dateRef.current); formRef.current = day.form; revisionRef.current = day.revision; setForm(day.form); const parsed = parseForm(day.form); setFormErrors(parsed.errors); setSaveState(parsed.errors.length ? 'invalid' : parsed.hasContent ? 'saved' : 'idle'); setError(''); } catch (cause) { setError(messageFor(cause)); } }}>Reload this day</button></div>}
        {pendingSettings.current && <div className="alert-actions"><button className="text-button" type="button" onClick={exportUnsaved}>Export entered values</button>{settingsConflict ? <button className="text-button" type="button" onClick={() => void reloadSettings()}>Reload settings</button> : <button className="text-button" type="button" onClick={() => void flushSettings()}>Try saving settings again</button>}</div>}
      </div><button className="icon-button" type="button" aria-label="Dismiss message" onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="alert notice-alert" role="status"><Check size={17} /><span>{notice}</span><button className="icon-button" type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {!ready ? <div className="loading-state"><LoaderCircle className="spin" size={26} /><p>{copy.loading}</p></div> : <fieldset className="app-interaction" disabled={busy}>
      {screen === 'today' && <>
        <section className="page-intro"><div className="eyebrow"><span className="small-leaf">✦</span> A MOMENT FOR YOURSELF</div><h1 ref={headlineRef} tabIndex={-1}>{copy.todayTitle}</h1><p>{copy.todayDescription}</p></section>
        <div className="day-toolbar"><div className="day-selector"><button type="button" className="icon-button" aria-label="Previous day" disabled={busy} onClick={() => void selectDate(addDays(date, -1))}><ChevronLeft size={20} /></button><label className="date-picker"><CalendarDays size={17} /><span>{date === todayDate ? dayLabel(date, true) : formatDate(date, { day: "numeric", month: "short", year: "numeric" })}{date === todayDate && <b>{copy.today}</b>}</span><input type="date" value={date} max={todayDate} aria-label="Check-in date" onChange={event => void selectDate(event.target.value)} /></label><button type="button" className="icon-button" aria-label="Next day" disabled={busy || date >= todayDate} onClick={() => void selectDate(addDays(date, 1))}><ChevronRight size={20} /></button></div><div className={`save-status status-${saveState}`} aria-live="polite" data-testid="save-status">{saveState === 'saving' ? <LoaderCircle size={14} className="spin" /> : saveState === 'saved' ? <Check size={15} /> : saveState === 'error' || saveState === 'conflict' ? <CircleHelp size={15} /> : <span className="status-dot" />}<span>{saveCopy[saveState]}</span></div></div>
        <section className="card sleep-card"><div className="section-title"><span className="section-icon lavender"><Moon size={21} /></span><div><h2>{copy.sleepTitle}</h2><p>{copy.sleepDescription}</p></div><span className="section-number">01</span></div><div className="sleep-grid"><SleepField kind="main" form={form} onChange={changeForm} errors={formErrors} /><SleepField kind="additional" form={form} onChange={changeForm} errors={formErrors} /></div>{formErrors.length > 0 && <div className="validation-message" role="status">{formErrors.map(value => <p key={value}>{value}</p>)}</div>}<div className="sleep-total" data-testid="total-sleep"><span>{copy.totalSleep}</span><strong>{saveState === 'saving' ? 'Saving…' : formErrors.length ? 'Check your sleep values' : sleepTotal === null ? copy.unknownSleepTotal : formatSleep(sleepTotal)}</strong></div></section>
        <section className="card feelings-card"><div className="section-title"><span className="section-icon sage"><Sun size={22} /></span><div><h2>{copy.feelingsTitle}</h2><p>{copy.feelingsDescription}</p></div><span className="section-number">02</span></div><div className="feelings-fields">{mainMetrics.map(metric => <RatingField key={metric} metric={metric} value={form[metric]} onChange={value => changeForm({ [metric]: value })} />)}</div></section>
        <section className={`card optional-card ${optionalOpen ? 'open' : ''}`}><button type="button" className="optional-toggle" aria-expanded={optionalOpen} aria-controls="optional-fields" onClick={() => setOptionalOpen(!optionalOpen)}><span className="section-icon peach"><MoreHorizontal size={22} /></span><span><strong>{copy.optionalTitle}</strong><small>{copy.optionalDescription}</small></span><ChevronDown size={20} /></button><div id="optional-fields" hidden={!optionalOpen}><div className="optional-fields"><RatingField metric="craving" value={form.craving} onChange={value => changeForm({ craving: value })} /><fieldset className="rating-field"><legend>Alcohol or other non-prescribed drug use</legend><p className="field-description">Record only what you want to keep.</p><div className="simple-choices">{(['none', 'occurred', 'prefer-not'] as const).map((value, index) => <button type="button" key={value} className={form.use === value ? 'selected' : ''} aria-pressed={form.use === value} onClick={() => changeForm({ use: form.use === value ? null : value })}>{['None', 'Occurred', 'Prefer not to record'][index]}{form.use === value && <Check size={14} />}</button>)}</div></fieldset><fieldset className="rating-field"><legend>A significant mood change?</legend><div className="simple-choices">{[false, true].map(value => <button type="button" key={String(value)} className={form.significantChange === value ? 'selected' : ''} aria-pressed={form.significantChange === value} onClick={() => changeForm({ significantChange: form.significantChange === value ? null : value })}>{value ? 'Yes' : 'No'}{form.significantChange === value && <Check size={14} />}</button>)}</div>{form.significantChange === true && <label className="text-field"><span>What changed? <small>Optional</small></span><textarea maxLength={4000} rows={2} value={form.changeNote} placeholder="A few words, if helpful…" onChange={event => changeForm({ changeNote: event.target.value })} /></label>}</fieldset><label className="text-field"><span>Something that supported me today <small>Optional</small></span><textarea maxLength={4000} rows={2} value={form.supportedBy} placeholder="A person, a small routine, a moment outside…" onChange={event => changeForm({ supportedBy: event.target.value })} /></label><label className="text-field"><span>Anything else to remember <small>Optional</small></span><textarea maxLength={4000} rows={3} value={form.note} placeholder="Leave a note for yourself…" onChange={event => changeForm({ note: event.target.value })} /></label></div></div></section>
        <div className="journal-footer"><ShieldCheck size={16} /><span>{copy.storageNote}</span></div><div className="bottom-support"><button type="button" className="text-button subtle" onClick={() => void navigate('support')}><Heart size={15} /> My support</button></div>
      </>}
      {screen === 'history' && <><section className="page-intro"><div className="eyebrow">{copy.historyEyebrow}</div><h1 ref={headlineRef} tabIndex={-1}>{copy.historyTitle}</h1><p>{copy.historyDescription}</p></section><section className="card calendar-card"><div className="calendar-heading"><h2>{monthLabel}</h2><div><button type="button" className="icon-button" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={20} /></button><button type="button" className="pill-button" onClick={() => setMonth(todayDate.slice(0, 7))}>This month</button><button type="button" className="icon-button" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={20} /></button></div></div><div className="calendar-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: monthEnd }, (_, index) => { const day = `${month}-${String(index + 1).padStart(2, '0')}`, entry = entries.find(item => item.date === day); return <button type="button" key={day} className={`calendar-day ${day === todayDate ? 'is-today' : ''} ${entry ? 'has-entry' : ''} ${entry?.mood !== null && entry?.mood !== undefined ? `mood-${entry.mood + 2}` : ''}`} disabled={day > todayDate && !entry} aria-label={`${dayLabel(day)}, ${entry ? `recorded${entry.mood !== null ? `, mood ${ratingLabel('mood', entry.mood)}` : ', mood unrecorded'}` : 'unrecorded'}`} onClick={() => void selectDate(day, true)}><span>{index + 1}</span>{entry && <i aria-hidden="true" />}</button>; })}</div><div className="calendar-key"><span><i className="recorded-dot" /> Recorded day</span><span>Empty date = unrecorded</span></div></section>{entries.length === 0 ? <EmptyState icon={<History size={30} />} title={copy.historyEmptyTitle} action={<button className="button" type="button" onClick={() => void navigate('today')}>Record today <ArrowRight size={16} /></button>}>{copy.historyEmptyDescription}</EmptyState> : <section className="entry-list"><div className="list-heading"><h2>Recorded days</h2><span>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span></div>{entries.map(entry => <article className="card history-entry" key={entry.date}><div className={`history-date mood-${entry.mood === null ? 'unknown' : entry.mood + 2}`}><span>{formatDate(entry.date, { month: 'short' })}</span><strong>{Number(entry.date.slice(-2))}</strong></div><div className="history-entry-body"><h3>{formatDate(entry.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h3><div className="entry-tags"><span>{entry.mood === null ? 'Mood unrecorded' : ratingLabel('mood', entry.mood)}</span>{totalSleep(entry) !== null && <span><Moon size={13} />{formatSleep(totalSleep(entry)!)}</span>}{entry.drive !== null && <span>Drive: {ratingLabel('drive', entry.drive)}</span>}{entry.fatigue !== null && <span>Fatigue: {ratingLabel('fatigue', entry.fatigue)}</span>}{entry.enjoyment !== null && <span>Enjoyment: {ratingLabel('enjoyment', entry.enjoyment)}</span>}</div>{entry.supportedBy && <p className="history-note"><Leaf size={14} /> {entry.supportedBy}</p>}{entry.note && <p className="history-note">{entry.note}</p>}</div><div className="entry-actions"><button className="pill-button" type="button" aria-label={`Edit ${entry.date}`} onClick={() => void selectDate(entry.date, true)}>Edit</button><button className="icon-button" type="button" aria-label={`Delete entry for ${entry.date}`} onClick={() => void removeEntry(entry.date)}><Trash2 size={16} /></button></div></article>)}</section>}</>}
      {screen === 'insights' && <><section className="page-intro"><div className="eyebrow">{copy.insightsEyebrow}</div><h1 ref={headlineRef} tabIndex={-1}>{copy.insightsTitle}</h1><p>{copy.insightsDescription}</p></section><div className="insights-toolbar"><div className="segmented-control" aria-label="Insight period">{([7, 30, 90] as const).map(value => <button type="button" key={value} aria-pressed={period === value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{value} days</button>)}</div><label className="range-end">Ending <input type="date" value={periodEnd} max={todayDate} aria-label="Last day of insight period" onChange={event => { if (event.target.value) setPeriodEnd(event.target.value); }} /></label></div><div className="period-context"><span>{compactDay(dates[0])} – {compactDay(periodEnd)}</span><span>{periodEntries.length} recorded {periodEntries.length === 1 ? 'day' : 'days'} · gaps stay visible</span></div><div className="insight-note"><Leaf size={18} /><p>{copy.insightsNote}</p></div>{[...mainMetrics, 'sleep' as const].map(metric => <TrendChart key={metric} entries={periodEntries} dates={dates} metric={metric} />)}</>}
      {screen === 'settings' && <><section className="page-intro"><div className="eyebrow">{copy.settingsEyebrow}</div><h1 ref={headlineRef} tabIndex={-1}>{copy.settingsTitle}</h1><p>{copy.settingsDescription}</p></section><section className="card settings-card"><div className="card-heading"><div><h2>Appearance</h2><p>A comfortable place to return to.</p></div><span className="small-status">{settingsSaving ? 'Saving…' : 'Saved locally'}</span></div><div className="theme-options">{([{ id: 'system', icon: SettingsIcon, label: 'Device setting' }, { id: 'light', icon: Sun, label: 'Light' }, { id: 'dark', icon: Moon, label: 'Dark' }] as { id: Theme; icon: typeof Sun; label: string }[]).map(item => <button type="button" key={item.id} aria-pressed={settings.theme === item.id} className={settings.theme === item.id ? 'selected' : ''} onClick={() => changeSettings({ theme: item.id })}><item.icon size={20} /><span>{item.label}</span>{settings.theme === item.id && <Check size={15} />}</button>)}</div></section><section className="card settings-card"><div className="section-title"><span className="section-icon sage"><ShieldCheck size={22} /></span><div><h2>Keep a copy of your journal</h2><p>A small backup makes a big difference.</p></div></div><p className="settings-description">Your journal lives in this browser or installed app. It doesn’t sync between devices. Clearing browser data, changing browsers, or removing the app can remove your journal. Keep a backup outside the app.</p><div className="privacy-note"><ShieldCheck size={17} /><span>A full JSON backup includes notes, substance details, support contacts, and unfinished drafts. Store and share it with care.</span></div><div className="button-row"><button type="button" className="button" disabled={busy} onClick={() => void backup()}><ArrowDownToLine size={17} /> Download full backup</button>{fullShareSupported && <button type="button" className="button secondary" disabled={busy} onClick={() => void backup(true)}><Share2 size={17} /> Share backup</button>}</div><p className="small-muted">{settings.lastExportAt ? `Last backup action: ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(settings.lastExportAt))}. Check that your file was saved.` : 'No backup action recorded yet.'}</p>{backupReminder && <p className="small-muted">{copy.backupReminder}</p>}<div className="settings-divider" /><h3>Restore from a backup</h3><p className="settings-description">Choose a MoodTracker JSON file. You’ll review it before anything changes.</p><input className="sr-only" tabIndex={-1} ref={fileRef} type="file" accept=".json,application/json" aria-label="Choose backup file" onChange={event => void readRestore(event.target.files?.[0])} /><button type="button" className="button secondary" disabled={busy} onClick={() => fileRef.current?.click()}><ArrowUpFromLine size={17} /> Choose backup file</button>{restore && <div className="restore-preview"><h3>Review your backup</h3><p className="restore-filename">{restoreName}</p><p>{restore.entries.length} entries and {restore.drafts.length} unfinished drafts. {restorePreview ? `${restorePreview.newEntries} new dates, ${restorePreview.conflicts} overlapping dates, ${restorePreview.unchanged} unchanged entries.` : ""}</p><fieldset><legend>How should we restore it?</legend><label className="radio-label"><input type="radio" name="restore-mode" checked={restoreMode === 'merge'} onChange={() => { setRestoreMode('merge'); setRestoreConfirmed(false); }} /><span><strong>Merge with this journal</strong><small>Add missing dates and choose what to do with overlaps. Keep your settings.</small></span></label><label className="radio-label"><input type="radio" name="restore-mode" checked={restoreMode === 'replace'} onChange={() => { setRestoreMode('replace'); setRestoreConfirmed(false); }} /><span><strong>Replace this journal</strong><small>Replace every local entry, draft, and setting with this backup.</small></span></label></fieldset>{restoreMode === 'merge' && <label className="text-field"><span>When the same date already exists</span><select value={restoreConflicts} onChange={event => setRestoreConflicts(event.target.value as 'keep' | 'incoming')}><option value="keep">Keep the entry already in this journal</option><option value="incoming">Use the entry from the backup</option></select></label>}{restoreMode === 'replace' && <div className="privacy-note"><span>Download a full backup of your current journal before replacing it.</span><button type="button" className="text-button" onClick={() => void backup()}>Download first</button></div>}<label className="checkbox-label"><input type="checkbox" checked={restoreConfirmed} onChange={event => setRestoreConfirmed(event.target.checked)} /><span>{restoreMode === 'replace' ? 'I understand this will replace all current local data.' : 'I have reviewed the backup and merge choices.'}</span></label><div className="button-row"><button type="button" className="button" disabled={busy || !restoreConfirmed} onClick={() => void restoreBackup()}>Confirm {restoreMode === 'replace' ? 'replacement' : 'merge'}</button><button type="button" className="button ghost" onClick={() => setRestore(null)}>Cancel</button></div></div>}</section><section className="card settings-card"><div className="card-heading"><div><h2>Export a selected period</h2><p>A readable copy for yourself, or to share.</p></div><ArrowDownToLine size={21} /></div><div className="export-range"><label className="text-field"><span>From</span><input type="date" value={exportStart} onChange={event => setExportStart(event.target.value)} /></label><label className="text-field"><span>To</span><input type="date" value={exportEnd} onChange={event => setExportEnd(event.target.value)} /></label></div><label className="checkbox-label"><input type="checkbox" checked={includePrivate} onChange={event => setIncludePrivate(event.target.checked)} /><span>Include notes and substance details <small>Off by default for privacy.</small></span></label><p className="small-muted">{filteredExport.length} recorded {filteredExport.length === 1 ? 'day' : 'days'} in this period. Unanswered values stay empty in CSV.</p><div className="button-row"><button type="button" className="button secondary" disabled={!exportStart || !exportEnd || exportStart > exportEnd} onClick={() => void downloadCsv()}><ArrowDownToLine size={16} /> Download CSV</button><button type="button" className="button secondary" disabled={!exportStart || !exportEnd || exportStart > exportEnd} onClick={() => void printReport()}><Printer size={16} /> Print / Save as PDF</button></div></section><section className="card settings-card"><div className="card-heading"><div><h2>App & updates</h2><p>Ready to grow with your journal.</p></div><RefreshCw size={21} /></div><div className="app-details"><span>Version</span><strong>{pwa.version}</strong><span>Offline app</span><strong>{pwa.offlineReady ? 'Ready in this browser' : 'Finishing setup'}</strong><span>Date & time</span><strong>Europe/Amsterdam · 24-hour</strong></div><p className="settings-description">Updates change the app while keeping the same local journal. When an update is ready, save your check-in and tap Update now. A backup is still the best protection against browser storage loss.</p><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => void checkUpdate()}><RefreshCw size={16} /> Check for updates</button>{pwa.updateAvailable && <button type="button" className="button" disabled={busy} onClick={() => void installUpdate()}>{copy.updateNow}</button>}</div><details className="installation-details"><summary>Install on iPhone or iPad <ChevronDown size={16} /></summary><p>{copy.installSafari}</p><p>{copy.installStorage}</p><p>{copy.installDesktop}</p></details></section><section className="card settings-card support-settings"><Heart size={23} /><div><h2>Your support, nearby.</h2><p>Save a contact or a few words that help.</p></div><button type="button" className="button secondary" onClick={() => void navigate('support')}>My support <ArrowRight size={16} /></button></section><section className="danger-zone"><h3>Delete local data</h3><p>Remove all entries, unfinished drafts, and settings from this browser.</p><button type="button" className="text-button danger" disabled={busy} onClick={() => void removeAll()}><Trash2 size={16} /> Delete all local data</button></section><p className="app-boundary">{copy.boundary}</p></>}
      {screen === 'support' && <><button type="button" className="text-button back-link" onClick={() => void navigate('today')}><ArrowLeft size={16} /> Back to your day</button><section className="page-intro"><div className="eyebrow">{copy.supportEyebrow}</div><h1 ref={headlineRef} tabIndex={-1}>{copy.supportTitle}</h1><p>{copy.supportDescription}</p></section><div className="insight-note"><Heart size={19} /><p>{copy.supportNote}</p></div><section className="card settings-card"><div className="card-heading"><div><h2>A person I can reach</h2><p>Keep their details here, if helpful.</p></div><span className="small-status">{settingsSaving ? 'Saving…' : 'Saved locally'}</span></div><label className="text-field"><span>Contact name</span><input maxLength={200} value={settings.contactName} placeholder="A trusted person" onChange={event => changeSettings({ contactName: event.target.value })} /></label><label className="text-field"><span>Contact details</span><input maxLength={1000} value={settings.contactDetails} placeholder="Phone, email, or how to reach them" onChange={event => changeSettings({ contactDetails: event.target.value })} /></label><label className="text-field"><span>Clinician or professional support <small>Optional</small></span><textarea maxLength={4000} rows={2} value={settings.clinician} placeholder="Name and contact details" onChange={event => changeSettings({ clinician: event.target.value })} /></label></section><section className="card settings-card"><div className="card-heading"><div><h2>My written plan</h2><p>What helps me, and what I want to remember.</p></div><Leaf size={22} /></div><label className="text-field"><span className="sr-only">My support plan</span><textarea maxLength={4000} rows={8} value={settings.supportPlan} placeholder="Things that help me settle…\nWho I can ask for support…\nA next step I can take…" onChange={event => changeSettings({ supportPlan: event.target.value })} /></label><p className="small-muted">Saved locally, and included in your full JSON backup.</p></section><p className="app-boundary">If you need urgent help, contact your local emergency service or a trusted professional directly. The app cannot arrange help for you.</p></>}
      </fieldset>}
    </main>
    <footer className="site-footer"><Logo /><span>{copy.footer}</span><button type="button" className="text-button subtle" onClick={() => void navigate('support')}>My support <Heart size={13} /></button></footer>
    <article className="print-report"><h1>MoodTracker — personal journal</h1><p>{dayLabel(exportStart, true)} to {dayLabel(exportEnd, true)} · {filteredExport.length} recorded days</p><p>Personal tracking scales. Not a diagnostic report. Missing values are unrecorded. {includePrivate ? 'Private notes and substance details are included.' : 'Notes and substance details are excluded.'}</p><table><thead><tr><th>Date</th><th>{copy.mainSleep}</th><th>Additional</th><th>Total</th>{mainMetrics.map(metric => <th key={metric}>{SCALES[metric].label}</th>)}</tr></thead><tbody>{filteredExport.map(entry => <tr key={entry.date}><td>{entry.date}</td><td>{entry.mainSleep === null ? '—' : formatSleep(entry.mainSleep)}</td><td>{entry.additionalSleep === null ? '—' : formatSleep(entry.additionalSleep)}</td><td>{totalSleep(entry) === null ? '—' : formatSleep(totalSleep(entry)!)}</td>{mainMetrics.map(metric => <td key={metric}>{ratingLabel(metric, entry[metric])}</td>)}</tr>)}</tbody></table>{includePrivate && filteredExport.map(entry => <section key={entry.date}><h2>{dayLabel(entry.date, true)}</h2>{entry.craving !== null && <p>Strongest craving: {ratingLabel('craving', entry.craving)}</p>}{entry.use !== null && <p>Substance use: {entry.use === 'none' ? 'None' : entry.use === 'occurred' ? 'Occurred' : 'Prefer not to record'}</p>}{entry.significantChange !== null && <p>Significant mood change: {entry.significantChange ? 'Yes' : 'No'} {entry.changeNote}</p>}{entry.supportedBy && <p>Supported by: {entry.supportedBy}</p>}{entry.note && <p>Note: {entry.note}</p>}</section>)}</article>
  </div>;
}

export interface PwaState { offlineReady: boolean; updateAvailable: boolean; version: string }
let registration: ServiceWorkerRegistration | undefined;
let state: PwaState = { offlineReady: false, updateAvailable: false, version: __APP_VERSION__ };
const listeners = new Set<(state: PwaState) => void>();
let persistenceRequested = false;
export function getPwaState(): PwaState { return { ...state }; }
function publish() {
  state = { ...state, updateAvailable: !!registration?.waiting };
  for (const listener of listeners) listener(getPwaState());
}
export async function registerPwa(callback: (state: PwaState) => void): Promise<void> {
  listeners.add(callback);
  if (!persistenceRequested && navigator.storage?.persist) {
    persistenceRequested = true;
    // Best effort only; the browser decides whether to grant this request.
    void navigator.storage.persist().catch(() => false);
  }
  if (!('serviceWorker' in navigator)) { callback(getPwaState()); return; }
  if (registration) { callback(getPwaState()); return; }
  registration = await navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
  state.offlineReady = !!registration.active;
  publish();
  registration.addEventListener('updatefound', () => {
    const worker = registration?.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'activated') state.offlineReady = true;
      if (worker.state === 'installed') state.offlineReady = true;
      publish();
    });
  });
  void navigator.serviceWorker.ready.then(() => { state.offlineReady = true; publish(); });
  // Check on foreground/online, without interrupting an active check-in.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void registration?.update().catch(() => undefined); });
  window.addEventListener('online', () => { void registration?.update().catch(() => undefined); });
}
export async function checkForUpdate(): Promise<void> {
  if (!registration) throw new Error('Offline setup is not ready yet. Try again after loading online.');
  await registration.update();
  publish();
}
export async function applyUpdate(): Promise<void> {
  const waiting = registration?.waiting;
  if (!waiting) throw new Error('No update is ready yet.');
  // UI must await its latest database save before calling this function.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('The update is taking longer than expected. Your entries remain saved; try again.')); }, 15000);
    function changed() { clearTimeout(timeout); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); window.location.reload(); }
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    waiting.postMessage({ type: 'MOODTRACKER_APPLY_UPDATE' });
  });
}

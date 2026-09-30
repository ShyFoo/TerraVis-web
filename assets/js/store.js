// Browser-only persistence: the theme (localStorage) and the in-flight job (sessionStorage, so a reload can
// reconnect). Every access is guarded; the page works without storage.

const THEME_KEY = "terravis.theme";
const ACTIVE_KEY = "terravis.activeJob.v1";

function storage(kind) {
  try {
    const st = window[kind];
    const probe = "__terravis_probe__";
    st.setItem(probe, "1");
    st.removeItem(probe);
    return st;
  } catch {
    return null;
  }
}

const local = storage("localStorage");
const session = storage("sessionStorage");

function readJson(st, key, fallback) {
  if (!st) return fallback;
  try {
    const raw = st.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(st, key, value) {
  if (!st) return false;
  try {
    st.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function saveTheme(theme) {
  if (!local) return;
  try { local.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

export function saveActiveJob(job) {
  writeJson(session, ACTIVE_KEY, job);
}

export function loadActiveJob() {
  const job = readJson(session, ACTIVE_KEY, null);
  if (!job || typeof job.jobId !== "string" || !Number.isFinite(job.ts)) return null;
  if (Date.now() - job.ts > 30 * 60 * 1000) { clearActiveJob(); return null; }
  return job;
}

export function clearActiveJob() {
  if (!session) return;
  try { session.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
}

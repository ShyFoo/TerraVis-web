// Real backend client (contract v1): /api/info, /api/health, /api/jobs (+ SSE events, polling fallback).

export class ApiError extends Error {
  constructor(code, message = "", { status = 0, retryAfter = null } = {}) {
    super(message || code);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const EVENT_TYPES = ["queued", "started", "eligibility", "detection", "severity", "done", "error"];
const POLL_MS = 750;
const SILENCE_MS = 120000;
const BUFFER_PROBE_MS = 1500;  // a live stream delivers the job's first event within milliseconds of opening
const OVERALL_MS = 15 * 60 * 1000;

function parseRetryAfter(value) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  const t = Date.parse(value);
  return Number.isFinite(t) ? Math.max(0, Math.round((t - Date.now()) / 1000)) : null;
}

export function createApi(base = "") {
  const root = String(base || "").replace(/\/+$/, "");
  const url = (path) => `${root}${path}`;
  let buffering = false; // set once a proxy is seen holding back the event stream; later jobs poll directly

  async function request(path, { timeout = 20000, signal, ...opts } = {}) {
    if (navigator.onLine === false) throw new ApiError("offline");
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    let res;
    try {
      res = await fetch(url(path), { ...opts, signal: ctrl.signal, headers: { Accept: "application/json", ...(opts.headers || {}) } });
    } catch (e) {
      if (signal && signal.aborted) throw new ApiError("aborted");
      if (timedOut) throw new ApiError("request_timeout");
      throw new ApiError(navigator.onLine === false ? "offline" : "network", e && e.message);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const err = body && body.error ? body.error : {};
      throw new ApiError(err.code || `http_${res.status}`, typeof err.message === "string" ? err.message : "", {
        status: res.status,
        retryAfter: parseRetryAfter(res.headers.get("Retry-After")),
      });
    }
    return body || {};
  }

  return {
    mock: false,
    info: () => request("/api/info", { timeout: 10000 }),
    health: () => request("/api/health", { timeout: 8000 }),

    submit(file, { token, signal } = {}) {
      const fd = new FormData();
      fd.append("image", file, file.name || "image");
      if (token) fd.append("turnstile_token", token);
      return request("/api/jobs", { method: "POST", body: fd, signal, timeout: 180000 });
    },

    snapshot: (jobId) => request(`/api/jobs/${encodeURIComponent(jobId)}`, { timeout: 15000 }),
    cancel: (jobId) => request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", timeout: 10000 }),

    /**
     * Stream a job's events. SSE first (the browser resends Last-Event-ID on its own reconnects);
     * after two EventSource errors, 120 s without an event, or a proxy that buffers the stream, poll the snapshot.
     * Events are de-duplicated by id, so full replays are harmless. Gives up after 15 minutes.
     * onEvent(type, data); onStatus("sse"|"polling").
     */
    watch(jobId, { onEvent, onStatus } = {}) {
      let closed = false;
      let es = null;
      let esErrors = 0;
      let pollTimer = 0;
      let pollFailures = 0;
      let polling = false;
      let lastNumericId = -1;
      let lastEventAt = Date.now();
      let sseEvents = 0;
      let probeTimer = 0;
      const startedAt = lastEventAt;
      const seen = new Set();

      const close = () => {
        closed = true;
        if (es) { es.close(); es = null; }
        clearTimeout(pollTimer);
        clearTimeout(probeTimer);
        clearInterval(watchdog);
      };

      const deliver = (type, data, id) => {
        if (closed) return;
        if (id != null && id !== "") {
          const key = String(id);
          if (seen.has(key)) return;
          seen.add(key);
          const n = Number(id);
          if (Number.isFinite(n)) lastNumericId = Math.max(lastNumericId, n);
        }
        lastEventAt = Date.now();
        if (type === "done" || type === "error" || type === "cancelled") close();
        onEvent && onEvent(type, data || {});
      };

      const startPolling = () => {
        if (closed || polling) return;
        polling = true;
        if (es) { es.close(); es = null; }
        onStatus && onStatus("polling");
        const tick = async () => {
          if (closed) return;
          try {
            const snap = await request(`/api/jobs/${encodeURIComponent(jobId)}`, { timeout: 15000 });
            pollFailures = 0;
            const events = Array.isArray(snap.events) ? snap.events.slice() : [];
            events.sort((a, b) => Number(a.id) - Number(b.id));
            for (const ev of events) {
              if (!ev || !ev.type) continue;
              const n = Number(ev.id);
              if (Number.isFinite(n) && n <= lastNumericId && seen.has(String(ev.id))) continue;
              deliver(ev.type, ev, ev.id);
              if (closed) return;
            }
            if (snap.status === "done" && snap.result) { deliver("done", { result: snap.result, image: snap.image }); return; }
            if (snap.status === "error") { deliver("error", snap.error || { code: "internal_error" }); return; }
            if (snap.status === "cancelled") { deliver("cancelled", {}); return; }
            if (snap.status === "queued" && Number.isFinite(snap.position)) deliver("queued", { position: snap.position }, `poll-pos-${snap.position}`);
          } catch (e) {
            if (e.code === "not_found") { deliver("error", { code: "not_found" }); return; }
            pollFailures += 1;
            if (pollFailures >= 8) { deliver("error", { code: e.code === "request_timeout" ? "network" : e.code || "network" }); return; }
          }
          pollTimer = setTimeout(tick, pollFailures ? Math.min(POLL_MS * 2 ** pollFailures, 10000) : POLL_MS);
        };
        tick();
      };

      // EventSource hides the server's keep-alive comments, so silence alone cannot tell a slow stage from a
      // stalled stream: switch to polling rather than failing.
      const watchdog = setInterval(() => {
        if (closed) return;
        if (Date.now() - startedAt > OVERALL_MS) deliver("error", { code: "client_timeout" });
        else if (!polling && Date.now() - lastEventAt > SILENCE_MS) startPolling();
      }, 5000);

      if (typeof EventSource === "undefined" || buffering) {
        startPolling();
      } else {
        try {
          es = new EventSource(url(`/api/jobs/${encodeURIComponent(jobId)}/events`));
          onStatus && onStatus("sse");
          for (const type of EVENT_TYPES) {
            es.addEventListener(type, (e) => {
              // "error" is both the server's error event (a MessageEvent with data) and the connection error.
              if (type === "error" && !(e && typeof e.data === "string")) return;
              let data = {};
              try { data = e.data ? JSON.parse(e.data) : {}; } catch { data = {}; }
              esErrors = 0;
              sseEvents += 1;
              deliver(type, data, e.lastEventId || null);
            });
          }
          // Every job has an event from the start, so an open stream that stays silent is being held back by a
          // proxy (a Cloudflare quick tunnel does this until the stream ends).
          es.onopen = () => {
            clearTimeout(probeTimer);
            probeTimer = setTimeout(async () => {
              if (closed || polling || sseEvents) return;
              try {
                const snap = await request(`/api/jobs/${encodeURIComponent(jobId)}`, { timeout: 10000 });
                if (!closed && !polling && !sseEvents && Array.isArray(snap.events) && snap.events.length) {
                  buffering = true;
                  startPolling();
                }
              } catch { /* the watchdog and error handlers still apply */ }
            }, BUFFER_PROBE_MS);
          };
          es.onerror = (e) => {
            if (closed || (e && typeof e.data === "string")) return;
            esErrors += 1;
            if (esErrors >= 2 || (es && es.readyState === EventSource.CLOSED)) startPolling();
          };
        } catch {
          startPolling();
        }
      }
      return { close };
    },
  };
}

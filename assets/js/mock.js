// Built-in simulator: replays a stored Result as a realistic event stream, and a mock API with
// the same interface as api.js (used for ?mock, apiBase "mock", and precomputed example replays).
import { ApiError } from "./api.js";
import { TAXONOMY, LAMBDA, ALPHA } from "./taxonomy.js";

const MODEL = "google/gemma-4-31B-it";

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Random, strictly increasing offsets in (0, span] for n events. */
function spread(n, span) {
  const w = Array.from({ length: n }, () => 0.35 + Math.random());
  const total = w.reduce((x, y) => x + y, 0);
  let acc = 0;
  return w.map((x) => (acc += (x / total) * span));
}

/**
 * Schedule the event stream for `result`.
 * Timeline at speed 1: queued #2 → #1 → started → eligibility (~1.2 s) → 18 detections in random
 * order (~3 s) → severities (~1 s) → done.
 */
export function simulate(result, { speed = 1, queue = true, onEvent, failAfter = null } = {}) {
  const k = 1 / Math.max(0.05, speed);
  const timers = [];
  let stopped = false;
  let started = false;
  const at = (ms, fn) => timers.push(setTimeout(() => { if (!stopped) fn(); }, ms * k));
  const emit = (type, data) => { if (!stopped) onEvent(type, data); };
  const stop = () => { stopped = true; timers.forEach(clearTimeout); };

  let t = 0;
  if (queue) {
    at(0, () => emit("queued", { position: 2 }));
    at(700, () => emit("queued", { position: 1 }));
    t = 1400;
  }
  at(t, () => { started = true; emit("started", {}); });

  const elig = result && result.eligibility ? result.eligibility : { eligible: null, reason: "" };
  t += 1200;
  at(t, () => emit("eligibility", { eligible: elig.eligible === undefined ? null : elig.eligible, reason: elig.reason || "" }));

  const checks = Array.isArray(result && result.checks) ? result.checks : [];
  if (elig.eligible === true && checks.length) {
    const order = shuffle(checks);
    const offs = spread(order.length, 3000);
    order.forEach((c, i) => {
      at(t + offs[i], () => {
        if (failAfter != null && i >= failAfter) {
          emit("error", { code: "judge_error", message: "Simulated judge failure (mockerror)." });
          stop();
          return;
        }
        emit("detection", {
          index: c.index,
          violation_type: c.violation_type,
          detected: c.detected,
          affected_aspect: c.affected_aspect || "",
          evidence: c.evidence || "",
        });
      });
    });
    t += 3000 + 120;
    const detected = shuffle(checks.filter((c) => c.detected === true));
    if (detected.length) {
      const soffs = spread(detected.length, 1000);
      detected.forEach((c, i) => {
        at(t + soffs[i], () => emit("severity", {
          index: c.index,
          violation_type: c.violation_type,
          severity: c.severity,
          severity_reason: c.severity_reason || "",
        }));
      });
      t += 1000;
    }
  }
  at(t + 200, () => { emit("done", { result }); stop(); });

  return { cancel: stop, get started() { return started; }, get stopped() { return stopped; } };
}

const SUBMIT_FAILS = {
  invalid_image: [400, "The file could not be decoded as an image.", null],
  captcha_failed: [400, "Captcha verification failed.", null],
  file_too_large: [413, "File exceeds the upload limit.", null],
  image_too_large: [413, "Image exceeds 50 megapixels.", null],
  unsupported_type: [415, "Unsupported media type.", null],
  rate_limited: [429, "Too many requests.", 24],
  too_many_active: [429, "Too many active jobs.", 15],
  busy: [503, "Queue is full.", 30],
  judge_offline: [503, "Judge is offline.", 45],
  offline: [0, "", null],
  network: [0, "", null],
};

export function createMockApi({ examples, speed = 1, failCode = "" } = {}) {
  const jobs = new Map();
  const pool = () => (examples() || []).filter((e) => e && e.result);
  return {
    mock: true,
    async info() {
      return {
        model: MODEL, max_upload_mb: 15, max_side: 2048, max_megapixels: 50,
        accepted_types: ["image/jpeg", "image/png", "image/webp"],
        lambda: LAMBDA, alpha: ALPHA, taxonomy: TAXONOMY, turnstile_site_key: "",
      };
    },
    async health() {
      return { status: "ok", judge_online: true, model: MODEL, queue: { waiting: 1, running: 1, workers: 4 }, served: 0, simulated: true };
    },
    async submit(file, { exampleId = null } = {}) {
      await new Promise((r) => setTimeout(r, 260 / Math.max(0.05, speed)));
      if (failCode && SUBMIT_FAILS[failCode]) {
        const [status, msg, ra] = SUBMIT_FAILS[failCode];
        throw new ApiError(failCode, msg, { status, retryAfter: ra });
      }
      const list = pool();
      if (!list.length) throw new ApiError("internal_error", "No simulator data (examples.json missing).", { status: 500 });
      const own = exampleId ? list.find((e) => e.id === exampleId) : null;
      const ex = own || list[Math.floor(Math.random() * list.length)];
      const id = `mock-${Math.random().toString(36).slice(2, 10)}`;
      jobs.set(id, { ex, borrowed: !own, sim: null, cancelled: false });
      return { job_id: id, status: "queued", position: 2, cached: false, simulated: true, borrowed_from: own ? null : ex.id };
    },
    watch(jobId, { onEvent, onStatus } = {}) {
      const job = jobs.get(jobId);
      if (!job) {
        setTimeout(() => onEvent("error", { code: "not_found" }), 0);
        return { close() {} };
      }
      onStatus && onStatus("sim");
      const judgeFail = failCode === "judge_error" || failCode === "timeout" || failCode === "judge_unavailable";
      job.sim = simulate(job.ex.result, {
        speed,
        queue: true,
        failAfter: judgeFail ? 7 : null,
        onEvent: (type, data) => {
          if (type === "error" && failCode !== "judge_error") data = { code: failCode, message: `Simulated ${failCode}.` };
          onEvent(type, data);
        },
      });
      return { close: () => job.sim && job.sim.cancel() };
    },
    async cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new ApiError("not_found", "", { status: 404 });
      if (job.sim && job.sim.started) throw new ApiError("not_cancellable", "Job is already running.", { status: 409 });
      if (job.sim) job.sim.cancel();
      job.cancelled = true;
      return { status: "cancelled" };
    },
    async snapshot(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new ApiError("not_found", "", { status: 404 });
      return { job_id: jobId, status: "done", position: 0, events: [], result: job.ex.result, error: null, image: null, cached: false, elapsed_s: 0 };
    },
  };
}

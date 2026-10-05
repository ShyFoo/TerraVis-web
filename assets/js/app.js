// TerraVis Online Evaluation — controller. Wires upload, API / simulator runs, examples and UI.
import { LAMBDA, ALPHA } from "./taxonomy.js";
import { createApi, ApiError } from "./api.js";
import { createMockApi, simulate } from "./mock.js";
import { Viewer } from "./viewer.js";
import { Readout } from "./render.js";
import * as store from "./store.js";
import { createHero, buildFlowCells, buildLadder, buildTaxonomy, buildNaList, buildLinks } from "./sections.js";
import {
  h, $, $$, clear, clamp, fmtBytes, fmtScore, outcomeText,
  thumbnailFrom, reducedMotion, safeText, fmtNum, exampleThumb,
} from "./util.js";

// ---------- configuration ----------
const CFG = Object.assign(
  { apiBase: "", paperUrl: "", codeUrl: "", issuesUrl: "", projectUrl: "", turnstileSiteKey: "" },
  window.TERRAVIS_CONFIG || {},
);
const params = new URLSearchParams(window.location.search);
const MOCK = params.has("mock") || String(CFG.apiBase || "").trim().toLowerCase() === "mock";
// apiBase "closed" (tools/publish_site.py --closed): online evaluation is switched off; the page sends no API requests.
const CLOSED = !MOCK && String(CFG.apiBase || "").trim().toLowerCase() === "closed";
const SPEED = clamp(parseFloat(params.get("speed")) || 1, 0.1, 50);
const AUTORUN = params.get("autorun");
const MOCK_ERROR = MOCK ? (params.get("mockerror") || "").trim() : "";
const TYPE_BY_EXT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

let info = {
  model: "google/gemma-4-31B-it", max_upload_mb: 15, max_side: 2048, max_megapixels: 50,
  accepted_types: ["image/jpeg", "image/png", "image/webp"], lambda: LAMBDA, alpha: ALPHA, turnstile_site_key: "",
};
let examples = [];
const exampleName = (ex) => `Example ${examples.indexOf(ex) + 1}`;

const api = MOCK
  ? createMockApi({ examples: () => examples, speed: SPEED, failCode: MOCK_ERROR })
  : createApi(CFG.apiBase);

// ---------- elements ----------
const el = {
  console: $("#console"),
  viewerBox: $("#viewer"),
  dropzone: $("#dropzone"),
  stage: $("#viewerStage"),
  img: $("#viewerImg"),
  hud: $("#viewerHud"),
  tools: $("#viewerTools"),
  meta: $("#specimenMeta"),
  badges: $("#specimenBadges"),
  caption: $("#specimenCaption"),
  uploadError: $("#uploadError"),
  captcha: $("#captcha"),
  runBtn: $("#runBtn"),
  replaceBtn: $("#replaceBtn"),
  cancelBtn: $("#cancelBtn"),
  anotherBtn: $("#anotherBtn"),
  note: $("#specimenNote"),
  fileInput: $("#fileInput"),
  overlay: $("#dropOverlay"),
  toast: $("#toast"),
  sr: $("#srLive"),
  pill: $("#statusPill"),
  serviceNote: $("#serviceNote"),
  themeToggle: $("#themeToggle"),
  exampleList: $("#exampleList"),
};

// ---------- announcements + toast ----------
let srTimer = 0;
function announce(text) {
  clearTimeout(srTimer);
  el.sr.textContent = "";
  srTimer = setTimeout(() => { el.sr.textContent = text; }, 80);
}
let toastTimer = 0;
function toast(text) {
  clearTimeout(toastTimer);
  el.toast.textContent = text;
  el.toast.hidden = false;
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
}

const viewer = new Viewer({
  stage: el.stage, img: el.img, tools: el.tools,
  zoomIn: $("#zoomIn"), zoomOut: $("#zoomOut"), zoomReset: $("#zoomReset"), zoomLabel: $("#zoomLabel"),
});

const readout = new Readout({
  console: el.console,
  stateBadge: $("#stateBadge"),
  stages: Object.fromEntries($$("#stageTrack .stage").map((li) => [li.dataset.stage, li])),
  dial: $("#dial"),
  countMajor: $("#countMajor"), countMinor: $("#countMinor"), countClear: $("#countClear"), countUnclear: $("#countUnclear"),
  summary: $("#summaryLine"),
  scale: $("#scale"),
  formula: $("#formula"),
  log: $("#log"),
  logClock: $("#logClock"),
  probes: $("#probes"),
  probesPanel: $("#probesPanel"),
  probesToggle: $("#probesToggle"),
  findings: $("#findings"),
  findingsBody: $("#findingsBody"),
  eligLine: $("#eligLine"),
  hud: el.hud,
}, { announce });

const hero = createHero({
  dial: $("#heroDial"), card: $("#heroCard"), label: $("#heroLabel"), prev: $("#heroPrev"), next: $("#heroNext"),
  evaluator: el.console, name: (ex) => exampleName(ex), announce, onReplay: (ex) => openExample(ex),
});

// ---------- state ----------
const S = {
  item: null, // {kind: upload|example|resume, file, url, name, size, width, height, exampleId, preview}
  run: null,  // {seq, jobId, watcher, sim, abort, started, done, failed, replay, cached, borrowedFrom, result, image, position}
  seq: 0,
};
const captcha = { widget: null, token: null, loading: null };

const isBusy = () => !!(S.run && !S.run.done && !S.run.failed && !S.run.replay);

function syncButtons() {
  const phase = readout.phase;
  const hasItem = !!S.item;
  const canRun = hasItem && !!S.item.file && (phase === "ready" || phase === "cancelled");
  el.dropzone.hidden = hasItem;
  el.runBtn.hidden = !canRun;
  el.replaceBtn.hidden = !canRun;
  el.cancelBtn.hidden = !(S.run && !S.run.replay && (phase === "uploading" || phase === "queued"));
  // A job resumed after a reload has no file to run again once cancelled.
  const finished = ["done", "na", "undetermined", "error"].includes(phase) || (phase === "running" && !isBusy()) || (phase === "cancelled" && !canRun);
  el.anotherBtn.hidden = !(hasItem && finished);
  hero.hold(!!S.run);
}

function setBadges() {
  clear(el.badges);
  const it = S.item;
  if (!it) return;
  const add = (cls, text) => el.badges.append(h("span", { class: `badge ${cls}`, text }));
  if (it.kind === "example") add("badge--pre", "Precomputed");
  if (MOCK && it.kind === "upload") add("badge--sim", "Simulated");
  if (S.run && S.run.cached) add("badge--cache", "Cached");
}

function setMeta() {
  const it = S.item;
  if (!it) { el.meta.textContent = ""; el.caption.hidden = true; return; }
  const dims = it.width && it.height ? `${it.width}×${it.height}` : "";
  if (it.kind === "example") {
    el.meta.textContent = [it.name, dims].filter(Boolean).join(" · ");
  } else {
    el.meta.textContent = [safeText(it.name, 80), dims, it.size ? fmtBytes(it.size) : ""].filter(Boolean).join(" · ");
  }
  setCaption();
}

function setCaption(extra) {
  const cap = clear(el.caption);
  cap.classList.remove("is-warn");
  if (extra) {
    cap.classList.add("is-warn");
    cap.append(extra);
    cap.hidden = false;
    return;
  }
  cap.hidden = true;
}

function showUploadError(text) {
  el.uploadError.textContent = text;
  el.uploadError.hidden = false;
}
function hideUploadError() {
  el.uploadError.hidden = true;
  el.uploadError.textContent = "";
}

function scrollToConsole() {
  const target = $("#evaluate");
  const r = target.getBoundingClientRect();
  if (r.top < 0 || r.top > window.innerHeight * 0.5) target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}

// ---------- item lifecycle ----------
function releaseItem() {
  if (S.item && S.item.url && S.item.url.startsWith("blob:")) {
    const url = S.item.url;
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function stopRun() {
  S.seq += 1;
  if (S.run) {
    if (S.run.watcher) S.run.watcher.close();
    if (S.run.sim) S.run.sim.cancel();
    if (S.run.abort && !S.run.jobId) S.run.abort.abort();
  }
  S.run = null;
}

function resetAll(focus = false) {
  stopRun();
  releaseItem();
  S.item = null;
  viewer.clear();
  hideUploadError();
  setMeta();
  setBadges();
  markActiveExample(null);
  readout.reset("idle");
  el.captcha.hidden = true;
  syncButtons();
  if (focus) el.dropzone.focus();
}

function guessType(file) {
  if (file.type) return file.type;
  const m = /\.([a-z0-9]+)$/i.exec(file.name || "");
  return m ? TYPE_BY_EXT[m[1].toLowerCase()] || "" : "";
}

function validateFile(file) {
  const type = guessType(file);
  const maxMb = Number(info.max_upload_mb) || 15;
  const accepted = Array.isArray(info.accepted_types) && info.accepted_types.length ? info.accepted_types : ["image/jpeg", "image/png", "image/webp"];
  if (!accepted.includes(type)) {
    const what = type.startsWith("image/") ? `a ${type.slice(6).toUpperCase()} image` : "not a supported image";
    return `“${safeText(file.name || "This file", 80)}” is ${what}. Please use JPEG, PNG or WebP.`;
  }
  if (file.size === 0) return "This file is empty.";
  if (file.size > maxMb * 1024 * 1024) return `This file is ${fmtBytes(file.size)}; the upload limit is ${maxMb} MB.`;
  return null;
}

async function loadFile(file, { exampleId = null, autorun = false, focusRun = true } = {}) {
  if (!file) return;
  if (isBusy()) { toast("Please wait for the current evaluation to finish."); return; }
  hideUploadError();
  const problem = validateFile(file);
  if (problem) { showUploadError(problem); announce(problem); return; }
  stopRun();
  releaseItem();
  const url = URL.createObjectURL(file);
  S.item = { kind: "upload", file, url, name: file.name || "image", size: file.size, exampleId };
  markActiveExample(null);
  syncButtons();
  try {
    await viewer.show(url, `Uploaded image “${safeText(S.item.name, 80)}”`);
  } catch {
    resetAll();
    showUploadError("This file could not be decoded as an image. Try re-exporting it as JPEG or PNG.");
    return;
  }
  if (!S.item || S.item.url !== url) return;
  S.item.width = el.img.naturalWidth;
  S.item.height = el.img.naturalHeight;
  const mp = (S.item.width * S.item.height) / 1e6;
  if (mp > (Number(info.max_megapixels) || 50)) {
    resetAll();
    showUploadError(`This image is ${mp.toFixed(1)} megapixels; the limit is ${info.max_megapixels || 50} MP. Please downscale it.`);
    return;
  }
  S.item.preview = thumbnailFrom(el.img, 720, 0.8);
  setMeta();
  setBadges();
  const longSide = Math.max(S.item.width, S.item.height);
  readout.reset("ready");
  if (longSide > (Number(info.max_side) || 2048)) readout.log(`long side ${longSide}px · will be downscaled to ${info.max_side || 2048}px on the server`, "warn");
  if (MOCK) setCaption(h("span", {}, h("b", { text: "Simulator" }), exampleId
    ? "This run replays the stored judge output for this example image."
    : "No backend is connected: the readout will replay a random example’s stored result, not an analysis of your image."));
  ensureCaptcha();
  syncButtons();
  if (autorun) startEvaluation();
  else if (focusRun) el.runBtn.focus({ preventScroll: true });
}

// ---------- captcha (only when a site key is configured) ----------
function captchaKey() {
  return MOCK || CLOSED ? "" : String(CFG.turnstileSiteKey || info.turnstile_site_key || "");
}
function ensureCaptcha() {
  const key = captchaKey();
  if (!key) { el.captcha.hidden = true; return; }
  el.captcha.hidden = false;
  if (captcha.loading) return;
  captcha.loading = new Promise((resolve) => {
    const sc = document.createElement("script");
    sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    sc.async = true;
    sc.addEventListener("load", () => {
      try {
        captcha.widget = window.turnstile.render(el.captcha, {
          sitekey: key,
          theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
          callback: (t) => { captcha.token = t; },
          "expired-callback": () => { captcha.token = null; },
          "error-callback": () => { captcha.token = null; },
        });
      } catch { /* widget failed; server will answer captcha_failed */ }
      resolve();
    });
    sc.addEventListener("error", () => resolve());
    document.head.append(sc);
  });
}
function resetCaptcha() {
  captcha.token = null;
  try { if (window.turnstile && captcha.widget != null) window.turnstile.reset(captcha.widget); } catch { /* ignore */ }
}

// ---------- running an evaluation ----------
async function startEvaluation() {
  const item = S.item;
  if (!item || !item.file || isBusy()) return;
  hideUploadError();
  if (CLOSED) { failRun(new ApiError("closed")); return; }
  if (!MOCK && navigator.onLine === false) { failRun(new ApiError("offline")); return; }
  const key = captchaKey();
  if (key && !captcha.token) {
    showUploadError("Please complete the verification check below the image first.");
    return;
  }
  stopRun();
  const seq = S.seq;
  const abort = new AbortController();
  S.run = { seq, abort, jobId: null, watcher: null, started: false, done: false, failed: false, position: null };
  if (item.kind !== "upload") item.kind = "upload";
  readout.begin({ note: MOCK ? "simulator · no data leaves this browser" : `uploading ${safeText(item.name, 60)} · ${fmtBytes(item.size)}` });
  setBadges();
  syncButtons();

  let res;
  try {
    res = await api.submit(item.file, { token: captcha.token, signal: abort.signal, exampleId: item.exampleId });
  } catch (e) {
    if (seq !== S.seq) return;
    if (e.code === "aborted") { onCancelled("Upload cancelled."); return; }
    failRun(e);
    return;
  } finally {
    if (key) resetCaptcha();
  }
  if (seq !== S.seq || !S.run) return;
  S.run.jobId = res.job_id;
  S.run.cached = !!res.cached;
  S.run.borrowedFrom = res.borrowed_from || null;
  readout.log(`job ${String(res.job_id || "").slice(0, 12)} accepted${res.cached ? " · cached result" : ""}`, "accent");
  if (res.borrowed_from) {
    const from = examples.find((e) => e.id === res.borrowed_from);
    readout.log(`simulator · replaying the stored result of ${from ? exampleName(from) : "a stored example"}`, "na");
  }
  setBadges();
  if (!MOCK) store.saveActiveJob({ jobId: res.job_id, ts: Date.now(), name: item.name, preview: item.preview || "", size: item.size || 0, width: item.width, height: item.height });
  if (res.status === "queued" && Number.isFinite(res.position) && res.position > 0) {
    S.run.position = res.position;
    readout.onQueued(res.position);
  }
  syncButtons();
  watchJob(seq, res.job_id);
}

function watchJob(seq, jobId) {
  if (!S.run || seq !== S.seq) return;
  S.run.watcher = api.watch(jobId, {
    onEvent: (type, data) => handleEvent(seq, type, data),
    onStatus: (mode) => {
      if (seq !== S.seq) return;
      if (mode === "polling") readout.log("live stream unavailable · polling for updates", "warn");
    },
  });
}

function handleEvent(seq, type, data) {
  const run = S.run;
  if (seq !== S.seq || !run || run.done || run.failed) return;
  data = data && typeof data === "object" ? data : {};
  switch (type) {
    case "queued": {
      const pos = Number(data.position);
      if (run.started || !Number.isFinite(pos) || pos < 1 || pos === run.position) break;
      run.position = pos;
      readout.onQueued(pos);
      break;
    }
    case "started":
      if (!run.started) { run.started = true; readout.onStarted(); }
      break;
    case "eligibility":
      if (!run.started) { run.started = true; readout.onStarted(); }
      readout.onEligibility({ eligible: data.eligible === undefined ? null : data.eligible, reason: typeof data.reason === "string" ? data.reason : "" });
      break;
    case "detection":
      if (!run.started) { run.started = true; readout.onStarted(); }
      readout.onDetection({ ...data, index: Number(data.index) });
      break;
    case "severity":
      readout.onSeverity({ ...data, index: Number(data.index) });
      break;
    case "done":
      finishRun(seq, data.result, data.image);
      break;
    case "error":
      if (data.code === "cancelled") { onCancelled("The job was cancelled."); break; }
      failRun(new ApiError(typeof data.code === "string" ? data.code : "internal_error", typeof data.message === "string" ? data.message : ""));
      break;
    case "cancelled":
      onCancelled("The job was cancelled.");
      break;
    default:
      break;
  }
  syncButtons();
}

function validResult(r) {
  return r && typeof r === "object" && typeof r.status === "string" && Array.isArray(r.checks);
}

function finishRun(seq, result, image) {
  const run = S.run;
  if (!run || seq !== S.seq) return;
  if (!validResult(result)) { failRun(new ApiError("internal_error", "The server's final result was missing or malformed.")); return; }
  if (run.watcher) run.watcher.close();
  run.done = true;
  run.result = result;
  run.image = image || null;
  const it = S.item;
  const label = run.replay ? "" : run.cached ? "result served from cache (identical image scored before)" : "";
  readout.renderResult(result, { animate: true, label });
  store.clearActiveJob();
  setBadges();
  syncButtons();
  if (it && (it.kind === "upload" || it.kind === "resume")) {
    if (!MOCK && run.jobId && !image) {
      api.snapshot(run.jobId).then((snap) => {
        if (S.run !== run || !snap) return;
        if (snap.image) { run.image = snap.image; noteImage(snap.image); }
        if (Number.isFinite(snap.elapsed_s)) { run.elapsed = snap.elapsed_s; readout.log(`server time ${snap.elapsed_s.toFixed(1)} s`); }
      }).catch(() => {});
    } else if (image) noteImage(image);
  }
}

function noteImage(img) {
  if (img && img.resized) readout.log(`server downscaled ${img.original_width}×${img.original_height} → ${img.width}×${img.height}`, "warn");
}

// ---------- errors ----------
function friendly(e) {
  const code = (e && e.code) || "internal_error";
  const maxMb = info.max_upload_mb || 15;
  const retryAfter = Number.isFinite(e && e.retryAfter) ? e.retryAfter : null;
  const M = {
    invalid_image: ["Unreadable image", "The server couldn’t decode this file as an image. Try re-exporting it as JPEG or PNG.", false],
    invalid_request: ["Upload not understood", "The server couldn’t read this upload. Please try again.", true],
    captcha_failed: ["Verification failed", "The anti-abuse check didn’t pass. Complete it again, then retry.", true],
    file_too_large: ["File too large", `Files up to ${maxMb} MB are accepted. Compress or downscale the image and try again.`, false],
    image_too_large: ["Image too large", `Images up to ${info.max_megapixels || 50} megapixels are accepted. Downscale it and try again.`, false],
    unsupported_type: ["Unsupported format", "Please upload a JPEG, PNG or WebP image.", false],
    rate_limited: ["Slow down a little", "You’ve submitted several images in a short time.", true],
    too_many_active: ["One at a time", "You already have evaluations in progress. Let them finish first.", true],
    busy: ["The judge is at capacity", "The queue is full right now. Please try again shortly.", true],
    closed: ["Online evaluation is closed", "Evaluating your own images isn’t available right now. The precomputed examples below show what a result looks like.", false],
    judge_offline: ["Judge offline", "The evaluation model is temporarily offline. Please try again later.", true],
    judge_unavailable: ["Judge unavailable", "The judge became unavailable during this evaluation.", true],
    judge_error: ["The judge ran into an error", "The model returned an error while evaluating this image.", true],
    timeout: ["Evaluation timed out", "The evaluation took too long and was stopped on the server.", true],
    request_timeout: ["Upload timed out", "The upload didn’t finish in time. Check your connection or try a smaller file.", true],
    upload_timeout: ["Upload timed out", "The upload was too slow to finish. Check your connection or try a smaller file.", true],
    forbidden_origin: ["Upload blocked", "Images can only be submitted from the TerraVis site itself.", false],
    client_timeout: ["No result after 15 minutes", "The evaluation did not finish in time. Check your connection and try again.", true],
    internal_error: ["Something went wrong", "An unexpected server error occurred.", true],
    not_found: ["Result expired", "Results are kept for about 3 minutes. Please evaluate the image again.", true],
    offline: ["You’re offline", "Check your internet connection, then try again.", true],
    network: ["Can’t reach the evaluation service", "The server is unreachable right now. It may be restarting — try again in a minute.", true],
    not_cancellable: ["Already running", "The judge has already started on this image.", true],
  };
  const noApi = e && [404, 405, 501, 502, 504].includes(e.status) && /^http_/.test(code);
  const [title, message, retry] = M[code] || (noApi
    ? ["Evaluation service unavailable", "The API did not answer at this address — it may be down or not deployed yet.", true]
    : e && e.status >= 500
    ? ["Server error", "The evaluation service returned an error.", true]
    : ["Request failed", "The request could not be completed.", true]);
  const serverMsg = e && e.message && e.message !== code ? safeText(e.message, 240) : "";
  return { code, title, message, retry, retryAfter, detail: `code: ${code}${e && e.status ? ` · HTTP ${e.status}` : ""}${serverMsg ? ` · ${serverMsg}` : ""}` };
}

function failRun(e) {
  const run = S.run;
  if (run) {
    run.failed = true;
    if (run.watcher) run.watcher.close();
    if (run.sim) run.sim.cancel();
  }
  store.clearActiveJob();
  const f = friendly(e);
  const canRetry = f.retry && S.item && S.item.file;
  readout.showError({
    title: f.title,
    message: f.message,
    detail: f.detail,
    retryAfter: f.retryAfter,
    onRetry: canRetry ? () => { readout.reset("ready"); syncButtons(); startEvaluation(); } : null,
    retryLabel: "Try again",
    onReset: () => { resetAll(true); scrollToConsole(); },
  });
  syncButtons();
}

async function cancelRun() {
  const run = S.run;
  if (!run || run.done || run.failed) return;
  if (!run.jobId) { run.abort.abort(); return; }
  if (run.started) { toast("The judge already started — it will finish in a few seconds."); return; }
  el.cancelBtn.disabled = true;
  try {
    await api.cancel(run.jobId);
    if (S.run === run) onCancelled("Cancelled — removed from the queue.");
  } catch (e) {
    if (S.run !== run) return;
    if (e.code === "not_found") onCancelled("Cancelled.");
    else if (e.code === "not_cancellable") {
      readout.log("cancel refused · the job is already running", "warn");
      toast("The judge already started — it will finish in a few seconds.");
    } else {
      readout.log(`cancel failed · ${e.code}`, "warn");
      toast("Couldn’t cancel — please try again.");
    }
  } finally {
    el.cancelBtn.disabled = false;
  }
}

function onCancelled(message) {
  stopRun();
  store.clearActiveJob();
  const file = !!(S.item && S.item.file);
  readout.reset(file ? "ready" : "idle", {
    summary: `${message} ${file ? "Evaluate again whenever you’re ready." : "The file itself isn’t kept after a reload — choose it again to evaluate it."}`,
  });
  readout.setPhase("cancelled");
  readout.log("cancelled", "warn");
  if (!file) setCaption();
  syncButtons();
  announce(message);
}

// ---------- examples ----------
function markActiveExample(id) {
  for (const b of $$(".tile", el.exampleList)) b.classList.toggle("is-active", !!id && b.dataset.id === id);
}

async function openExample(ex) {
  if (isBusy()) { toast("Please wait for the current evaluation to finish."); return; }
  stopRun();
  releaseItem();
  hideUploadError();
  el.captcha.hidden = true;
  S.item = { kind: "example", url: ex.image, name: exampleName(ex), exampleId: ex.id };
  const seq = S.seq;
  markActiveExample(ex.id);
  setMeta();
  setBadges();
  syncButtons();
  scrollToConsole();
  viewer.show(ex.image, `${exampleName(ex)} image`)
    .then((img) => {
      if (S.item && S.item.exampleId === ex.id) { S.item.width = img.naturalWidth; S.item.height = img.naturalHeight; setMeta(); }
    })
    .catch(() => {});
  const label = `precomputed · ${exampleName(ex).toLowerCase()}`;
  if (reducedMotion()) {
    S.run = { seq, replay: true, started: true, done: true, result: ex.result };
    readout.reset("running");
    readout.renderResult(ex.result, { animate: false, label });
    syncButtons();
    return;
  }
  readout.replayBegin(label);
  S.run = { seq, replay: true, started: false, done: false, failed: false, position: null };
  S.run.sim = simulate(ex.result, { speed: 3.2 * SPEED, queue: false, onEvent: (type, data) => handleEvent(seq, type, data) });
  syncButtons();
}

function renderExamples() {
  clear(el.exampleList);
  for (const ex of examples) {
    const r = ex.result || {};
    const scored = r.status === "scored";
    const scoreTxt = scored ? `S ${fmtScore(r.score)}` : r.status === "not_applicable" ? "N/A" : "?";
    const btn = h("button", { type: "button", class: "tile", dataset: { id: ex.id } },
      h("span", { class: "tile__img" },
        exampleThumb(ex, { alt: `${exampleName(ex)} image`, width: "320", height: "320", loading: "lazy" }),
        h("span", { class: `tile__score${scored ? "" : " is-na"}`, text: scoreTxt })),
      h("span", { class: "tile__body" },
        h("span", { class: "tile__title", text: exampleName(ex) }),
        h("span", { class: "tile__counts", text: outcomeText(r) })));
    btn.addEventListener("click", () => openExample(ex));
    el.exampleList.append(h("li", {}, btn));
  }
}

// ---------- inputs: browse, drop, paste ----------
el.dropzone.addEventListener("click", () => el.fileInput.click());
el.replaceBtn.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("change", () => {
  const f = el.fileInput.files && el.fileInput.files[0];
  el.fileInput.value = "";
  if (f) loadFile(f);
});
el.runBtn.addEventListener("click", () => startEvaluation());
el.cancelBtn.addEventListener("click", () => cancelRun());
el.anotherBtn.addEventListener("click", () => resetAll(true));

let dragDepth = 0;
const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"));
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth += 1;
  el.overlay.hidden = false;
});
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth || e.relatedTarget === null) { dragDepth = 0; el.overlay.hidden = true; }
});
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  el.overlay.hidden = true;
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) { scrollToConsole(); loadFile(f); }
});

document.addEventListener("paste", (e) => {
  const t = e.target;
  if (t && t.closest && t.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
  const items = e.clipboardData ? Array.from(e.clipboardData.items || []) : [];
  const fileItem = items.find((i) => i.kind === "file");
  if (!fileItem) return;
  const f = fileItem.getAsFile();
  if (!f) return;
  e.preventDefault();
  const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const name = f.name && f.name !== "image.png" ? f.name : `pasted-image.${ext}`;
  let file = f;
  try { file = new File([f], name, { type: f.type }); } catch { /* old browsers: keep the blob */ }
  scrollToConsole();
  loadFile(file);
});

$("#heroCta").addEventListener("click", () => {
  if (!S.item) setTimeout(() => el.dropzone.focus({ preventScroll: true }), reducedMotion() ? 0 : 450);
});

// ---------- theme ----------
function syncThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  el.themeToggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  el.themeToggle.title = dark ? "Light theme" : "Dark theme";
}
el.themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.saveTheme(next);
  syncThemeButton();
});
syncThemeButton();

// ---------- status pill ----------
const SERVICE_NOTES = {
  closed: "Online evaluation is closed for now. The precomputed examples below still open.",
  device: "You’re offline. The precomputed examples below still open; reconnect to evaluate your own image.",
  degraded: "The judge model is temporarily offline, so new evaluations will fail for now. The precomputed examples below still open.",
  offline: "The evaluation service can’t be reached right now. The precomputed examples below still open; try your own image again in a few minutes.",
};

function setPill(state, text, title, note = "") {
  el.pill.dataset.state = state;
  el.pill.querySelector(".status-pill__text").textContent = text;
  el.pill.title = title || text;
  el.serviceNote.textContent = note;
  el.serviceNote.hidden = !note;
}

async function refreshHealth() {
  if (MOCK) { setPill("sim", "Simulator", "Built-in simulator: no requests leave this browser."); return; }
  if (CLOSED) { setPill("closed", "Closed", "Online evaluation is switched off.", SERVICE_NOTES.closed); return; }
  if (navigator.onLine === false) { setPill("offline", "No network", "Your device is offline.", SERVICE_NOTES.device); return; }
  try {
    const hl = await api.health();
    const q = hl.queue || {};
    const waiting = Number(q.waiting) || 0;
    if (hl.status === "ok" && hl.judge_online !== false) {
      setPill(waiting > 0 ? "busy" : "online", `Online · queue ${waiting}`,
        `Judge ${safeText(hl.model || info.model, 60)} online · ${Number(q.running) || 0} running on ${Number(q.workers) || 0} workers`);
    } else {
      setPill("degraded", "Judge offline", "The API is up but the judge model is offline.", SERVICE_NOTES.degraded);
    }
  } catch {
    setPill("offline", "Offline", "The evaluation service is unreachable.", SERVICE_NOTES.offline);
  }
}
setInterval(() => { if (!document.hidden) refreshHealth(); }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshHealth(); });
window.addEventListener("online", () => { refreshHealth(); toast("Back online."); });
window.addEventListener("offline", () => { refreshHealth(); toast("You’re offline."); });

// ---------- info ----------
function applyInfo() {
  for (const n of $$(".js-max-mb")) n.textContent = String(info.max_upload_mb || 15);
  for (const n of $$(".js-max-side")) n.textContent = String(info.max_side || 2048);
  for (const n of $$(".js-lambda")) n.textContent = fmtNum(Number(info.lambda) || LAMBDA);
  for (const n of $$(".js-alpha")) n.textContent = fmtNum(Number(info.alpha) || ALPHA);
  if (Array.isArray(info.accepted_types) && info.accepted_types.length) el.fileInput.accept = info.accepted_types.join(",");
  const model = safeText(info.model || "google/gemma-4-31B-it", 80);
  $("#footerMeta").textContent = `Judge: ${model} · served with vLLM${MOCK ? " · simulator mode" : ""}`;
  for (const n of $$(".js-model")) n.textContent = model;
}

// ---------- reconnect after reload ----------
function resumeActiveJob() {
  if (MOCK || CLOSED) return false;
  const job = store.loadActiveJob();
  if (!job) return false;
  const preview = typeof job.preview === "string" && job.preview.startsWith("data:image/") ? job.preview : "";
  S.item = { kind: "resume", url: preview, name: job.name || "image", size: job.size, width: job.width, height: job.height };
  if (preview) viewer.show(preview, `Preview of “${safeText(job.name, 80)}”`).catch(() => {});
  setMeta();
  setCaption(h("span", {}, h("b", { text: "Reconnected" }), "The page was reloaded while the judge was working; showing a local preview while the result streams back."));
  stopRun();
  const seq = S.seq;
  S.run = { seq, jobId: job.jobId, watcher: null, started: false, done: false, failed: false, position: null };
  readout.begin({ note: `reconnecting to job ${job.jobId.slice(0, 12)} after reload` });
  readout.setPhase("queued");
  readout.els.summary.textContent = "Reconnecting to your evaluation…";
  syncButtons();
  watchJob(seq, job.jobId);
  return true;
}

// ---------- boot ----------
function boot() {
  if (window.__terravisFramed) return;  // inside another site's frame (theme-boot.js hid the page)
  buildFlowCells($("#flowCells"));
  buildLadder($("#ladder"), {
    major: $("#calcMajor"), minor: $("#calcMinor"), expr: $("#calcExpr"), score: $("#calcScore"),
    buttons: $$("[data-calc]"), plot: $("#calcPlot"),
  });
  buildTaxonomy({ list: $("#taxList"), filter: $("#taxFilter"), search: $("#taxSearch"), empty: $("#taxEmpty") });
  buildNaList($("#faqNaList"));
  buildLinks(CFG, { footer: $("#footerLinks"), navCode: $("#navCode"), issues: $("#footerIssues") });
  applyInfo();
  if (MOCK) el.note.textContent = "Simulator mode: nothing is uploaded; results come from stored examples.";
  else if (CLOSED) el.note.textContent = "Online evaluation is closed for now: nothing is uploaded.";
  syncButtons();
  refreshHealth();
  const resumed = resumeActiveJob();

  if (!CLOSED) api.info()
    .then((i) => {
      if (i && typeof i === "object") {
        info = { ...info, ...i };
        applyInfo();
        if (S.item && S.item.kind === "upload") ensureCaptcha();
      }
    })
    .catch(() => { /* keep defaults */ });

  fetch("examples/examples.json")
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .then((list) => {
      // An undetermined example has nothing to show; hero and gallery number the same list.
      examples = Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string" && validResult(e.result)
        && (e.result.status === "scored" || e.result.status === "not_applicable")) : [];
      renderExamples();
      hero.setExamples(examples);
      if (AUTORUN && !resumed) autorun(AUTORUN);
    });
}

async function autorun(id) {
  const ex = examples.find((e) => e.id === id);
  if (!ex) { toast("Unknown example id for autorun."); return; }
  if (!MOCK) { openExample(ex); return; }
  scrollToConsole();
  try {
    const res = await fetch(ex.image);
    const blob = await res.blob();
    const file = new File([blob], `${exampleName(ex)}.jpg`, { type: blob.type || "image/jpeg" });
    await loadFile(file, { exampleId: ex.id, autorun: true, focusRun: false });
  } catch {
    openExample(ex);
  }
}

boot();

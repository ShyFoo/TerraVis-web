// The live readout: stage track, score dial + scale strip, counts, formula, telemetry log, the 18-cell probe
// panel and the findings. Driven purely by pipeline events; `renderResult` is the canonical final render.
import { TAXONOMY, LAMBDA, ALPHA } from "./taxonomy.js";
import {
  h, s, icon, clear, codeFor, domainInfo, DOMAINS, NA_CATEGORIES, NA_CLARIFIER, fmtScore, fmtNum, fmtClock,
  outcomeText, plural, safeText, reducedMotion, taxonomyAt, scoreOf,
} from "./util.js";

const C = 160;
const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};
const arc = (r, a0, a1) => {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const G0 = 135;   // gauge start angle (bottom-left)
const GS = 270;   // gauge sweep
const valueAngle = (v) => G0 + GS * Math.max(0, Math.min(1, v));

const PHASE_LABEL = {
  idle: "IDLE", ready: "READY", uploading: "UPLOADING", queued: "QUEUED", running: "RUNNING",
  done: "COMPLETE", na: "N/A", undetermined: "UNDETERMINED", error: "ERROR", cancelled: "CANCELLED",
};
const CELL_STATUS = {
  pending: "Pending", checking: "Checking", clear: "Clear", detected: "Detected",
  major: "Major", minor: "Minor", unclear: "Unparsed", skipped: "Skipped",
};

function buildDial(container) {
  clear(container);
  const svg = s("svg", { viewBox: "0 0 320 286", role: "img", "aria-label": "Score dial" });
  const title = s("title", { text: "Score dial" });
  svg.append(title);
  const ticks = s("g", { "aria-hidden": "true" });
  for (let k = 0; k <= 20; k++) {
    const major = k % 5 === 0;
    const [x0, y0] = polar(major ? 141 : 145, valueAngle(k / 20));
    const [x1, y1] = polar(151, valueAngle(k / 20));
    ticks.append(s("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: major ? "dl-tick dl-tick--major" : "dl-tick" }));
  }
  svg.append(ticks);
  svg.append(s("path", { d: arc(128, G0, G0 + GS), class: "dl-track" }));
  const fill = s("path", { d: arc(128, G0, G0 + GS), class: "dl-fill is-empty", pathLength: "1", "stroke-dasharray": "1 1", "stroke-dashoffset": "1" });
  svg.append(fill);

  const needle = s("g", { class: "dl-needle" });
  needle.append(s("line", { x1: C + 108, y1: C, x2: C + 150, y2: C }), s("circle", { cx: C + 150, cy: C, r: 3.4 }));
  needle.style.transformOrigin = `${C}px ${C}px`;
  needle.style.transformBox = "view-box";
  needle.style.transform = `rotate(${G0}deg)`;
  needle.style.opacity = "0";
  svg.append(needle);

  const cap = s("text", { x: C, y: C - 42, "text-anchor": "middle", class: "dl-cap", text: "SCORE S" });
  const val = s("text", { x: C, y: C + 18, "text-anchor": "middle", class: "dl-val is-pending", text: "—" });
  const sub = s("text", { x: C, y: C + 50, "text-anchor": "middle", class: "dl-sub", text: "" });
  svg.append(cap, val, sub);
  container.append(svg);
  return { svg, title, fill, needle, val, sub, cap, raf: 0, timer: 0 };
}

/** Every score some count of major and minor violations can produce (down to ~0.004). */
function reachableScores(lambda, alpha) {
  const vals = new Map();
  for (let a = 0; a <= 8; a++) {
    for (let b = 0; b <= 16; b++) {
      const v = Math.exp(-lambda * (a + alpha * b));
      if (v > 0.004) vals.set(v.toFixed(4), v);
    }
  }
  return [...vals.values()];
}

function buildScale(root) {
  const track = h("div", { class: "scale__track", role: "img" });
  const ticks = h("div", { class: "scale__ticks", "aria-hidden": "true" });
  const val = h("span", { class: "scale__val" });
  const mark = h("span", { class: "scale__mark", "aria-hidden": "true" }, val);
  track.append(ticks, mark);
  clear(root).append(
    h("p", { class: "scale__cap" }, "Where this score sits on the scale", h("span", { text: "ticks: every score a count of violations can produce" })),
    track,
    h("div", { class: "scale__axis", "aria-hidden": "true" }, h("span", { text: "0" }), h("span", { text: "0.5" }), h("span", { text: "1" })),
  );
  let key = "";
  return {
    set(score, { lambda, alpha, animate }) {
      root.hidden = false;
      if (key !== `${lambda}/${alpha}`) {
        key = `${lambda}/${alpha}`;
        clear(ticks);
        for (const v of reachableScores(lambda, alpha)) {
          const t = h("i", {});
          t.style.left = `${(v * 100).toFixed(2)}%`;
          ticks.append(t);
        }
      }
      const pct = Math.max(0, Math.min(1, score)) * 100;
      track.setAttribute("aria-label", `Score ${fmtScore(score)} on the scale from 0 to 1. Ticks mark every score a count of major and minor violations can produce.`);
      val.textContent = fmtScore(score);
      mark.dataset.edge = pct > 90 ? "right" : pct < 10 ? "left" : "";
      if (animate && !reducedMotion()) {
        mark.style.transition = "none";
        mark.style.left = "100%";
        void mark.offsetWidth;
        mark.style.transition = "";
      }
      requestAnimationFrame(() => { mark.style.left = `${pct.toFixed(2)}%`; });
    },
    hide() { root.hidden = true; },
  };
}

export class Readout {
  constructor(els, { announce } = {}) {
    this.els = els;
    this.announce = announce || (() => {});
    this.dial = buildDial(els.dial);
    this.scale = buildScale(els.scale);
    this.cells = [];
    this.groups = new Map();
    this.cards = new Map();
    this.cardList = null;
    this.linked = null;
    this.clockTimer = 0;
    this.countdownTimer = 0;
    this.t0 = performance.now();
    this.live = null;
    this.buildProbes();
    els.probesToggle.addEventListener("click", () => {
      const all = els.probesPanel.classList.toggle("show-all");
      els.probesToggle.setAttribute("aria-expanded", String(all));
      els.probesToggle.textContent = all ? "Show detected only" : "Show all 18 checks";
    });
    this.reset("idle");
  }

  // ---------- probe panel ----------
  buildProbes() {
    const root = clear(this.els.probes);
    for (const d of DOMAINS) {
      const items = TAXONOMY.filter((t) => t.domain === d.key);
      const cellsWrap = h("div", { class: "pgroup__cells" });
      const group = h("div", { class: "pgroup", role: "group", "aria-label": `${d.long} probes` },
        h("div", { class: "pgroup__head" }, h("h4", { text: d.label }), h("p", { text: `${codeFor(items[0].index)}–${codeFor(items[items.length - 1].index)} · ${items.length} probes` })),
        cellsWrap,
        h("p", { class: "pgroup__none", text: "No violations detected in this domain" }));
      this.groups.set(d.key, group);
      for (const t of items) {
        const status = h("span", { class: "cell__status", text: "Pending" });
        const cell = h("button", { type: "button", class: "cell", dataset: { index: t.index, state: "pending" } },
          h("span", { class: "cell__top" }, h("span", { class: "cell__code", text: codeFor(t.index) }), status, h("span", { class: "led", "aria-hidden": "true" })),
          h("span", { class: "cell__name", text: t.violation_type.replace(/\//g, "/\u200B") }));
        cell._status = status;
        const enter = () => { if (this.cards.has(t.index)) this.link(t.index, true); };
        const leave = () => { if (this.linked != null) this.link(this.linked, false); };
        cell.addEventListener("mouseenter", enter);
        cell.addEventListener("focus", enter);
        cell.addEventListener("mouseleave", leave);
        cell.addEventListener("blur", leave);
        cell.addEventListener("click", () => this.focusCard(t.index));
        this.cells[t.index] = cell;
        cellsWrap.append(cell);
      }
      root.append(group);
    }
    this.setAllCells("pending");
  }

  setCell(index, state) {
    const cell = this.cells[index];
    if (!cell) return;
    cell.dataset.state = state;
    cell._status.textContent = CELL_STATUS[state] || state;
    const t = taxonomyAt(index);
    const live = this.cards.has(index);  // only a probe with a finding card does anything when pressed
    cell.setAttribute("aria-label", `${codeFor(index)} ${t ? t.violation_type : ""}: ${CELL_STATUS[state] || state}${live ? ". Press to jump to its finding." : ""}`);
    cell.tabIndex = live ? 0 : -1;
    cell.toggleAttribute("aria-disabled", !live);
  }

  /** "" while running; "scored" | "na" | "undetermined" once final (drives the compact layouts). */
  setProbesFinal(final) {
    const panel = this.els.probesPanel;
    panel.dataset.final = final;
    panel.classList.remove("show-all");
    this.els.probesToggle.setAttribute("aria-expanded", "false");
    this.els.probesToggle.textContent = "Show all 18 checks";
    for (const [key, group] of this.groups) {
      const hits = TAXONOMY.filter((t) => t.domain === key && !["clear", "pending", "skipped"].includes(this.cells[t.index].dataset.state)).length;
      group.dataset.hits = String(hits);
    }
  }

  /** Findings sit under the probe grid while it animates, and move above it once the result is in. */
  findingsFirst(on) {
    const { findings, probesPanel } = this.els;
    if (on && probesPanel.nextElementSibling === findings) probesPanel.before(findings);
    else if (!on && findings.nextElementSibling === probesPanel) findings.before(probesPanel);
  }

  setAllCells(state) {
    for (let i = 0; i < TAXONOMY.length; i++) this.setCell(i, state);
  }

  link(index, on) {
    if (on && this.linked != null && this.linked !== index) this.link(this.linked, false);
    const card = this.cards.get(index);
    const cell = this.cells[index];
    if (card) card.classList.toggle("is-linked", on);
    if (cell) cell.classList.toggle("is-linked", on);
    this.linked = on ? index : null;
  }

  focusCard(index) {
    const card = this.cards.get(index);
    if (!card) return;
    card.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    card.focus({ preventScroll: true });
    this.link(index, true);
  }

  // ---------- phase + stage track ----------
  setPhase(phase) {
    this.phase = phase;
    this.els.console.dataset.phase = phase;
    this.els.stateBadge.dataset.state = phase;
    this.els.stateBadge.querySelector(".state-badge__text").textContent = PHASE_LABEL[phase] || phase.toUpperCase();
  }

  stage(name, state, meta, progress) {
    const li = this.els.stages[name];
    if (!li) return;
    li.dataset.state = state;
    if (meta !== undefined) li.querySelector(".stage__meta").textContent = meta;
    if (progress === "indeterminate") li.setAttribute("data-indeterminate", "");
    else li.removeAttribute("data-indeterminate");
    const bar = li.querySelector(".stage__bar span");
    bar.style.setProperty("--p", typeof progress === "number" ? String(progress) : "0");
  }

  hud(text) { this.els.hud.textContent = text; }

  // ---------- counts, dial, formula ----------
  setCounts({ major, minor, clear: clr, unclear }) {
    const f = (v) => (v == null ? "—" : String(v));
    this.els.countMajor.textContent = f(major);
    this.els.countMinor.textContent = f(minor);
    this.els.countClear.textContent = f(clr);
    this.els.countUnclear.textContent = f(unclear);
  }

  dialPending(text = "—", sub = "") {
    const d = this.dial;
    cancelAnimationFrame(d.raf);
    clearTimeout(d.timer);
    d.val.textContent = text;
    d.val.setAttribute("class", "dl-val is-pending");
    d.sub.textContent = sub;
    d.fill.setAttribute("class", "dl-fill is-empty");
    d.fill.style.strokeDashoffset = "1";
    d.needle.style.opacity = "0";
    d.needle.style.transform = `rotate(${G0}deg)`;
    d.title.textContent = "Score dial: no score yet";
  }

  dialNA(text, sub) {
    this.dialPending(text, sub);
    this.dial.val.setAttribute("class", "dl-val is-na");
    this.dial.title.textContent = `Score dial: ${text}, no score`;
  }

  dialScore(score, sub, animate) {
    const d = this.dial;
    cancelAnimationFrame(d.raf);
    clearTimeout(d.timer);
    d.val.setAttribute("class", "dl-val");
    d.sub.textContent = sub;
    d.fill.setAttribute("class", "dl-fill");
    d.needle.style.opacity = "1";
    d.title.textContent = `Score dial: S = ${fmtScore(score)}`;
    const target = Math.max(0, Math.min(1, score));
    const setFinal = () => { d.val.textContent = fmtScore(score); };
    if (!animate || reducedMotion()) {
      d.fill.style.transition = "none";
      d.needle.style.transition = "none";
      d.fill.style.strokeDashoffset = String(1 - target);
      d.needle.style.transform = `rotate(${valueAngle(target)}deg)`;
      void d.fill.getBoundingClientRect();
      d.fill.style.transition = "";
      d.needle.style.transition = "";
      setFinal();
      return;
    }
    // Start from 1.0 (no violations) and fall to the measured value.
    d.fill.style.transition = "none";
    d.needle.style.transition = "none";
    d.fill.style.strokeDashoffset = "0";
    d.needle.style.transform = `rotate(${valueAngle(1)}deg)`;
    void d.fill.getBoundingClientRect();
    d.fill.style.transition = "";
    d.needle.style.transition = "";
    requestAnimationFrame(() => {
      d.fill.style.strokeDashoffset = String(1 - target);
      d.needle.style.transform = `rotate(${valueAngle(target)}deg)`;
    });
    const dur = 1200;
    const t0 = performance.now();
    const from = 1;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      d.val.textContent = fmtScore(from + (target - from) * e);
      if (p < 1) d.raf = requestAnimationFrame(step);
    };
    d.val.textContent = "1.000";
    d.raf = requestAnimationFrame(step);
    d.timer = setTimeout(() => { cancelAnimationFrame(d.raf); setFinal(); }, dur + 60);
  }

  setFormula(result) {
    const el = clear(this.els.formula);
    if (!result || result.status !== "scored") return;
    const lam = Number.isFinite(result.lambda) ? result.lambda : LAMBDA;
    const al = Number.isFinite(result.alpha) ? result.alpha : ALPHA;
    const M = result.num_major | 0;
    const m = result.num_minor | 0;
    const pen = M + al * m;
    const S = Number.isFinite(result.score) ? result.score : scoreOf(M, m, lam, al);
    el.append(
      h("span", { class: "f-row" }, "S = exp(−", h("span", { class: "f-par", text: "λ" }), " · (", h("span", { class: "f-maj", text: "N_major" }), " + ", h("span", { class: "f-par", text: "α" }), " · ", h("span", { class: "f-min", text: "N_minor" }), "))"),
      h("span", { class: "f-row" }, "  = exp(−", h("span", { class: "f-par", text: fmtNum(lam) }), " · (", h("span", { class: "f-maj", text: String(M) }), " + ", h("span", { class: "f-par", text: fmtNum(al) }), " · ", h("span", { class: "f-min", text: String(m) }), `)) = exp(−${(lam * pen).toFixed(2)}) = `, h("span", { class: "f-res", text: fmtScore(S) })),
    );
  }

  // ---------- log ----------
  log(text, kind = "") {
    const list = this.els.log;
    const empty = list.querySelector(".is-empty");
    if (empty) empty.remove();
    const li = h("li", { dataset: kind ? { kind } : {} }, h("time", { text: fmtClock(performance.now() - this.t0) }), h("span", { text: safeText(text, 300) }));
    list.append(li);
    while (list.children.length > 80) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
  }

  clearLog(placeholder = "Waiting for an image.") {
    clear(this.els.log).append(h("li", { class: "is-empty", text: placeholder }));
  }

  startClock() {
    this.t0 = performance.now();
    clearInterval(this.clockTimer);
    this.els.logClock.textContent = fmtClock(0);
    this.clockTimer = setInterval(() => { this.els.logClock.textContent = fmtClock(performance.now() - this.t0); }, 100);
  }

  stopClock() {
    clearInterval(this.clockTimer);
    this.clockTimer = 0;
    this.els.logClock.textContent = fmtClock(performance.now() - this.t0);
  }

  // ---------- lifecycle ----------
  reset(phase = "idle", { summary } = {}) {
    clearInterval(this.countdownTimer);
    this.stopClock();
    this.els.logClock.textContent = fmtClock(0);
    this.live = null;
    this.cards.clear();
    this.cardList = null;
    this.linked = null;
    this.setPhase(phase);
    this.stage("eligibility", "pending", "—");
    this.stage("detection", "pending", "0/18");
    this.stage("severity", "pending", "—");
    this.stage("score", "pending", "—");
    this.setAllCells("pending");
    this.setProbesFinal("");
    this.findingsFirst(false);
    this.setCounts({});
    this.dialPending("—", phase === "ready" ? "ready" : "");
    this.scale.hide();
    clear(this.els.formula);
    this.els.eligLine.textContent = "";
    this.hud(phase === "ready" ? "READY · PRESS EVALUATE" : "STANDBY");
    this.els.summary.textContent = summary || (phase === "ready" ? "Ready — press Evaluate to send the image to the judge." : "Load an image to begin.");
    this.clearLog(phase === "ready" ? "Image loaded. Waiting for Evaluate." : "Waiting for an image.");
    this.setFindingsIdle();
  }

  setFindingsIdle() {
    clear(this.els.findingsBody).append(
      h("div", { class: "state-panel state-panel--idle" },
        h("div", { class: "state-panel__icon" }, icon("scan")),
        h("div", { class: "state-panel__body" },
          h("h4", { text: "Findings appear here" }),
          h("p", { class: "sub", text: "Each detected violation is listed with its affected aspect, the judge’s one-sentence evidence, its severity and the reason for it." }))),
    );
  }

  begin({ note } = {}) {
    this.reset("uploading", { summary: "Uploading image…" });
    this.live = { eligible: undefined, detections: new Map(), severities: new Map(), K: 0 };
    this.startClock();
    this.dialPending("···", "awaiting judge");
    this.hud("UPLOADING");
    clear(this.els.log);
    if (note) this.log(note, "accent");
  }

  replayBegin(label) {
    this.reset("running", { summary: "Replaying stored result…" });
    this.live = { eligible: undefined, detections: new Map(), severities: new Map(), K: 0 };
    this.startClock();
    this.dialPending("···", "replay");
    clear(this.els.log);
    this.log(label, "accent");
  }

  onQueued(position) {
    this.setPhase("queued");
    const pos = Number.isFinite(position) ? position : null;
    this.hud(pos ? `QUEUED · POSITION ${pos}` : "QUEUED");
    this.els.summary.textContent = pos ? `Queued — position ${pos}` : "Queued";
    this.dialPending("···", pos ? `queue #${pos}` : "queued");
    this.log(pos ? `queued · position ${pos}` : "queued", "warn");
    if (pos) this.announce(`Queued, position ${pos}.`);
  }

  onStarted() {
    this.setPhase("running");
    this.stage("eligibility", "active", "checking", "indeterminate");
    this.hud("SCANNING · ELIGIBILITY");
    this.els.summary.textContent = "Stage 1 — checking eligibility…";
    this.dialPending("···", "stage 1/3");
    this.log("judge started", "accent");
    this.announce("Evaluation started. Checking eligibility.");
  }

  onEligibility({ eligible, reason }) {
    if (!this.live) this.live = { detections: new Map(), severities: new Map(), K: 0 };
    this.live.eligible = eligible;
    this.setPhase("running");
    this.setEligLine(eligible, reason);
    if (eligible === true) {
      this.stage("eligibility", "done", "eligible");
      this.stage("detection", "active", "0/18", 0);
      this.setAllCells("checking");
      this.setCounts({ major: 0, minor: 0, clear: 0, unclear: 0 });
      this.hud("SCANNING · DETECTION 0/18");
      this.els.summary.textContent = "Stage 2 — running 18 violation probes in parallel…";
      this.dialPending("···", "stage 2/3");
      this.log(`eligibility → eligible${reason ? ` · “${safeText(reason, 160)}”` : ""}`, "ok");
      this.announce("Image is eligible. Running 18 violation probes.");
    } else {
      const na = eligible === false;
      this.stage("eligibility", "na", na ? "N/A" : "unparsed");
      this.stage("detection", "skipped", "skipped");
      this.stage("severity", "skipped", "skipped");
      this.setAllCells("skipped");
      this.hud(na ? "NOT APPLICABLE" : "UNDETERMINED");
      this.els.summary.textContent = na ? "Not applicable — no score" : "Undetermined — no score";
      this.log(na ? `eligibility → N/A${reason ? ` · “${safeText(reason, 160)}”` : ""}` : "eligibility → unparseable answer", "na");
    }
  }

  setEligLine(eligible, reason) {
    const el = clear(this.els.eligLine);
    const tag = eligible === true ? "Eligible" : eligible === false ? "N/A" : "Unparsed";
    el.append(h("b", { class: eligible === true ? "" : "is-na", text: `Stage 1 · ${tag}` }), reason ? safeText(reason, 600) : "");
    el.title = reason ? safeText(reason, 600) : "";  // the line is cut to one row
  }

  onDetection(d) {
    const L = this.live;
    if (!L || !Number.isInteger(d.index) || !this.cells[d.index]) return;
    if (L.detections.has(d.index)) return;
    L.detections.set(d.index, d);
    const state = d.detected === true ? "detected" : d.detected === false ? "clear" : "unclear";
    this.setCell(d.index, state);
    const n = L.detections.size;
    const vals = [...L.detections.values()];
    const K = vals.filter((x) => x.detected === true).length;
    this.setCounts({
      major: [...L.severities.values()].filter((x) => x.severity === "major").length,
      minor: [...L.severities.values()].filter((x) => x.severity === "minor").length,
      clear: vals.filter((x) => x.detected === false).length,
      unclear: vals.filter((x) => x.detected == null).length,
    });
    this.stage("detection", n >= 18 ? "done" : "active", `${n}/18`, n / 18);
    this.hud(`SCANNING · DETECTION ${n}/18`);
    const t = taxonomyAt(d.index);
    const name = d.violation_type || (t && t.violation_type) || "";
    if (state === "detected") {
      this.log(`${codeFor(d.index)} ${name} → DETECTED${d.affected_aspect ? ` · ${safeText(d.affected_aspect, 80)}` : ""}`, "bad");
      this.addLiveCard({ ...d, domain: t && t.domain, severity: null, severity_reason: "" });
    } else {
      this.log(`${codeFor(d.index)} ${name} → ${state === "clear" ? "clear" : "unparsed"}`, state === "clear" ? "" : "na");
    }
    if (n >= 18) {
      L.K = K;
      if (K > 0) {
        this.stage("severity", "active", `0/${K}`, 0);
        this.hud("CLASSIFYING SEVERITY");
        this.els.summary.textContent = `Stage 3 — classifying the severity of ${plural(K, "detection")}…`;
        this.dialPending("···", "stage 3/3");
        this.announce(`Detection complete: ${plural(K, "violation")} found. Classifying severity.`);
      } else {
        this.stage("severity", "skipped", "none needed");
        this.els.summary.textContent = "No detections — computing score…";
        this.announce("Detection complete: no violations found.");
      }
    } else {
      this.els.summary.textContent = `Stage 2 — ${n} of 18 probes answered · ${plural(K, "detection")} so far`;
    }
  }

  onSeverity(d) {
    const L = this.live;
    if (!L || !Number.isInteger(d.index)) return;
    L.severities.set(d.index, d);
    const sev = d.severity === "major" ? "major" : d.severity === "minor" ? "minor" : "detected";
    this.setCell(d.index, sev);
    this.updateCardSeverity(d.index, d.severity, d.severity_reason);
    const k = L.severities.size;
    const K = L.K || [...L.detections.values()].filter((x) => x.detected === true).length;
    this.stage("severity", k >= K ? "done" : "active", `${k}/${K}`, K ? k / K : 1);
    const sv = [...L.severities.values()];
    const vals = [...L.detections.values()];
    this.setCounts({
      major: sv.filter((x) => x.severity === "major").length,
      minor: sv.filter((x) => x.severity === "minor").length,
      clear: vals.filter((x) => x.detected === false).length,
      unclear: vals.filter((x) => x.detected == null).length,
    });
    const t = taxonomyAt(d.index);
    this.log(`${codeFor(d.index)} ${d.violation_type || (t && t.violation_type) || ""} → ${String(d.severity || "?").toUpperCase()}`, sev === "major" ? "bad" : "warn");
  }

  // ---------- findings ----------
  ensureCardList() {
    if (this.cardList && this.cardList.isConnected) return this.cardList;
    this.cardList = h("ul", { class: "cards", "aria-label": "Detected violations" });
    clear(this.els.findingsBody).append(this.cardList);
    return this.cardList;
  }

  makeCard(c) {
    const idx = c.index;
    const t = taxonomyAt(idx) || {};
    const domain = c.domain || t.domain;
    const pill = h("span", { class: "pill pill--pending", text: "Classifying" });
    const reasonLabel = h("dt", { text: "Severity" });
    const reason = h("dd", { class: "is-muted", text: "Awaiting severity classification…" });
    const card = h("li", { class: "card", id: `finding-${idx}`, tabindex: "-1", dataset: { sev: "pending", index: idx } },
      h("div", { class: "card__head" },
        h("span", { class: "card__code", text: codeFor(idx) }),
        h("div", { class: "card__title" }, h("h4", { text: safeText(c.violation_type || t.violation_type || "Violation", 120).replace(/\//g, "/\u200B") }), h("p", { text: domainInfo(domain).long })),
        pill),
      h("dl", {},
        h("div", {}, h("dt", { text: "Evidence" }), h("dd", {},
          h("b", { class: "card__aspect", text: safeText(c.affected_aspect, 400) || "—" }), " — ", safeText(c.evidence, 1200) || "—")),
        h("div", {}, reasonLabel, reason)));
    card._pill = pill;
    card._reasonLabel = reasonLabel;
    card._reason = reason;
    card.addEventListener("mouseenter", () => this.link(idx, true));
    card.addEventListener("mouseleave", () => this.link(idx, false));
    this.cards.set(idx, card);
    if (c.severity) this.setCardSeverity(card, c.severity, c.severity_reason);
    return card;
  }

  setCardSeverity(card, severity, reason) {
    const sev = severity === "major" || severity === "minor" ? severity : null;
    card.dataset.sev = sev || "unrated";
    card._pill.className = sev ? `pill pill--${sev}` : "pill pill--pending";
    card._pill.textContent = sev ? (sev === "major" ? "Major" : "Minor") : "Unrated";
    card._reasonLabel.textContent = sev ? `Why ${sev}` : "Severity";
    card._reason.classList.toggle("is-muted", !sev);
    card._reason.textContent = safeText(reason, 1200) || (sev ? "—" : "No severity was returned for this detection.");
  }

  addLiveCard(c) {
    const list = this.ensureCardList();
    const card = this.makeCard(c);
    list.append(card);
    this.setCell(c.index, this.cells[c.index].dataset.state);
  }

  updateCardSeverity(index, severity, reason) {
    const card = this.cards.get(index);
    if (card) this.setCardSeverity(card, severity, reason);
  }

  // ---------- canonical final render ----------
  renderResult(result, { animate = true, label = "" } = {}) {
    clearInterval(this.countdownTimer);
    this.stopClock();
    const seenLive = new Set(this.cards.keys());
    this.cards.clear();
    this.cardList = null;
    this.linked = null;
    const status = result && result.status;
    const elig = (result && result.eligibility) || {};
    const checks = Array.isArray(result && result.checks) ? result.checks : [];
    const byIndex = new Map(checks.filter((c) => c && Number.isInteger(c.index)).map((c) => [c.index, c]));
    this.setEligLine(elig.eligible === undefined ? null : elig.eligible, elig.reason);
    if (label) this.log(label, "accent");

    if (status === "scored") {
      this.setPhase("done");
      const lam = Number.isFinite(result.lambda) ? result.lambda : LAMBDA;
      const al = Number.isFinite(result.alpha) ? result.alpha : ALPHA;
      const M = result.num_major | 0;
      const m = result.num_minor | 0;
      const S = Number.isFinite(result.score) ? result.score : scoreOf(M, m, lam, al);
      const detected = checks.filter((c) => c.detected === true);
      const unclear = checks.filter((c) => c.detected == null);
      const clearN = checks.filter((c) => c.detected === false).length;
      this.stage("eligibility", "done", "eligible");
      this.stage("detection", "done", `${checks.length}/18`, 1);
      this.stage("severity", detected.length ? "done" : "skipped", detected.length ? `${detected.length}/${detected.length}` : "none needed", 1);
      this.stage("score", "done", fmtScore(S), 1);
      for (let i = 0; i < TAXONOMY.length; i++) {
        const c = byIndex.get(i);
        let st = "pending";
        if (c) st = c.detected === true ? (c.severity === "major" ? "major" : c.severity === "minor" ? "minor" : "detected") : c.detected === false ? "clear" : "unclear";
        this.setCell(i, st);
      }
      this.setCounts({ major: M, minor: m, clear: clearN, unclear: unclear.length });
      this.dialScore(S, `exp(−${(lam * (M + al * m)).toFixed(2)})`, animate);
      this.scale.set(S, { lambda: lam, alpha: al, animate });
      this.setFormula({ ...result, lambda: lam, alpha: al, score: S });
      const outcome = outcomeText(result);
      this.els.summary.textContent = `${outcome} across 18 probes`;
      this.hud(`COMPLETE · S = ${fmtScore(S)}`);

      const body = clear(this.els.findingsBody);
      if (detected.length) {
        const order = { major: 0, minor: 1 };
        detected.sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2) || a.index - b.index);
        this.cardList = h("ul", { class: "cards", "aria-label": "Detected violations" });
        for (const c of detected) {
          const card = this.makeCard(c);
          if (!animate || seenLive.has(c.index)) card.classList.add("no-anim");
          this.cardList.append(card);
        }
        body.append(this.cardList);
        for (const c of detected) this.setCell(c.index, this.cells[c.index].dataset.state);
      } else {
        body.append(h("div", { class: "state-panel state-panel--clean" },
          h("div", { class: "state-panel__icon" }, icon("check")),
          h("div", { class: "state-panel__body" },
            h("h4", { text: "No violations detected" }),
            h("p", { class: "sub", text: unclear.length
              ? `${clearN} of 18 probes answered “no”; ${plural(unclear.length, "answer")} could not be parsed and ${unclear.length === 1 ? "counts" : "count"} as not detected. S = ${fmtScore(S)}.`
              : `All 18 probes answered “no”, so S = ${fmtScore(S)} — the top of the scale.` }))));
      }
      if (unclear.length && detected.length) {
        body.append(h("p", { class: "note-unclear" },
          `${plural(unclear.length, "probe")} returned an answer that could not be parsed (${unclear.map((c) => codeFor(c.index)).join(", ")}) and ${unclear.length === 1 ? "is" : "are"} counted as not detected.`));
      }
      this.setProbesFinal("scored");
      this.findingsFirst(true);
      this.log(`score S = ${fmtScore(S)} · ${outcome}`, "ok");
      this.announce(`Evaluation complete. Score ${fmtScore(S)}. ${outcome}.`);
    } else if (status === "not_applicable" || status === "undetermined") {
      const na = status === "not_applicable";
      this.setPhase(na ? "na" : "undetermined");
      this.stage("eligibility", "na", na ? "N/A" : "unparsed", 1);
      this.stage("detection", "skipped", "skipped");
      this.stage("severity", "skipped", "skipped");
      this.stage("score", "na", "no score", 1);
      this.setAllCells("skipped");
      this.setCounts({});
      this.dialNA(na ? "N/A" : "?", na ? "not applicable" : "undetermined");
      this.scale.hide();
      this.setProbesFinal(na ? "na" : "undetermined");
      this.findingsFirst(true);
      clear(this.els.formula);
      this.els.summary.textContent = outcomeText(result);
      this.hud(na ? "NOT APPLICABLE · NO SCORE" : "UNDETERMINED · NO SCORE");
      clear(this.els.findingsBody).append(na ? this.naPanel(elig.reason) : this.undeterminedPanel());
      this.log(na ? "result → not applicable (no score)" : "result → undetermined (no score)", "na");
      this.announce(na ? "Not applicable. The image is outside the scope of world-consistency scoring." : "Undetermined. The eligibility answer could not be parsed; no score.");
    } else {
      this.showError({ title: "Unexpected result", message: "The server returned a result this page does not understand.", detail: `status: ${safeText(status, 40)}` });
    }
  }

  naPanel(reason) {
    return h("div", { class: "state-panel state-panel--na", role: "status" },
      h("div", { class: "state-panel__icon" }, icon("info")),
      h("div", { class: "state-panel__body" },
        h("h4", { text: "Not applicable — no score" }),
        h("p", { class: "sub", text: "TerraVis scores single-frame, representational images of identifiable macroscopic objects or scenes (photorealistic or stylized). The judge placed this image outside that scope, so the 18 probes were not run." }),
        reason ? h("blockquote", {}, safeText(reason, 600), h("cite", { text: "Judge’s reason" })) : null,
        h("ul", { class: "na-cats", "aria-label": "Content categories that are not applicable" },
          NA_CATEGORIES.map((c) => h("li", {}, icon(c.icon, "icon na-cats__icon"), h("b", { text: c.name }), h("span", { text: c.eg })))),
        h("p", { class: "na-note" }, icon("check", "icon"), NA_CLARIFIER)));
  }

  undeterminedPanel() {
    return h("div", { class: "state-panel state-panel--na", role: "status" },
      h("div", { class: "state-panel__icon" }, icon("info")),
      h("div", { class: "state-panel__body" },
        h("h4", { text: "Undetermined — no score" }),
        h("p", { class: "sub", text: "The judge’s eligibility answer could not be parsed after 3 attempts, so the image was not scored. The first attempt is greedy and the two retries sample at a higher temperature, so a later run may succeed; for about 3 minutes, though, the identical file gets this cached result back." })));
  }

  /** opts: {title, message, detail, retryAfter, onRetry, retryLabel, onReset} */
  showError(opts) {
    clearInterval(this.countdownTimer);
    this.stopClock();
    for (const name of ["eligibility", "detection", "severity", "score"]) {
      const li = this.els.stages[name];
      if (li.dataset.state === "active") this.stage(name, "error", "failed");
    }
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] && this.cells[i].dataset.state === "checking") this.setCell(i, "pending");
    }
    this.setPhase("error");
    this.hud("ERROR");
    this.dialNA("ERR", "no score");
    this.dial.val.setAttribute("class", "dl-val is-err");
    this.scale.hide();
    this.findingsFirst(true);
    this.els.summary.textContent = opts.title;
    this.log(`error · ${opts.title}${opts.detail ? ` (${opts.detail})` : ""}`, "bad");

    const actions = h("div", { class: "state-panel__actions" });
    let retryBtn = null;
    const countdown = h("span", { class: "state-panel__count", role: "timer" });
    if (opts.onRetry) {
      retryBtn = h("button", { type: "button", class: "btn btn--primary btn--sm" }, icon("refresh"), h("span", { text: opts.retryLabel || "Try again" }));
      retryBtn.addEventListener("click", () => opts.onRetry());
      actions.append(retryBtn);
    }
    if (opts.onReset) {
      const b = h("button", { type: "button", class: "btn btn--ghost btn--sm" }, icon("image"), h("span", { text: "Use a different image" }));
      b.addEventListener("click", () => opts.onReset());
      actions.append(b);
    }
    actions.append(countdown);
    const panel = h("div", { class: "state-panel state-panel--error", role: "alert" },
      h("div", { class: "state-panel__icon" }, icon("alert")),
      h("div", { class: "state-panel__body" },
        h("h4", { text: opts.title }),
        h("p", { class: "sub", text: opts.message }),
        opts.detail ? h("p", { class: "state-panel__code", text: opts.detail }) : null,
        actions));
    clear(this.els.findingsBody).append(panel);

    let wait = "";
    if (Number.isFinite(opts.retryAfter) && opts.retryAfter > 0) {
      let left = Math.round(opts.retryAfter);
      const minutes = () => Math.ceil(left / 60);
      wait = ` You can retry in ${left > 90 ? `about ${minutes()} minutes` : `${left} seconds`}.`;
      const tick = () => {
        if (left <= 0) {
          clearInterval(this.countdownTimer);
          countdown.textContent = "";
          if (retryBtn) retryBtn.disabled = false;
          this.announce("You can retry now.");
          return;
        }
        countdown.textContent = `Retry available in ${left > 90 ? `about ${minutes()} min` : `${left}s`}`;
        if (retryBtn) retryBtn.disabled = true;
        left -= 1;
      };
      tick();
      this.countdownTimer = setInterval(tick, 1000);
    }
    this.announce(`Error: ${opts.title}. ${opts.message}${wait}`);
    return panel;
  }
}

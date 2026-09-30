// Content built from data: the hero demo (replays the precomputed examples), stage diagram, score ladder +
// calculator + S-vs-penalty curve, taxonomy explorer, N/A list and links.
import { TAXONOMY, LEVELS, LAMBDA, ALPHA } from "./taxonomy.js";
import {
  h, s, icon, clear, $$, codeFor, DOMAINS, NA_CATEGORIES, fmtScore, fmtNum, reducedMotion, scoreOf, debounce,
  outcomeText, safeText, thumbUrl,
} from "./util.js";

// ---------- hero demo ----------
const HC = 200;
const RING0 = 126;  // the 18 probe segments run clockwise from bottom-left over 288°, leaving the bottom for the card
const SEG = 16;
const hp = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [HC + r * Math.cos(a), HC + r * Math.sin(a)];
};
const harc = (r, a0, a1) => {
  const [x0, y0] = hp(r, a0);
  const [x1, y1] = hp(r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const HOLD_MS = 6500;
const SEVERITY_ORDER = { major: 0, minor: 1 };

function heroDialSvg() {
  const svg = s("svg", { viewBox: "0 0 400 400", "aria-hidden": "true", focusable: "false" });
  svg.append(s("circle", { cx: HC, cy: HC, r: 198, class: "hd-ring hd-ring--dash" }), s("circle", { cx: HC, cy: HC, r: 142, class: "hd-ring" }));
  const domains = [[0, 7, "OBJECT"], [7, 15, "INTERACTION"], [15, 18, "SCENE"]];
  for (const [a, b, name] of domains) {
    const id = `hd-dom-${name.toLowerCase()}`;
    svg.append(
      s("path", { d: harc(186, segA(a) + 1.5, segA(b) - 1.5), class: "hd-ring hd-ring--strong" }),
      s("path", { id, d: harc(191, segA(a), segA(b)), fill: "none" }),
      s("text", { class: "hd-dom" }, s("textPath", { href: `#${id}`, startOffset: "50%", "text-anchor": "middle", text: `${name} · ${b - a}` })),
    );
  }
  const segs = [];
  for (let i = 0; i < 18; i++) {
    const seg = s("path", { d: harc(174, segA(i) + 1.4, segA(i + 1) - 1.4), class: "hd-seg" });
    const [x, y] = hp(156, segA(i) + SEG / 2);
    segs.push(seg);
    svg.append(seg, s("text", { x, y: y + 4, "text-anchor": "middle", class: "hd-code", text: codeFor(i) }));
  }
  svg.append(s("path", { d: harc(127, RING0, RING0 + 288), class: "hd-arc-track" }));
  const arcEl = s("path", { d: harc(127, RING0, RING0 + 288), class: "hd-arc", pathLength: "1", "stroke-dasharray": "1 1", "stroke-dashoffset": "1" });
  svg.append(arcEl);
  return { svg, segs, arcEl };
}

function segA(i) { return RING0 + i * SEG; }

function segState(check) {
  if (!check) return "hd-seg is-skip";
  if (check.detected !== true) return "hd-seg is-clear";
  return check.severity === "major" ? "hd-seg is-major" : "hd-seg is-minor";
}

/**
 * The hero instrument loops over the precomputed examples. It pauses while the visitor's own evaluation is shown,
 * while the evaluator is on screen, when the hero is scrolled away and while the pointer or focus is on its card (so a
 * card being read or tabbed through is not replaced); stepping through the examples by hand stops the loop, and
 * reduced motion shows one frame.
 */
export function createHero({ dial, card, label, prev, next: nextBtn, evaluator, name, announce, onReplay }) {
  const { svg, segs, arcEl } = heroDialSvg();
  const img = h("img", { class: "hero-dial__img", alt: "", width: "320", height: "320", decoding: "async" });
  img.addEventListener("error", () => { if (img.dataset.full && img.getAttribute("src") !== img.dataset.full) img.src = img.dataset.full; });
  const chip = h("span", { class: "hero-dial__score mono" });
  const sweep = h("div", { class: "hero-dial__sweep" });
  dial.append(sweep, svg, img, chip);

  let list = [];
  let k = 0;
  let timers = [];
  let next = 0;
  const pause = { user: false, held: false, hidden: document.hidden, offscreen: false, evaluator: false, engaged: false };
  const running = () => list.length > 1 && !reducedMotion() && !Object.values(pause).some(Boolean);

  function fillCard(ex) {
    const r = ex.result;
    const found = r.checks.filter((c) => c.detected === true)
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2) || a.index - b.index);
    const replay = h("button", { type: "button", class: "demo__replay" }, "Replay this evaluation", icon("arrow-right"));
    replay.addEventListener("click", () => onReplay(ex));
    let detail;
    if (r.status !== "scored") detail = h("p", { class: "demo__note", text: safeText(r.eligibility && r.eligibility.reason, 180) });
    else if (!found.length) detail = h("p", { class: "demo__note", text: "All 18 probes answered “no”." });
    else {
      detail = h("ol", { class: "demo__list" }, found.slice(0, 2).map((c) => h("li", {},
        h("span", { class: `pill pill--${c.severity === "major" ? "major" : "minor"}`, text: c.severity === "major" ? "Major" : "Minor" }),
        h("b", { text: `${codeFor(c.index)} ${c.violation_type}` }),
        h("span", { class: "demo__ev", text: safeText(c.evidence || c.affected_aspect, 200) }))));
    }
    clear(card).append(
      h("p", { class: "demo__kicker", text: "TerraVis finds" }),
      h("p", { class: "demo__counts", text: outcomeText(r) }),
      detail,
      ...(found.length > 2 ? [h("p", { class: "demo__more", text: `+ ${found.length - 2} more in the full result` })] : []),
      replay,
    );
  }

  function show(ex, animate) {
    timers.forEach(clearTimeout);
    timers = [];
    const r = ex.result;
    const byIndex = new Map(r.checks.map((c) => [c.index, c]));
    img.dataset.full = ex.image;
    img.src = thumbUrl(ex);
    img.alt = `${name(ex)} image`;
    const settle = () => {
      segs.forEach((seg, i) => seg.setAttribute("class", segState(byIndex.get(i))));
      const scored = r.status === "scored";
      arcEl.style.strokeDashoffset = String(scored ? 1 - r.score : 1);
      chip.textContent = scored ? `Score = ${fmtScore(r.score)}` : "Score = N/A";
      chip.classList.toggle("is-na", !scored);
      fillCard(ex);
      card.classList.remove("is-out");
    };
    if (!animate) { settle(); return; }
    sweep.style.animation = "none";  // each new example starts its scan from the top
    void sweep.offsetWidth;
    sweep.style.animation = "";
    card.classList.add("is-out");
    arcEl.style.strokeDashoffset = "0";
    chip.textContent = "···";
    segs.forEach((seg, i) => {
      seg.setAttribute("class", "hd-seg");
      if (r.status !== "scored") return;
      timers.push(setTimeout(() => seg.setAttribute("class", "hd-seg is-lit"), i * 55));
      timers.push(setTimeout(() => seg.setAttribute("class", segState(byIndex.get(i))), i * 55 + 420));
    });
    timers.push(setTimeout(settle, 18 * 55 + 480));
  }

  function sync() {
    const on = running();
    dial.classList.toggle("is-paused", pause.hidden || pause.offscreen);  // the scan keeps turning after a manual step
    label.textContent = list.length ? `${name(list[k])} of ${list.length}` : "";
    prev.hidden = nextBtn.hidden = list.length < 2;
    clearTimeout(next);
    if (on) next = setTimeout(advance, HOLD_MS);
  }

  function go(step) {
    k = (k + step + list.length) % list.length;
    show(list[k], !reducedMotion());
    sync();
  }

  function advance() {
    if (running()) go(1);
  }

  const stepBy = (step) => () => {
    pause.user = true;
    go(step);
    announce(`${label.textContent}: ${outcomeText(list[k].result)}`);
  };
  prev.addEventListener("click", stepBy(-1));
  nextBtn.addEventListener("click", stepBy(1));
  const engage = (on) => { if (pause.engaged !== on) { pause.engaged = on; sync(); } };
  card.addEventListener("pointerenter", () => engage(true));
  card.addEventListener("pointerleave", () => engage(card.contains(document.activeElement)));
  card.addEventListener("focusin", () => engage(true));
  card.addEventListener("focusout", (e) => engage(card.contains(e.relatedTarget) || card.matches(":hover")));
  document.addEventListener("visibilitychange", () => { pause.hidden = document.hidden; sync(); });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { pause.offscreen = e.intersectionRatio < 0.35; sync(); }, { threshold: [0, 0.35, 1] }).observe(dial);
    // Only once the evaluator is well into view: on tall screens its top edge shows below the hero at first paint.
    new IntersectionObserver(([e]) => { pause.evaluator = e.intersectionRatio > 0.12; sync(); },
      { threshold: [0, 0.12, 0.5], rootMargin: "0px 0px -25% 0px" }).observe(evaluator);
  }

  return {
    setExamples(examples) {
      list = examples;
      if (!list.length) return;
      k = 0;
      show(list[0], running());
      sync();
    },
    hold(on) {
      if (pause.held === on) return;
      pause.held = on;
      sync();
    },
  };
}

// ---------- stage diagram cells ----------
export function buildFlowCells(root) {
  clear(root);
  for (const t of TAXONOMY) {  // coloured like the hero dial; the two detections are example 1's
    root.append(h("span", { class: t.index === 15 ? "is-major" : t.index === 5 ? "is-minor" : "" }));
  }
}

// ---------- ladder + calculator + curve ----------
const PLOT = { W: 440, H: 256, L: 44, R: 14, T: 24, B: 44, PMAX: 6 };

function buildCurve(root, lambda, alpha) {
  const { W, H, L, R, T, B, PMAX } = PLOT;
  const px = (p) => L + ((W - L - R) * Math.min(p, PMAX)) / PMAX;
  const py = (v) => T + (H - T - B) * (1 - v);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "plot", role: "img" });
  const grid = s("g", { class: "plot__grid", "aria-hidden": "true" });
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    grid.append(s("line", { x1: L, x2: W - R, y1: py(v), y2: py(v) }),
      s("text", { x: L - 8, y: py(v) + 4, "text-anchor": "end", text: v === 0 || v === 1 ? String(v) : v.toFixed(2) }));
  }
  for (let p = 0; p <= PMAX; p++) grid.append(s("text", { x: px(p), y: H - B + 18, "text-anchor": "middle", text: String(p) }));
  grid.append(s("text", { class: "plot__axis", x: (L + W - R) / 2, y: H - 6, "text-anchor": "middle", text: "penalty  λ · (N_major + α · N_minor)" }),
    s("text", { class: "plot__axis", x: L, y: T - 10, "text-anchor": "middle", text: "S" }));
  let d = "";
  for (let i = 0; i <= 120; i++) {
    const p = (PMAX * i) / 120;
    d += `${i ? "L" : "M"}${px(p).toFixed(1)} ${py(Math.exp(-p)).toFixed(1)}`;
  }
  const dots = s("g", { class: "plot__dots", "aria-hidden": "true" });
  for (let p = 0; p <= PMAX + 1e-9; p += lambda * alpha) dots.append(s("circle", { cx: px(p), cy: py(Math.exp(-p)), r: 2.6 }));
  const guideV = s("line", { class: "plot__guide" });
  const guideH = s("line", { class: "plot__guide" });
  const point = s("circle", { class: "plot__point", r: 6.5 });
  const label = s("text", { class: "plot__label" });
  svg.append(grid, s("path", { class: "plot__curve", d }), dots, guideV, guideH, point, label);
  root.append(svg);
  return (major, minor) => {
    const pen = lambda * (major + alpha * minor);
    const S = scoreOf(major, minor, lambda, alpha);
    const x = px(pen);
    const y = py(S);
    for (const [el, a] of [[guideV, { x1: x, x2: x, y1: y, y2: py(0) }], [guideH, { x1: L, x2: x, y1: y, y2: y }], [point, { cx: x, cy: y }]]) {
      for (const [k, v] of Object.entries(a)) el.setAttribute(k, v.toFixed(1));
    }
    label.setAttribute("x", String(Math.min(x + 12, W - R - 70)));
    label.setAttribute("y", String(Math.max(y - 12, T + 14)));
    label.textContent = pen > PMAX ? `${fmtScore(S)} (off the chart)` : fmtScore(S);
    svg.setAttribute("aria-label", `Curve of S = exp(−penalty). ${major} major and ${minor} minor give a penalty of ${fmtNum(pen)} and S = ${fmtScore(S)}.`);
  };
}

export function buildLadder(root, calc, { lambda = LAMBDA, alpha = ALPHA } = {}) {
  const rows = [
    { label: "No violations", pen: 0 },
    { label: "1 minor", pen: alpha },
    { label: "1 major · or 2 minor", pen: 1 },
    { label: "1 major + 1 minor", pen: 1 + alpha },
    { label: "2 major", pen: 2 },
    { label: "3 major", pen: 3 },
  ];
  clear(root);
  const lis = rows.map((r) => {
    const S = Math.exp(-lambda * r.pen);
    const bar = h("i", {});
    bar.style.width = `${(S * 100).toFixed(1)}%`;
    const li = h("li", { dataset: { pen: r.pen } },
      h("span", { class: "ladder__lbl", text: r.label }),
      h("span", { class: "ladder__bar", "aria-hidden": "true" }, bar),
      h("span", { class: "ladder__val", text: fmtScore(S) }));
    root.append(li);
    return li;
  });
  const drawCurve = buildCurve(calc.plot, lambda, alpha);

  const st = { major: 1, minor: 1 };
  const update = () => {
    calc.major.textContent = String(st.major);
    calc.minor.textContent = String(st.minor);
    const pen = st.major + alpha * st.minor;
    calc.expr.textContent = `exp(−${fmtNum(lambda)} · (${st.major} + ${fmtNum(alpha)} · ${st.minor}))`;
    calc.score.textContent = fmtScore(scoreOf(st.major, st.minor, lambda, alpha));
    for (const li of lis) li.classList.toggle("is-current", Math.abs(Number(li.dataset.pen) - pen) < 1e-9);
    for (const b of calc.buttons) {
      const next = st[b.dataset.calc] + Number(b.dataset.delta);
      b.disabled = next < 0 || (Number(b.dataset.delta) > 0 && st.major + st.minor >= 18);
    }
    drawCurve(st.major, st.minor);
  };
  for (const b of calc.buttons) {
    b.addEventListener("click", () => {
      const key = b.dataset.calc;
      st[key] = Math.max(0, Math.min(18, st[key] + Number(b.dataset.delta)));
      if (st.major + st.minor > 18) st[key] -= Number(b.dataset.delta);
      update();
    });
  }
  update();
}

// ---------- taxonomy explorer ----------
function highlight(text, q) {
  if (!q) return [text];
  const out = [];
  const lower = text.toLowerCase();
  let i = 0;
  for (;;) {
    const j = lower.indexOf(q, i);
    if (j < 0) break;
    if (j > i) out.push(text.slice(i, j));
    out.push(h("mark", { text: text.slice(j, j + q.length) }));
    i = j + q.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

export function buildTaxonomy({ list, filter, search, empty }) {
  let domain = "all";
  let query = "";
  const render = () => {
    clear(list);
    let shown = 0;
    for (const d of DOMAINS) {
      if (domain !== "all" && domain !== d.key) continue;
      const items = TAXONOMY.filter((t) => t.domain === d.key)
        .filter((t) => !query || t.definition.toLowerCase().includes(query) || t.violation_type.toLowerCase().includes(query));
      if (!items.length) continue;
      shown += items.length;
      const ol = h("ol", { class: "tax__list" });
      for (const t of items) {
        ol.append(h("li", { class: "tax__item" },
          h("span", { class: "tax__code", text: codeFor(t.index) }),
          h("h4", {}, highlight(t.violation_type, query)),
          h("p", {}, highlight(t.definition, query))));
      }
      const level = LEVELS[d.key] || {};
      list.append(h("section", { class: "tax__group", "aria-label": `${d.long} violations` },
        h("h3", {}, d.long, h("span", { class: "mono", text: `${items.length} of ${TAXONOMY.filter((t) => t.domain === d.key).length}` })),
        h("p", { class: "tax__standard", text: level.standard || "" }),
        level.stylized ? h("p", { class: "tax__stylized", text: level.stylized }) : null,
        ol));
    }
    empty.hidden = shown > 0;
  };
  for (const b of $$("button", filter)) {
    b.addEventListener("click", () => {
      domain = b.dataset.domain;
      for (const o of $$("button", filter)) o.setAttribute("aria-pressed", String(o === b));
      render();
    });
  }
  search.addEventListener("input", debounce(() => { query = search.value.trim().toLowerCase(); render(); }, 120));
  render();
}

export function buildNaList(root) {
  clear(root);
  for (const c of NA_CATEGORIES) root.append(h("li", {}, icon(c.icon, "icon na-list__icon"), h("b", { text: c.name }), h("span", { text: c.eg })));
}

// ---------- links ----------
export function buildLinks(cfg, { footer, navCode, issues }) {
  clear(footer);
  const links = [
    [cfg.paperUrl, "Paper", "paper"],
    [cfg.projectUrl, "Project page", "globe"],
  ];
  for (const [url, label, ic] of links) {
    if (!isHttpUrl(url)) continue;
    footer.append(h("li", {}, h("a", { href: url, rel: "noopener", target: "_blank" }, icon(ic), label, icon("external", "icon icon--ext"))));
  }
  if (isHttpUrl(cfg.codeUrl)) {
    navCode.href = cfg.codeUrl;
    navCode.target = "_blank";
    navCode.rel = "noopener";
    navCode.hidden = false;
    issues.querySelector("a").href = `${cfg.codeUrl.replace(/\/+$/, "")}/issues`;
    issues.hidden = false;
  }
}

function isHttpUrl(u) {
  if (typeof u !== "string" || !u.trim()) return false;
  try {
    const p = new URL(u, window.location.href);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
}

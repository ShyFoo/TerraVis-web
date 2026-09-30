// DOM + formatting helpers. Everything that touches untrusted text goes through
// textContent / createTextNode here — never innerHTML.
import { TAXONOMY } from "./taxonomy.js";

const SVGNS = "http://www.w3.org/2000/svg";

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** createElement with props: class, text, dataset, style (object), on<Event> (listener), attributes. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = String(v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function icon(name, cls = "icon") {
  const svg = s("svg", { class: cls, "aria-hidden": "true", focusable: "false" });
  svg.append(s("use", { href: `#i-${name}` }));
  return svg;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const reducedMotion = () =>
  !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

// ---------- taxonomy helpers ----------
export const DOMAINS = [
  { key: "object-level", label: "Object", long: "Object-level" },
  { key: "interaction-level", label: "Interaction", long: "Interaction-level" },
  { key: "scene-level", label: "Scene", long: "Scene-level" },
];
const DOMAIN_BY_KEY = Object.fromEntries(DOMAINS.map((d) => [d.key, d]));
export const domainInfo = (key) => DOMAIN_BY_KEY[key] || { key, label: key || "Other", long: key || "Other" };

/** Probe number as in the paper's taxonomy: index 0 → "01", 17 → "18". */
export const codeFor = (index) => (Number.isInteger(index) ? String(index + 1).padStart(2, "0") : "??");
export const taxonomyAt = (index) => TAXONOMY[index] || null;

export const NA_CATEGORIES = [
  { icon: "cat-abstract", name: "Abstract content", eg: "color blocks, geometric patterns, noise textures, abstract shapes or illustrations" },
  { icon: "cat-symbolic", name: "Symbolic content", eg: "logos, icons, emblems, flags, emojis, QR codes" },
  { icon: "cat-info", name: "Informational content", eg: "charts, diagrams, maps, tables, infographics, timelines, menus" },
  { icon: "cat-interface", name: "Interface content", eg: "UI mockups, app or website screenshots, software windows, game menus" },
  { icon: "cat-layout", name: "Layout-based compositions", eg: "posters, advertisements, book covers, storyboards, collages, multi-panel layouts" },
  { icon: "cat-micro", name: "Microscopic content", eg: "cell structures, material surfaces, mineral textures, crystal structures" },
];
export const NA_CLARIFIER = "A photo of a physical object that happens to carry text, a map or a menu is still eligible.";

// ---------- formatting ----------
export function fmtScore(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v > 0 && v < 0.0005 ? "<0.001" : v.toFixed(3);  // S = exp(−…) is never 0, so never print 0.000
}
export function fmtNum(v, digits = 1) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? v.toFixed(digits) : String(Math.round(v * 1000) / 1000);
}
export function fmtBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export function fmtClock(ms) {
  const t = Math.max(0, ms) / 1000;
  const m = Math.floor(t / 60);
  const sec = t - m * 60;
  return `${String(m).padStart(2, "0")}:${sec.toFixed(1).padStart(4, "0")}`;
}
export const plural = (n, word, pl = `${word}s`) => `${n} ${n === 1 ? word : pl}`;

/** Outcome described by counts only (no qualitative thresholds). */
export function outcomeText(result) {
  if (!result) return "";
  if (result.status === "not_applicable") return "Not applicable — no score";
  if (result.status === "undetermined") return "Undetermined — no score";
  const M = result.num_major | 0;
  const m = result.num_minor | 0;
  if (M + m === 0) return "No violations detected";
  const parts = [];
  if (M) parts.push(`${M} major`);
  if (m) parts.push(`${m} minor`);
  return `${parts.join(" · ")} ${M + m === 1 ? "violation" : "violations"}`;
}

export function scoreOf(nMajor, nMinor, lambda, alpha) {
  return Math.exp(-lambda * (nMajor + alpha * nMinor));
}

export function safeText(v, max = 2000) {
  if (v == null) return "";
  const str = typeof v === "string" ? v : String(v);
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

export function debounce(fn, ms) {
  let t = 0;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Small JPEG data URL from an <img> (same-origin/blob only). */
export function thumbnailFrom(img, maxSide = 240, quality = 0.72) {
  try {
    const w = img.naturalWidth, hgt = img.naturalHeight;
    if (!w || !hgt) return "";
    const k = Math.min(1, maxSide / Math.max(w, hgt));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(hgt * k));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  } catch {
    return "";
  }
}

/** An example's 320 px thumbnail (examples/thumbs/<file>); callers fall back to `ex.image` when it is missing. */
export const thumbUrl = (ex) => String(ex.image || "").replace(/^(.*\/)?([^/]+)$/, "$1thumbs/$2");

export function exampleThumb(ex, props = {}) {
  const img = h("img", { ...props, src: thumbUrl(ex), decoding: "async" });
  img.addEventListener("error", () => { if (img.getAttribute("src") !== ex.image) img.src = ex.image; }, { once: true });
  return img;
}

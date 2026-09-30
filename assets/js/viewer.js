// Image preview with wheel zoom (around the cursor), drag / touch pan, pinch, and keyboard control.
import { clamp } from "./util.js";

const MIN = 1;
const MAX = 8;

export class Viewer {
  constructor({ stage, img, tools, zoomIn, zoomOut, zoomReset, zoomLabel }) {
    Object.assign(this, { stage, img, tools, zoomLabel });
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.pointers = new Map();
    this.pinch = null;
    this.drag = null;

    zoomIn.addEventListener("click", () => this.zoomCenter(1.5));
    zoomOut.addEventListener("click", () => this.zoomCenter(1 / 1.5));
    zoomReset.addEventListener("click", () => this.reset());

    stage.addEventListener("wheel", (e) => {
      if (!this.img.src) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const factor = Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.01 : 0.0022));
      this.zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    stage.addEventListener("dblclick", (e) => {
      const r = stage.getBoundingClientRect();
      if (this.scale > 1) this.reset();
      else this.zoomAt(2.5, e.clientX - r.left, e.clientY - r.top);
    });

    stage.addEventListener("pointerdown", (e) => this.onDown(e));
    stage.addEventListener("pointermove", (e) => this.onMove(e));
    const up = (e) => this.onUp(e);
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("lostpointercapture", up);

    stage.addEventListener("keydown", (e) => {
      const step = 40;
      let handled = true;
      switch (e.key) {
        case "+": case "=": this.zoomCenter(1.25); break;
        case "-": case "_": this.zoomCenter(0.8); break;
        case "0": this.reset(); break;
        case "ArrowLeft": if (this.scale > 1) this.panBy(step, 0); else handled = false; break;
        case "ArrowRight": if (this.scale > 1) this.panBy(-step, 0); else handled = false; break;
        case "ArrowUp": if (this.scale > 1) this.panBy(0, step); else handled = false; break;
        case "ArrowDown": if (this.scale > 1) this.panBy(0, -step); else handled = false; break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    });

    window.addEventListener("resize", () => this.apply());
  }

  show(src, alt) {
    this.reset();
    this.img.alt = alt || "";
    this.stage.hidden = false;
    this.tools.hidden = false;
    return new Promise((resolve, reject) => {
      const done = () => { this.img.removeEventListener("load", done); this.img.removeEventListener("error", fail); resolve(this.img); };
      const fail = () => { this.img.removeEventListener("load", done); this.img.removeEventListener("error", fail); reject(new Error("decode")); };
      this.img.addEventListener("load", done);
      this.img.addEventListener("error", fail);
      this.img.src = src;
      if (this.img.complete && this.img.naturalWidth) done();
    });
  }

  clear() {
    this.reset();
    this.img.removeAttribute("src");
    this.img.alt = "";
    this.stage.hidden = true;
    this.tools.hidden = true;
  }

  size() {
    return { w: this.stage.clientWidth, h: this.stage.clientHeight };
  }

  zoomCenter(f) {
    const { w, h } = this.size();
    this.zoomAt(f, w / 2, h / 2);
  }

  zoomAt(factor, px, py) {
    const next = clamp(this.scale * factor, MIN, MAX);
    if (next === this.scale) return;
    const k = next / this.scale;
    this.tx = px - (px - this.tx) * k;
    this.ty = py - (py - this.ty) * k;
    this.scale = next;
    this.apply();
  }

  panBy(dx, dy) {
    this.tx += dx;
    this.ty += dy;
    this.apply();
  }

  reset() {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.apply();
  }

  apply() {
    const { w, h } = this.size();
    if (this.scale <= 1) { this.scale = 1; this.tx = 0; this.ty = 0; }
    this.tx = clamp(this.tx, w - w * this.scale, 0);
    this.ty = clamp(this.ty, h - h * this.scale, 0);
    this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.stage.classList.toggle("is-zoomed", this.scale > 1);
    if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
  }

  onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      this.drag = null;
    } else if (this.scale > 1) {
      this.drag = { x: e.clientX, y: e.clientY };
      this.stage.classList.add("is-dragging");
    }
    if (this.scale > 1 || this.pointers.size === 2) {
      try { this.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const r = this.stage.getBoundingClientRect();
      this.zoomAt(d / this.pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      this.pinch.d = d;
      e.preventDefault();
    } else if (this.drag) {
      this.panBy(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.drag = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      this.drag = null;
      this.stage.classList.remove("is-dragging");
    }
  }
}

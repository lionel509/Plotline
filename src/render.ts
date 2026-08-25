/** Canvas rendering: grid, axes, and every curve kind the model can hold. */

import { Scope, setAngleMode } from "./expr";
import { Poi } from "./poi";
import { Bounds, Curve, linearFit, Model, Style } from "./spec";

export class Viewport implements Bounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  width = 100;
  height = 100;

  constructor(b: Bounds) {
    this.xmin = b.xmin;
    this.xmax = b.xmax;
    this.ymin = b.ymin;
    this.ymax = b.ymax;
  }

  clone(): Viewport {
    const v = new Viewport(this);
    v.width = this.width;
    v.height = this.height;
    return v;
  }

  set(b: Bounds): void {
    this.xmin = b.xmin;
    this.xmax = b.xmax;
    this.ymin = b.ymin;
    this.ymax = b.ymax;
  }

  get spanX(): number {
    return this.xmax - this.xmin;
  }

  get spanY(): number {
    return this.ymax - this.ymin;
  }

  /** world -> screen */
  sx(x: number): number {
    return ((x - this.xmin) / this.spanX) * this.width;
  }

  sy(y: number): number {
    return this.height - ((y - this.ymin) / this.spanY) * this.height;
  }

  /** screen -> world */
  ix(px: number): number {
    return this.xmin + (px / this.width) * this.spanX;
  }

  iy(py: number): number {
    return this.ymin + ((this.height - py) / this.height) * this.spanY;
  }

  panPixels(dx: number, dy: number): void {
    const wx = (dx / this.width) * this.spanX;
    const wy = (dy / this.height) * this.spanY;
    this.xmin -= wx;
    this.xmax -= wx;
    this.ymin += wy;
    this.ymax += wy;
  }

  zoomAt(px: number, py: number, factor: number, axis: "both" | "x" | "y" = "both"): void {
    const cx = this.ix(px);
    const cy = this.iy(py);
    if (axis !== "y") {
      this.xmin = cx + (this.xmin - cx) * factor;
      this.xmax = cx + (this.xmax - cx) * factor;
    }
    if (axis !== "x") {
      this.ymin = cy + (this.ymin - cy) * factor;
      this.ymax = cy + (this.ymax - cy) * factor;
    }
  }

  /** Make one x unit the same length as one y unit, keeping the centre. */
  equalize(): void {
    if (this.width <= 0 || this.height <= 0) return;
    const targetSpanY = (this.spanX * this.height) / this.width;
    const cy = (this.ymin + this.ymax) / 2;
    this.ymin = cy - targetSpanY / 2;
    this.ymax = cy + targetSpanY / 2;
  }
}

export interface Theme {
  text: string;
  muted: string;
  axis: string;
  grid: string;
  gridMinor: string;
  background: string;
  isDark: boolean;
}

export function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const pick = (name: string, fallback: string): string => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  const isDark = document.body.classList.contains("theme-dark");
  return {
    text: pick("--text-normal", isDark ? "#dadada" : "#222222"),
    muted: pick("--text-muted", isDark ? "#9a9a9a" : "#666666"),
    axis: isDark ? "rgba(220,220,220,0.75)" : "rgba(40,40,40,0.75)",
    grid: isDark ? "rgba(190,190,200,0.20)" : "rgba(60,60,80,0.18)",
    gridMinor: isDark ? "rgba(190,190,200,0.09)" : "rgba(60,60,80,0.07)",
    background: pick("--background-primary", isDark ? "#1e1e1e" : "#ffffff"),
    isDark,
  };
}

/** Sampled screen-space polylines, kept so the trace readout can hit-test. */
export interface TraceSet {
  style: Style;
  points: { x: number; y: number; px: number; py: number }[];
  kind: Curve["type"];
  line: number;
}

export interface DrawResult {
  traces: TraceSet[];
  /** One line of derived output per curve that produces some, e.g. a fit. */
  notes: { text: string; color: string }[];
}

/** 1, 2, 5, 10, 20 ... — the step that puts roughly `target` lines on an axis. */
function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return step * mag;
}

const PI_FRACTIONS: [number, string][] = [
  [1, "π"], [1 / 2, "π/2"], [1 / 3, "π/3"], [1 / 4, "π/4"], [1 / 6, "π/6"],
];

/** Axis labels: π-multiples when the step is one, plain decimals otherwise. */
function formatTick(value: number, step: number): string {
  for (const [frac, label] of PI_FRACTIONS) {
    if (Math.abs(step - Math.PI * frac) < 1e-9) {
      const k = Math.round(value / (Math.PI * frac));
      if (k === 0) return "0";
      const sign = k < 0 ? "-" : "";
      const n = Math.abs(k);
      if (label === "π") return `${sign}${n === 1 ? "" : n}π`;
      const [, den] = label.split("/");
      const g = gcd(n, Number(den));
      const num = n / g;
      const d = Number(den) / g;
      const head = `${sign}${num === 1 ? "" : num}π`;
      return d === 1 ? head : `${head}/${d}`;
    }
  }
  if (Math.abs(value) < step / 1000) return "0";
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)) + 1));
  const abs = Math.abs(value);
  if (abs >= 1e6 || (abs > 0 && abs < 1e-4)) return value.toExponential(2).replace("e+", "e");
  return Number(value.toFixed(decimals)).toString();
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function formatNumber(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? "undefined" : value > 0 ? "∞" : "-∞";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return value.toExponential(3).replace("e+", "e");
  return Number(value.toFixed(decimals)).toString();
}

/** Resolve the "black" palette slot against the current theme. */
function strokeColor(style: Style, theme: Theme): string {
  if (style.color === "#000000" && theme.isDark) return theme.text;
  return style.color;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
  }

  /** Size the backing store to the element box and the device pixel ratio. */
  resize(vp: Viewport, cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vp.width = cssWidth;
    vp.height = cssHeight;
  }

  draw(model: Model, vp: Viewport, theme: Theme, quality = 1): DrawResult {
    setAngleMode(model.options.degrees);
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, vp.width, vp.height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, vp.width, vp.height);

    if (model.options.grid) this.drawGrid(vp, theme, model.options.minorGrid);
    if (model.options.axes) this.drawAxes(vp, theme, model.options.labels);

    const traces: TraceSet[] = [];
    const notes: DrawResult["notes"] = [];

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, vp.width, vp.height);
    ctx.clip();

    // Shading first, so curves stay readable on top of it.
    for (const curve of model.curves) {
      if (curve.type === "inequality") this.drawInequality(curve, model.scope, vp, theme, quality);
    }
    for (const curve of model.curves) {
      switch (curve.type) {
        case "explicit":
          traces.push(this.drawExplicit(curve, model.scope, vp, theme));
          break;
        case "vertical":
          this.drawVertical(curve, model.scope, vp, theme);
          break;
        case "parametric":
          traces.push(this.drawParametric(curve, model.scope, vp, theme));
          break;
        case "polar":
          traces.push(this.drawPolar(curve, model.scope, vp, theme));
          break;
        case "implicit":
          this.drawImplicit(curve.f, curve.style, model.scope, vp, theme, quality, false);
          break;
        case "points": {
          const t = this.drawPoints(curve, vp, theme);
          traces.push(t);
          if (curve.fit === "linear") {
            const fit = linearFit(curve.pts);
            if (fit) {
              this.drawFitLine(fit, curve.style, vp, theme);
              notes.push({
                text: `fit: y = ${formatNumber(fit.m)}x ${fit.b < 0 ? "−" : "+"} ${formatNumber(
                  Math.abs(fit.b),
                )}   (R² = ${formatNumber(fit.r2, 4)}, n = ${curve.pts.length})`,
                color: strokeColor(curve.style, theme),
              });
            }
          }
          break;
        }
      }
    }
    ctx.restore();
    ctx.restore();
    return { traces, notes };
  }

  /** Hollow rings on the solved points: intersections, zeros, turning points. */
  drawMarkers(pois: Poi[], vp: Viewport, theme: Theme, active: Poi | null): void {
    const ctx = this.ctx;
    ctx.save();
    for (const poi of pois) {
      const px = vp.sx(poi.x);
      const py = vp.sy(poi.y);
      if (px < -12 || px > vp.width + 12 || py < -12 || py > vp.height + 12) continue;
      const isActive = poi === active;
      const color = poi.color === "#000000" && theme.isDark ? theme.text : poi.color;
      ctx.globalAlpha = isActive ? 1 : 0.6;
      ctx.beginPath();
      ctx.arc(px, py, isActive ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = theme.background;
      ctx.fill();
      ctx.lineWidth = isActive ? 2.6 : 1.8;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGrid(vp: Viewport, theme: Theme, minor: boolean): void {
    const ctx = this.ctx;
    const stepX = niceStep(vp.spanX, Math.max(4, vp.width / 90));
    const stepY = niceStep(vp.spanY, Math.max(3, vp.height / 70));

    if (minor) {
      ctx.strokeStyle = theme.gridMinor;
      ctx.lineWidth = 1;
      this.gridLines(vp, stepX / 5, stepY / 5);
    }
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    this.gridLines(vp, stepX, stepY);
  }

  private gridLines(vp: Viewport, stepX: number, stepY: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    const startX = Math.ceil(vp.xmin / stepX) * stepX;
    for (let x = startX; x <= vp.xmax; x += stepX) {
      const px = Math.round(vp.sx(x)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, vp.height);
    }
    const startY = Math.ceil(vp.ymin / stepY) * stepY;
    for (let y = startY; y <= vp.ymax; y += stepY) {
      const py = Math.round(vp.sy(y)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(vp.width, py);
    }
    ctx.stroke();
  }

  private drawAxes(vp: Viewport, theme: Theme, labels: boolean): void {
    const ctx = this.ctx;
    const stepX = niceStep(vp.spanX, Math.max(4, vp.width / 90));
    const stepY = niceStep(vp.spanY, Math.max(3, vp.height / 70));
    const x0 = Math.min(vp.width - 1, Math.max(1, vp.sx(0)));
    const y0 = Math.min(vp.height - 1, Math.max(1, vp.sy(0)));

    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y0) + 0.5);
    ctx.lineTo(vp.width, Math.round(y0) + 0.5);
    ctx.moveTo(Math.round(x0) + 0.5, 0);
    ctx.lineTo(Math.round(x0) + 0.5, vp.height);
    ctx.stroke();

    if (!labels) return;
    ctx.fillStyle = theme.muted;
    ctx.font = "11px var(--font-interface, sans-serif)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const labelY = Math.min(vp.height - 14, y0 + 4);
    for (let x = Math.ceil(vp.xmin / stepX) * stepX; x <= vp.xmax; x += stepX) {
      if (Math.abs(x) < stepX / 1000) continue;
      ctx.fillText(formatTick(x, stepX), vp.sx(x), labelY);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const labelX = Math.max(24, x0 - 5);
    for (let y = Math.ceil(vp.ymin / stepY) * stepY; y <= vp.ymax; y += stepY) {
      if (Math.abs(y) < stepY / 1000) continue;
      ctx.fillText(formatTick(y, stepY), labelX, vp.sy(y));
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("0", Math.max(10, x0 - 4), Math.min(vp.height - 14, y0 + 4));
  }

  private applyStroke(style: Style, theme: Theme): void {
    const ctx = this.ctx;
    ctx.strokeStyle = strokeColor(style, theme);
    ctx.lineWidth = style.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(style.dashed ? [7, 5] : []);
  }

  /** Walk a polyline, cutting it wherever the function blows up.
   *  `across` says which screen axis the value lives on, so the pole test
   *  measures the jump in the dependent coordinate. */
  private strokePolyline(
    pts: { px: number; py: number; ok: boolean }[],
    vp: Viewport,
    across: "y" | "x" = "y",
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    let drawing = false;
    let prev: { px: number; py: number } | null = null;
    const jumpLimit = (across === "y" ? vp.height : vp.width) * 4;
    for (const p of pts) {
      if (!p.ok) {
        drawing = false;
        prev = null;
        continue;
      }
      if (prev && (across === "y" ? Math.abs(p.py - prev.py) : Math.abs(p.px - prev.px)) > jumpLimit) {
        // A pole: the two sides belong to different branches.
        drawing = false;
        prev = null;
      }
      if (!drawing) {
        ctx.moveTo(p.px, p.py);
        drawing = true;
      } else {
        ctx.lineTo(p.px, p.py);
      }
      prev = p;
    }
    ctx.stroke();
  }

  private drawExplicit(
    curve: Extract<Curve, { type: "explicit" }>,
    base: Scope,
    vp: Viewport,
    theme: Theme,
  ): TraceSet {
    const scope: Scope = Object.assign(Object.create(null), base);
    const along = curve.of === "y" ? vp.width : vp.height;
    const steps = Math.max(2, Math.round(along * 2));
    const pts: { px: number; py: number; ok: boolean }[] = [];
    const trace: TraceSet["points"] = [];
    for (let i = 0; i <= steps; i++) {
      const screen = (i / steps) * along;
      if (curve.of === "y") {
        const x = vp.ix(screen);
        scope.x = x;
        const y = curve.f(scope);
        const ok = Number.isFinite(y);
        const py = ok ? clampPixel(vp.sy(y)) : 0;
        pts.push({ px: screen, py, ok });
        if (ok) trace.push({ x, y, px: screen, py });
      } else {
        const y = vp.iy(screen);
        scope.y = y;
        const x = curve.f(scope);
        const ok = Number.isFinite(x);
        const px = ok ? clampPixel(vp.sx(x)) : 0;
        pts.push({ px, py: screen, ok });
        if (ok) trace.push({ x, y, px, py: screen });
      }
    }
    this.applyStroke(curve.style, theme);
    this.strokePolyline(pts, vp, curve.of === "y" ? "y" : "x");
    this.ctx.setLineDash([]);
    return { style: curve.style, points: trace, kind: "explicit", line: curve.line };
  }

  private drawVertical(
    curve: Extract<Curve, { type: "vertical" }>,
    base: Scope,
    vp: Viewport,
    theme: Theme,
  ): void {
    const x = curve.at(base);
    if (!Number.isFinite(x)) return;
    this.applyStroke(curve.style, theme);
    const px = vp.sx(x);
    this.ctx.beginPath();
    this.ctx.moveTo(px, 0);
    this.ctx.lineTo(px, vp.height);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  private drawParametric(
    curve: Extract<Curve, { type: "parametric" }>,
    base: Scope,
    vp: Viewport,
    theme: Theme,
  ): TraceSet {
    const scope: Scope = Object.assign(Object.create(null), base);
    const steps = 2000;
    const pts: { px: number; py: number; ok: boolean }[] = [];
    const trace: TraceSet["points"] = [];
    for (let i = 0; i <= steps; i++) {
      const t = curve.tmin + ((curve.tmax - curve.tmin) * i) / steps;
      scope.t = t;
      const x = curve.fx(scope);
      const y = curve.fy(scope);
      const ok = Number.isFinite(x) && Number.isFinite(y);
      const px = ok ? clampPixel(vp.sx(x)) : 0;
      const py = ok ? clampPixel(vp.sy(y)) : 0;
      pts.push({ px, py, ok });
      if (ok) trace.push({ x, y, px, py });
    }
    this.applyStroke(curve.style, theme);
    this.ctx.beginPath();
    let drawing = false;
    for (const p of pts) {
      if (!p.ok) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        this.ctx.moveTo(p.px, p.py);
        drawing = true;
      } else {
        this.ctx.lineTo(p.px, p.py);
      }
    }
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    return { style: curve.style, points: trace, kind: "parametric", line: curve.line };
  }

  private drawPolar(
    curve: Extract<Curve, { type: "polar" }>,
    base: Scope,
    vp: Viewport,
    theme: Theme,
  ): TraceSet {
    const scope: Scope = Object.assign(Object.create(null), base);
    const steps = 2000;
    const pts: { px: number; py: number; ok: boolean }[] = [];
    const trace: TraceSet["points"] = [];
    for (let i = 0; i <= steps; i++) {
      const th = curve.tmin + ((curve.tmax - curve.tmin) * i) / steps;
      scope.theta = th;
      scope.t = th;
      const r = curve.f(scope);
      const ok = Number.isFinite(r);
      const x = r * Math.cos(th);
      const y = r * Math.sin(th);
      const px = ok ? clampPixel(vp.sx(x)) : 0;
      const py = ok ? clampPixel(vp.sy(y)) : 0;
      pts.push({ px, py, ok });
      if (ok) trace.push({ x, y, px, py });
    }
    this.applyStroke(curve.style, theme);
    this.ctx.beginPath();
    let drawing = false;
    for (const p of pts) {
      if (!p.ok) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        this.ctx.moveTo(p.px, p.py);
        drawing = true;
      } else {
        this.ctx.lineTo(p.px, p.py);
      }
    }
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    return { style: curve.style, points: trace, kind: "polar", line: curve.line };
  }

  private drawPoints(
    curve: Extract<Curve, { type: "points" }>,
    vp: Viewport,
    theme: Theme,
  ): TraceSet {
    const ctx = this.ctx;
    const color = strokeColor(curve.style, theme);
    const trace: TraceSet["points"] = [];
    ctx.fillStyle = color;
    ctx.strokeStyle = theme.background;
    ctx.lineWidth = 1.5;
    for (const [x, y] of curve.pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const px = vp.sx(x);
      const py = vp.sy(y);
      trace.push({ x, y, px, py });
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    return { style: curve.style, points: trace, kind: "points", line: curve.line };
  }

  private drawFitLine(
    fit: { m: number; b: number },
    style: Style,
    vp: Viewport,
    theme: Theme,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = strokeColor(style, theme);
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(vp.sx(vp.xmin), clampPixel(vp.sy(fit.m * vp.xmin + fit.b)));
    ctx.lineTo(vp.sx(vp.xmax), clampPixel(vp.sy(fit.m * vp.xmax + fit.b)));
    ctx.stroke();
    ctx.restore();
  }

  /** Marching squares over f(x, y) = 0. */
  private drawImplicit(
    f: (s: Scope) => number,
    style: Style,
    base: Scope,
    vp: Viewport,
    theme: Theme,
    quality: number,
    dashed: boolean,
  ): void {
    const scope: Scope = Object.assign(Object.create(null), base);
    const cols = Math.max(40, Math.round(Math.min(260, vp.width / 3.5) * quality));
    const rows = Math.max(30, Math.round(cols * (vp.height / Math.max(1, vp.width))));
    const values = new Float64Array((cols + 1) * (rows + 1));
    for (let j = 0; j <= rows; j++) {
      scope.y = vp.ymin + (vp.spanY * (rows - j)) / rows;
      for (let i = 0; i <= cols; i++) {
        scope.x = vp.xmin + (vp.spanX * i) / cols;
        values[j * (cols + 1) + i] = f(scope);
      }
    }
    const cw = vp.width / cols;
    const ch = vp.height / rows;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = strokeColor(style, theme);
    ctx.lineWidth = style.width;
    ctx.setLineDash(dashed || style.dashed ? [6, 4] : []);
    ctx.beginPath();
    const at = (i: number, j: number): number => values[j * (cols + 1) + i];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const tl = at(i, j);
        const tr = at(i + 1, j);
        const br = at(i + 1, j + 1);
        const bl = at(i, j + 1);
        if (!Number.isFinite(tl) || !Number.isFinite(tr) || !Number.isFinite(br) || !Number.isFinite(bl)) continue;
        const idx = (tl > 0 ? 8 : 0) | (tr > 0 ? 4 : 0) | (br > 0 ? 2 : 0) | (bl > 0 ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x0 = i * cw;
        const y0 = j * ch;
        const top = { x: x0 + cw * lerpT(tl, tr), y: y0 };
        const right = { x: x0 + cw, y: y0 + ch * lerpT(tr, br) };
        const bottom = { x: x0 + cw * lerpT(bl, br), y: y0 + ch };
        const left = { x: x0, y: y0 + ch * lerpT(tl, bl) };
        const seg = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        };
        switch (idx) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 10: seg(left, bottom); seg(top, right); break;
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawInequality(
    curve: Extract<Curve, { type: "inequality" }>,
    base: Scope,
    vp: Viewport,
    theme: Theme,
    quality: number,
  ): void {
    const scope: Scope = Object.assign(Object.create(null), base);
    const block = quality < 1 ? 10 : 5;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = strokeColor(curve.style, theme);
    for (let py = 0; py < vp.height; py += block) {
      scope.y = vp.iy(py + block / 2);
      for (let px = 0; px < vp.width; px += block) {
        scope.x = vp.ix(px + block / 2);
        if (curve.test(scope) !== 0) ctx.fillRect(px, py, block, block);
      }
    }
    ctx.restore();
    this.drawImplicit(curve.boundary, curve.style, base, vp, theme, quality, curve.strict);
  }
}

function lerpT(a: number, b: number): number {
  const d = a - b;
  if (Math.abs(d) < 1e-30) return 0.5;
  const t = a / d;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Canvas paths misbehave with absurd coordinates; keep them near the box. */
function clampPixel(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v > 1e6 ? 1e6 : v < -1e6 ? -1e6 : v;
}

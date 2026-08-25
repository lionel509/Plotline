/** Points of interest: intersections, zeros, turning points, intercepts.
 *
 *  All of it is numeric — sample the visible window, find a sign change, then
 *  bisect. That means a root is only found if the curve actually crosses inside
 *  the window, which is the honest behaviour: a graphing calculator reports
 *  what is on screen, and zooming out is how you ask for more.
 */

import { Scope } from "./expr";
import { Viewport } from "./render";
import { Curve, Model } from "./spec";

export type PoiKind = "intersection" | "zero" | "maximum" | "minimum" | "intercept";

export interface Poi {
  x: number;
  y: number;
  kind: PoiKind;
  color: string;
  /** Which curve(s) it belongs to, for the list under the graph. */
  from: string;
}

/** Total markers we are willing to put on screen. sin(x) zoomed far out would
 *  otherwise produce thousands, and a screen full of dots says nothing. */
const MAX_POINTS = 60;
const SAMPLES = 1200;

export const POI_LABEL: Record<PoiKind, string> = {
  intersection: "intersection",
  zero: "zero",
  maximum: "maximum",
  minimum: "minimum",
  intercept: "y-intercept",
};

interface Fn {
  eval: (x: number) => number;
  color: string;
  label: string;
}

function explicitFns(model: Model): Fn[] {
  const out: Fn[] = [];
  for (const curve of model.curves) {
    if (curve.type !== "explicit" || curve.of !== "y") continue;
    const scope: Scope = Object.assign(Object.create(null), model.scope);
    const f = curve.f;
    out.push({
      eval: (x: number) => {
        scope.x = x;
        return f(scope);
      },
      color: curve.style.color,
      label: curve.style.label || "f(x)",
    });
  }
  return out;
}

/** Bisect a sign change. Returns null when it lands on a pole instead of a root. */
function bisect(f: (x: number) => number, a: number, b: number, scale: number): number | null {
  let fa = f(a);
  let fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa === 0) {
    return fa === 0 ? a : null;
  }
  if (fa * fb > 0) return null;
  for (let i = 0; i < 80 && b - a > Math.abs(a + b) * 1e-15 + 1e-15; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return null;
    if (fm === 0) return mid;
    if (fa * fm < 0) {
      b = mid;
      fb = fm;
    } else {
      a = mid;
      fa = fm;
    }
  }
  const root = (a + b) / 2;
  const value = f(root);
  // A pole flips sign too, but the function is enormous there rather than zero.
  if (!Number.isFinite(value) || Math.abs(value) > scale * 1e-4) return null;
  return root;
}

/** Golden-section refine of a bracketed turning point. */
function refineExtremum(
  f: (x: number) => number,
  a: number,
  b: number,
  wantMax: boolean,
): { x: number; y: number } | null {
  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = a;
  let hi = b;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 90 && hi - lo > Math.abs(lo + hi) * 1e-14 + 1e-14; i++) {
    const better = wantMax ? fc > fd : fc < fd;
    if (better) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - phi * (hi - lo);
      fc = f(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + phi * (hi - lo);
      fd = f(d);
    }
  }
  const x = (lo + hi) / 2;
  const y = f(x);
  return Number.isFinite(y) ? { x, y } : null;
}

/** Drop duplicates that would land on the same pixel. */
function dedupe(points: Poi[], vp: Viewport): Poi[] {
  const seen = new Set<string>();
  const out: Poi[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.y < vp.ymin || p.y > vp.ymax) continue;
    const key = `${p.kind}:${Math.round(vp.sx(p.x) * 0.5)}:${Math.round(vp.sy(p.y) * 0.5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function findPointsOfInterest(model: Model, vp: Viewport): Poi[] {
  const fns = explicitFns(model);
  const verticals: { x: number; color: string }[] = [];
  for (const curve of model.curves as Curve[]) {
    if (curve.type !== "vertical") continue;
    const x = curve.at(model.scope);
    if (Number.isFinite(x)) verticals.push({ x, color: curve.style.color });
  }
  if (fns.length === 0) return [];

  const step = vp.spanX / SAMPLES;
  const xs: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) xs.push(vp.xmin + step * i);
  const values = fns.map((fn) => xs.map((x) => fn.eval(x)));

  // Scale of the picture, used to tell a root from a pole.
  const scale = Math.max(vp.spanY, 1);
  const found: Poi[] = [];

  // --- zeros and turning points, per function -------------------------
  fns.forEach((fn, i) => {
    const ys = values[i];
    for (let k = 0; k < SAMPLES; k++) {
      const y0 = ys[k];
      const y1 = ys[k + 1];
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
      if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0) || y0 === 0) {
        const root = bisect(fn.eval, xs[k], xs[k + 1], scale);
        if (root !== null) found.push({ x: root, y: 0, kind: "zero", color: fn.color, from: fn.label });
      }
    }
    // A turning point sits where the slope changes sign.
    for (let k = 1; k < SAMPLES; k++) {
      const prev = ys[k - 1];
      const cur = ys[k];
      const next = ys[k + 1];
      if (!Number.isFinite(prev) || !Number.isFinite(cur) || !Number.isFinite(next)) continue;
      const rising = cur - prev;
      const falling = next - cur;
      if (rising === 0 && falling === 0) continue;
      if (rising > 0 && falling < 0) {
        const peak = refineExtremum(fn.eval, xs[k - 1], xs[k + 1], true);
        if (peak) found.push({ ...peak, kind: "maximum", color: fn.color, from: fn.label });
      } else if (rising < 0 && falling > 0) {
        const dip = refineExtremum(fn.eval, xs[k - 1], xs[k + 1], false);
        if (dip) found.push({ ...dip, kind: "minimum", color: fn.color, from: fn.label });
      }
    }
    // y-intercept, when the axis is on screen.
    if (vp.xmin <= 0 && vp.xmax >= 0) {
      const y = fn.eval(0);
      if (Number.isFinite(y)) found.push({ x: 0, y, kind: "intercept", color: fn.color, from: fn.label });
    }
  });

  // --- intersections, every pair --------------------------------------
  for (let i = 0; i < fns.length; i++) {
    for (let j = i + 1; j < fns.length; j++) {
      const diff = (x: number): number => fns[i].eval(x) - fns[j].eval(x);
      const a = values[i];
      const b = values[j];
      for (let k = 0; k < SAMPLES; k++) {
        const d0 = a[k] - b[k];
        const d1 = a[k + 1] - b[k + 1];
        if (!Number.isFinite(d0) || !Number.isFinite(d1)) continue;
        if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0) || d0 === 0) {
          const x = bisect(diff, xs[k], xs[k + 1], scale);
          if (x === null) continue;
          const y = fns[i].eval(x);
          if (!Number.isFinite(y)) continue;
          found.push({
            x,
            y,
            kind: "intersection",
            color: fns[i].color,
            from: `${fns[i].label} ∩ ${fns[j].label}`,
          });
        }
      }
    }
  }

  // --- where a vertical line meets a curve ----------------------------
  for (const line of verticals) {
    if (line.x < vp.xmin || line.x > vp.xmax) continue;
    for (const fn of fns) {
      const y = fn.eval(line.x);
      if (!Number.isFinite(y)) continue;
      found.push({
        x: line.x,
        y,
        kind: "intersection",
        color: line.color,
        from: `x = ${line.x} ∩ ${fn.label}`,
      });
    }
  }

  // Intersections first: they are what someone is usually looking for.
  const order: Record<PoiKind, number> = {
    intersection: 0,
    zero: 1,
    maximum: 2,
    minimum: 2,
    intercept: 3,
  };
  const deduped = dedupe(found, vp).sort((p, q) => order[p.kind] - order[q.kind] || p.x - q.x);
  return deduped.slice(0, MAX_POINTS);
}

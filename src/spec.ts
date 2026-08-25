/** Turns the lines of a plot block into something the renderer can draw.
 *
 *  One line = one statement. A statement is a setting, a parameter (which
 *  becomes a slider), a function definition, or something to draw.
 */

import {
  compile,
  constantValue,
  Env,
  ExprError,
  isBuiltinFunction,
  isConstant,
  Node,
  parse,
  parseRelation,
  ParseContext,
  Scope,
  Compiled,
  UserFunc,
} from "./expr";

export const PALETTE = [
  "#2d70b3", // blue
  "#c74440", // red
  "#388c46", // green
  "#6042a6", // purple
  "#fa7e19", // orange
  "#000000", // black -> remapped to the text colour in dark mode
];

export interface Bounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export interface Options extends Bounds {
  grid: boolean;
  minorGrid: boolean;
  axes: boolean;
  labels: boolean;
  height: number;
  /** Sample count for the data table. */
  tableRows: number;
  showTable: boolean;
  degrees: boolean;
  equalAspect: boolean;
  title: string;
  tmin: number;
  tmax: number;
  thetaMin: number;
  thetaMax: number;
}

export const DEFAULT_OPTIONS: Options = {
  xmin: -10,
  xmax: 10,
  ymin: -6.5,
  ymax: 6.5,
  grid: true,
  minorGrid: true,
  axes: true,
  labels: true,
  height: 380,
  tableRows: 11,
  showTable: false,
  degrees: false,
  equalAspect: false,
  title: "",
  tmin: 0,
  tmax: Math.PI * 2,
  thetaMin: 0,
  thetaMax: Math.PI * 2,
};

export interface Param {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Line index in the source, so a slider drag can rewrite its own line. */
  line: number;
}

export interface Style {
  color: string;
  width: number;
  dashed: boolean;
  label: string;
  fill: boolean;
  /** Only meaningful on a point set: draw a least-squares line through it. */
  fit: "linear" | null;
}

export type Curve =
  | { type: "explicit"; of: "x" | "y"; f: Compiled; style: Style; line: number }
  | { type: "vertical"; at: Compiled; style: Style; line: number }
  | { type: "parametric"; fx: Compiled; fy: Compiled; tmin: number; tmax: number; style: Style; line: number }
  | { type: "polar"; f: Compiled; tmin: number; tmax: number; style: Style; line: number }
  | { type: "implicit"; f: Compiled; style: Style; line: number }
  | { type: "inequality"; test: Compiled; boundary: Compiled; strict: boolean; style: Style; line: number }
  | {
      type: "points";
      pts: [number, number][];
      fit: "linear" | null;
      style: Style;
      line: number;
    };

export interface Model {
  options: Options;
  params: Param[];
  curves: Curve[];
  /** Errors keyed by source line index. */
  errors: Map<number, string>;
  env: Env;
  /** Parameter values, ready to be used as the base scope. */
  scope: Scope;
}

const SETTING_KEYS = new Set([
  "xmin", "xmax", "ymin", "ymax", "x", "y", "t", "theta", "grid", "minor", "axes",
  "labels", "height", "table", "degrees", "aspect", "title", "bounds",
  // Read before the model is built, by whoever is hosting the widget.
  "editable", "controls",
]);

const COLOR_NAMES: Record<string, string> = {
  blue: "#2d70b3",
  red: "#c74440",
  green: "#388c46",
  purple: "#6042a6",
  orange: "#fa7e19",
  black: "#000000",
  grey: "#7b7b7b",
  gray: "#7b7b7b",
  teal: "#0f9b8e",
  pink: "#d43b8c",
  yellow: "#e5a50a",
  accent: "var(--interactive-accent)",
};

/** Split on commas that sit at bracket depth zero. */
function splitTop(src: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of src) {
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Find an "=" that is a top-level assignment, not part of <=, >= or !=. */
function topLevelEquals(src: string): number {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "=" && depth === 0) {
      if (src[i - 1] === "<" || src[i - 1] === ">" || src[i - 1] === "!" || src[i - 1] === "=") continue;
      if (src[i + 1] === "=") continue;
      return i;
    }
  }
  return -1;
}

function topLevelCompare(src: string): { op: string; at: number } | null {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (depth === 0 && (c === "<" || c === ">")) {
      return { op: src[i + 1] === "=" ? c + "=" : c, at: i };
    }
  }
  return null;
}

function collectVars(node: Node, into: Set<string>): void {
  switch (node.kind) {
    case "var":
      if (!isConstant(node.name)) into.add(node.name);
      break;
    case "neg":
    case "fact":
      collectVars(node.arg, into);
      break;
    case "bin":
    case "cmp":
      collectVars(node.left, into);
      collectVars(node.right, into);
      break;
    case "call":
      node.args.forEach((a) => collectVars(a, into));
      break;
    case "piecewise":
      node.branches.forEach((b) => {
        if (b.cond) collectVars(b.cond, into);
        collectVars(b.value, into);
      });
      break;
  }
}

function parseNumber(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (t === "pi") return Math.PI;
  if (t === "-pi") return -Math.PI;
  if (t === "2pi" || t === "tau") return Math.PI * 2;
  if (t === "-2pi") return -Math.PI * 2;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseBool(text: string): boolean {
  const t = text.trim().toLowerCase();
  return !(t === "false" || t === "off" || t === "no" || t === "0");
}

/** "-10..10" or "-10, 10" or "-10 to 10" */
function parseRange(text: string): [number, number] | null {
  const parts = text.split(/\.\.|,| to /).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const a = parseNumber(parts[0]);
  const b = parseNumber(parts[1]);
  return a === null || b === null ? null : [a, b];
}

function defaultStyle(index: number): Style {
  return {
    color: PALETTE[index % PALETTE.length],
    width: 2.2,
    dashed: false,
    label: "",
    fill: true,
    fit: null,
  };
}

/** Trailing "| color: red, dashed, label: foo" modifiers. */
function extractStyle(src: string, style: Style): string {
  const bar = src.lastIndexOf("|");
  if (bar < 0) return src;
  // Only treat it as a modifier list when the bars are balanced before it,
  // so |x| absolute values are left alone.
  const before = src.slice(0, bar);
  if ((before.match(/\|/g) ?? []).length % 2 !== 0) return src;
  const mods = splitTop(src.slice(bar + 1));
  for (const mod of mods) {
    const colon = mod.indexOf(":");
    const key = (colon < 0 ? mod : mod.slice(0, colon)).trim().toLowerCase();
    const value = colon < 0 ? "" : mod.slice(colon + 1).trim();
    switch (key) {
      case "color":
      case "colour":
        style.color = COLOR_NAMES[value.toLowerCase()] ?? value;
        break;
      case "width":
        style.width = parseNumber(value) ?? style.width;
        break;
      case "dashed":
      case "dash":
        style.dashed = value === "" ? true : parseBool(value);
        break;
      case "label":
      case "name":
        style.label = value;
        break;
      case "nofill":
        style.fill = false;
        break;
      case "fit":
      case "regression":
        style.fit = value === "" || /^(linear|line|lsq)$/i.test(value) ? "linear" : null;
        break;
    }
  }
  return before;
}

/** A parameter line may end with a slider range: a = 3 [-5, 5, 0.1] */
function extractSlider(src: string): { expr: string; min?: number; max?: number; step?: number } {
  const m = src.match(/\[([^\]]*)\]\s*$/);
  if (!m) return { expr: src };
  const parts = splitTop(m[1]);
  const nums = parts.map(parseNumber);
  return {
    expr: src.slice(0, m.index).trim(),
    min: nums[0] ?? undefined,
    max: nums[1] ?? undefined,
    step: nums[2] ?? undefined,
  };
}

function stripComment(line: string): string {
  // Only a leading hash is a comment — "#c74440" inside a modifier is a colour.
  const trimmed = line.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) return "";
  return line;
}

export function buildModel(lines: string[], base: Options): Model {
  const options: Options = { ...base };
  const errors = new Map<number, string>();
  const params: Param[] = [];
  const funcs = new Map<string, UserFunc>();
  const env: Env = { funcs };
  const scope: Scope = Object.create(null);
  const curves: Curve[] = [];

  // Pass 1 — learn every declared name, so pass 2 can tell f(x) from a*(x).
  const declaredFuncs = new Set<string>();
  const declaredVars = new Set<string>();
  const statements: { raw: string; line: number }[] = [];

  lines.forEach((rawLine, line) => {
    const src = stripComment(rawLine).trim();
    if (!src) return;
    statements.push({ raw: src, line });
    const eq = topLevelEquals(src);
    if (eq < 0) return;
    const lhs = src.slice(0, eq).trim();
    const def = lhs.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)$/);
    if (def) {
      declaredFuncs.add(def[1]);
      return;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(lhs) && !["x", "y", "r"].includes(lhs)) {
      declaredVars.add(lhs);
    }
  });

  const ctx: ParseContext = {
    isFunction: (name) => isBuiltinFunction(name) || declaredFuncs.has(name),
    isValue: (name) =>
      isConstant(name) ||
      declaredVars.has(name) ||
      ["x", "y", "t", "theta", "r"].includes(name),
  };

  let colorIndex = 0;
  const nextStyle = () => defaultStyle(colorIndex++);

  const compileWith = (node: Node): Compiled => compile(node, env);

  const evalConst = (node: Node): number => compileWith(node)(scope);

  for (const { raw, line } of statements) {
    try {
      const style = nextStyle();
      const src = extractStyle(raw, style).trim();
      if (!src) continue;

      // --- settings: "key: value" -------------------------------------
      const colon = src.indexOf(":");
      if (colon > 0 && !src.startsWith("(")) {
        const key = src.slice(0, colon).trim().toLowerCase();
        const value = src.slice(colon + 1).trim();
        if (key === "points" || key === "data") {
          curves.push(parsePoints(value, style, line, ctx, compileWith, scope));
          continue;
        }
        if (SETTING_KEYS.has(key)) {
          applySetting(options, key, value);
          colorIndex--; // settings do not consume a colour
          continue;
        }
      }

      const eq = topLevelEquals(src);
      const cmp = topLevelCompare(src);

      // --- inequality: y < x^2, x^2 + y^2 <= 4 ------------------------
      if (cmp) {
        const node = parseRelation(src, ctx);
        const strict = cmp.op === "<" || cmp.op === ">";
        const test = compileWith(node);
        const lhs = parse(src.slice(0, cmp.at), ctx);
        const rhs = parse(src.slice(cmp.at + cmp.op.length), ctx);
        const boundary = compileWith({ kind: "bin", op: "-", left: lhs, right: rhs });
        style.width = 1.6;
        curves.push({ type: "inequality", test, boundary, strict, style, line });
        continue;
      }

      if (eq >= 0) {
        const lhs = src.slice(0, eq).trim();
        const rhsSrc = src.slice(eq + 1).trim();

        // --- function definition: f(x) = ... --------------------------
        const def = lhs.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)$/);
        if (def) {
          const name = def[1];
          const fnParams = splitTop(def[2]);
          const inner: ParseContext = {
            isFunction: ctx.isFunction,
            isValue: (n) => ctx.isValue(n) || fnParams.includes(n),
          };
          const body = compileWith(parse(rhsSrc, inner));
          funcs.set(name, { params: fnParams, body });
          // A one-argument function of x is also drawn, the way Desmos does.
          if (fnParams.length === 1 && fnParams[0] === "x") {
            const call = parse(`${name}(x)`, ctx);
            style.label = style.label || `${name}(x)`;
            curves.push({ type: "explicit", of: "y", f: compileWith(call), style, line });
          } else {
            colorIndex--;
          }
          continue;
        }

        // --- parameter (slider): a = 3 [0, 10, 0.1] -------------------
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(lhs) && !["x", "y", "r"].includes(lhs)) {
          const { expr, min, max, step } = extractSlider(rhsSrc);
          const value = evalConst(parse(expr, ctx));
          scope[lhs] = value;
          const span = Math.max(1, Math.abs(value) * 2);
          params.push({
            name: lhs,
            value,
            min: min ?? Math.min(-span, value),
            max: max ?? Math.max(span, value),
            step: step ?? 0.01,
            line,
          });
          colorIndex--;
          continue;
        }

        const rhsNode = parse(rhsSrc, ctx);
        const rhsVars = new Set<string>();
        collectVars(rhsNode, rhsVars);

        // --- y = f(x) --------------------------------------------------
        if (lhs === "y" && !rhsVars.has("y")) {
          style.label = style.label || src;
          curves.push({ type: "explicit", of: "y", f: compileWith(rhsNode), style, line });
          continue;
        }
        // --- x = f(y), or a vertical line -----------------------------
        if (lhs === "x" && !rhsVars.has("x")) {
          if (!rhsVars.has("y")) {
            curves.push({ type: "vertical", at: compileWith(rhsNode), style, line });
          } else {
            curves.push({ type: "explicit", of: "x", f: compileWith(rhsNode), style, line });
          }
          continue;
        }
        // --- r = f(theta) ---------------------------------------------
        if (lhs === "r") {
          style.label = style.label || src;
          curves.push({
            type: "polar",
            f: compileWith(rhsNode),
            tmin: options.thetaMin,
            tmax: options.thetaMax,
            style,
            line,
          });
          continue;
        }

        // --- implicit: anything else with an "=" ----------------------
        const lhsNode = parse(lhs, ctx);
        const diff: Node = { kind: "bin", op: "-", left: lhsNode, right: rhsNode };
        style.label = style.label || src;
        curves.push({ type: "implicit", f: compileWith(diff), style, line });
        continue;
      }

      // --- a tuple: a point, a point list, or a parametric curve -------
      if (src.startsWith("(")) {
        const tuples = splitTop(src);
        // One tuple mentioning t is a parametric curve; anything else is points.
        const isParametric = tuples.length === 1 && /(^|[^A-Za-z0-9_])t([^A-Za-z0-9_]|$)/.test(tuples[0]);
        if (isParametric) {
          const inner = tuples[0].trim().replace(/^\(/, "").replace(/\)$/, "");
          const [xs, ys] = splitTop(inner);
          style.label = style.label || src;
          curves.push({
            type: "parametric",
            fx: compileWith(parse(xs, ctx)),
            fy: compileWith(parse(ys, ctx)),
            tmin: options.tmin,
            tmax: options.tmax,
            style,
            line,
          });
          continue;
        }
        curves.push(parsePoints(src, style, line, ctx, compileWith, scope));
        continue;
      }

      // --- bare expression: treat as y = ... ---------------------------
      style.label = style.label || `y = ${src}`;
      curves.push({ type: "explicit", of: "y", f: compileWith(parse(src, ctx)), style, line });
    } catch (err) {
      colorIndex--;
      errors.set(line, err instanceof ExprError || err instanceof Error ? err.message : String(err));
    }
  }

  for (const p of params) scope[p.name] = p.value;
  return { options, params, curves, errors, env, scope };
}

function parsePoints(
  src: string,
  style: Style,
  line: number,
  ctx: ParseContext,
  compileWith: (n: Node) => Compiled,
  scope: Scope,
): Curve {
  let fit: "linear" | null = style.fit;
  let body = src;
  const fitMatch = body.match(/\bfit\s*:?\s*(linear|line)\b/i);
  if (fitMatch) {
    fit = "linear";
    body = body.replace(fitMatch[0], "");
  }
  const pts: [number, number][] = [];
  for (const tuple of splitTop(body)) {
    const inner = tuple.trim().replace(/^\(/, "").replace(/\)$/, "");
    const [xs, ys] = splitTop(inner);
    if (xs === undefined || ys === undefined) throw new ExprError(`"${tuple}" is not a point`);
    pts.push([compileWith(parse(xs, ctx))(scope), compileWith(parse(ys, ctx))(scope)]);
  }
  return { type: "points", pts, fit, style, line };
}

function applySetting(options: Options, key: string, value: string): void {
  switch (key) {
    case "xmin": case "xmax": case "ymin": case "ymax": {
      const n = parseNumber(value);
      if (n !== null) (options as unknown as Record<string, number>)[key] = n;
      break;
    }
    case "x": case "y": {
      const r = parseRange(value);
      if (r) {
        options[`${key}min` as "xmin" | "ymin"] = r[0];
        options[`${key}max` as "xmax" | "ymax"] = r[1];
      }
      break;
    }
    case "bounds": {
      const parts = splitTop(value).map(parseNumber);
      if (parts.length === 4 && parts.every((n) => n !== null)) {
        options.xmin = parts[0] as number;
        options.xmax = parts[1] as number;
        options.ymin = parts[2] as number;
        options.ymax = parts[3] as number;
      }
      break;
    }
    case "t": {
      const r = parseRange(value);
      if (r) { options.tmin = r[0]; options.tmax = r[1]; }
      break;
    }
    case "theta": {
      const r = parseRange(value);
      if (r) { options.thetaMin = r[0]; options.thetaMax = r[1]; }
      break;
    }
    case "grid": options.grid = parseBool(value); break;
    case "minor": options.minorGrid = parseBool(value); break;
    case "axes": options.axes = parseBool(value); break;
    case "labels": options.labels = parseBool(value); break;
    case "degrees": options.degrees = parseBool(value); break;
    case "aspect": options.equalAspect = value.trim().toLowerCase() === "equal"; break;
    case "title": options.title = value; break;
    case "height": {
      const n = parseNumber(value);
      if (n !== null) options.height = Math.max(160, Math.min(1200, n));
      break;
    }
    case "editable":
    case "controls":
      break; // handled by the host, kept here so the line is not an error
    case "table": {
      const n = parseNumber(value);
      options.showTable = n !== null ? n > 0 : parseBool(value);
      if (n !== null && n > 1) options.tableRows = Math.min(200, Math.round(n));
      break;
    }
  }
}

/** Least-squares straight line through a point set, with R². */
export function linearFit(pts: [number, number][]): { m: number; b: number; r2: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const m = (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  const varY = syy - (sy * sy) / n;
  const r2 = varY < 1e-12 ? 1 : 1 - (syy - m * sxy - b * sy) / varY;
  return { m, b, r2 };
}

export { constantValue };

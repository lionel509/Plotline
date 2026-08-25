"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PlotlinePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/calculator.ts
var import_obsidian = require("obsidian");

// src/poi.ts
var MAX_POINTS = 60;
var SAMPLES = 1200;
var POI_LABEL = {
  intersection: "intersection",
  zero: "zero",
  maximum: "maximum",
  minimum: "minimum",
  intercept: "y-intercept"
};
function explicitFns(model) {
  const out = [];
  for (const curve of model.curves) {
    if (curve.type !== "explicit" || curve.of !== "y") continue;
    const scope = Object.assign(/* @__PURE__ */ Object.create(null), model.scope);
    const f = curve.f;
    out.push({
      eval: (x) => {
        scope.x = x;
        return f(scope);
      },
      color: curve.style.color,
      label: curve.style.label || "f(x)"
    });
  }
  return out;
}
function bisect(f, a, b, scale) {
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
  if (!Number.isFinite(value) || Math.abs(value) > scale * 1e-4) return null;
  return root;
}
function refineExtremum(f, a, b, wantMax) {
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
function dedupe(points, vp) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
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
function findPointsOfInterest(model, vp) {
  const fns = explicitFns(model);
  const verticals = [];
  for (const curve of model.curves) {
    if (curve.type !== "vertical") continue;
    const x = curve.at(model.scope);
    if (Number.isFinite(x)) verticals.push({ x, color: curve.style.color });
  }
  if (fns.length === 0) return [];
  const step = vp.spanX / SAMPLES;
  const xs = [];
  for (let i = 0; i <= SAMPLES; i++) xs.push(vp.xmin + step * i);
  const values = fns.map((fn) => xs.map((x) => fn.eval(x)));
  const scale = Math.max(vp.spanY, 1);
  const found = [];
  fns.forEach((fn, i) => {
    const ys = values[i];
    for (let k = 0; k < SAMPLES; k++) {
      const y0 = ys[k];
      const y1 = ys[k + 1];
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
      if (y0 < 0 && y1 > 0 || y0 > 0 && y1 < 0 || y0 === 0) {
        const root = bisect(fn.eval, xs[k], xs[k + 1], scale);
        if (root !== null) found.push({ x: root, y: 0, kind: "zero", color: fn.color, from: fn.label });
      }
    }
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
    if (vp.xmin <= 0 && vp.xmax >= 0) {
      const y = fn.eval(0);
      if (Number.isFinite(y)) found.push({ x: 0, y, kind: "intercept", color: fn.color, from: fn.label });
    }
  });
  for (let i = 0; i < fns.length; i++) {
    for (let j = i + 1; j < fns.length; j++) {
      const diff = (x) => fns[i].eval(x) - fns[j].eval(x);
      const a = values[i];
      const b = values[j];
      for (let k = 0; k < SAMPLES; k++) {
        const d0 = a[k] - b[k];
        const d1 = a[k + 1] - b[k + 1];
        if (!Number.isFinite(d0) || !Number.isFinite(d1)) continue;
        if (d0 < 0 && d1 > 0 || d0 > 0 && d1 < 0 || d0 === 0) {
          const x = bisect(diff, xs[k], xs[k + 1], scale);
          if (x === null) continue;
          const y = fns[i].eval(x);
          if (!Number.isFinite(y)) continue;
          found.push({
            x,
            y,
            kind: "intersection",
            color: fns[i].color,
            from: `${fns[i].label} \u2229 ${fns[j].label}`
          });
        }
      }
    }
  }
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
        from: `x = ${line.x} \u2229 ${fn.label}`
      });
    }
  }
  const order = {
    intersection: 0,
    zero: 1,
    maximum: 2,
    minimum: 2,
    intercept: 3
  };
  const deduped = dedupe(found, vp).sort((p, q) => order[p.kind] - order[q.kind] || p.x - q.x);
  return deduped.slice(0, MAX_POINTS);
}

// src/expr.ts
var ExprError = class extends Error {
};
var ANGLE_SCALE = 1;
function setAngleMode(degrees) {
  ANGLE_SCALE = degrees ? Math.PI / 180 : 1;
}
var REWRITE = {
  "\u2212": "-",
  // U+2212 minus
  "\u2013": "-",
  "\u2014": "-",
  "\xD7": "*",
  "\xB7": "*",
  "\u2217": "*",
  "\xF7": "/",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2260": "!=",
  "\u221A": "sqrt",
  "\u221E": "infinity",
  "\u03C0": "pi",
  "\u03C4": "tau",
  "\u03B8": "theta",
  "\u03C6": "phi",
  "\u03B1": "alpha",
  "\u03B2": "beta",
  "\u03B3": "gamma",
  "\u03BB": "lambda",
  "\u03BC": "mu",
  "\u03C9": "omega"
};
function normalize(src) {
  let out = "";
  for (const ch of src) out += REWRITE[ch] ?? ch;
  return out;
}
function isDigit(c) {
  return c >= "0" && c <= "9";
}
function isAlpha(c) {
  return c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "_";
}
function lex(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "	" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (isDigit(c) || c === "." && isDigit(src[i + 1] ?? "")) {
      const start = i;
      while (i < src.length && isDigit(src[i])) i++;
      if (src[i] === ".") {
        i++;
        while (i < src.length && isDigit(src[i])) i++;
      }
      toks.push({ kind: "num", text: src.slice(start, i), pos: start });
      continue;
    }
    if (isAlpha(c)) {
      const start = i;
      while (i < src.length && (isAlpha(src[i]) || isDigit(src[i]))) i++;
      toks.push({ kind: "name", text: src.slice(start, i), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "==" || two === "!=") {
      toks.push({ kind: "op", text: two, pos: i });
      i += 2;
      continue;
    }
    if ("+-*/^<>=!".includes(c)) {
      toks.push({ kind: "op", text: c, pos: i });
      i++;
      continue;
    }
    if ("(),:{}|".includes(c)) {
      toks.push({ kind: c, text: c, pos: i });
      i++;
      continue;
    }
    throw new ExprError(`Unexpected character "${c}"`);
  }
  toks.push({ kind: "eof", text: "", pos: src.length });
  return toks;
}
var Parser = class {
  constructor(toks, ctx) {
    this.toks = toks;
    this.ctx = ctx;
  }
  i = 0;
  /** Nesting depth of |...| groups: inside one, a bar closes rather than multiplies. */
  barDepth = 0;
  peek() {
    return this.toks[this.i];
  }
  next() {
    return this.toks[this.i++];
  }
  eat(kind, text) {
    const t = this.peek();
    if (t.kind === kind && (text === void 0 || t.text === text)) {
      this.i++;
      return true;
    }
    return false;
  }
  expect(kind, text) {
    if (!this.eat(kind, text)) {
      const t = this.peek();
      throw new ExprError(`Expected "${text ?? kind}" but found "${t.text || "end of expression"}"`);
    }
    return this.toks[this.i - 1];
  }
  /** Top level of a value expression (comparisons live only inside piecewise). */
  parseExpr() {
    return this.parseSum();
  }
  parseComparison() {
    const left = this.parseSum();
    const t = this.peek();
    if (t.kind === "op" && ["<", "<=", ">", ">=", "=", "==", "!="].includes(t.text)) {
      this.next();
      const op = t.text === "==" ? "=" : t.text;
      const right = this.parseSum();
      return { kind: "cmp", op, left, right };
    }
    return left;
  }
  atEnd() {
    return this.peek().kind === "eof";
  }
  parseSum() {
    let left = this.parseProduct();
    for (; ; ) {
      const t = this.peek();
      if (t.kind === "op" && (t.text === "+" || t.text === "-")) {
        this.next();
        const right = this.parseProduct();
        left = { kind: "bin", op: t.text, left, right };
      } else {
        return left;
      }
    }
  }
  parseProduct() {
    let left = this.parseUnary();
    for (; ; ) {
      const t = this.peek();
      if (t.kind === "op" && (t.text === "*" || t.text === "/")) {
        this.next();
        const right = this.parseUnary();
        left = { kind: "bin", op: t.text, left, right };
      } else if (this.startsFactor()) {
        const right = this.parseUnary();
        left = { kind: "bin", op: "*", left, right };
      } else {
        return left;
      }
    }
  }
  /** True when the next token can begin a factor, i.e. juxtaposition means "times". */
  startsFactor() {
    const t = this.peek();
    if (t.kind === "num" || t.kind === "name" || t.kind === "(" || t.kind === "{") return true;
    return t.kind === "|" && this.barDepth === 0;
  }
  parseUnary() {
    const t = this.peek();
    if (t.kind === "op" && (t.text === "-" || t.text === "+")) {
      this.next();
      const arg = this.parseUnary();
      return t.text === "-" ? { kind: "neg", arg } : arg;
    }
    return this.parsePower();
  }
  parsePower() {
    const base = this.parsePostfix();
    const t = this.peek();
    if (t.kind === "op" && t.text === "^") {
      this.next();
      const exp = this.parseUnary();
      return { kind: "bin", op: "^", left: base, right: exp };
    }
    return base;
  }
  parsePostfix() {
    let node = this.parsePrimary();
    while (this.peek().kind === "op" && this.peek().text === "!") {
      this.next();
      node = { kind: "fact", arg: node };
    }
    return node;
  }
  parsePrimary() {
    const t = this.next();
    switch (t.kind) {
      case "num":
        return { kind: "num", value: Number(t.text) };
      case "(": {
        const inner = this.parseSum();
        this.expect(")");
        return inner;
      }
      case "|": {
        this.barDepth++;
        const inner = this.parseSum();
        this.expect("|");
        this.barDepth--;
        return { kind: "call", name: "abs", args: [inner] };
      }
      case "{":
        return this.parsePiecewise();
      case "name":
        return this.parseName(t);
      default:
        throw new ExprError(`Unexpected "${t.text || "end of expression"}"`);
    }
  }
  parseName(t) {
    const name = t.text;
    if (this.peek().kind === "(" && this.ctx.isFunction(name)) {
      this.next();
      const args = [];
      if (this.peek().kind !== ")") {
        do {
          args.push(this.parseSum());
        } while (this.eat(","));
      }
      this.expect(")");
      return { kind: "call", name, args };
    }
    if (this.ctx.isValue(name)) return { kind: "var", name };
    if (name.length > 1 && [...name].every((c) => this.ctx.isValue(c))) {
      let node = { kind: "var", name: name[0] };
      for (const c of name.slice(1)) {
        node = { kind: "bin", op: "*", left: node, right: { kind: "var", name: c } };
      }
      return node;
    }
    if (this.ctx.isFunction(name)) throw new ExprError(`"${name}" is a function \u2014 write ${name}(x)`);
    throw new ExprError(`Unknown name "${name}"`);
  }
  /** Desmos piecewise: {x > 0: x^2, x < 0: -x, 0} — a trailing bare value is the else. */
  parsePiecewise() {
    const branches = [];
    if (this.peek().kind === "}") {
      this.next();
      throw new ExprError("Empty piecewise {}");
    }
    do {
      const first = this.parseComparison();
      if (this.eat(":")) {
        branches.push({ cond: first, value: this.parseSum() });
      } else {
        branches.push({ cond: null, value: first });
      }
    } while (this.eat(","));
    this.expect("}");
    return { kind: "piecewise", branches };
  }
};
function parse(source, ctx) {
  const p = new Parser(lex(normalize(source)), ctx);
  const node = p.parseExpr();
  if (!p.atEnd()) throw new ExprError("Unexpected trailing input");
  return node;
}
function parseRelation(source, ctx) {
  const p = new Parser(lex(normalize(source)), ctx);
  const node = p.parseComparison();
  if (!p.atEnd()) throw new ExprError("Unexpected trailing input");
  return node;
}
var CONSTANTS = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
  infinity: Infinity
};
function factorial(n) {
  if (!Number.isFinite(n) || n < 0) return NaN;
  if (Math.abs(n - Math.round(n)) > 1e-9) return gamma(n + 1);
  let out = 1;
  for (let i = 2; i <= Math.round(n); i++) out *= i;
  return out;
}
function gamma(z) {
  const g = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9984369578019572e-21,
    15056327351493116e-23
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = 0.9999999999998099;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
function fixed(arity, fn) {
  return { arity, fn };
}
var BUILTINS = {
  sin: fixed(1, (x) => Math.sin(x * ANGLE_SCALE)),
  cos: fixed(1, (x) => Math.cos(x * ANGLE_SCALE)),
  tan: fixed(1, (x) => Math.tan(x * ANGLE_SCALE)),
  sec: fixed(1, (x) => 1 / Math.cos(x * ANGLE_SCALE)),
  csc: fixed(1, (x) => 1 / Math.sin(x * ANGLE_SCALE)),
  cot: fixed(1, (x) => 1 / Math.tan(x * ANGLE_SCALE)),
  arcsin: fixed(1, (x) => Math.asin(x) / ANGLE_SCALE),
  arccos: fixed(1, (x) => Math.acos(x) / ANGLE_SCALE),
  arctan: fixed(1, (x) => Math.atan(x) / ANGLE_SCALE),
  asin: fixed(1, (x) => Math.asin(x) / ANGLE_SCALE),
  acos: fixed(1, (x) => Math.acos(x) / ANGLE_SCALE),
  atan: fixed(1, (x) => Math.atan(x) / ANGLE_SCALE),
  atan2: fixed(2, (y, x) => Math.atan2(y, x) / ANGLE_SCALE),
  sinh: fixed(1, Math.sinh),
  cosh: fixed(1, Math.cosh),
  tanh: fixed(1, Math.tanh),
  arsinh: fixed(1, Math.asinh),
  arcosh: fixed(1, Math.acosh),
  artanh: fixed(1, Math.atanh),
  exp: fixed(1, Math.exp),
  ln: fixed(1, Math.log),
  log: { arity: [1, 2], fn: (x, b) => b === void 0 ? Math.log10(x) : Math.log(x) / Math.log(b) },
  log2: fixed(1, Math.log2),
  sqrt: fixed(1, Math.sqrt),
  cbrt: fixed(1, Math.cbrt),
  abs: fixed(1, Math.abs),
  sign: fixed(1, Math.sign),
  floor: fixed(1, Math.floor),
  ceil: fixed(1, Math.ceil),
  round: { arity: [1, 2], fn: (x, d) => d === void 0 ? Math.round(x) : Math.round(x * 10 ** d) / 10 ** d },
  trunc: fixed(1, Math.trunc),
  mod: fixed(2, (a, b) => (a % b + b) % b),
  hypot: { arity: [1, 8], fn: (...a) => Math.hypot(...a) },
  min: { arity: [1, 8], fn: (...a) => Math.min(...a) },
  max: { arity: [1, 8], fn: (...a) => Math.max(...a) },
  pow: fixed(2, Math.pow),
  nCr: fixed(2, (n, r) => factorial(n) / (factorial(r) * factorial(n - r))),
  nPr: fixed(2, (n, r) => factorial(n) / factorial(n - r)),
  factorial: fixed(1, factorial),
  gamma: fixed(1, gamma)
};
function isBuiltinFunction(name) {
  return Object.prototype.hasOwnProperty.call(BUILTINS, name);
}
function isConstant(name) {
  return Object.prototype.hasOwnProperty.call(CONSTANTS, name);
}
function arityOk(b, n) {
  return typeof b.arity === "number" ? b.arity === n : n >= b.arity[0] && n <= b.arity[1];
}
function compile(node, env) {
  switch (node.kind) {
    case "num": {
      const v = node.value;
      return () => v;
    }
    case "var": {
      const name = node.name;
      if (isConstant(name)) {
        const v = CONSTANTS[name];
        return () => v;
      }
      return (scope) => {
        const v = scope[name];
        return v === void 0 ? NaN : v;
      };
    }
    case "neg": {
      const a = compile(node.arg, env);
      return (s) => -a(s);
    }
    case "fact": {
      const a = compile(node.arg, env);
      return (s) => factorial(a(s));
    }
    case "bin": {
      const l = compile(node.left, env);
      const r = compile(node.right, env);
      switch (node.op) {
        case "+":
          return (s) => l(s) + r(s);
        case "-":
          return (s) => l(s) - r(s);
        case "*":
          return (s) => l(s) * r(s);
        case "/":
          return (s) => l(s) / r(s);
        case "^":
          return (s) => {
            const base = l(s);
            const exp = r(s);
            if (base < 0 && !Number.isInteger(exp)) {
              const inv = 1 / exp;
              if (Number.isFinite(inv) && Math.abs(inv - Math.round(inv)) < 1e-9 && Math.round(inv) % 2 !== 0) {
                return -Math.pow(-base, exp);
              }
            }
            return Math.pow(base, exp);
          };
      }
      break;
    }
    case "cmp": {
      const l = compile(node.left, env);
      const r = compile(node.right, env);
      const op = node.op;
      return (s) => {
        const a = l(s);
        const b = r(s);
        let ok;
        switch (op) {
          case "<":
            ok = a < b;
            break;
          case "<=":
            ok = a <= b;
            break;
          case ">":
            ok = a > b;
            break;
          case ">=":
            ok = a >= b;
            break;
          case "=":
            ok = Math.abs(a - b) < 1e-12;
            break;
          case "!=":
            ok = Math.abs(a - b) >= 1e-12;
            break;
        }
        return ok ? 1 : 0;
      };
    }
    case "piecewise": {
      const branches = node.branches.map((b) => ({
        cond: b.cond ? compile(b.cond, env) : null,
        value: compile(b.value, env)
      }));
      return (s) => {
        for (const b of branches) {
          if (b.cond === null || b.cond(s) !== 0) return b.value(s);
        }
        return NaN;
      };
    }
    case "call": {
      const args = node.args.map((a) => compile(a, env));
      const name = node.name;
      const builtin = BUILTINS[name];
      if (builtin) {
        if (!arityOk(builtin, args.length)) {
          throw new ExprError(`${name}() takes ${JSON.stringify(builtin.arity)} argument(s), got ${args.length}`);
        }
        const fn = builtin.fn;
        if (args.length === 1) {
          const a0 = args[0];
          return (s) => fn(a0(s));
        }
        if (args.length === 2) {
          const [a0, a1] = args;
          return (s) => fn(a0(s), a1(s));
        }
        return (s) => fn(...args.map((a) => a(s)));
      }
      const funcs = env.funcs;
      return (s) => {
        const f = funcs.get(name);
        if (!f || f.params.length !== args.length) return NaN;
        const inner = /* @__PURE__ */ Object.create(null);
        for (const k in s) inner[k] = s[k];
        for (let i = 0; i < f.params.length; i++) inner[f.params[i]] = args[i](s);
        return f.body(inner);
      };
    }
  }
  throw new ExprError("Cannot compile expression");
}

// src/spec.ts
var PALETTE = [
  "#2d70b3",
  // blue
  "#c74440",
  // red
  "#388c46",
  // green
  "#6042a6",
  // purple
  "#fa7e19",
  // orange
  "#000000"
  // black -> remapped to the text colour in dark mode
];
var DEFAULT_OPTIONS = {
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
  keyPoints: true,
  degrees: false,
  equalAspect: false,
  title: "",
  tmin: 0,
  tmax: Math.PI * 2,
  thetaMin: 0,
  thetaMax: Math.PI * 2
};
var SETTING_KEYS = /* @__PURE__ */ new Set([
  "xmin",
  "xmax",
  "ymin",
  "ymax",
  "x",
  "y",
  "t",
  "theta",
  "grid",
  "minor",
  "axes",
  "labels",
  "height",
  "table",
  "degrees",
  "aspect",
  "title",
  "bounds",
  "keypoints",
  "points-of-interest",
  // Read before the model is built, by whoever is hosting the widget.
  "editable",
  "controls"
]);
var COLOR_NAMES = {
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
  accent: "var(--interactive-accent)"
};
function splitTop(src, sep = ",") {
  const out = [];
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
function topLevelEquals(src) {
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
function topLevelCompare(src) {
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
function collectVars(node, into) {
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
function parseNumber(text) {
  const t = text.trim().toLowerCase();
  if (t === "pi") return Math.PI;
  if (t === "-pi") return -Math.PI;
  if (t === "2pi" || t === "tau") return Math.PI * 2;
  if (t === "-2pi") return -Math.PI * 2;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function parseBool(text) {
  const t = text.trim().toLowerCase();
  return !(t === "false" || t === "off" || t === "no" || t === "0");
}
function parseRange(text) {
  const parts = text.split(/\.\.|,| to /).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const a = parseNumber(parts[0]);
  const b = parseNumber(parts[1]);
  return a === null || b === null ? null : [a, b];
}
function defaultStyle(index) {
  return {
    color: PALETTE[index % PALETTE.length],
    width: 2.2,
    dashed: false,
    label: "",
    fill: true,
    fit: null
  };
}
function extractStyle(src, style) {
  const bar = src.lastIndexOf("|");
  if (bar < 0) return src;
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
function extractSlider(src) {
  const m = src.match(/\[([^\]]*)\]\s*$/);
  if (!m) return { expr: src };
  const parts = splitTop(m[1]);
  const nums = parts.map(parseNumber);
  return {
    expr: src.slice(0, m.index).trim(),
    min: nums[0] ?? void 0,
    max: nums[1] ?? void 0,
    step: nums[2] ?? void 0
  };
}
function stripComment(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) return "";
  return line;
}
function buildModel(lines, base) {
  const options = { ...base };
  const errors = /* @__PURE__ */ new Map();
  const params = [];
  const funcs = /* @__PURE__ */ new Map();
  const env = { funcs };
  const scope = /* @__PURE__ */ Object.create(null);
  const curves = [];
  const declaredFuncs = /* @__PURE__ */ new Set();
  const declaredVars = /* @__PURE__ */ new Set();
  const statements = [];
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
  const ctx = {
    isFunction: (name) => isBuiltinFunction(name) || declaredFuncs.has(name),
    isValue: (name) => isConstant(name) || declaredVars.has(name) || ["x", "y", "t", "theta", "r"].includes(name)
  };
  let colorIndex = 0;
  const nextStyle = () => defaultStyle(colorIndex++);
  const compileWith = (node) => compile(node, env);
  const evalConst = (node) => compileWith(node)(scope);
  for (const { raw, line } of statements) {
    try {
      const style = nextStyle();
      const src = extractStyle(raw, style).trim();
      if (!src) continue;
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
          colorIndex--;
          continue;
        }
      }
      const eq = topLevelEquals(src);
      const cmp = topLevelCompare(src);
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
        const def = lhs.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)$/);
        if (def) {
          const name = def[1];
          const fnParams = splitTop(def[2]);
          const inner = {
            isFunction: ctx.isFunction,
            isValue: (n) => ctx.isValue(n) || fnParams.includes(n)
          };
          const body = compileWith(parse(rhsSrc, inner));
          funcs.set(name, { params: fnParams, body });
          if (fnParams.length === 1 && fnParams[0] === "x") {
            const call = parse(`${name}(x)`, ctx);
            style.label = style.label || `${name}(x)`;
            curves.push({ type: "explicit", of: "y", f: compileWith(call), style, line });
          } else {
            colorIndex--;
          }
          continue;
        }
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
            line
          });
          colorIndex--;
          continue;
        }
        const rhsNode = parse(rhsSrc, ctx);
        const rhsVars = /* @__PURE__ */ new Set();
        collectVars(rhsNode, rhsVars);
        if (lhs === "y" && !rhsVars.has("y")) {
          style.label = style.label || src;
          curves.push({ type: "explicit", of: "y", f: compileWith(rhsNode), style, line });
          continue;
        }
        if (lhs === "x" && !rhsVars.has("x")) {
          if (!rhsVars.has("y")) {
            curves.push({ type: "vertical", at: compileWith(rhsNode), style, line });
          } else {
            curves.push({ type: "explicit", of: "x", f: compileWith(rhsNode), style, line });
          }
          continue;
        }
        if (lhs === "r") {
          style.label = style.label || src;
          curves.push({
            type: "polar",
            f: compileWith(rhsNode),
            tmin: options.thetaMin,
            tmax: options.thetaMax,
            style,
            line
          });
          continue;
        }
        const lhsNode = parse(lhs, ctx);
        const diff = { kind: "bin", op: "-", left: lhsNode, right: rhsNode };
        style.label = style.label || src;
        curves.push({ type: "implicit", f: compileWith(diff), style, line });
        continue;
      }
      if (src.startsWith("(")) {
        const tuples = splitTop(src);
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
            line
          });
          continue;
        }
        curves.push(parsePoints(src, style, line, ctx, compileWith, scope));
        continue;
      }
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
function parsePoints(src, style, line, ctx, compileWith, scope) {
  let fit = style.fit;
  let body = src;
  const fitMatch = body.match(/\bfit\s*:?\s*(linear|line)\b/i);
  if (fitMatch) {
    fit = "linear";
    body = body.replace(fitMatch[0], "");
  }
  const pts = [];
  for (const tuple of splitTop(body)) {
    const inner = tuple.trim().replace(/^\(/, "").replace(/\)$/, "");
    const [xs, ys] = splitTop(inner);
    if (xs === void 0 || ys === void 0) throw new ExprError(`"${tuple}" is not a point`);
    pts.push([compileWith(parse(xs, ctx))(scope), compileWith(parse(ys, ctx))(scope)]);
  }
  return { type: "points", pts, fit, style, line };
}
function applySetting(options, key, value) {
  switch (key) {
    case "xmin":
    case "xmax":
    case "ymin":
    case "ymax": {
      const n = parseNumber(value);
      if (n !== null) options[key] = n;
      break;
    }
    case "x":
    case "y": {
      const r = parseRange(value);
      if (r) {
        options[`${key}min`] = r[0];
        options[`${key}max`] = r[1];
      }
      break;
    }
    case "bounds": {
      const parts = splitTop(value).map(parseNumber);
      if (parts.length === 4 && parts.every((n) => n !== null)) {
        options.xmin = parts[0];
        options.xmax = parts[1];
        options.ymin = parts[2];
        options.ymax = parts[3];
      }
      break;
    }
    case "t": {
      const r = parseRange(value);
      if (r) {
        options.tmin = r[0];
        options.tmax = r[1];
      }
      break;
    }
    case "theta": {
      const r = parseRange(value);
      if (r) {
        options.thetaMin = r[0];
        options.thetaMax = r[1];
      }
      break;
    }
    case "grid":
      options.grid = parseBool(value);
      break;
    case "minor":
      options.minorGrid = parseBool(value);
      break;
    case "axes":
      options.axes = parseBool(value);
      break;
    case "labels":
      options.labels = parseBool(value);
      break;
    case "degrees":
      options.degrees = parseBool(value);
      break;
    case "keypoints":
    case "points-of-interest":
      options.keyPoints = parseBool(value);
      break;
    case "aspect":
      options.equalAspect = value.trim().toLowerCase() === "equal";
      break;
    case "title":
      options.title = value;
      break;
    case "height": {
      const n = parseNumber(value);
      if (n !== null) options.height = Math.max(160, Math.min(1200, n));
      break;
    }
    case "editable":
    case "controls":
      break;
    // handled by the host, kept here so the line is not an error
    case "table": {
      const n = parseNumber(value);
      options.showTable = n !== null ? n > 0 : parseBool(value);
      if (n !== null && n > 1) options.tableRows = Math.min(200, Math.round(n));
      break;
    }
  }
}
function linearFit(pts) {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const m = (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  const varY = syy - sy * sy / n;
  const r2 = varY < 1e-12 ? 1 : 1 - (syy - m * sxy - b * sy) / varY;
  return { m, b, r2 };
}

// src/render.ts
var Viewport = class _Viewport {
  xmin;
  xmax;
  ymin;
  ymax;
  width = 100;
  height = 100;
  constructor(b) {
    this.xmin = b.xmin;
    this.xmax = b.xmax;
    this.ymin = b.ymin;
    this.ymax = b.ymax;
  }
  clone() {
    const v = new _Viewport(this);
    v.width = this.width;
    v.height = this.height;
    return v;
  }
  set(b) {
    this.xmin = b.xmin;
    this.xmax = b.xmax;
    this.ymin = b.ymin;
    this.ymax = b.ymax;
  }
  get spanX() {
    return this.xmax - this.xmin;
  }
  get spanY() {
    return this.ymax - this.ymin;
  }
  /** world -> screen */
  sx(x) {
    return (x - this.xmin) / this.spanX * this.width;
  }
  sy(y) {
    return this.height - (y - this.ymin) / this.spanY * this.height;
  }
  /** screen -> world */
  ix(px) {
    return this.xmin + px / this.width * this.spanX;
  }
  iy(py) {
    return this.ymin + (this.height - py) / this.height * this.spanY;
  }
  panPixels(dx, dy) {
    const wx = dx / this.width * this.spanX;
    const wy = dy / this.height * this.spanY;
    this.xmin -= wx;
    this.xmax -= wx;
    this.ymin += wy;
    this.ymax += wy;
  }
  zoomAt(px, py, factor, axis = "both") {
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
  equalize() {
    if (this.width <= 0 || this.height <= 0) return;
    const targetSpanY = this.spanX * this.height / this.width;
    const cy = (this.ymin + this.ymax) / 2;
    this.ymin = cy - targetSpanY / 2;
    this.ymax = cy + targetSpanY / 2;
  }
};
function readTheme(el) {
  const cs = getComputedStyle(el);
  const pick = (name, fallback) => {
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
    isDark
  };
}
function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return step * mag;
}
var PI_FRACTIONS = [
  [1, "\u03C0"],
  [1 / 2, "\u03C0/2"],
  [1 / 3, "\u03C0/3"],
  [1 / 4, "\u03C0/4"],
  [1 / 6, "\u03C0/6"]
];
function formatTick(value, step) {
  for (const [frac, label] of PI_FRACTIONS) {
    if (Math.abs(step - Math.PI * frac) < 1e-9) {
      const k = Math.round(value / (Math.PI * frac));
      if (k === 0) return "0";
      const sign = k < 0 ? "-" : "";
      const n = Math.abs(k);
      if (label === "\u03C0") return `${sign}${n === 1 ? "" : n}\u03C0`;
      const [, den] = label.split("/");
      const g = gcd(n, Number(den));
      const num = n / g;
      const d = Number(den) / g;
      const head = `${sign}${num === 1 ? "" : num}\u03C0`;
      return d === 1 ? head : `${head}/${d}`;
    }
  }
  if (Math.abs(value) < step / 1e3) return "0";
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)) + 1));
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs > 0 && abs < 1e-4) return value.toExponential(2).replace("e+", "e");
  return Number(value.toFixed(decimals)).toString();
}
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}
function formatNumber(value, decimals = 4) {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? "undefined" : value > 0 ? "\u221E" : "-\u221E";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return value.toExponential(3).replace("e+", "e");
  return Number(value.toFixed(decimals)).toString();
}
function strokeColor(style, theme) {
  if (style.color === "#000000" && theme.isDark) return theme.text;
  return style.color;
}
var Renderer = class {
  constructor(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
  }
  ctx;
  /** Size the backing store to the element box and the device pixel ratio. */
  resize(vp, cssWidth, cssHeight) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vp.width = cssWidth;
    vp.height = cssHeight;
  }
  draw(model, vp, theme, quality = 1) {
    setAngleMode(model.options.degrees);
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, vp.width, vp.height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, vp.width, vp.height);
    if (model.options.grid) this.drawGrid(vp, theme, model.options.minorGrid);
    if (model.options.axes) this.drawAxes(vp, theme, model.options.labels);
    const traces = [];
    const notes = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, vp.width, vp.height);
    ctx.clip();
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
                text: `fit: y = ${formatNumber(fit.m)}x ${fit.b < 0 ? "\u2212" : "+"} ${formatNumber(
                  Math.abs(fit.b)
                )}   (R\xB2 = ${formatNumber(fit.r2, 4)}, n = ${curve.pts.length})`,
                color: strokeColor(curve.style, theme)
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
  drawMarkers(pois, vp, theme, active) {
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
  drawGrid(vp, theme, minor) {
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
  gridLines(vp, stepX, stepY) {
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
  drawAxes(vp, theme, labels) {
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
      if (Math.abs(x) < stepX / 1e3) continue;
      ctx.fillText(formatTick(x, stepX), vp.sx(x), labelY);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const labelX = Math.max(24, x0 - 5);
    for (let y = Math.ceil(vp.ymin / stepY) * stepY; y <= vp.ymax; y += stepY) {
      if (Math.abs(y) < stepY / 1e3) continue;
      ctx.fillText(formatTick(y, stepY), labelX, vp.sy(y));
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("0", Math.max(10, x0 - 4), Math.min(vp.height - 14, y0 + 4));
  }
  applyStroke(style, theme) {
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
  strokePolyline(pts, vp, across = "y") {
    const ctx = this.ctx;
    ctx.beginPath();
    let drawing = false;
    let prev = null;
    const jumpLimit = (across === "y" ? vp.height : vp.width) * 4;
    for (const p of pts) {
      if (!p.ok) {
        drawing = false;
        prev = null;
        continue;
      }
      if (prev && (across === "y" ? Math.abs(p.py - prev.py) : Math.abs(p.px - prev.px)) > jumpLimit) {
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
  drawExplicit(curve, base, vp, theme) {
    const scope = Object.assign(/* @__PURE__ */ Object.create(null), base);
    const along = curve.of === "y" ? vp.width : vp.height;
    const steps = Math.max(2, Math.round(along * 2));
    const pts = [];
    const trace = [];
    for (let i = 0; i <= steps; i++) {
      const screen = i / steps * along;
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
  drawVertical(curve, base, vp, theme) {
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
  drawParametric(curve, base, vp, theme) {
    const scope = Object.assign(/* @__PURE__ */ Object.create(null), base);
    const steps = 2e3;
    const pts = [];
    const trace = [];
    for (let i = 0; i <= steps; i++) {
      const t = curve.tmin + (curve.tmax - curve.tmin) * i / steps;
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
  drawPolar(curve, base, vp, theme) {
    const scope = Object.assign(/* @__PURE__ */ Object.create(null), base);
    const steps = 2e3;
    const pts = [];
    const trace = [];
    for (let i = 0; i <= steps; i++) {
      const th = curve.tmin + (curve.tmax - curve.tmin) * i / steps;
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
  drawPoints(curve, vp, theme) {
    const ctx = this.ctx;
    const color = strokeColor(curve.style, theme);
    const trace = [];
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
  drawFitLine(fit, style, vp, theme) {
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
  drawImplicit(f, style, base, vp, theme, quality, dashed) {
    const scope = Object.assign(/* @__PURE__ */ Object.create(null), base);
    const cols = Math.max(40, Math.round(Math.min(260, vp.width / 3.5) * quality));
    const rows = Math.max(30, Math.round(cols * (vp.height / Math.max(1, vp.width))));
    const values = new Float64Array((cols + 1) * (rows + 1));
    for (let j = 0; j <= rows; j++) {
      scope.y = vp.ymin + vp.spanY * (rows - j) / rows;
      for (let i = 0; i <= cols; i++) {
        scope.x = vp.xmin + vp.spanX * i / cols;
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
    const at = (i, j) => values[j * (cols + 1) + i];
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
        const seg = (a, b) => {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        };
        switch (idx) {
          case 1:
          case 14:
            seg(left, bottom);
            break;
          case 2:
          case 13:
            seg(bottom, right);
            break;
          case 3:
          case 12:
            seg(left, right);
            break;
          case 4:
          case 11:
            seg(top, right);
            break;
          case 6:
          case 9:
            seg(top, bottom);
            break;
          case 7:
          case 8:
            seg(left, top);
            break;
          case 5:
            seg(left, top);
            seg(bottom, right);
            break;
          case 10:
            seg(left, bottom);
            seg(top, right);
            break;
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }
  drawInequality(curve, base, vp, theme, quality) {
    const scope = Object.assign(/* @__PURE__ */ Object.create(null), base);
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
};
function lerpT(a, b) {
  const d = a - b;
  if (Math.abs(d) < 1e-30) return 0.5;
  const t = a / d;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
function clampPixel(v) {
  if (!Number.isFinite(v)) return 0;
  return v > 1e6 ? 1e6 : v < -1e6 ? -1e6 : v;
}

// src/calculator.ts
var TRACE_RADIUS = 26;
var Calculator = class {
  constructor(parent, source, opts) {
    this.opts = opts;
    this.lines = source.replace(/\r/g, "").split("\n");
    this.root = parent.createDiv({ cls: "plotline" });
    if (opts.editable) this.root.addClass("plotline-editable");
    this.showTable = false;
    this.tableRows = DEFAULT_OPTIONS.tableRows;
    this.build();
    this.rebuild(true);
  }
  root;
  panel = null;
  canvasWrap;
  canvas;
  sliderBar;
  noteBar;
  poiBar;
  tableWrap;
  tooltip;
  renderer;
  vp;
  theme;
  model;
  traces = [];
  lines;
  frame = 0;
  quality = 1;
  idleTimer = 0;
  changeTimer = 0;
  resizeObserver = null;
  showTable;
  showKeyPoints = true;
  pois = [];
  poiKey = "";
  activePoi = null;
  tableRows;
  destroyed = false;
  /* ------------------------------------------------------------- layout */
  build() {
    if (this.opts.editable) {
      this.panel = this.root.createDiv({ cls: "plotline-panel" });
    }
    const main = this.root.createDiv({ cls: "plotline-main" });
    const toolbar = main.createDiv({ cls: "plotline-toolbar" });
    this.buildToolbar(toolbar);
    this.canvasWrap = main.createDiv({ cls: "plotline-canvas-wrap" });
    this.canvas = this.canvasWrap.createEl("canvas", { cls: "plotline-canvas" });
    this.canvas.tabIndex = 0;
    this.tooltip = this.canvasWrap.createDiv({ cls: "plotline-tooltip" });
    this.tooltip.hide();
    this.sliderBar = main.createDiv({ cls: "plotline-sliders" });
    this.noteBar = main.createDiv({ cls: "plotline-notes" });
    this.poiBar = main.createDiv({ cls: "plotline-poi" });
    this.tableWrap = main.createDiv({ cls: "plotline-table-wrap" });
    this.tableWrap.hide();
    this.renderer = new Renderer(this.canvas);
    this.vp = new Viewport(DEFAULT_OPTIONS);
    this.theme = readTheme(this.root);
    this.attachPointer();
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.canvasWrap);
  }
  buildToolbar(bar) {
    const title = bar.createDiv({ cls: "plotline-title" });
    const spacer = bar.createDiv({ cls: "plotline-spacer" });
    spacer.setText("");
    const btn = (icon, tip, fn) => {
      const b = bar.createEl("button", { cls: "plotline-btn", attr: { "aria-label": tip, title: tip } });
      (0, import_obsidian.setIcon)(b, icon);
      b.addEventListener("click", (e) => {
        e.preventDefault();
        fn();
      });
      return b;
    };
    this.titleEl = title;
    btn("zoom-in", "Zoom in", () => {
      this.vp.zoomAt(this.vp.width / 2, this.vp.height / 2, 1 / 1.4);
      this.schedule();
    });
    btn("zoom-out", "Zoom out", () => {
      this.vp.zoomAt(this.vp.width / 2, this.vp.height / 2, 1.4);
      this.schedule();
    });
    btn("square", "Equal axis scaling", () => {
      this.vp.equalize();
      this.schedule();
    });
    btn("home", "Reset view", () => this.resetView());
    const keyBtn = btn("crosshair", "Key points \u2014 intersections, zeros, turning points", () => {
      this.showKeyPoints = !this.showKeyPoints;
      this.poiKey = "";
      this.activePoi = null;
      keyBtn.toggleClass("is-active", this.showKeyPoints);
      this.schedule();
    });
    const tableBtn = btn("table", "Data table", () => {
      this.showTable = !this.showTable;
      tableBtn.toggleClass("is-active", this.showTable);
      this.renderTable();
    });
    this.toggleButtons = { keyPoints: keyBtn, table: tableBtn };
    btn("image-down", "Save the graph as a PNG", () => this.exportPng());
    btn("copy", "Copy the graph to the clipboard", () => this.copyPng());
  }
  titleEl;
  toggleButtons = null;
  layout() {
    if (this.destroyed) return;
    const width = this.canvasWrap.clientWidth;
    const height = this.model ? this.model.options.height : DEFAULT_OPTIONS.height;
    if (width <= 0) return;
    this.canvasWrap.style.height = `${height}px`;
    this.renderer.resize(this.vp, width, height);
    this.schedule();
  }
  /* -------------------------------------------------------------- model */
  /** Re-parse the source. `resetView` re-applies the bounds from the block. */
  rebuild(resetView) {
    const base = { ...DEFAULT_OPTIONS, ...this.opts.defaults ?? {} };
    this.model = buildModel(this.lines, base);
    if (resetView) {
      this.vp.set(this.model.options);
      this.showTable = this.model.options.showTable;
      this.tableRows = this.model.options.tableRows;
      this.showKeyPoints = this.model.options.keyPoints;
    }
    this.poiKey = "";
    this.activePoi = null;
    this.toggleButtons?.keyPoints.toggleClass("is-active", this.showKeyPoints);
    this.toggleButtons?.table.toggleClass("is-active", this.showTable);
    this.titleEl.setText(this.model.options.title);
    this.titleEl.toggleClass("is-empty", this.model.options.title === "");
    this.renderPanel();
    this.renderSliders();
    this.layout();
    this.renderTable();
  }
  notifyChange() {
    if (!this.opts.onChange) return;
    window.clearTimeout(this.changeTimer);
    this.changeTimer = window.setTimeout(() => this.opts.onChange?.(this.lines.slice()), 400);
  }
  getSource() {
    return this.lines.join("\n");
  }
  /* --------------------------------------------------------------- draw */
  schedule() {
    if (this.frame || this.destroyed) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }
  draw() {
    if (this.destroyed || !this.model || this.vp.width <= 0) return;
    this.theme = readTheme(this.root);
    const result = this.renderer.draw(this.model, this.vp, this.theme, this.quality);
    this.traces = result.traces;
    this.noteBar.empty();
    for (const note of result.notes) {
      const el = this.noteBar.createDiv({ cls: "plotline-note", text: note.text });
      el.style.setProperty("--plotline-note-color", note.color);
    }
    this.noteBar.toggleClass("is-empty", result.notes.length === 0);
    this.updateKeyPoints();
  }
  /** Solve for the key points, but never mid-drag — it is the expensive part,
   *  and the markers from the previous resting position are close enough
   *  while the view is still moving. */
  updateKeyPoints() {
    if (!this.showKeyPoints) {
      if (this.pois.length > 0) {
        this.pois = [];
        this.renderPoiList();
      }
      return;
    }
    const key = [
      this.vp.xmin,
      this.vp.xmax,
      this.vp.ymin,
      this.vp.ymax,
      ...this.model.params.map((p) => p.value)
    ].join(",");
    if (this.quality === 1 && key !== this.poiKey) {
      this.poiKey = key;
      this.pois = findPointsOfInterest(this.model, this.vp);
      this.renderPoiList();
    }
    this.renderer.drawMarkers(this.pois, this.vp, this.theme, this.activePoi);
  }
  /** Drop resolution while the user is dragging, restore it shortly after. */
  interacting() {
    this.quality = 0.45;
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.quality = 1;
      this.schedule();
    }, 160);
  }
  resetView() {
    this.vp.set(this.model.options);
    this.schedule();
  }
  /* ---------------------------------------------------------- pointer */
  attachPointer() {
    const canvas = this.canvas;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      lastX = e.offsetX;
      lastY = e.offsetY;
      canvas.setPointerCapture(e.pointerId);
      canvas.addClass("is-dragging");
    });
    canvas.addEventListener("pointermove", (e) => {
      if (dragging) {
        this.vp.panPixels(e.offsetX - lastX, e.offsetY - lastY);
        lastX = e.offsetX;
        lastY = e.offsetY;
        this.interacting();
        this.tooltip.hide();
        this.schedule();
      } else {
        this.updateTrace(e.offsetX, e.offsetY);
      }
    });
    const stop = (e) => {
      dragging = false;
      canvas.removeClass("is-dragging");
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", () => this.tooltip.hide());
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = Math.pow(1.0016, e.deltaY);
        const axis = e.shiftKey ? "x" : e.altKey ? "y" : "both";
        this.vp.zoomAt(e.offsetX, e.offsetY, factor, axis);
        this.interacting();
        this.schedule();
      },
      { passive: false }
    );
    canvas.addEventListener("dblclick", () => this.resetView());
    canvas.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 80 : 30;
      switch (e.key) {
        case "ArrowLeft":
          this.vp.panPixels(step, 0);
          break;
        case "ArrowRight":
          this.vp.panPixels(-step, 0);
          break;
        case "ArrowUp":
          this.vp.panPixels(0, step);
          break;
        case "ArrowDown":
          this.vp.panPixels(0, -step);
          break;
        case "+":
        case "=":
          this.vp.zoomAt(this.vp.width / 2, this.vp.height / 2, 1 / 1.4);
          break;
        case "-":
          this.vp.zoomAt(this.vp.width / 2, this.vp.height / 2, 1.4);
          break;
        case "0":
          this.resetView();
          return;
        default:
          return;
      }
      e.preventDefault();
      this.schedule();
    });
  }
  /** What the cursor is over: a solved key point if one is near, otherwise the
   *  nearest sampled point on a curve. */
  updateTrace(px, py) {
    let nearest = null;
    for (const poi of this.pois) {
      const d = Math.hypot(this.vp.sx(poi.x) - px, this.vp.sy(poi.y) - py);
      if (d < TRACE_RADIUS && (!nearest || d < nearest.d)) nearest = { poi, d };
    }
    if (nearest) {
      const { poi } = nearest;
      if (this.activePoi === poi) return;
      this.activePoi = poi;
      const sx = this.vp.sx(poi.x);
      const sy = this.vp.sy(poi.y);
      this.tracePoint = { px: sx, py: sy };
      this.showTooltip(`${POI_LABEL[poi.kind]}  (${formatNumber(poi.x)}, ${formatNumber(poi.y)})`, poi.color, sx, sy);
      this.draw();
      return;
    }
    const hadActive = this.activePoi !== null;
    this.activePoi = null;
    let best = null;
    for (const t of this.traces) {
      for (const p of t.points) {
        const d = Math.hypot(p.px - px, p.py - py);
        if (d < TRACE_RADIUS && (!best || d < best.d)) best = { t, p, d };
      }
    }
    if (!best) {
      if (this.tracePoint || hadActive) {
        this.tracePoint = null;
        this.tooltip.hide();
        this.schedule();
      }
      return;
    }
    if (!hadActive && this.tracePoint && Math.abs(this.tracePoint.px - best.p.px) < 0.5 && Math.abs(this.tracePoint.py - best.p.py) < 0.5) {
      return;
    }
    this.tracePoint = { px: best.p.px, py: best.p.py };
    this.showTooltip(
      `(${formatNumber(best.p.x)}, ${formatNumber(best.p.y)})`,
      best.t.style.color,
      best.p.px,
      best.p.py
    );
    this.draw();
    this.markTrace(best.p.px, best.p.py, best.t.style.color);
  }
  tracePoint = null;
  showTooltip(text, color, px, py) {
    this.tooltip.show();
    this.tooltip.setText(text);
    this.tooltip.style.setProperty("--plotline-trace-color", color);
    const width = this.tooltip.offsetWidth || 110;
    this.tooltip.style.left = `${Math.min(this.vp.width - width - 4, Math.max(4, px + 12))}px`;
    this.tooltip.style.top = `${Math.min(this.vp.height - 30, Math.max(4, py - 34))}px`;
  }
  /** A ring on the traced point, painted straight after a redraw. */
  markTrace(px, py, color) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.theme.background;
    ctx.stroke();
    ctx.restore();
  }
  /** The chips under the graph: one per solved point, click to copy. */
  renderPoiList() {
    this.poiBar.empty();
    const shown = this.pois.slice(0, 12);
    this.poiBar.toggleClass("is-empty", shown.length === 0);
    if (shown.length === 0) return;
    for (const poi of shown) {
      const chip = this.poiBar.createDiv({ cls: "plotline-chip" });
      chip.style.setProperty("--plotline-chip-color", poi.color);
      chip.createSpan({ cls: "plotline-chip-kind", text: POI_LABEL[poi.kind] });
      chip.createSpan({
        cls: "plotline-chip-value",
        text: `(${formatNumber(poi.x)}, ${formatNumber(poi.y)})`
      });
      chip.setAttr("title", `${poi.from} \u2014 click to copy`);
      chip.addEventListener("click", () => {
        void navigator.clipboard.writeText(`(${formatNumber(poi.x)}, ${formatNumber(poi.y)})`);
        new import_obsidian.Notice("Coordinates copied");
      });
      chip.addEventListener("mouseenter", () => {
        this.activePoi = poi;
        this.draw();
      });
      chip.addEventListener("mouseleave", () => {
        this.activePoi = null;
        this.schedule();
      });
    }
    if (this.pois.length > shown.length) {
      this.poiBar.createSpan({
        cls: "plotline-chip-more",
        text: `+${this.pois.length - shown.length} more on the graph`
      });
    }
  }
  /* --------------------------------------------------- expression list */
  renderPanel() {
    if (!this.panel) return;
    this.panel.empty();
    const list = this.panel.createDiv({ cls: "plotline-rows" });
    this.lines.forEach((line, index) => {
      const row = list.createDiv({ cls: "plotline-row" });
      const swatch = row.createDiv({ cls: "plotline-swatch" });
      const curve = this.model.curves.find((c) => c.line === index);
      const param = this.model.params.find((p) => p.line === index);
      if (curve) {
        swatch.style.setProperty("--plotline-swatch-color", curve.style.color);
      } else if (param) {
        swatch.addClass("is-param");
        (0, import_obsidian.setIcon)(swatch, "sliders-horizontal");
      } else {
        swatch.addClass("is-plain");
      }
      const input = row.createEl("input", {
        cls: "plotline-input",
        attr: { type: "text", spellcheck: "false", placeholder: "y = x^2" }
      });
      input.value = line;
      input.addEventListener("input", () => {
        this.lines[index] = input.value;
        this.rebuild(false);
        this.notifyChange();
        this.focusRow(index, input.selectionStart ?? input.value.length);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.lines.splice(index + 1, 0, "");
          this.rebuild(false);
          this.notifyChange();
          this.focusRow(index + 1, 0);
        } else if (e.key === "Backspace" && input.value === "" && this.lines.length > 1) {
          e.preventDefault();
          this.lines.splice(index, 1);
          this.rebuild(false);
          this.notifyChange();
          this.focusRow(Math.max(0, index - 1), Infinity);
        } else if (e.key === "ArrowDown" && index < this.lines.length - 1) {
          this.focusRow(index + 1, Infinity);
        } else if (e.key === "ArrowUp" && index > 0) {
          this.focusRow(index - 1, Infinity);
        }
      });
      const del = row.createEl("button", {
        cls: "plotline-row-del",
        attr: { "aria-label": "Delete this line", title: "Delete this line" }
      });
      (0, import_obsidian.setIcon)(del, "x");
      del.addEventListener("click", () => {
        this.lines.splice(index, 1);
        if (this.lines.length === 0) this.lines.push("");
        this.rebuild(false);
        this.notifyChange();
      });
      const error = this.model.errors.get(index);
      if (error) {
        row.addClass("has-error");
        list.createDiv({ cls: "plotline-row-error", text: error });
      }
    });
    const add = this.panel.createEl("button", { cls: "plotline-add", text: "Add expression" });
    add.addEventListener("click", () => {
      this.lines.push("");
      this.rebuild(false);
      this.notifyChange();
      this.focusRow(this.lines.length - 1, 0);
    });
  }
  focusRow(index, caret) {
    if (!this.panel) return;
    const inputs = this.panel.querySelectorAll(".plotline-input");
    const input = inputs[index];
    if (!input) return;
    input.focus();
    const pos = caret === Infinity ? input.value.length : caret;
    input.setSelectionRange(pos, pos);
  }
  /* -------------------------------------------------------------- sliders */
  renderSliders() {
    this.sliderBar.empty();
    this.sliderBar.toggleClass("is-empty", this.model.params.length === 0);
    for (const param of this.model.params) this.renderSlider(param);
  }
  renderSlider(param) {
    const row = this.sliderBar.createDiv({ cls: "plotline-slider" });
    const label = row.createSpan({ cls: "plotline-slider-name", text: param.name });
    label.setAttr("title", `${param.name} \u2208 [${param.min}, ${param.max}]`);
    const play = row.createEl("button", {
      cls: "plotline-slider-play",
      attr: { "aria-label": "Animate", title: "Animate this parameter" }
    });
    (0, import_obsidian.setIcon)(play, "play");
    const input = row.createEl("input", {
      cls: "plotline-range",
      attr: {
        type: "range",
        min: String(param.min),
        max: String(param.max),
        step: String(param.step)
      }
    });
    input.value = String(param.value);
    const value = row.createSpan({ cls: "plotline-slider-value", text: formatNumber(param.value, 3) });
    const apply = (v) => {
      param.value = v;
      this.model.scope[param.name] = v;
      value.setText(formatNumber(v, 3));
      this.interacting();
      this.schedule();
      this.renderTableBody();
    };
    input.addEventListener("input", () => {
      apply(Number(input.value));
      this.syncParamLine(param);
    });
    let timer = 0;
    let direction = 1;
    const stopAnim = () => {
      window.clearInterval(timer);
      timer = 0;
      (0, import_obsidian.setIcon)(play, "play");
    };
    play.addEventListener("click", () => {
      if (timer) {
        stopAnim();
        return;
      }
      (0, import_obsidian.setIcon)(play, "pause");
      const stride = (param.max - param.min) / 120;
      timer = window.setInterval(() => {
        if (this.destroyed) {
          stopAnim();
          return;
        }
        let next = param.value + stride * direction;
        if (next > param.max) {
          next = param.max;
          direction = -1;
        } else if (next < param.min) {
          next = param.min;
          direction = 1;
        }
        input.value = String(next);
        apply(next);
      }, 40);
    });
    this.animationTimers.push(() => stopAnim());
  }
  animationTimers = [];
  /** Write a dragged slider value back into its own source line. */
  syncParamLine(param) {
    const line = this.lines[param.line];
    if (line === void 0) return;
    const eq = line.indexOf("=");
    if (eq < 0) return;
    const slider = line.match(/\[[^\]]*\]\s*$/);
    const tail = slider ? ` ${slider[0].trim()}` : "";
    this.lines[param.line] = `${line.slice(0, eq + 1)} ${formatNumber(param.value, 4)}${tail}`;
    if (this.panel) {
      const input = this.panel.querySelectorAll(".plotline-input")[param.line];
      if (input && document.activeElement !== input) input.value = this.lines[param.line];
    }
    this.notifyChange();
  }
  /* ---------------------------------------------------------- data table */
  renderTable() {
    this.tableWrap.empty();
    if (!this.showTable) {
      this.tableWrap.hide();
      return;
    }
    this.tableWrap.show();
    const head = this.tableWrap.createDiv({ cls: "plotline-table-head" });
    head.createSpan({ cls: "plotline-table-title", text: "Data" });
    const rows = head.createEl("input", {
      cls: "plotline-rows-input",
      attr: { type: "number", min: "2", max: "200", step: "1", title: "Number of sample rows" }
    });
    rows.value = String(this.tableRows);
    rows.addEventListener("change", () => {
      this.tableRows = Math.max(2, Math.min(200, Number(rows.value) || 11));
      this.renderTableBody();
    });
    const copy = head.createEl("button", { cls: "plotline-btn plotline-btn-text", text: "Copy Markdown" });
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(this.tableMarkdown());
      new import_obsidian.Notice("Table copied as Markdown");
    });
    this.tableBody = this.tableWrap.createDiv({ cls: "plotline-table-body" });
    this.renderTableBody();
  }
  tableBody = null;
  tableColumns() {
    const cols = [];
    for (const curve of this.model.curves) {
      if (curve.type !== "explicit" || curve.of !== "y") continue;
      const scope = Object.assign(/* @__PURE__ */ Object.create(null), this.model.scope);
      cols.push({
        label: curve.style.label || `f${cols.length + 1}(x)`,
        color: curve.style.color,
        f: (x) => {
          scope.x = x;
          for (const p of this.model.params) scope[p.name] = p.value;
          return curve.f(scope);
        }
      });
    }
    return cols;
  }
  tableData() {
    const cols = this.tableColumns();
    const n = Math.max(2, this.tableRows);
    const xs = [];
    for (let i = 0; i < n; i++) xs.push(this.vp.xmin + (this.vp.xmax - this.vp.xmin) * i / (n - 1));
    return { xs, cols };
  }
  renderTableBody() {
    if (!this.showTable || !this.tableBody) return;
    this.tableBody.empty();
    const { xs, cols } = this.tableData();
    const pointSets = this.model.curves.filter((c) => c.type === "points");
    if (cols.length === 0 && pointSets.length === 0) {
      this.tableBody.createDiv({ cls: "plotline-table-empty", text: "No y = f(x) expression to tabulate." });
      return;
    }
    if (cols.length > 0) {
      const table = this.tableBody.createEl("table", { cls: "plotline-table" });
      const thead = table.createEl("thead").createEl("tr");
      thead.createEl("th", { text: "x" });
      for (const c of cols) {
        const th = thead.createEl("th", { text: c.label });
        th.style.setProperty("--plotline-col-color", c.color);
      }
      const tbody = table.createEl("tbody");
      for (const x of xs) {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: formatNumber(x, 4) });
        for (const c of cols) tr.createEl("td", { text: formatNumber(c.f(x), 4) });
      }
    }
    for (const set of pointSets) {
      if (set.type !== "points") continue;
      const table = this.tableBody.createEl("table", { cls: "plotline-table" });
      const thead = table.createEl("thead").createEl("tr");
      thead.createEl("th", { text: set.style.label || "x" });
      thead.createEl("th", { text: "y" });
      const tbody = table.createEl("tbody");
      for (const [x, y] of set.pts) {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: formatNumber(x, 4) });
        tr.createEl("td", { text: formatNumber(y, 4) });
      }
    }
  }
  tableMarkdown() {
    const { xs, cols } = this.tableData();
    if (cols.length === 0) {
      const set = this.model.curves.find((c) => c.type === "points");
      if (set && set.type === "points") {
        const head = "| x | y |\n|---|---|\n";
        return head + set.pts.map(([x, y]) => `| ${formatNumber(x, 4)} | ${formatNumber(y, 4)} |`).join("\n");
      }
      return "";
    }
    const header = `| x | ${cols.map((c) => c.label).join(" | ")} |`;
    const rule = `|${"---|".repeat(cols.length + 1)}`;
    const body = xs.map((x) => `| ${formatNumber(x, 4)} | ${cols.map((c) => formatNumber(c.f(x), 4)).join(" | ")} |`).join("\n");
    return `${header}
${rule}
${body}`;
  }
  /* -------------------------------------------------------------- export */
  exportPng() {
    this.quality = 1;
    this.draw();
    const url = this.canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.model.options.title || "plotline-graph"}.png`;
    a.click();
  }
  copyPng() {
    this.quality = 1;
    this.draw();
    this.canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        new import_obsidian.Notice("Graph copied to the clipboard");
      } catch {
        new import_obsidian.Notice("Could not copy the graph \u2014 the clipboard refused an image");
      }
    });
  }
  /* ------------------------------------------------------------- teardown */
  destroy() {
    this.destroyed = true;
    this.animationTimers.forEach((stop) => stop());
    this.resizeObserver?.disconnect();
    window.cancelAnimationFrame(this.frame);
    window.clearTimeout(this.idleTimer);
    window.clearTimeout(this.changeTimer);
  }
  /** Repaint after a theme change. */
  refreshTheme() {
    this.theme = readTheme(this.root);
    this.schedule();
  }
};

// src/scientific.ts
var import_obsidian2 = require("obsidian");
var CalcSession = class {
  vars = /* @__PURE__ */ Object.create(null);
  funcs = /* @__PURE__ */ new Map();
  env = { funcs: this.funcs };
  degrees = false;
  constructor() {
    this.vars.ans = 0;
  }
  reset() {
    for (const key of Object.keys(this.vars)) delete this.vars[key];
    this.vars.ans = 0;
    this.funcs.clear();
  }
  context(extra = []) {
    return {
      isFunction: (name) => isBuiltinFunction(name) || this.funcs.has(name),
      isValue: (name) => isConstant(name) || name in this.vars || extra.includes(name)
    };
  }
  /** Evaluate one line. Never throws: a bad line comes back as an error result. */
  evaluate(line) {
    const source = line.trim();
    if (!source) return { kind: "blank", source, value: NaN, text: "" };
    if (source.startsWith("#") || source.startsWith("//")) {
      return { kind: "comment", source: source.replace(/^(#|\/\/)\s?/, ""), value: NaN, text: "" };
    }
    const mode = source.toLowerCase();
    if (mode === "deg" || mode === "degrees") {
      this.degrees = true;
      return { kind: "comment", source, value: NaN, text: "degrees" };
    }
    if (mode === "rad" || mode === "radians") {
      this.degrees = false;
      return { kind: "comment", source, value: NaN, text: "radians" };
    }
    setAngleMode(this.degrees);
    try {
      const eq = topLevelEquals(source);
      if (eq >= 0) {
        const lhs = source.slice(0, eq).trim();
        const rhs = source.slice(eq + 1).trim();
        const def = lhs.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)$/);
        if (def) {
          const name = def[1];
          const params = def[2].split(",").map((s) => s.trim()).filter(Boolean);
          const body = compile(parse(rhs, this.context(params)), this.env);
          this.funcs.set(name, { params, body });
          return { kind: "define", source, value: NaN, text: `${name}(${params.join(", ")}) defined` };
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(lhs) && !isConstant(lhs)) {
          const value2 = compile(parse(rhs, this.context()), this.env)(this.vars);
          this.vars[lhs] = value2;
          this.vars.ans = value2;
          return { kind: "assign", source, value: value2, text: `${lhs} = ${formatNumber(value2, 10)}` };
        }
      }
      const value = compile(parse(source, this.context()), this.env)(this.vars);
      this.vars.ans = value;
      return { kind: "value", source, value, text: formatNumber(value, 10) };
    } catch (err) {
      const message = err instanceof ExprError || err instanceof Error ? err.message : String(err);
      return { kind: "error", source, value: NaN, text: message };
    }
  }
  /** Evaluate without recording anything — used for the live preview. */
  peek(line) {
    const source = line.trim();
    if (!source) return "";
    setAngleMode(this.degrees);
    try {
      const eq = topLevelEquals(source);
      const expr = eq >= 0 ? source.slice(eq + 1) : source;
      if (eq >= 0 && /\(/.test(source.slice(0, eq))) return "";
      const value = compile(parse(expr.trim(), this.context()), this.env)(this.vars);
      return Number.isNaN(value) ? "" : formatNumber(value, 10);
    } catch {
      return "";
    }
  }
};
var KEYS = [
  [
    { label: "sin", insert: "sin(" },
    { label: "cos", insert: "cos(" },
    { label: "tan", insert: "tan(" },
    { label: "(", insert: "(" },
    { label: ")", insert: ")" }
  ],
  [
    { label: "ln", insert: "ln(" },
    { label: "log", insert: "log(" },
    { label: "\u221A", insert: "sqrt(" },
    { label: "x^y", insert: "^" },
    { label: "n!", insert: "!" }
  ],
  [
    { label: "\u03C0", insert: "pi" },
    { label: "e", insert: "e" },
    { label: "ans", insert: "ans" },
    { label: "\u232B", action: "back" },
    { label: "C", action: "clear" }
  ],
  [
    { label: "7", insert: "7" },
    { label: "8", insert: "8" },
    { label: "9", insert: "9" },
    { label: "\xF7", insert: "/" },
    { label: "mod", insert: "mod(" }
  ],
  [
    { label: "4", insert: "4" },
    { label: "5", insert: "5" },
    { label: "6", insert: "6" },
    { label: "\xD7", insert: "*" },
    { label: "|x|", insert: "abs(" }
  ],
  [
    { label: "1", insert: "1" },
    { label: "2", insert: "2" },
    { label: "3", insert: "3" },
    { label: "\u2212", insert: "-" },
    { label: ",", insert: "," }
  ],
  [
    { label: "0", insert: "0" },
    { label: ".", insert: "." },
    { label: "(\u2212)", insert: "-" },
    { label: "+", insert: "+" },
    { label: "=", action: "equals" }
  ]
];
var ScientificCalculator = class {
  constructor(parent, opts = {}) {
    this.opts = opts;
    this.session.degrees = opts.degrees ?? false;
    this.root = parent.createDiv({ cls: "plotline-sci" });
    this.build();
  }
  root;
  tape;
  input;
  preview;
  session = new CalcSession();
  history = [];
  build() {
    this.tape = this.root.createDiv({ cls: "plotline-sci-tape" });
    this.renderTape();
    const entry = this.root.createDiv({ cls: "plotline-sci-entry" });
    this.input = entry.createEl("input", {
      cls: "plotline-sci-input",
      attr: { type: "text", spellcheck: "false", placeholder: "2 + 2, or a = 9.81" }
    });
    this.preview = entry.createDiv({ cls: "plotline-sci-preview" });
    this.input.addEventListener("input", () => this.updatePreview());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "ArrowUp" && this.history.length > 0) {
        e.preventDefault();
        const last = [...this.history].reverse().find((h) => h.kind !== "error");
        if (last) this.setInput(last.source);
      } else if (e.key === "Escape") {
        this.setInput("");
      }
    });
    const pad = this.root.createDiv({ cls: "plotline-sci-pad" });
    for (const row of KEYS) {
      for (const key of row) {
        const b = pad.createEl("button", { cls: "plotline-key", text: key.label });
        if (key.action === "equals") b.addClass("is-equals");
        if (!key.insert && key.action !== "equals") b.addClass("is-util");
        b.addEventListener("click", (e) => {
          e.preventDefault();
          if (key.action === "equals") this.submit();
          else if (key.action === "clear") this.setInput("");
          else if (key.action === "back") this.backspace();
          else if (key.insert) this.insert(key.insert);
        });
      }
    }
    const footer = this.root.createDiv({ cls: "plotline-sci-footer" });
    const angle = footer.createEl("button", { cls: "plotline-btn plotline-btn-text" });
    const paintAngle = () => angle.setText(this.session.degrees ? "DEG" : "RAD");
    paintAngle();
    angle.setAttr("title", "Switch between degrees and radians");
    angle.addEventListener("click", () => {
      this.session.degrees = !this.session.degrees;
      paintAngle();
      this.updatePreview();
    });
    const clear = footer.createEl("button", {
      cls: "plotline-btn",
      attr: { "aria-label": "Clear the tape and every variable", title: "Clear the tape and every variable" }
    });
    (0, import_obsidian2.setIcon)(clear, "trash-2");
    clear.addEventListener("click", () => {
      this.history = [];
      this.session.reset();
      this.renderTape();
      this.updatePreview();
    });
    if (this.opts.onInsert) {
      const insert = footer.createEl("button", { cls: "plotline-btn plotline-btn-text", text: "Insert into note" });
      insert.addEventListener("click", () => this.opts.onInsert?.(this.asMarkdown()));
    }
  }
  setInput(text) {
    this.input.value = text;
    this.input.focus();
    this.updatePreview();
  }
  insert(text) {
    const start = this.input.selectionStart ?? this.input.value.length;
    const end = this.input.selectionEnd ?? start;
    this.input.value = this.input.value.slice(0, start) + text + this.input.value.slice(end);
    const caret = start + text.length;
    this.input.focus();
    this.input.setSelectionRange(caret, caret);
    this.updatePreview();
  }
  backspace() {
    const start = this.input.selectionStart ?? this.input.value.length;
    const end = this.input.selectionEnd ?? start;
    if (start === end && start > 0) {
      this.input.value = this.input.value.slice(0, start - 1) + this.input.value.slice(start);
      this.input.focus();
      this.input.setSelectionRange(start - 1, start - 1);
    } else {
      this.input.value = this.input.value.slice(0, start) + this.input.value.slice(end);
      this.input.focus();
      this.input.setSelectionRange(start, start);
    }
    this.updatePreview();
  }
  updatePreview() {
    const text = this.session.peek(this.input.value);
    this.preview.setText(text ? `= ${text}` : "");
    this.preview.toggleClass("is-empty", text === "");
  }
  submit() {
    const line = this.input.value.trim();
    if (!line) return;
    const result = this.session.evaluate(line);
    this.history.push(result);
    if (this.history.length > 60) this.history.shift();
    this.renderTape();
    if (result.kind !== "error") this.setInput("");
    else this.updatePreview();
  }
  renderTape() {
    this.tape.empty();
    if (this.history.length === 0) {
      this.tape.createDiv({
        cls: "plotline-sci-hint",
        text: "Type an expression and press Enter. Assign with a = 9.81, define with f(x) = x^2, and reuse the last answer as ans."
      });
      return;
    }
    for (const entry of this.history) {
      const row = this.tape.createDiv({ cls: `plotline-sci-row is-${entry.kind}` });
      const src = row.createDiv({ cls: "plotline-sci-src", text: entry.source });
      src.addEventListener("click", () => this.setInput(entry.source));
      row.createDiv({ cls: "plotline-sci-out", text: entry.kind === "error" ? entry.text : `= ${entry.text}` });
    }
    this.tape.scrollTop = this.tape.scrollHeight;
  }
  /** The tape as a Markdown list, for dropping into a note. */
  asMarkdown() {
    const lines = this.history.filter((h) => h.kind === "value" || h.kind === "assign").map((h) => `- \`${h.source}\` = **${h.text.replace(/^[^=]*=\s*/, "")}**`);
    if (lines.length === 0) {
      new import_obsidian2.Notice("Nothing on the tape yet");
      return "";
    }
    return `${lines.join("\n")}
`;
  }
};
function renderWorksheet(source, el, degrees) {
  const wrap = el.createDiv({ cls: "plotline-worksheet" });
  const session = new CalcSession();
  session.degrees = degrees;
  let total = 0;
  let any = false;
  for (const line of source.replace(/\r/g, "").split("\n")) {
    const result = session.evaluate(line);
    if (result.kind === "blank") continue;
    const row = wrap.createDiv({ cls: `plotline-calc-row is-${result.kind}` });
    if (result.kind === "comment") {
      row.createDiv({ cls: "plotline-calc-note", text: result.source });
      continue;
    }
    row.createDiv({ cls: "plotline-calc-src", text: result.source });
    row.createDiv({ cls: "plotline-calc-out", text: result.text });
    if (result.kind === "value" && Number.isFinite(result.value)) {
      total += result.value;
      any = true;
    }
  }
  if (any) {
    const foot = wrap.createDiv({ cls: "plotline-calc-total" });
    foot.createDiv({ cls: "plotline-calc-src", text: "total" });
    foot.createDiv({ cls: "plotline-calc-out", text: formatNumber(total, 10) });
  }
}

// src/view.ts
var import_obsidian3 = require("obsidian");
var VIEW_TYPE_PLOTLINE = "plotline-calculator";
var PlotlineView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  calculator = null;
  scientific = null;
  mode = "graph";
  body = null;
  bar = null;
  getViewType() {
    return VIEW_TYPE_PLOTLINE;
  }
  getDisplayText() {
    return this.mode === "graph" ? "Graphing calculator" : "Scientific calculator";
  }
  getIcon() {
    return this.mode === "graph" ? "line-chart" : "calculator";
  }
  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("plotline-view");
    this.mode = this.plugin.settings.lastMode === "scientific" ? "scientific" : "graph";
    this.bar = container.createDiv({ cls: "plotline-viewbar" });
    this.body = container.createDiv({ cls: "plotline-view-host" });
    this.render();
  }
  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.plugin.settings.lastMode = mode;
    void this.plugin.saveSettings();
    this.render();
    this.leaf.setViewState({ type: VIEW_TYPE_PLOTLINE, active: true });
  }
  render() {
    if (!this.bar || !this.body) return;
    this.teardown();
    this.bar.empty();
    this.body.empty();
    const group = this.bar.createDiv({ cls: "plotline-modes" });
    const tab = (label, mode) => {
      const b = group.createEl("button", { cls: "plotline-mode", text: label });
      b.toggleClass("is-active", this.mode === mode);
      b.addEventListener("click", () => this.setMode(mode));
    };
    tab("Graph", "graph");
    tab("Calculator", "scientific");
    if (this.mode === "graph") {
      const insert = this.bar.createEl("button", { cls: "plotline-btn plotline-btn-text", text: "Insert into note" });
      insert.addEventListener("click", () => this.insertIntoNote());
      const clear = this.bar.createEl("button", { cls: "plotline-btn plotline-btn-text", text: "Clear" });
      clear.addEventListener("click", () => this.reset(""));
      const source = this.plugin.settings.rememberSession ? this.plugin.settings.lastSession : "y = x^2";
      this.calculator = new Calculator(this.body, source || "", {
        editable: true,
        defaults: this.plugin.blockDefaults(),
        onChange: (lines) => {
          this.plugin.settings.lastSession = lines.join("\n");
          void this.plugin.saveSettings();
        }
      });
    } else {
      this.scientific = new ScientificCalculator(this.body, {
        degrees: this.plugin.settings.degrees,
        onInsert: (text) => this.writeToNote(text)
      });
    }
  }
  reset(source) {
    this.plugin.settings.lastSession = source;
    void this.plugin.saveSettings();
    this.render();
  }
  /** Drop the current expression list into the last markdown note as a block. */
  insertIntoNote() {
    const source = this.calculator?.getSource() ?? "";
    this.writeToNote("```plot\n" + source.replace(/\s+$/, "") + "\n```\n");
  }
  writeToNote(text) {
    if (!text) return;
    const markdown = this.plugin.lastMarkdownView();
    if (!markdown) {
      new import_obsidian3.Notice("Open a note first \u2014 Plotline has nowhere to insert this");
      return;
    }
    const editor = markdown.editor;
    editor.replaceRange(text, editor.getCursor());
    this.app.workspace.setActiveLeaf(markdown.leaf, { focus: true });
    new import_obsidian3.Notice("Inserted");
  }
  teardown() {
    this.calculator?.destroy();
    this.calculator = null;
    this.scientific = null;
  }
  async onClose() {
    this.teardown();
  }
};

// src/main.ts
var BLOCK_LANGUAGES = ["plot", "plotline", "desmos"];
var CALC_LANGUAGES = ["calc", "calculate"];
var DEFAULT_SETTINGS = {
  xRange: "-10, 10",
  yRange: "-6.5, 6.5",
  height: 380,
  grid: true,
  minorGrid: true,
  labels: true,
  degrees: false,
  tableRows: 11,
  keyPoints: true,
  editableBlocks: false,
  rememberSession: true,
  lastSession: "y = x^2",
  lastMode: "graph"
};
function parsePair(text, fallback) {
  const parts = text.split(/[,;]|\.\./).map((s) => Number(s.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)) || parts[0] >= parts[1]) return fallback;
  return [parts[0], parts[1]];
}
var PlotlinePlugin = class extends import_obsidian4.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  calculators = /* @__PURE__ */ new Set();
  lastMarkdownLeaf = null;
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_PLOTLINE, (leaf) => new PlotlineView(leaf, this));
    for (const language of BLOCK_LANGUAGES) {
      this.registerMarkdownCodeBlockProcessor(
        language,
        (source, el, ctx) => this.renderBlock(source, el, ctx)
      );
    }
    for (const language of CALC_LANGUAGES) {
      this.registerMarkdownCodeBlockProcessor(
        language,
        (source, el) => renderWorksheet(source, el, this.settings.degrees)
      );
    }
    this.addRibbonIcon("line-chart", "Plotline: graphing calculator", () => void this.openCalculator());
    this.addCommand({
      id: "open-calculator",
      name: "Open the graphing calculator",
      callback: () => void this.openCalculator()
    });
    this.addCommand({
      id: "open-scientific",
      name: "Open the scientific calculator",
      callback: () => void this.openCalculator("scientific")
    });
    this.addCommand({
      id: "calculate-selection",
      name: "Calculate the selection",
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        if (!selection) {
          new import_obsidian4.Notice("Select something to calculate first");
          return;
        }
        const session = new CalcSession();
        session.degrees = this.settings.degrees;
        const results = selection.split("\n").map((line) => session.evaluate(line));
        const last = [...results].reverse().find((r) => r.kind === "value" || r.kind === "assign");
        const failed = results.find((r) => r.kind === "error");
        if (!last) {
          new import_obsidian4.Notice(failed ? `Plotline: ${failed.text}` : "Nothing to calculate there");
          return;
        }
        editor.replaceSelection(`${selection} = ${last.text.replace(/^[^=]*=\s*/, "")}`);
      }
    });
    this.addCommand({
      id: "insert-calc-block",
      name: "Insert a calculation block",
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        editor.replaceSelection("```calc\n" + (selection || "2 + 2") + "\n```\n");
      }
    });
    this.addCommand({
      id: "insert-graph-block",
      name: "Insert a graph block",
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        const body = selection.length > 0 ? selection : "y = x^2";
        editor.replaceSelection("```plot\n" + body + "\n```\n");
      }
    });
    this.addCommand({
      id: "graph-selection",
      name: "Graph the selection in the calculator",
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        if (!selection) {
          new import_obsidian4.Notice("Select an expression first");
          return;
        }
        this.settings.lastSession = selection;
        void this.saveSettings().then(() => this.openCalculator());
      }
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf && leaf.view instanceof import_obsidian4.MarkdownView) this.lastMarkdownLeaf = leaf;
      })
    );
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        for (const calc of this.calculators) calc.refreshTheme();
      })
    );
    this.addSettingTab(new PlotlineSettingTab(this.app, this));
  }
  onunload() {
    for (const calc of this.calculators) calc.destroy();
    this.calculators.clear();
  }
  /** Block-level defaults, as configured in settings. */
  blockDefaults() {
    const [xmin, xmax] = parsePair(this.settings.xRange, [DEFAULT_OPTIONS.xmin, DEFAULT_OPTIONS.xmax]);
    const [ymin, ymax] = parsePair(this.settings.yRange, [DEFAULT_OPTIONS.ymin, DEFAULT_OPTIONS.ymax]);
    return {
      xmin,
      xmax,
      ymin,
      ymax,
      height: this.settings.height,
      grid: this.settings.grid,
      minorGrid: this.settings.minorGrid,
      labels: this.settings.labels,
      degrees: this.settings.degrees,
      tableRows: this.settings.tableRows,
      keyPoints: this.settings.keyPoints
    };
  }
  renderBlock(source, el, ctx) {
    const editable = this.settings.editableBlocks || /^\s*(editable|controls)\s*:\s*(true|on|yes|1)\s*$/im.test(source);
    const calc = new Calculator(el, source, {
      editable,
      defaults: this.blockDefaults(),
      onChange: editable ? (lines) => this.writeBack(lines, el, ctx) : void 0
    });
    this.calculators.add(calc);
    const child = new import_obsidian4.MarkdownRenderChild(el);
    child.register(() => {
      calc.destroy();
      this.calculators.delete(calc);
    });
    ctx.addChild(child);
  }
  /** Push edits from an editable block back into the note it came from. */
  writeBack(lines, el, ctx) {
    const info = ctx.getSectionInfo(el);
    if (!info) return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view || view.file?.path !== ctx.sourcePath) return;
    const editor = view.editor;
    const from = { line: info.lineStart + 1, ch: 0 };
    const to = { line: info.lineEnd, ch: 0 };
    const next = lines.join("\n") + "\n";
    if (editor.getRange(from, to) === next) return;
    editor.replaceRange(next, from, to);
  }
  async openCalculator(mode) {
    const { workspace } = this.app;
    if (mode) {
      this.settings.lastMode = mode;
      await this.saveSettings();
    }
    const existing = workspace.getLeavesOfType(VIEW_TYPE_PLOTLINE);
    if (existing.length > 0) {
      const view = existing[0].view;
      if (mode && view instanceof PlotlineView) view.setMode(mode);
      await workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_PLOTLINE, active: true });
    await workspace.revealLeaf(leaf);
  }
  lastMarkdownView() {
    const active = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (active) return active;
    const view = this.lastMarkdownLeaf?.view;
    if (view instanceof import_obsidian4.MarkdownView) return view;
    const leaf = this.app.workspace.getLeavesOfType("markdown")[0];
    return leaf && leaf.view instanceof import_obsidian4.MarkdownView ? leaf.view : null;
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var PlotlineSettingTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian4.Setting(containerEl).setName("Default x range").setDesc("Applied to a block that does not set its own. Two numbers, e.g. -10, 10").addText(
      (t) => t.setValue(this.plugin.settings.xRange).onChange(async (v) => {
        this.plugin.settings.xRange = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Default y range").addText(
      (t) => t.setValue(this.plugin.settings.yRange).onChange(async (v) => {
        this.plugin.settings.yRange = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Graph height").setDesc("Pixels. A block can override this with height: 500").addSlider(
      (s) => s.setLimits(200, 800, 10).setValue(this.plugin.settings.height).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.height = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Grid").addToggle(
      (t) => t.setValue(this.plugin.settings.grid).onChange(async (v) => {
        this.plugin.settings.grid = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Minor grid lines").addToggle(
      (t) => t.setValue(this.plugin.settings.minorGrid).onChange(async (v) => {
        this.plugin.settings.minorGrid = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Axis labels").addToggle(
      (t) => t.setValue(this.plugin.settings.labels).onChange(async (v) => {
        this.plugin.settings.labels = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Degrees").setDesc("Trigonometric functions take degrees instead of radians").addToggle(
      (t) => t.setValue(this.plugin.settings.degrees).onChange(async (v) => {
        this.plugin.settings.degrees = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Data table rows").setDesc("How many samples the table shows by default").addSlider(
      (s) => s.setLimits(3, 51, 1).setValue(this.plugin.settings.tableRows).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.tableRows = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Key points").setDesc(
      "Solve every graph for intersections, zeros, turning points and the y-intercept, mark them, and list them under the graph. A block can override this with keypoints: off"
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.keyPoints).onChange(async (v) => {
        this.plugin.settings.keyPoints = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Editable blocks").setDesc(
      "Show the expression list on every graph block and write edits back into the note. Off by default: a single block can opt in with a line reading editable: true"
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.editableBlocks).onChange(async (v) => {
        this.plugin.settings.editableBlocks = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Remember the calculator tab").setDesc("Reopen the tab with the expressions that were last in it").addToggle(
      (t) => t.setValue(this.plugin.settings.rememberSession).onChange(async (v) => {
        this.plugin.settings.rememberSession = v;
        await this.plugin.saveSettings();
      })
    );
  }
};

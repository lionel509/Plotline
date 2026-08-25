/** Expression engine: tokenise -> parse -> compile to a closure.
 *
 *  Deliberately dependency-free. Everything the grapher evaluates goes through
 *  here, including the 40k-odd samples a marching-squares pass needs, so the
 *  compiled form is a tree of closures rather than an AST walked per sample.
 */

export type Scope = Record<string, number>;
export type Compiled = (scope: Scope) => number;

export interface UserFunc {
  params: string[];
  body: Compiled;
}

/** Everything a compiled expression can reach at evaluation time. */
export interface Env {
  funcs: Map<string, UserFunc>;
}

export class ExprError extends Error {}

/** Radians by default. Degree mode rescales the trig built-ins in place; the
 *  renderer sets it once per draw, which is safe because drawing is synchronous. */
let ANGLE_SCALE = 1;

export function setAngleMode(degrees: boolean): void {
  ANGLE_SCALE = degrees ? Math.PI / 180 : 1;
}

/* ------------------------------------------------------------------ lexer */

type TokKind = "num" | "name" | "op" | "(" | ")" | "," | ":" | "{" | "}" | "|" | "eof";

interface Tok {
  kind: TokKind;
  text: string;
  pos: number;
}

/** Characters we silently rewrite before lexing, so pasted maths just works. */
const REWRITE: Record<string, string> = {
  "−": "-", // U+2212 minus
  "–": "-",
  "—": "-",
  "×": "*",
  "·": "*",
  "∗": "*",
  "÷": "/",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "√": "sqrt",
  "∞": "infinity",
  "π": "pi",
  "τ": "tau",
  "θ": "theta",
  "φ": "phi",
  "α": "alpha",
  "β": "beta",
  "γ": "gamma",
  "λ": "lambda",
  "μ": "mu",
  "ω": "omega",
};

export function normalize(src: string): string {
  let out = "";
  for (const ch of src) out += REWRITE[ch] ?? ch;
  return out;
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isAlpha(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
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
      toks.push({ kind: c as TokKind, text: c, pos: i });
      i++;
      continue;
    }
    throw new ExprError(`Unexpected character "${c}"`);
  }
  toks.push({ kind: "eof", text: "", pos: src.length });
  return toks;
}

/* ----------------------------------------------------------------- parser */

export type CmpOp = "<" | "<=" | ">" | ">=" | "=" | "!=";

export type Node =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "neg"; arg: Node }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node }
  | { kind: "cmp"; op: CmpOp; left: Node; right: Node }
  | { kind: "piecewise"; branches: { cond: Node | null; value: Node }[] }
  | { kind: "fact"; arg: Node };

export interface ParseContext {
  /** Names callable as f(...). Anything else before "(" is implicit multiplication. */
  isFunction(name: string): boolean;
  /** Names readable as a value — variables, parameters, constants. */
  isValue(name: string): boolean;
}

class Parser {
  private i = 0;

  constructor(private toks: Tok[], private ctx: ParseContext) {}

  private peek(): Tok {
    return this.toks[this.i];
  }

  private next(): Tok {
    return this.toks[this.i++];
  }

  private eat(kind: TokKind, text?: string): boolean {
    const t = this.peek();
    if (t.kind === kind && (text === undefined || t.text === text)) {
      this.i++;
      return true;
    }
    return false;
  }

  private expect(kind: TokKind, text?: string): Tok {
    if (!this.eat(kind, text)) {
      const t = this.peek();
      throw new ExprError(`Expected "${text ?? kind}" but found "${t.text || "end of expression"}"`);
    }
    return this.toks[this.i - 1];
  }

  /** Top level of a value expression (comparisons live only inside piecewise). */
  parseExpr(): Node {
    return this.parseSum();
  }

  parseComparison(): Node {
    const left = this.parseSum();
    const t = this.peek();
    if (t.kind === "op" && ["<", "<=", ">", ">=", "=", "==", "!="].includes(t.text)) {
      this.next();
      const op = (t.text === "==" ? "=" : t.text) as CmpOp;
      const right = this.parseSum();
      return { kind: "cmp", op, left, right };
    }
    return left;
  }

  atEnd(): boolean {
    return this.peek().kind === "eof";
  }

  private parseSum(): Node {
    let left = this.parseProduct();
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && (t.text === "+" || t.text === "-")) {
        this.next();
        const right = this.parseProduct();
        left = { kind: "bin", op: t.text as "+" | "-", left, right };
      } else {
        return left;
      }
    }
  }

  private parseProduct(): Node {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && (t.text === "*" || t.text === "/")) {
        this.next();
        const right = this.parseUnary();
        left = { kind: "bin", op: t.text as "*" | "/", left, right };
      } else if (this.startsFactor()) {
        // Implicit multiplication: 2x, 3sin(x), 2(x+1), x(x+1), a b.
        const right = this.parseUnary();
        left = { kind: "bin", op: "*", left, right };
      } else {
        return left;
      }
    }
  }

  /** True when the next token can begin a factor, i.e. juxtaposition means "times". */
  private startsFactor(): boolean {
    const t = this.peek();
    if (t.kind === "num" || t.kind === "name" || t.kind === "(" || t.kind === "|" || t.kind === "{") {
      // "|" is ambiguous: it also closes an absolute value. The caller inside
      // |...| stops before us by parsing a bounded expression, so treating a
      // bar as a factor start here is only reached outside such a group.
      return true;
    }
    return false;
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t.kind === "op" && (t.text === "-" || t.text === "+")) {
      this.next();
      const arg = this.parseUnary();
      return t.text === "-" ? { kind: "neg", arg } : arg;
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePostfix();
    const t = this.peek();
    if (t.kind === "op" && t.text === "^") {
      this.next();
      const exp = this.parseUnary(); // right-associative, and 2^-1 works
      return { kind: "bin", op: "^", left: base, right: exp };
    }
    return base;
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    while (this.peek().kind === "op" && this.peek().text === "!") {
      this.next();
      node = { kind: "fact", arg: node };
    }
    return node;
  }

  private parsePrimary(): Node {
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
        const inner = this.parseSum();
        this.expect("|");
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

  private parseName(t: Tok): Node {
    const name = t.text;
    if (this.peek().kind === "(" && this.ctx.isFunction(name)) {
      this.next();
      const args: Node[] = [];
      if (this.peek().kind !== ")") {
        do {
          args.push(this.parseSum());
        } while (this.eat(","));
      }
      this.expect(")");
      return { kind: "call", name, args };
    }
    if (this.ctx.isValue(name)) return { kind: "var", name };

    // Unknown multi-letter run: Desmos-style, "xy" means x*y — but only when
    // every letter is itself a known value. Otherwise it is a real typo.
    if (name.length > 1 && [...name].every((c) => this.ctx.isValue(c))) {
      let node: Node = { kind: "var", name: name[0] };
      for (const c of name.slice(1)) {
        node = { kind: "bin", op: "*", left: node, right: { kind: "var", name: c } };
      }
      return node;
    }
    if (this.ctx.isFunction(name)) throw new ExprError(`"${name}" is a function — write ${name}(x)`);
    throw new ExprError(`Unknown name "${name}"`);
  }

  /** Desmos piecewise: {x > 0: x^2, x < 0: -x, 0} — a trailing bare value is the else. */
  private parsePiecewise(): Node {
    const branches: { cond: Node | null; value: Node }[] = [];
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
}

export function parse(source: string, ctx: ParseContext): Node {
  const p = new Parser(lex(normalize(source)), ctx);
  const node = p.parseExpr();
  if (!p.atEnd()) throw new ExprError("Unexpected trailing input");
  return node;
}

/** Parse a value expression that may be a bare comparison (used for inequalities). */
export function parseRelation(source: string, ctx: ParseContext): Node {
  const p = new Parser(lex(normalize(source)), ctx);
  const node = p.parseComparison();
  if (!p.atEnd()) throw new ExprError("Unexpected trailing input");
  return node;
}

/* -------------------------------------------------------------- built-ins */

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
  infinity: Infinity,
};

function factorial(n: number): number {
  if (!Number.isFinite(n) || n < 0) return NaN;
  if (Math.abs(n - Math.round(n)) > 1e-9) return gamma(n + 1);
  let out = 1;
  for (let i = 2; i <= Math.round(n); i++) out *= i;
  return out;
}

/** Lanczos approximation — only used for non-integer factorials. */
function gamma(z: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

interface Builtin {
  arity: number | [number, number];
  fn: (...a: number[]) => number;
}

function fixed(arity: number, fn: (...a: number[]) => number): Builtin {
  return { arity, fn };
}

export const BUILTINS: Record<string, Builtin> = {
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
  log: { arity: [1, 2], fn: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)) },
  log2: fixed(1, Math.log2),
  sqrt: fixed(1, Math.sqrt),
  cbrt: fixed(1, Math.cbrt),
  abs: fixed(1, Math.abs),
  sign: fixed(1, Math.sign),
  floor: fixed(1, Math.floor),
  ceil: fixed(1, Math.ceil),
  round: { arity: [1, 2], fn: (x, d) => (d === undefined ? Math.round(x) : Math.round(x * 10 ** d) / 10 ** d) },
  trunc: fixed(1, Math.trunc),
  mod: fixed(2, (a, b) => ((a % b) + b) % b),
  hypot: { arity: [1, 8], fn: (...a) => Math.hypot(...a) },
  min: { arity: [1, 8], fn: (...a) => Math.min(...a) },
  max: { arity: [1, 8], fn: (...a) => Math.max(...a) },
  pow: fixed(2, Math.pow),
  nCr: fixed(2, (n, r) => factorial(n) / (factorial(r) * factorial(n - r))),
  nPr: fixed(2, (n, r) => factorial(n) / factorial(n - r)),
  factorial: fixed(1, factorial),
  gamma: fixed(1, gamma),
};

export function isBuiltinFunction(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTINS, name);
}

export function isConstant(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONSTANTS, name);
}

export function constantValue(name: string): number {
  return CONSTANTS[name];
}

/* --------------------------------------------------------------- compiler */

function arityOk(b: Builtin, n: number): boolean {
  return typeof b.arity === "number" ? b.arity === n : n >= b.arity[0] && n <= b.arity[1];
}

/** Turn an AST into a closure. Free names are read from the scope at call time. */
export function compile(node: Node, env: Env): Compiled {
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
        return v === undefined ? NaN : v;
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
            // Odd integer roots of negatives are real; Math.pow says NaN.
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
        let ok: boolean;
        switch (op) {
          case "<": ok = a < b; break;
          case "<=": ok = a <= b; break;
          case ">": ok = a > b; break;
          case ">=": ok = a >= b; break;
          case "=": ok = Math.abs(a - b) < 1e-12; break;
          case "!=": ok = Math.abs(a - b) >= 1e-12; break;
        }
        return ok ? 1 : 0;
      };
    }
    case "piecewise": {
      const branches = node.branches.map((b) => ({
        cond: b.cond ? compile(b.cond, env) : null,
        value: compile(b.value, env),
      }));
      return (s) => {
        for (const b of branches) {
          if (b.cond === null || b.cond(s) !== 0) return b.value(s);
        }
        return NaN; // outside every branch: an undefined region, so no curve
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
      // User-defined: resolved at call time so definition order and recursion work.
      const funcs = env.funcs;
      return (s) => {
        const f = funcs.get(name);
        if (!f || f.params.length !== args.length) return NaN;
        const inner: Scope = Object.create(null);
        for (const k in s) inner[k] = s[k];
        for (let i = 0; i < f.params.length; i++) inner[f.params[i]] = args[i](s);
        return f.body(inner);
      };
    }
  }
  throw new ExprError("Cannot compile expression");
}

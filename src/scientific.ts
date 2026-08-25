/** The scientific calculator: a running session, a keypad panel, and the
 *  worksheet behind a ```calc block. All three share one evaluator with the
 *  grapher, so a function defined here behaves the way it would on a graph. */

import { Notice, setIcon } from "obsidian";
import {
  compile,
  Env,
  ExprError,
  isBuiltinFunction,
  isConstant,
  parse,
  ParseContext,
  Scope,
  setAngleMode,
  UserFunc,
} from "./expr";
import { formatNumber } from "./render";
import { topLevelEquals } from "./spec";

export type ResultKind = "value" | "assign" | "define" | "blank" | "comment" | "error";

export interface CalcResult {
  kind: ResultKind;
  /** What was typed, tidied. */
  source: string;
  /** The number, when there is one. */
  value: number;
  /** Rendered right-hand side: a number, a definition, or an error message. */
  text: string;
}

/** A running calculation: variables and functions accumulate, `ans` carries. */
export class CalcSession {
  readonly vars: Scope = Object.create(null);
  private funcs = new Map<string, UserFunc>();
  private env: Env = { funcs: this.funcs };
  degrees = false;

  constructor() {
    this.vars.ans = 0;
  }

  reset(): void {
    for (const key of Object.keys(this.vars)) delete this.vars[key];
    this.vars.ans = 0;
    this.funcs.clear();
  }

  private context(extra: string[] = []): ParseContext {
    return {
      isFunction: (name) => isBuiltinFunction(name) || this.funcs.has(name),
      isValue: (name) =>
        isConstant(name) || name in this.vars || extra.includes(name),
    };
  }

  /** Evaluate one line. Never throws: a bad line comes back as an error result. */
  evaluate(line: string): CalcResult {
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
          const value = compile(parse(rhs, this.context()), this.env)(this.vars);
          this.vars[lhs] = value;
          this.vars.ans = value;
          return { kind: "assign", source, value, text: `${lhs} = ${formatNumber(value, 10)}` };
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
  peek(line: string): string {
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
}

/* ------------------------------------------------------------------ panel */

const KEYS: { label: string; insert?: string; action?: "equals" | "clear" | "back" }[][] = [
  [
    { label: "sin", insert: "sin(" },
    { label: "cos", insert: "cos(" },
    { label: "tan", insert: "tan(" },
    { label: "(", insert: "(" },
    { label: ")", insert: ")" },
  ],
  [
    { label: "ln", insert: "ln(" },
    { label: "log", insert: "log(" },
    { label: "√", insert: "sqrt(" },
    { label: "x^y", insert: "^" },
    { label: "n!", insert: "!" },
  ],
  [
    { label: "π", insert: "pi" },
    { label: "e", insert: "e" },
    { label: "ans", insert: "ans" },
    { label: "⌫", action: "back" },
    { label: "C", action: "clear" },
  ],
  [
    { label: "7", insert: "7" },
    { label: "8", insert: "8" },
    { label: "9", insert: "9" },
    { label: "÷", insert: "/" },
    { label: "mod", insert: "mod(" },
  ],
  [
    { label: "4", insert: "4" },
    { label: "5", insert: "5" },
    { label: "6", insert: "6" },
    { label: "×", insert: "*" },
    { label: "|x|", insert: "abs(" },
  ],
  [
    { label: "1", insert: "1" },
    { label: "2", insert: "2" },
    { label: "3", insert: "3" },
    { label: "−", insert: "-" },
    { label: ",", insert: "," },
  ],
  [
    { label: "0", insert: "0" },
    { label: ".", insert: "." },
    { label: "(−)", insert: "-" },
    { label: "+", insert: "+" },
    { label: "=", action: "equals" },
  ],
];

export interface ScientificOptions {
  /** Offered as a button when the host can write into a note. */
  onInsert?: (text: string) => void;
  degrees?: boolean;
}

export class ScientificCalculator {
  private root: HTMLElement;
  private tape!: HTMLElement;
  private input!: HTMLInputElement;
  private preview!: HTMLElement;
  private session = new CalcSession();
  private history: CalcResult[] = [];

  constructor(parent: HTMLElement, private opts: ScientificOptions = {}) {
    this.session.degrees = opts.degrees ?? false;
    this.root = parent.createDiv({ cls: "plotline-sci" });
    this.build();
  }

  private build(): void {
    this.tape = this.root.createDiv({ cls: "plotline-sci-tape" });
    this.renderTape();

    const entry = this.root.createDiv({ cls: "plotline-sci-entry" });
    this.input = entry.createEl("input", {
      cls: "plotline-sci-input",
      attr: { type: "text", spellcheck: "false", placeholder: "2 + 2, or a = 9.81" },
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
    const paintAngle = (): void => angle.setText(this.session.degrees ? "DEG" : "RAD");
    paintAngle();
    angle.setAttr("title", "Switch between degrees and radians");
    angle.addEventListener("click", () => {
      this.session.degrees = !this.session.degrees;
      paintAngle();
      this.updatePreview();
    });

    const clear = footer.createEl("button", {
      cls: "plotline-btn",
      attr: { "aria-label": "Clear the tape and every variable", title: "Clear the tape and every variable" },
    });
    setIcon(clear, "trash-2");
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

  private setInput(text: string): void {
    this.input.value = text;
    this.input.focus();
    this.updatePreview();
  }

  private insert(text: string): void {
    const start = this.input.selectionStart ?? this.input.value.length;
    const end = this.input.selectionEnd ?? start;
    this.input.value = this.input.value.slice(0, start) + text + this.input.value.slice(end);
    const caret = start + text.length;
    this.input.focus();
    this.input.setSelectionRange(caret, caret);
    this.updatePreview();
  }

  private backspace(): void {
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

  private updatePreview(): void {
    const text = this.session.peek(this.input.value);
    this.preview.setText(text ? `= ${text}` : "");
    this.preview.toggleClass("is-empty", text === "");
  }

  private submit(): void {
    const line = this.input.value.trim();
    if (!line) return;
    const result = this.session.evaluate(line);
    this.history.push(result);
    if (this.history.length > 60) this.history.shift();
    this.renderTape();
    if (result.kind !== "error") this.setInput("");
    else this.updatePreview();
  }

  private renderTape(): void {
    this.tape.empty();
    if (this.history.length === 0) {
      this.tape.createDiv({
        cls: "plotline-sci-hint",
        text: "Type an expression and press Enter. Assign with a = 9.81, define with f(x) = x^2, and reuse the last answer as ans.",
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
  private asMarkdown(): string {
    const lines = this.history
      .filter((h) => h.kind === "value" || h.kind === "assign")
      .map((h) => `- \`${h.source}\` = **${h.text.replace(/^[^=]*=\s*/, "")}**`);
    if (lines.length === 0) {
      new Notice("Nothing on the tape yet");
      return "";
    }
    return `${lines.join("\n")}\n`;
  }
}

/* -------------------------------------------------------------- worksheet */

/** Render a ```calc block: every line evaluated, in order, sharing a session. */
export function renderWorksheet(source: string, el: HTMLElement, degrees: boolean): void {
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

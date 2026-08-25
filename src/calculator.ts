/** The interactive widget: canvas + expression list + sliders + data table.
 *  Used both by the code-block processor and by the full-tab view. */

import { setIcon, Notice } from "obsidian";
import { formatNumber, Renderer, TraceSet, Theme, readTheme, Viewport } from "./render";
import { buildModel, DEFAULT_OPTIONS, Model, Options, Param, PALETTE } from "./spec";

export interface CalculatorOptions {
  /** Show the editable expression list and let the block be rewritten. */
  editable: boolean;
  /** Called (debounced) whenever the source text changes. */
  onChange?: (lines: string[]) => void;
  defaults?: Partial<Options>;
}

const TRACE_RADIUS = 26;

export class Calculator {
  private root: HTMLElement;
  private panel: HTMLElement | null = null;
  private canvasWrap!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private sliderBar!: HTMLElement;
  private noteBar!: HTMLElement;
  private tableWrap!: HTMLElement;
  private tooltip!: HTMLElement;

  private renderer!: Renderer;
  private vp!: Viewport;
  private theme!: Theme;
  private model!: Model;
  private traces: TraceSet[] = [];

  private lines: string[];
  private frame = 0;
  private quality = 1;
  private idleTimer = 0;
  private changeTimer = 0;
  private resizeObserver: ResizeObserver | null = null;
  private showTable: boolean;
  private tableRows: number;
  private destroyed = false;

  constructor(parent: HTMLElement, source: string, private opts: CalculatorOptions) {
    this.lines = source.replace(/\r/g, "").split("\n");
    this.root = parent.createDiv({ cls: "plotline" });
    if (opts.editable) this.root.addClass("plotline-editable");
    this.showTable = false;
    this.tableRows = DEFAULT_OPTIONS.tableRows;
    this.build();
    this.rebuild(true);
  }

  /* ------------------------------------------------------------- layout */

  private build(): void {
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
    this.tableWrap = main.createDiv({ cls: "plotline-table-wrap" });
    this.tableWrap.hide();

    this.renderer = new Renderer(this.canvas);
    this.vp = new Viewport(DEFAULT_OPTIONS);
    this.theme = readTheme(this.root);
    this.attachPointer();

    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.canvasWrap);
  }

  private buildToolbar(bar: HTMLElement): void {
    const title = bar.createDiv({ cls: "plotline-title" });
    const spacer = bar.createDiv({ cls: "plotline-spacer" });
    spacer.setText("");
    const btn = (icon: string, tip: string, fn: () => void): HTMLElement => {
      const b = bar.createEl("button", { cls: "plotline-btn", attr: { "aria-label": tip, title: tip } });
      setIcon(b, icon);
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
    btn("table", "Data table", () => {
      this.showTable = !this.showTable;
      this.renderTable();
    });
    btn("image-down", "Save the graph as a PNG", () => this.exportPng());
    btn("copy", "Copy the graph to the clipboard", () => this.copyPng());
  }

  private titleEl!: HTMLElement;

  private layout(): void {
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
  private rebuild(resetView: boolean): void {
    const base: Options = { ...DEFAULT_OPTIONS, ...(this.opts.defaults ?? {}) };
    this.model = buildModel(this.lines, base);
    if (resetView) {
      this.vp.set(this.model.options);
      this.showTable = this.model.options.showTable;
      this.tableRows = this.model.options.tableRows;
    }
    this.titleEl.setText(this.model.options.title);
    this.titleEl.toggleClass("is-empty", this.model.options.title === "");
    this.renderPanel();
    this.renderSliders();
    this.layout();
    this.renderTable();
  }

  private notifyChange(): void {
    if (!this.opts.onChange) return;
    window.clearTimeout(this.changeTimer);
    this.changeTimer = window.setTimeout(() => this.opts.onChange?.(this.lines.slice()), 400);
  }

  getSource(): string {
    return this.lines.join("\n");
  }

  /* --------------------------------------------------------------- draw */

  private schedule(): void {
    if (this.frame || this.destroyed) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    if (this.destroyed || this.vp.width <= 0) return;
    this.theme = readTheme(this.root);
    const result = this.renderer.draw(this.model, this.vp, this.theme, this.quality);
    this.traces = result.traces;
    this.noteBar.empty();
    for (const note of result.notes) {
      const el = this.noteBar.createDiv({ cls: "plotline-note", text: note.text });
      el.style.setProperty("--plotline-note-color", note.color);
    }
    this.noteBar.toggleClass("is-empty", result.notes.length === 0);
  }

  /** Drop resolution while the user is dragging, restore it shortly after. */
  private interacting(): void {
    this.quality = 0.45;
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.quality = 1;
      this.schedule();
    }, 160);
  }

  private resetView(): void {
    this.vp.set(this.model.options);
    this.schedule();
  }

  /* ---------------------------------------------------------- pointer */

  private attachPointer(): void {
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
    const stop = (e: PointerEvent): void => {
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
        const axis: "both" | "x" | "y" = e.shiftKey ? "x" : e.altKey ? "y" : "both";
        this.vp.zoomAt(e.offsetX, e.offsetY, factor, axis);
        this.interacting();
        this.schedule();
      },
      { passive: false },
    );

    canvas.addEventListener("dblclick", () => this.resetView());

    canvas.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 80 : 30;
      switch (e.key) {
        case "ArrowLeft": this.vp.panPixels(step, 0); break;
        case "ArrowRight": this.vp.panPixels(-step, 0); break;
        case "ArrowUp": this.vp.panPixels(0, step); break;
        case "ArrowDown": this.vp.panPixels(0, -step); break;
        case "+": case "=": this.vp.zoomAt(this.vp.width / 2, this.vp.height / 2, 1 / 1.4); break;
        case "-": this.vp.zoomAt(this.vp.width / 2, this.vp.height / 2, 1.4); break;
        case "0": this.resetView(); return;
        default: return;
      }
      e.preventDefault();
      this.schedule();
    });
  }

  /** Nearest sampled point on any curve, in screen space. */
  private updateTrace(px: number, py: number): void {
    let best: { t: TraceSet; p: TraceSet["points"][number]; d: number } | null = null;
    for (const t of this.traces) {
      for (const p of t.points) {
        const d = Math.hypot(p.px - px, p.py - py);
        if (d < TRACE_RADIUS && (!best || d < best.d)) best = { t, p, d };
      }
    }
    if (!best) {
      if (this.tracePoint) {
        this.tracePoint = null;
        this.tooltip.hide();
        this.schedule(); // wipe the ring left behind
      }
      return;
    }
    // Redrawing is not free — an implicit curve is a full marching-squares
    // pass — so only repaint when the traced point actually moved.
    if (
      this.tracePoint &&
      Math.abs(this.tracePoint.px - best.p.px) < 0.5 &&
      Math.abs(this.tracePoint.py - best.p.py) < 0.5
    ) {
      return;
    }
    this.tracePoint = { px: best.p.px, py: best.p.py };
    this.tooltip.show();
    this.tooltip.setText(`(${formatNumber(best.p.x)}, ${formatNumber(best.p.y)})`);
    this.tooltip.style.setProperty("--plotline-trace-color", best.t.style.color);
    const left = Math.min(this.vp.width - 96, Math.max(4, best.p.px + 12));
    const top = Math.min(this.vp.height - 30, Math.max(4, best.p.py - 34));
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
    this.draw();
    this.markTrace(best.p.px, best.p.py, best.t.style.color);
  }

  private tracePoint: { px: number; py: number } | null = null;

  /** A ring on the traced point, painted straight after a redraw. */
  private markTrace(px: number, py: number, color: string): void {
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

  /* --------------------------------------------------- expression list */

  private renderPanel(): void {
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
        setIcon(swatch, "sliders-horizontal");
      } else {
        swatch.addClass("is-plain");
      }
      const input = row.createEl("input", {
        cls: "plotline-input",
        attr: { type: "text", spellcheck: "false", placeholder: "y = x^2" },
      });
      input.value = line;
      input.addEventListener("input", () => {
        this.lines[index] = input.value;
        this.rebuild(false);
        this.notifyChange();
        // Keep focus where the user is typing; rebuild replaced the row.
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
        attr: { "aria-label": "Delete this line", title: "Delete this line" },
      });
      setIcon(del, "x");
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

  private focusRow(index: number, caret: number): void {
    if (!this.panel) return;
    const inputs = this.panel.querySelectorAll<HTMLInputElement>(".plotline-input");
    const input = inputs[index];
    if (!input) return;
    input.focus();
    const pos = caret === Infinity ? input.value.length : caret;
    input.setSelectionRange(pos, pos);
  }

  /* -------------------------------------------------------------- sliders */

  private renderSliders(): void {
    this.sliderBar.empty();
    this.sliderBar.toggleClass("is-empty", this.model.params.length === 0);
    for (const param of this.model.params) this.renderSlider(param);
  }

  private renderSlider(param: Param): void {
    const row = this.sliderBar.createDiv({ cls: "plotline-slider" });
    const label = row.createSpan({ cls: "plotline-slider-name", text: param.name });
    label.setAttr("title", `${param.name} ∈ [${param.min}, ${param.max}]`);
    const play = row.createEl("button", {
      cls: "plotline-slider-play",
      attr: { "aria-label": "Animate", title: "Animate this parameter" },
    });
    setIcon(play, "play");
    const input = row.createEl("input", {
      cls: "plotline-range",
      attr: {
        type: "range",
        min: String(param.min),
        max: String(param.max),
        step: String(param.step),
      },
    });
    input.value = String(param.value);
    const value = row.createSpan({ cls: "plotline-slider-value", text: formatNumber(param.value, 3) });

    const apply = (v: number): void => {
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
    const stopAnim = (): void => {
      window.clearInterval(timer);
      timer = 0;
      setIcon(play, "play");
    };
    play.addEventListener("click", () => {
      if (timer) {
        stopAnim();
        return;
      }
      setIcon(play, "pause");
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

  private animationTimers: (() => void)[] = [];

  /** Write a dragged slider value back into its own source line. */
  private syncParamLine(param: Param): void {
    const line = this.lines[param.line];
    if (line === undefined) return;
    const eq = line.indexOf("=");
    if (eq < 0) return;
    const slider = line.match(/\[[^\]]*\]\s*$/);
    const tail = slider ? ` ${slider[0].trim()}` : "";
    this.lines[param.line] = `${line.slice(0, eq + 1)} ${formatNumber(param.value, 4)}${tail}`;
    if (this.panel) {
      const input = this.panel.querySelectorAll<HTMLInputElement>(".plotline-input")[param.line];
      if (input && document.activeElement !== input) input.value = this.lines[param.line];
    }
    this.notifyChange();
  }

  /* ---------------------------------------------------------- data table */

  private renderTable(): void {
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
      attr: { type: "number", min: "2", max: "200", step: "1", title: "Number of sample rows" },
    });
    rows.value = String(this.tableRows);
    rows.addEventListener("change", () => {
      this.tableRows = Math.max(2, Math.min(200, Number(rows.value) || 11));
      this.renderTableBody();
    });
    const copy = head.createEl("button", { cls: "plotline-btn plotline-btn-text", text: "Copy Markdown" });
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(this.tableMarkdown());
      new Notice("Table copied as Markdown");
    });
    this.tableBody = this.tableWrap.createDiv({ cls: "plotline-table-body" });
    this.renderTableBody();
  }

  private tableBody: HTMLElement | null = null;

  private tableColumns(): { label: string; color: string; f: (x: number) => number }[] {
    const cols: { label: string; color: string; f: (x: number) => number }[] = [];
    for (const curve of this.model.curves) {
      if (curve.type !== "explicit" || curve.of !== "y") continue;
      const scope = Object.assign(Object.create(null), this.model.scope);
      cols.push({
        label: curve.style.label || `f${cols.length + 1}(x)`,
        color: curve.style.color,
        f: (x: number) => {
          scope.x = x;
          for (const p of this.model.params) scope[p.name] = p.value;
          return curve.f(scope);
        },
      });
    }
    return cols;
  }

  private tableData(): { xs: number[]; cols: ReturnType<Calculator["tableColumns"]> } {
    const cols = this.tableColumns();
    const n = Math.max(2, this.tableRows);
    const xs: number[] = [];
    for (let i = 0; i < n; i++) xs.push(this.vp.xmin + ((this.vp.xmax - this.vp.xmin) * i) / (n - 1));
    return { xs, cols };
  }

  private renderTableBody(): void {
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

  private tableMarkdown(): string {
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
    const body = xs
      .map((x) => `| ${formatNumber(x, 4)} | ${cols.map((c) => formatNumber(c.f(x), 4)).join(" | ")} |`)
      .join("\n");
    return `${header}\n${rule}\n${body}`;
  }

  /* -------------------------------------------------------------- export */

  private exportPng(): void {
    this.quality = 1;
    this.draw();
    const url = this.canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.model.options.title || "plotline-graph"}.png`;
    a.click();
  }

  private copyPng(): void {
    this.quality = 1;
    this.draw();
    this.canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        new Notice("Graph copied to the clipboard");
      } catch {
        new Notice("Could not copy the graph — the clipboard refused an image");
      }
    });
  }

  /* ------------------------------------------------------------- teardown */

  destroy(): void {
    this.destroyed = true;
    this.animationTimers.forEach((stop) => stop());
    this.resizeObserver?.disconnect();
    window.cancelAnimationFrame(this.frame);
    window.clearTimeout(this.idleTimer);
    window.clearTimeout(this.changeTimer);
  }

  /** Repaint after a theme change. */
  refreshTheme(): void {
    this.theme = readTheme(this.root);
    this.schedule();
  }
}

export { PALETTE };

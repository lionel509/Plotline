/** The full tab: a bigger graph with an editable expression list, or the
 *  scientific calculator, switched by the two buttons in the header. */

import { ItemView, MarkdownView, Notice, WorkspaceLeaf } from "obsidian";
import { Calculator } from "./calculator";
import { ScientificCalculator } from "./scientific";
import type PlotlinePlugin from "./main";

export const VIEW_TYPE_PLOTLINE = "plotline-calculator";

export type PlotlineMode = "graph" | "scientific";

export class PlotlineView extends ItemView {
  private calculator: Calculator | null = null;
  private scientific: ScientificCalculator | null = null;
  private mode: PlotlineMode = "graph";
  private body: HTMLElement | null = null;
  private bar: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: PlotlinePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_PLOTLINE;
  }

  getDisplayText(): string {
    return this.mode === "graph" ? "Graphing calculator" : "Scientific calculator";
  }

  getIcon(): string {
    return this.mode === "graph" ? "line-chart" : "calculator";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("plotline-view");
    this.mode = this.plugin.settings.lastMode === "scientific" ? "scientific" : "graph";
    this.bar = container.createDiv({ cls: "plotline-viewbar" });
    this.body = container.createDiv({ cls: "plotline-view-host" });
    this.render();
  }

  setMode(mode: PlotlineMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.plugin.settings.lastMode = mode;
    void this.plugin.saveSettings();
    this.render();
    // The tab title and icon follow the mode.
    this.leaf.setViewState({ type: VIEW_TYPE_PLOTLINE, active: true });
  }

  private render(): void {
    if (!this.bar || !this.body) return;
    this.teardown();
    this.bar.empty();
    this.body.empty();

    const group = this.bar.createDiv({ cls: "plotline-modes" });
    const tab = (label: string, mode: PlotlineMode): void => {
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
        },
      });
    } else {
      this.scientific = new ScientificCalculator(this.body, {
        degrees: this.plugin.settings.degrees,
        onInsert: (text) => this.writeToNote(text),
      });
    }
  }

  private reset(source: string): void {
    this.plugin.settings.lastSession = source;
    void this.plugin.saveSettings();
    this.render();
  }

  /** Drop the current expression list into the last markdown note as a block. */
  private insertIntoNote(): void {
    const source = this.calculator?.getSource() ?? "";
    this.writeToNote("```plot\n" + source.replace(/\s+$/, "") + "\n```\n");
  }

  private writeToNote(text: string): void {
    if (!text) return;
    const markdown = this.plugin.lastMarkdownView();
    if (!markdown) {
      new Notice("Open a note first — Plotline has nowhere to insert this");
      return;
    }
    const editor = markdown.editor;
    editor.replaceRange(text, editor.getCursor());
    this.app.workspace.setActiveLeaf(markdown.leaf, { focus: true });
    new Notice("Inserted");
  }

  private teardown(): void {
    this.calculator?.destroy();
    this.calculator = null;
    this.scientific = null;
  }

  async onClose(): Promise<void> {
    this.teardown();
  }
}

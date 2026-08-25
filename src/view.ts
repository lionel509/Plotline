/** The full-tab calculator: a bigger canvas and an editable expression list. */

import { ItemView, MarkdownView, Notice, WorkspaceLeaf } from "obsidian";
import { Calculator } from "./calculator";
import type PlotlinePlugin from "./main";

export const VIEW_TYPE_PLOTLINE = "plotline-calculator";

export class PlotlineView extends ItemView {
  private calculator: Calculator | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: PlotlinePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_PLOTLINE;
  }

  getDisplayText(): string {
    return "Graphing calculator";
  }

  getIcon(): string {
    return "line-chart";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("plotline-view");

    const bar = container.createDiv({ cls: "plotline-viewbar" });
    const insert = bar.createEl("button", { cls: "plotline-btn plotline-btn-text", text: "Insert into note" });
    insert.addEventListener("click", () => this.insertIntoNote());
    const clear = bar.createEl("button", { cls: "plotline-btn plotline-btn-text", text: "Clear" });
    clear.addEventListener("click", () => this.reset(""));

    const source = this.plugin.settings.rememberSession
      ? this.plugin.settings.lastSession
      : "y = x^2";
    this.mount(container, source);
  }

  private mount(container: HTMLElement, source: string): void {
    this.calculator?.destroy();
    const host = container.querySelector<HTMLElement>(".plotline-view-host") ?? container.createDiv({ cls: "plotline-view-host" });
    host.empty();
    this.calculator = new Calculator(host, source || "", {
      editable: true,
      defaults: this.plugin.blockDefaults(),
      onChange: (lines) => {
        this.plugin.settings.lastSession = lines.join("\n");
        void this.plugin.saveSettings();
      },
    });
  }

  private reset(source: string): void {
    this.mount(this.contentEl, source);
    this.plugin.settings.lastSession = source;
    void this.plugin.saveSettings();
  }

  /** Drop the current expression list into the last markdown note as a block. */
  private insertIntoNote(): void {
    const markdown = this.plugin.lastMarkdownView();
    if (!markdown) {
      new Notice("Open a note first — Plotline has nowhere to insert the block");
      return;
    }
    const source = this.calculator?.getSource() ?? "";
    const block = "```plot\n" + source.replace(/\s+$/, "") + "\n```\n";
    const editor = markdown.editor;
    editor.replaceRange(block, editor.getCursor());
    this.app.workspace.setActiveLeaf(markdown.leaf, { focus: true });
    new Notice("Graph inserted");
  }

  async onClose(): Promise<void> {
    this.calculator?.destroy();
    this.calculator = null;
  }
}

export type { MarkdownView };

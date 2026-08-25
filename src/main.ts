import {
  App,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
} from "obsidian";
import { Calculator } from "./calculator";
import { DEFAULT_OPTIONS, Options } from "./spec";
import { PlotlineView, VIEW_TYPE_PLOTLINE } from "./view";

/** Fence languages that render a graph. */
const BLOCK_LANGUAGES = ["plot", "plotline", "desmos"];

interface PlotlineSettings {
  xRange: string;
  yRange: string;
  height: number;
  grid: boolean;
  minorGrid: boolean;
  labels: boolean;
  degrees: boolean;
  tableRows: number;
  editableBlocks: boolean;
  rememberSession: boolean;
  lastSession: string;
}

const DEFAULT_SETTINGS: PlotlineSettings = {
  xRange: "-10, 10",
  yRange: "-6.5, 6.5",
  height: 380,
  grid: true,
  minorGrid: true,
  labels: true,
  degrees: false,
  tableRows: 11,
  editableBlocks: false,
  rememberSession: true,
  lastSession: "y = x^2",
};

function parsePair(text: string, fallback: [number, number]): [number, number] {
  const parts = text.split(/[,;]|\.\./).map((s) => Number(s.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)) || parts[0] >= parts[1]) return fallback;
  return [parts[0], parts[1]];
}

export default class PlotlinePlugin extends Plugin {
  settings: PlotlineSettings = { ...DEFAULT_SETTINGS };
  private calculators = new Set<Calculator>();
  private lastMarkdownLeaf: WorkspaceLeaf | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_PLOTLINE, (leaf) => new PlotlineView(leaf, this));

    for (const language of BLOCK_LANGUAGES) {
      this.registerMarkdownCodeBlockProcessor(language, (source, el, ctx) =>
        this.renderBlock(source, el, ctx),
      );
    }

    this.addRibbonIcon("line-chart", "Plotline: graphing calculator", () => void this.openCalculator());

    this.addCommand({
      id: "open-calculator",
      name: "Open the graphing calculator",
      callback: () => void this.openCalculator(),
    });

    this.addCommand({
      id: "insert-graph-block",
      name: "Insert a graph block",
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        const body = selection.length > 0 ? selection : "y = x^2";
        editor.replaceSelection("```plot\n" + body + "\n```\n");
      },
    });

    this.addCommand({
      id: "graph-selection",
      name: "Graph the selection in the calculator",
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        if (!selection) {
          new Notice("Select an expression first");
          return;
        }
        this.settings.lastSession = selection;
        void this.saveSettings().then(() => this.openCalculator());
      },
    });

    // Remember where to insert a graph when the calculator tab has focus.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf && leaf.view instanceof MarkdownView) this.lastMarkdownLeaf = leaf;
      }),
    );
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        for (const calc of this.calculators) calc.refreshTheme();
      }),
    );

    this.addSettingTab(new PlotlineSettingTab(this.app, this));
  }

  onunload(): void {
    for (const calc of this.calculators) calc.destroy();
    this.calculators.clear();
  }

  /** Block-level defaults, as configured in settings. */
  blockDefaults(): Partial<Options> {
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
    };
  }

  private renderBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const editable = this.settings.editableBlocks || /^\s*(editable|controls)\s*:\s*(true|on|yes|1)\s*$/im.test(source);
    const calc = new Calculator(el, source, {
      editable,
      defaults: this.blockDefaults(),
      onChange: editable ? (lines) => this.writeBack(lines, el, ctx) : undefined,
    });
    this.calculators.add(calc);
    // Tie the widget's lifetime to the rendered block, so a closed note or a
    // re-render tears down its animation timers and observers.
    const child = new MarkdownRenderChild(el);
    child.register(() => {
      calc.destroy();
      this.calculators.delete(calc);
    });
    ctx.addChild(child);
  }

  /** Push edits from an editable block back into the note it came from. */
  private writeBack(lines: string[], el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const info = ctx.getSectionInfo(el);
    if (!info) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== ctx.sourcePath) return;
    const editor = view.editor;
    const from = { line: info.lineStart + 1, ch: 0 };
    const to = { line: info.lineEnd, ch: 0 };
    const next = lines.join("\n") + "\n";
    if (editor.getRange(from, to) === next) return;
    editor.replaceRange(next, from, to);
  }

  private async openCalculator(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_PLOTLINE);
    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_PLOTLINE, active: true });
    await workspace.revealLeaf(leaf);
  }

  lastMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const view = this.lastMarkdownLeaf?.view;
    if (view instanceof MarkdownView) return view;
    const leaf = this.app.workspace.getLeavesOfType("markdown")[0];
    return leaf && leaf.view instanceof MarkdownView ? leaf.view : null;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class PlotlineSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PlotlinePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Default x range")
      .setDesc("Applied to a block that does not set its own. Two numbers, e.g. -10, 10")
      .addText((t) =>
        t.setValue(this.plugin.settings.xRange).onChange(async (v) => {
          this.plugin.settings.xRange = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Default y range").addText((t) =>
      t.setValue(this.plugin.settings.yRange).onChange(async (v) => {
        this.plugin.settings.yRange = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl)
      .setName("Graph height")
      .setDesc("Pixels. A block can override this with height: 500")
      .addSlider((s) =>
        s
          .setLimits(200, 800, 10)
          .setValue(this.plugin.settings.height)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.height = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Grid").addToggle((t) =>
      t.setValue(this.plugin.settings.grid).onChange(async (v) => {
        this.plugin.settings.grid = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Minor grid lines").addToggle((t) =>
      t.setValue(this.plugin.settings.minorGrid).onChange(async (v) => {
        this.plugin.settings.minorGrid = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Axis labels").addToggle((t) =>
      t.setValue(this.plugin.settings.labels).onChange(async (v) => {
        this.plugin.settings.labels = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl)
      .setName("Degrees")
      .setDesc("Trigonometric functions take degrees instead of radians")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.degrees).onChange(async (v) => {
          this.plugin.settings.degrees = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Data table rows")
      .setDesc("How many samples the table shows by default")
      .addSlider((s) =>
        s
          .setLimits(3, 51, 1)
          .setValue(this.plugin.settings.tableRows)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.tableRows = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Editable blocks")
      .setDesc(
        "Show the expression list on every graph block and write edits back into the note. " +
          "Off by default: a single block can opt in with a line reading editable: true",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.editableBlocks).onChange(async (v) => {
          this.plugin.settings.editableBlocks = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Remember the calculator tab")
      .setDesc("Reopen the tab with the expressions that were last in it")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.rememberSession).onChange(async (v) => {
          this.plugin.settings.rememberSession = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}

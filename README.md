# Plotline

A Desmos-style graphing calculator that lives inside Obsidian. Write a fenced
`plot` block in a note and get an interactive graph: pan, zoom, trace, drag a
slider, read a table of values off the curve.

No network, no CDN, no bundled maths library — the parser, the evaluator and the
renderer are all in this repo, so a graph works offline and in a vault that never
leaves the machine.

## Install

```bash
npm install
npm run build
npm run install-local     # copies main.js, manifest.json, styles.css into your vaults
```

`install-local` reads `OBSIDIAN_VAULT` (the folder holding your vaults) or
`OBSIDIAN_VAULTS` (a colon-separated list of vault paths) and falls back to the
author's own layout. Or copy the three built files into
`<vault>/.obsidian/plugins/plotline/` yourself and enable **Plotline** under
Community plugins.

## Using it

A fence tagged `plot`, `plotline` or `desmos` becomes a graph. One line, one
thing:

````markdown
```plot
y = x^2 - 3
y = sin(x) | color: red
```
````

### What a line can be

| Line | Draws |
|---|---|
| `y = x^2` or just `x^2` | a function of x |
| `x = y^2 - 1` | a function of y |
| `x = 3` | a vertical line |
| `f(x) = x^3 - x` | defines `f` **and** graphs it |
| `g(a, b) = a*b` | defines a two-argument function (not graphed) |
| `x^2 + y^2 = 9` | an implicit curve, by marching squares |
| `y < x^2` | a shaded inequality with its boundary |
| `(cos(t), sin(t))` | a parametric curve over `t` |
| `r = 2 + 2cos(theta)` | a polar curve |
| `(3, 4)` or `points: (1,2), (2,4)` | a point set |
| `a = 3 [0, 10, 0.5]` | a parameter — becomes a slider `[min, max, step]` |
| `# note to self` | a comment |

### Settings, one per line

`x: -5..5` · `y: -2, 2` · `bounds: -5, 5, -2, 2` · `xmin: 0` (and `xmax`, `ymin`,
`ymax`) · `t: 0..2pi` · `theta: 0..pi` · `height: 500` · `title: Damped
oscillator` · `grid: off` · `minor: off` · `axes: off` · `labels: off` ·
`degrees: on` · `aspect: equal` · `table: 21` · `editable: true`

### Per-line modifiers, after a `|`

`| color: red` (a palette name or any CSS colour) · `| width: 3` · `| dashed` ·
`| label: velocity` · `| fit: linear` (least-squares line through a point set,
with slope, intercept and R² printed under the graph).

### Maths it understands

Implicit multiplication (`2x`, `3sin(x)`, `xy`), `^` right-associative, unary
minus, `|x|` bars, `5!`, and Desmos-style piecewise `{x > 0: x^2, -x}`.

Constants `pi` `tau` `e` `phi` `infinity`, and the Greek letters `π τ θ φ α β γ
λ μ ω` typed directly. Functions: `sin cos tan sec csc cot`, `arcsin arccos
arctan atan2`, `sinh cosh tanh arsinh arcosh artanh`, `exp ln log log2 sqrt
cbrt`, `abs sign floor ceil round trunc mod hypot min max pow`, `nCr nPr
factorial gamma`.

### Interacting

Drag to pan, scroll to zoom (shift = x only, alt = y only), double-click to
reset, hover to trace a curve and read the coordinates. Arrow keys pan and
`+`/`-`/`0` zoom when the canvas has focus. The toolbar adds equal axis scaling,
a data table, PNG export and copy-to-clipboard.

**Data table** — the table button samples every `y = f(x)` across the current
x window and can copy the result as a Markdown table, which is the fast way to
get a column of values into a lab report.

**Sliders** — any parameter line gets a slider and a play button that sweeps it.
Dragging a slider rewrites its own line, so the value you left it at is the value
the note keeps.

### Editing in place

Blocks render read-only by default. Add `editable: true` to a block — or turn on
*Editable blocks* in settings — to get the expression list beside the graph;
edits are written back into the note.

### The full tab

The ribbon icon (or **Plotline: open the graphing calculator**) opens a
full-width calculator with the expression list always visible. **Insert into
note** drops the current expressions into the last markdown note as a `plot`
block. There is also **Graph the selection in the calculator** for an expression
you have highlighted in a note.

## Development

```bash
npm run build      # bundle src/ -> main.js
npm run check      # tsc --noEmit
```

- `src/expr.ts` — lexer, parser, compiler. An expression compiles to a tree of
  closures rather than an AST walked per sample, because an implicit curve
  evaluates tens of thousands of points per frame.
- `src/spec.ts` — turns block lines into settings, parameters and curves.
- `src/render.ts` — viewport, grid, curve sampling with pole detection, marching
  squares, inequality shading.
- `src/calculator.ts` — the widget: canvas, expression list, sliders, table.
- `src/view.ts`, `src/main.ts` — the full tab, and the plugin itself.

## Licence

MIT.

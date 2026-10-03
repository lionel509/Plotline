# Cleanup — Plotline

What this repo leaves behind while you work on it, and how to put the working tree
back to what a fresh `git clone` gives you. Companion to the `.gitignore` coverage
added in #1.

Nothing here touches files git tracks. `main.js`, `package-lock.json`, `src/`, the
docs and `styles.css` all stay.

## What this project leaves behind

| path / thing | created by | size note |
|---|---|---|
| `node_modules/` | `npm install` / `npm ci` | ~40–80 MB — esbuild, typescript, `obsidian` typings |
| `graphify-out/` | `graphify update .` in this folder | grows with the repo being graphed |
| `/*— Project Hub.md` | this folder doubles as a note folder in a private vault | one file |
| `.env`, `.env.*` | you, by hand | tiny — **kept on purpose**, see Secrets |
| `*.log`, `logs/` | redirected output while building or debugging | safe to drop |
| `.tsbuildinfo`, `coverage/` | `tsc --incremental` or a coverage run if you add one | this repo's `npm run check` is `tsc --noEmit`, so today it produces neither |
| `.venv/`, `venv/`, `__pycache__/` | only if a Python helper gets bolted on | none exists now |
| `.DS_Store`, `.idea/`, `.vscode/`, `*.swp` | Finder / editors | tiny |

`main.js` is **not** ignored: it is committed on purpose — the plugin is installed by
copying three files into a vault, so a user never runs `npm install`.

Build output is otherwise zero: `esbuild.config.mjs` writes a single file
(`outfile: "main.js"`), sourcemaps are off, and `npm run check` emits nothing.

## Preview

Lists every ignored file the clean below would remove, keeping your secrets:

```bash
git clean -ndX -e '!.env' -e '!.env.*'
```

## Clean the repo

```bash
git clean -fdX -e '!.env' -e '!.env.*'
```

That covers everything `git clean` can see. What it **cannot** see: the vault copies
`install.mjs` writes, outside the repo. `npm run install-local` copies `main.js`,
`manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/plotline/`, and for
the BlackRock vault it also **adds `"plotline"` to `.obsidian/community-plugins.json`**
so the plugin is switched on. To undo that from vaults you installed into:

```bash
rm -rf ~/Documents/<Vault>/.obsidian/plugins/plotline
```

and, if the plugin was auto-enabled, remove the `"plotline"` entry from
`~/Documents/<Vault>/.obsidian/community-plugins.json` by hand (leave every other
entry alone). Then reload Obsidian. Vault notes and settings the plugin stored are
not touched by either step — this removes the plugin, not your data.

After a clean, restore dependencies with `npm ci` and rebuild with `npm run build`.

## Outside the repo

| thing | exact command | shared? |
|---|---|---|
| npm's download cache, filled by `npm install`/`npm ci` | `npm cache clean --force` | **shared — every Node project on this Mac uses it.** Only worth it for the disk; it costs a re-download next time. |
| `<vault>/.obsidian/plugins/plotline/` and the `community-plugins.json` entry | `rm -rf` the folder above, edit the JSON by hand | per-vault, manual, optional — lives in `~/Documents`, outside the repo. |

Nothing else. No pip packages, no Hugging Face / torch weights, no Playwright
browsers, no Docker images, no launchd plists: the plugin is offline by design
("No network, no CDN, no bundled maths library"), and the build toolchain installs
into `node_modules/` only.

## Secrets

`.env`, `.env.*`, `*.key`, `*.pem`, `credentials.json` and `secrets.json` are ignored
**and deliberately kept** by both commands above — the `-e '!.env' -e '!.env.*'`
exceptions mean `git clean` skips them. Your local secrets survive a cleanup.

This repo needs no secret today: nothing here reads an API key, and the plugin never
talks to the network. If you ever add one, it belongs in `.env`, not in `src/`.

If you truly mean to get rid of a secret file, remove it yourself and mean it:

```bash
rm -f .env .env.*
```

If a secret was ever *committed*, deleting the file is not enough — it is in history.
Open an issue and rotate the credential first; never rewrite published history.

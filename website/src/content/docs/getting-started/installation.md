---
title: Installation
description: Install Feynman on macOS, Linux, or Windows with curl, PowerShell, or npm.
section: Getting Started
order: 1
---

Feynman installs either as a standalone bundle or as an npm package. The standalone installer is the simplest path: it downloads a prebuilt bundle with its own Node.js runtime and verifies the release SHA-256 before installing.

## One-line installer (recommended)

On **macOS or Linux**:

```bash
curl -fsSL https://feynman.is/install | bash
```

The installer supports macOS (Apple Silicon and Intel) and Linux (x64 and arm64). It installs the launcher to `~/.local/bin`, unpacks the bundle into `~/.local/share/feynman`, and updates your `PATH` when needed.

If you previously installed Feynman with npm and your shell still runs the old binary, run `which -a feynman`, then `hash -r`, or launch `~/.local/bin/feynman` directly.

On **Windows**, in PowerShell:

```powershell
irm https://feynman.is/install.ps1 | iex
```

This installs the Windows x64 bundle under `%LOCALAPPDATA%\Programs\feynman` and adds its launcher to your user `PATH`. Windows 11 on Arm runs the same bundle through x64 emulation.

## Alternative: npm

To install into an existing Node.js environment instead:

```bash
npm install -g @companion-ai/feynman
```

This uses your local Node.js, which must satisfy `>=22.22.0`.

If you installed the interim `@advaitpaliwal/feynman` package, migrate once:

```bash
npm uninstall -g @advaitpaliwal/feynman
npm install -g @companion-ai/feynman
```

## Updating

Rerun the installer you originally used to get the latest tagged release. For npm installs:

```bash
npm install -g @companion-ai/feynman@latest
```

`feynman update` only updates optional Pi packages you installed with `feynman packages install`. The core packages update with Feynman itself.

## Pinned releases

To install an exact version:

```bash
curl -fsSL https://feynman.is/install | bash -s -- 0.5.3
```

On Windows:

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install.ps1))) -Version 0.5.3
```

## Uninstalling

Feynman has no `uninstall` command. Remove the launcher and bundle, and optionally the Feynman home directory (settings, sessions, installed packages) and `~/.ahub` (alphaXiv login).

On macOS or Linux:

```bash
rm -f ~/.local/bin/feynman
rm -rf ~/.local/share/feynman
# optional: settings, sessions, and installed packages
rm -rf ~/.feynman
# optional: alphaXiv login
rm -rf ~/.ahub
```

On Windows PowerShell:

```powershell
Remove-Item "$env:LOCALAPPDATA\Programs\feynman" -Recurse -Force
# optional: settings, sessions, and installed packages
Remove-Item "$HOME\.feynman" -Recurse -Force
# optional: alphaXiv login
Remove-Item "$HOME\.ahub" -Recurse -Force
```

Then remove `%LOCALAPPDATA%\Programs\feynman\bin` from your user `PATH`.

For npm installs:

```bash
npm uninstall -g @companion-ai/feynman
```

## Skills only

To install only Feynman's research skills, without the terminal app, into `~/.codex/skills/feynman` for Codex:

```bash
curl -fsSL https://feynman.is/install-skills | bash
```

To name the target explicitly, use `--codex`. For a repo-local install into `.agents/skills/feynman`, or an OpenCode install into `.opencode/skills/feynman`, pass a scope:

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --codex
curl -fsSL https://feynman.is/install-skills | bash -s -- --repo
curl -fsSL https://feynman.is/install-skills | bash -s -- --opencode
```

On Windows:

```powershell
irm https://feynman.is/install-skills.ps1 | iex
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope Codex
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope Repo
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope OpenCode
```

These installers copy the `skills/` and `prompts/` trees plus `AGENTS.md` and `CONTRIBUTING.md`. They do not install the Feynman terminal, its Node.js runtime, or Pi packages.

## After installing

Check the install:

```bash
feynman --version
```

Then run `feynman setup` to connect a model provider (see [Setup](/docs/getting-started/setup)). `feynman doctor` diagnoses configuration, authentication, and runtime problems.

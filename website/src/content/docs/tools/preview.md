---
title: Preview
description: Render research artifacts to HTML or PDF with pandoc.
section: Tools
order: 4
---

Feynman writes research artifacts as Markdown. To read one as a rendered document, convert it with [pandoc](https://pandoc.org/) from the shell. Feynman has no in-REPL preview command.

## Setup

Check for pandoc, or install it:

```bash
feynman setup preview
```

If pandoc is missing, this installs it with Homebrew on macOS, `winget` on Windows, or `apt-get` on Linux. If none of those is available or the install fails, install pandoc manually from [pandoc.org](https://pandoc.org/installing.html). `feynman doctor` and `feynman status` report whether pandoc is found.

## Rendering

```bash
pandoc outputs/scaling-laws.md -s -o outputs/scaling-laws.html
pandoc outputs/scaling-laws.md -o outputs/scaling-laws.pdf
```

Open the result in your browser or PDF viewer. PDF output needs a LaTeX engine such as TeX Live or MiKTeX in addition to pandoc.

Inside the REPL you can ask Feynman to run these commands for you.

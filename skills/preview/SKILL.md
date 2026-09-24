---
name: preview
description: Render Markdown or LaTeX research artifacts to HTML or PDF with pandoc. Use when the user wants to review a written artifact, export a report, or view a rendered document.
---

# Preview

Render Markdown or LaTeX artifacts with pandoc through the shell. `feynman setup preview` checks for pandoc, and `feynman doctor` reports whether it is available.

```bash
pandoc outputs/<slug>.md -s -o outputs/<slug>.html   # HTML
pandoc outputs/<slug>.md -o outputs/<slug>.pdf       # PDF (needs a LaTeX engine)
open outputs/<slug>.html                             # macOS; xdg-open on Linux
```

Rendered HTML and PDF files are previews; the Markdown artifact stays canonical. If pandoc or a LaTeX engine is missing, say so and leave the Markdown artifact as the deliverable.

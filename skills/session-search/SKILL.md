---
name: session-search
description: Search prior Feynman session transcripts on disk. Use when the user asks about earlier research sessions, past findings, or wants to resume a prior session.
---

# Session Search

Feynman stores session transcripts as JSONL files under `~/.feynman/sessions/` (or `$FEYNMAN_HOME/.feynman/sessions/`). Each line is a JSON record with a `type` (session, message, model_change) and, for messages, `message.content`.

```bash
grep -ril "scaling laws" ~/.feynman/sessions/                  # sessions that mention a topic
grep -il "scaling laws" -r ~/.feynman/sessions/ | xargs ls -t   # newest first
```

To continue a session you found, run `feynman --session <path>` or pick it with `feynman --resume`.

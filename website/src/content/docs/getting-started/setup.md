---
title: Setup
description: Walk through the guided setup wizard to configure Feynman.
section: Getting Started
order: 3
---

`feynman setup` connects a model provider, offers optional packages, signs you in to alphaXiv, and offers to install pandoc for preview. It runs automatically when you launch `feynman` interactively without a usable default model, and you can rerun it at any time.

```bash
feynman setup
```

## Model access

If no authenticated model is available yet, setup asks how to connect one:

```text
Choose how to configure model access:
> OAuth login (recommended: ChatGPT, Claude Max, Copilot, ...)
  API key or custom provider (OpenAI, Anthropic, ZAI, Kimi, MiniMax, ...)
  Cancel
```

OAuth opens a browser to sign in. On a remote or headless machine where the browser callback cannot reach Feynman, paste the final redirect URL or authorization code into the prompt. The API-key flow lists hosted providers plus LM Studio, LiteLLM, custom OpenAI-compatible servers, and Amazon Bedrock. You can paste a key, or leave it empty and set the provider's environment variable (for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) instead.

Credentials are stored in `~/.feynman/agent/auth.json` with user-only file permissions. Setting the key in your shell or `.env` keeps it off disk.

Once a provider is connected, setup picks the recommended research model from what you are signed in to, such as `openai/gpt-5.6-terra` or `anthropic/claude-opus-5-5`. If you already have a valid default, setup keeps it. To change it later:

```bash
feynman model list
feynman model set <provider/model>
```

`model set` also accepts `provider:model`. Pro-class model IDs are rejected.

### Amazon Bedrock

Choose `Amazon Bedrock (AWS credential chain)`. Feynman checks the same AWS credential chain Pi uses at runtime, including `AWS_PROFILE`, `~/.aws` credentials and config, SSO, ECS/IRSA, and EC2 instance roles. When the check passes, Bedrock models appear in `feynman model list` without an API key.

### Local models: LM Studio, LiteLLM, Ollama, vLLM

For LM Studio, start its local server, load a model, and choose `LM Studio (local OpenAI-compatible server)`. The defaults are:

```text
Base URL: http://localhost:1234/v1
API key: lm-studio
```

For LiteLLM, start the proxy and choose `LiteLLM Proxy (OpenAI-compatible gateway)`. The default base URL is `http://localhost:4000/v1`; if the proxy requires a master key, Feynman reads it from `LITELLM_MASTER_KEY`.

For both, Feynman reads the server's `/models` endpoint to prefill model IDs.

For Ollama, vLLM, or another OpenAI-compatible server, choose `Custom provider (local/self-hosted/proxy)`. Typical Ollama settings:

```text
API mode: openai-completions
Base URL: http://localhost:11434/v1
Send Authorization header: No
API key / resolver: local
Model id(s): llama3.1:8b
```

Custom providers are saved to `~/.feynman/agent/models.json`. Then confirm and select the model:

```bash
feynman model list
feynman model set <provider>/<model-id>
```

Small local models often skip the multi-step research workflows and reply in chat without writing files to `outputs/`. A context window that is too small causes the same symptom: Ollama's default is only a few thousand tokens. Serve the model with a larger one (for example `OLLAMA_CONTEXT_LENGTH=65536 ollama serve`) and set the matching `contextWindow` and `maxTokens` on the model's entry in `~/.feynman/agent/models.json`, since custom models otherwise default to 128k and 16k.

## Optional packages

Feynman ships with alphaXiv access, web access, document parsing, subagents, and `/btw` side conversations. Setup can also install optional Pi packages:

- **memory**: preference and correction memory across research sessions
- **hindsight**: Hindsight-backed memory; requires a Hindsight server or Hindsight Cloud account

Skip this step and install later with `feynman packages install <preset>`. `feynman packages list` shows both.

## alphaXiv and preview

Setup then offers to sign you in to alphaXiv (same as `feynman alpha login`) and to install pandoc for Markdown-to-HTML/PDF preview (same as `feynman setup preview`).

## Editor integration (ACP)

Feynman runs in ACP editors through [pi-acp](https://github.com/svkozak/pi-acp). In Zed, add to `settings.json`:

```json
"agent_servers": {
  "Feynman": {
    "command": "npx",
    "args": ["-y", "pi-acp"],
    "env": { "PI_ACP_PI_COMMAND": "feynman" }
  }
}
```

## Rerunning setup

Settings live in `~/.feynman/agent/settings.json`. Rerunning setup keeps a valid default model and your other settings. To change one thing, use a targeted command such as `feynman model set`, `feynman model login <provider>`, or `feynman alpha login`, or edit the file directly.

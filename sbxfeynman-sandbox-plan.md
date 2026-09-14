# Add Local `sbxfeynman` Sandbox Launcher

## Summary

Add an unshipped, repository-local `sbxfeynman` command that creates or reattaches to a Docker `sbx` sandbox and runs the published Feynman `0.3.48` terminal agent inside it. The current working directory remains mounted read-write; Feynman state persists separately. The browser workbench is out of scope.

Core research job: improve safety and reproducibility of research-agent execution by isolating shell, Python, package, and document-processing workloads from the macOS host.

## Implementation Changes

- Add `scripts/sbxfeynman`, modeled on `sbxagent`'s portable wrapper:
  - Run directly as `./scripts/sbxfeynman`.
  - Derive a stable `sbxfeynman-<project>-<path-hash>` sandbox name from the current working directory.
  - Store persistent state beneath `${XDG_STATE_HOME:-$HOME/.local/state}/sbxfeynman/`.
  - Mount the current project read-write and only that project's Feynman state.
  - Support start, `name`, `version`, `exec`, `inspect`, `create`, `rm`, `kit validate`, `policy log`, and `policy check`.
  - Require the host `sbx` CLI and provide the existing macOS/Linux installation hint when absent.
  - Preserve macOS Bash 3.2 and BSD/GNU utility compatibility.
  - Do not add a `package.json` bin entry or modify native installers.

- Add a local `kits/sbxfeynman` sandbox kit:
  - Build on `docker/sandbox-templates:shell-docker`.
  - Install pinned Node `24.20.0` with architecture-specific SHA-256 verification.
  - Install `@advaitpaliwal/feynman@0.3.48` exactly with lifecycle scripts disabled, then verify `feynman --version` and `--help`.
  - Install the minimal terminal research toolchain: certificates, Git, curl, ripgrep, fd, jq, Python, build tools, and shellcheck.
  - Bind persistent state over both `~/.feynman` and `~/.ahub` on every boot; fail startup if either bind cannot be established.
  - Seed Feynman's agent settings with the network-block guard and an OpenRouter default compatible with the bundled Pi runtime.
  - Launch with `exec feynman "$@"`.
  - Set `FEYNMAN_TELEMETRY=off`, `DO_NOT_TRACK=1`, `PI_SKIP_VERSION_CHECK=1`, and `FEYNMAN_SKIP_PANDOC_INSTALL=1`.

- Configure sandbox security:
  - Use proxy-managed `OPENROUTER_API_KEY`; never place the real key in kit files.
  - Allow build sources plus core runtime endpoints: OpenRouter, npm/Node, GitHub, AlphaXiv, arXiv, Crossref/DOI, OpenAlex, Europe PMC/EBI, NCBI/PubMed/PMC, Hugging Face, and DuckDuckGo.
  - Keep all other egress default-denied and direct users to `sbxfeynman policy check` and host-side `sbx policy allow` when another research source is required.
  - Retain the warning that the mounted project remains writable and can be changed or deleted by the agent.

- Document local use in the repository README:
  - Prerequisites: supported `sbx` v0.42.1, login, and OpenRouter secret setup.
  - Start with `./scripts/sbxfeynman`.
  - Explain persistent-state location, sandbox removal, network-policy remedies, and the writable-project boundary.
  - State explicitly that `feynman serve` and workbench port forwarding are not included.
  - Credit the MIT-licensed `sbxagent` design where code or substantial logic is adapted.

## Test Plan

- Add wrapper unit tests using a fake `sbx` binary:
  - Stable, path-specific sandbox naming.
  - Correct kit, project, and state mount arguments.
  - Create versus reattach behavior.
  - Full lifecycle and policy command dispatch.
  - Invalid signatures, missing `sbx`, path names with spaces/non-ASCII, and state-directory permissions.
  - No mutation outside the selected project's state directory.

- Add static kit contract tests:
  - Kit name/version and pinned Feynman version are `sbxfeynman`/`0.3.48`.
  - Node archives have exact per-architecture digests.
  - Telemetry is disabled.
  - OpenRouter is the only model credential.
  - Both Feynman state roots are mounted.
  - Entrypoint ends in `exec feynman "$@"`.
  - Network allowlist contains the agreed core hosts and excludes PostHog.

- Validate with:
  - `sbx kit validate kits/sbxfeynman`
  - Focused wrapper/kit tests
  - Full `npm test`
  - `npm run typecheck`
  - `npm run architecture:check`
  - `git diff --check`

- Perform an optional credentialed local smoke outside automated CI:
  - `./scripts/sbxfeynman create`
  - `./scripts/sbxfeynman exec feynman --version`
  - Start an interactive session and obtain an exact `PONG` response through OpenRouter.
  - Stop and reattach, confirming Feynman session continuity.
  - Confirm a non-allowlisted host is blocked and a core paper endpoint succeeds.

## Assumptions

- This feature lives only in the cloned Feynman repository; it is excluded from npm package contents, native bundles, installers, website commands, and release artifacts.
- Invocation is direct from the checkout, not through a PATH symlink.
- The sandbox runs published Feynman `0.3.48`, not the current unpublished `0.3.49` checkout and not the moving npm `latest` tag.
- Initial support is terminal-only, OpenRouter-only, local `sbx`, and macOS/Linux hosts.
- The current project mount is intentionally writable; isolation protects the rest of the host, not the checked-out project.

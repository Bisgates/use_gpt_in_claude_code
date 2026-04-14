# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Repo-specific workflow
- Keep `.claude/` ignored and do not commit it.
- After changing TypeScript/runtime code, rebuild once with `npm run build`.
- Docs-only changes do not require a rebuild.
- This fork is meant to run from source. Do not rely on official Anthropic install/update flows in this repo.
- All release, npm publish, tag, and GitHub Release work must follow `docs/release-version-policy.md`.
- Future releases should include a one-line summary in the tag message (for example: `telegram 支持关闭`); the release workflow prepends it to the GitHub Release body.
- Treat `package.json.version` as the only authoritative release version; do not introduce or preserve a second formal version source in scripts, CI, or release notes.
- Opus prompt mode is the default runtime behavior. `/opus` can toggle it off or back on mid-session; `--opus` explicitly starts with it enabled.

## Common commands
- Install dependencies: `npm install`
- Fresh-machine bootstrap: `bash scripts/bootstrap.sh`
- Build the CLI bundle: `npm run build`
- Remove build output: `npm run clean`
- Start the built CLI: `npm start`
- Show CLI help through the source launcher: `node cli.js --help`
- Quick auth check: `node cli.js auth status --text`
- Smoke test the fork end-to-end: `npm run smoke`
- Run the P0 regression suite: `npm run test:p0`
- Run the P0 suite with dot reporter: `npm run test:p0:check`
- Run the P0 suite with JSON output: `npm run test:p0:json`
- Run one test file: `bunx vitest run --config vitest.config.ts tests/p0/model/openaiResponsesBackend.test.ts`
- Run one test by name: `bunx vitest run --config vitest.config.ts tests/p0/model/openaiResponsesBackend.test.ts -t "serializes structured tool_result content"`
- There is currently no dedicated lint script in `package.json`; do not invent one in automation.

## Credentials and local config
- The default model backend in this fork is OpenAI Responses, not Anthropic.
- Credentials are loaded from `OPENAI_API_KEY` or `~/.codex/auth.json`.
- Provider/model defaults are loaded from `~/.codex/config.toml`.
- `src/services/modelBackend/openaiCodexConfig.ts` is the canonical place for config precedence: API key, base URL, model, prompt-cache retention, context window, and reasoning effort.
- `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `OPENAI_BASE_URL`, and related env vars override `~/.codex/config.toml`.

## High-level architecture
- Root `cli.js` is intentionally tiny; it only launches the built artifact in `dist/cli.js`. Real startup begins in `src/entrypoints/cli.tsx` and then hands off to `src/main.tsx`.
- `src/entrypoints/cli.tsx` contains fast paths for lightweight invocations (`--version`, bridge/daemon/bg/worktree paths) before loading the full app.
- `src/main.tsx` is the main bootstrap layer: config/init, auth, telemetry, policy/settings loading, MCP/plugin/skill setup, command wiring, and REPL/session startup.
- `src/commands.ts` is the central registry for slash commands. A lot of command loading is feature-gated with `bun:bundle` and lazy `require(...)`; preserve that pattern when editing command registration so build-time dead-code elimination still works.
- `src/Tool.ts` defines the shared tool contract and tool-use context. `src/tools.ts` is the source of truth for which built-in tools are exposed in a session.
- `src/query.ts` is the core turn loop. It normalizes transcript state, manages compact/recovery behavior, streams model output, and feeds tool calls back into the local runtime.
- Tool execution lives under `src/services/tools/`. `toolOrchestration.ts` batches concurrency-safe/read-only tool calls together and runs state-changing tools serially.
- Model-provider selection lives in `src/services/modelBackend/index.ts`. This fork defaults to `openaiResponses`, but still keeps a Claude backend implementation for compatibility.
- `src/services/modelBackend/openaiResponsesBackend.ts` is the critical adapter for this fork: it translates the internal Claude-shaped transcript/tool protocol into OpenAI Responses API input items and maps streamed/native output back into local message/tool events.
- `src/services/modelBackend/openaiApi.ts` is the HTTP boundary for OpenAI requests. Keep auth/header behavior there instead of scattering fetch logic.
- The fork’s architecture intentionally keeps local runtime authority for tool execution and approvals. The OpenAI integration is an adapter layer, not a switch to provider-native execution.

## Docs and source-of-truth files
- `README.md` is the repo entry point for setup, smoke commands, credential sources, and launcher helper scripts.
- `docs/INDEX.md` is the canonical documentation router.
- `docs/implementation/hybrid-native-implementation-plan.md` is the implementation source of truth for ongoing Codex/OpenAI backend work.
- `research/` is historical background only; do not treat it as the current implementation source of truth.

## Testing focus
- The most important automated coverage is under `tests/p0/`, especially the `model`, `tool`, and `protocol` subtrees.
- These tests protect the fork-specific contracts around OpenAI Responses translation, tool orchestration, and remote/protocol behavior. If you change backend translation or tool execution semantics, update/add P0 tests first.

## context-os
- This project uses `.context_os/` as the phase 1 task runtime.
- `.context_os/STATE.md` is the single entry point for task status and resume.
- Stable task paths live under `.context_os/tasks/<task_id>/` and do not change when status changes.
- Default operation allows only one active task unless the user explicitly requests parallel tasks.
- Core task files are `0-meta.md`, `1-objective.md`, `2-context.md`, and `3-log.md`.
- Optional task files are `4-decisions.md`, `8-remaining.md`, and `9-completion.md`.
- Phase 1 is only for task checkpoint/resume runtime; do not build a knowledge base, doc system, `knowledge/`, or `INDEX.md`.
- `resume-refresh` is a hard protocol rule: after `resume`, refresh `current_focus`, `next_action`, `blocker`, and stale context instead of copying the old checkpoint blindly.

<!-- docmeta
role: entry
layer: 1
parent: null
children:
  - docs/implementation/INDEX.md
  - docs/6cx3b-agent-auto-resume-design.md
  - docs/system-prompt-summary.md
  - docs/ant-mode-summary.md
  - docs/release-version-policy.md
summary: primary documentation router for Codex integration planning, release policy, and implementation
read_when:
  - need the canonical documentation path for the repository
  - need to choose the implementation document to follow before coding
skip_when:
  - the exact implementation leaf is already known
source_of_truth:
  - README.md
  - docs/catalog.yaml
-->

# Documentation Index

## Scope

This entry routes implementation work for integrating Codex/OpenAI into the existing Claude Code-style runtime. It is intentionally short and points to the single implementation surface that should drive the next coding rounds.

## Open this next

- `docs/implementation/INDEX.md` — open for the implementation track, fixed decisions, phases, and coding order.
- `docs/6cx3b-agent-auto-resume-design.md` — same-run auto-resume design for recoverable transient interruptions such as `fetch failed`.
- `docs/system-prompt-summary.md` — summary of the runtime's system-level prompt surfaces and where each one is defined.
- `docs/ant-mode-summary.md` — explanation of `USER_TYPE=ant`, internal-only behavior, and differences from external builds.
- `docs/release-version-policy.md` — canonical release policy for keeping `package.json.version`, npm package versions, Git tags, and GitHub Releases in sync.

## Historical research archive

These archived research notes are still useful when you need background rationale or want to trace why the current plan was chosen, but they are not implementation truth:

- `research/README.md` — archive index for the three pre-plan research documents.

## Do not read this for

- deep runtime details
- implementation decisions that have already been frozen in the canonical plan

# Transcript Tool Target Detail Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Strengthen deterministic review and merge evidence by extracting stable tool-call target detail from normalized vendor transcript events, so correlated tool interactions can show what command ran or which file path was touched.

## Why This Slice Exists

The prior transcript-correlation slice already delivered:

- stable `toolInvocationKey` persistence on normalized tool transcript events
- durable correlation between keyed tool calls and tool results in run history
- reviewer and merger context that could show one correlated interaction instead of unrelated flat summaries

But one evidence gap still remained:

- keyed tool interactions still rendered only generic call summaries such as `Tool call: Bash`
- reviewer and merger context could prove that a result belonged to a call, but not what that call actually targeted
- run detail and Bun UI therefore still hid whether one invocation read the relevant file, edited the intended path, or ran the expected command

That kept transcript evidence less useful than the authority path requires for deterministic operator review.

## Constraints

- keep transcript evidence file-native inside existing run history
- do not add a second structured tool-log store
- extract only stable target detail that vendor payloads already expose
- keep summary rendering compact enough for run detail, Bun UI, and reviewer/merger context

## Implemented Scope

### Stable Tool-Call Target Detail In Normalized Summaries

Normalized tool-call transcript summaries now include stable target detail when vendor payloads expose it.

Examples:

- `Tool call: Bash (bun test packages/backend/tests/server.test.ts)`
- `Tool call: Read (src/server.ts)`
- `Tool call: edit (src/modal.tsx)`

The extraction path stays conservative and prefers:

- shell command fields such as `command`, `cmd`, `argv`, or `args`
- file target fields such as `file_path`, `filePath`, `path`, or `targetFile`
- simple search fields such as `pattern` or `query` only when they materially improve the target summary

### Richer Correlated Review/Merge Evidence

Reviewer and merger transcript evidence now prefers the correlated tool-call summary over the bare tool name when one keyed interaction is rendered.

Examples:

- `Tool call: Bash (bun test packages/backend/tests/server.test.ts) [shell-1] -> Command completed successfully.`
- `Tool call: Read (src/server.ts) [toolu_1] -> File contents loaded.`

This keeps the durable invocation key while finally showing what the invocation actually targeted.

### No New Transcript Truth

Target detail is derived inline during vendor normalization and stored inside the existing transcript `summary`.

No new transcript schema branch, no second tool registry, and no post-hoc transcript enrichment cache were introduced.

## Non-Goals

- persisting full raw tool argument payloads
- creating a separate structured command/file audit log beside run history
- attempting heuristic reconstruction for tool targets that vendors do not expose
- replacing write traces as the primary durable proof of file mutation

## Acceptance Criteria

- normalized Codex, Claude, and OpenCode tool-call transcript summaries include stable target detail when vendor payloads expose one
- run-detail API responses surface those richer tool-call summaries unchanged
- reviewer and merger context uses the richer correlated tool-call summary when rendering keyed tool interactions
- unkeyed or detail-free tool events still fall back to the previous compact summary path

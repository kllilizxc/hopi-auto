# Assistant Run Bundle Inspection Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Expose the exact durable Goal assistant run bundle on the active Bun product path, so operators can inspect `context.md`, `prompt.md`, `outcome.json`, and `result.json` without dropping to the filesystem.

## Why This Slice Exists

Earlier assistant surfacing already made these pieces visible:

- assistant run summaries
- assistant run detail records
- assistant runtime events and durable action results

But the most important execution evidence still lived behind manual file inspection:

- the exact bundled context the assistant saw
- the exact transport-facing prompt
- the raw structured outcome returned by the assistant process
- the persisted final result record

Without that bundle inspection surface, assistant runs were visible, but not fully auditable from the product path.

## Constraints

- assistant bundle files remain the source of truth under `.hopi/runtime/goals/<goalKey>/assistant/runs/<assistantRunId>/`
- the new inspection surface is read-only
- no new workflow truth is introduced beyond files that already exist
- the Bun UI should surface the bundle directly, not through a second frontend stack

## Implemented Scope

### Assistant Run Bundle Store

`AssistantRunStore` now supports a second read-side projection:

- validate run existence through durable `result.json`
- return absolute file paths for `context.md`, `prompt.md`, `outcome.json`, and `result.json`
- return file contents when present
- return `null` for missing optional files without inventing synthetic data

### Assistant Bundle API Surface

The Bun API now exposes:

```text
GET /api/goals/:goalKey/assistant/runs/:assistantRunId/bundle
```

This keeps assistant execution evidence on the same inspection path as board state, run history, decisions, planning requests, and preferences.

### Bun UI Surfacing

The active Bun UI now renders a bundle-inspection section inside assistant run detail:

- `context.md`
- `prompt.md`
- `outcome.json`
- `result.json`

Each file shows its durable path plus its recorded contents, making assistant execution inspectable without local shell access.

## Non-Goals

- editing assistant bundle files from the UI
- adding extra persisted assistant state beyond the existing bundle
- replaying or diffing assistant runs
- deep chat UX beyond the existing Goal assistant surface

## Acceptance Criteria

- assistant run bundles are inspectable through a dedicated Bun API route
- the Bun UI can render the four durable assistant bundle files for a selected run
- bundle inspection remains read-only and file-native
- missing bundle files degrade explicitly instead of silently inventing state

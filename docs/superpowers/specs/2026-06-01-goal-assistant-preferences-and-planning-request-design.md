# Goal Assistant Preferences And Planning Request Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Close the next real Goal assistant loop by making durable repo preferences editable on the active Bun product path and by giving assistant a safer planner-request action than blind planning-task creation.

## Why This Slice Exists

The prior slices already added:

- explicit Goal assistant execution
- assistant run inspection APIs
- Bun UI surfacing for prompts, decisions, thread state, and assistant runs

What was still missing was the next durable product loop:

- repo preferences were durable but not editable through the active UI/API path
- assistant could create planning tasks, but it did not have an explicit planner-request action with reuse semantics
- assistant durable preference updates depended too heavily on whole-document rewrite behavior

## Constraints

- `todo.yml` remains the only workflow truth
- assistant still may not create engineering tasks
- assistant still may not write source files
- repo preferences remain file-native in `.hopi/preference.md`
- preference editing should not introduce a second preference store or hidden overlay

## Implemented Scope

### Repo Preference API

Add:

- `GET /api/preferences`
- `POST /api/preferences`

This exposes the durable repo-level preference document directly through the Bun backend.

### Preference Editing In The Bun UI

The Goal assistant panel now includes a repo preference editor backed by the Bun API.

This keeps preference maintenance on the same product path as assistant runs, decisions, and board inspection.

### Structured Assistant Planner Requests

Add a new assistant action:

- `request_planning`

This action creates visible planning work, but first checks for an existing open planning task with the same title and reuses it instead of duplicating planner-visible work.

That is intentionally narrower and more durable than letting assistant invent arbitrary task-graph mutations.

### Structured Assistant Preference Recording

Add a new assistant action:

- `record_preference`

This action records one durable preference through store-managed deduplicated bullet guidance instead of forcing the assistant to rewrite the full document for every stable preference signal.

`update_preference` remains available for explicit full-document rewrites, but `record_preference` is now the preferred additive path.

### Preference Change Refresh

Add `preferences_changed` SSE broadcasts so the Bun UI reloads when preferences change either through direct editing or assistant actions.

## Non-Goals

- a rich preference schema beyond the current Markdown document
- semantic planning-request deduplication beyond deterministic same-title reuse
- replacing planner with assistant-driven task graph authoring
- deep chat UX or multi-turn preference review workflows

## Acceptance Criteria

- repo preferences are readable and writable through the active Bun API/UI path
- assistant can record one durable preference without rewriting the entire file
- assistant can request visible planning work without blindly duplicating open planner tasks
- preference changes refresh the current UI through SSE
- no new hidden truth store is introduced

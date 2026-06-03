# Assistant Action Authority Metadata Inspection

Status: implemented
Date: 2026-06-03

## Goal

Keep assistant-thread inspection and bundled assistant context on the same durable authority path as structured assistant actions themselves, instead of flattening those actions down to one title line plus a couple of generic fields.

## Gap

The previous slice persisted full `action` payloads on `assistant-thread.json`, but the shared inspection helper still surfaced only a narrow subset of that authority:

- planning actions mostly showed title plus requested updates
- answer-driven actions mostly showed action kind plus source-response format
- workflow reuse metadata, inferred-answer flags, linked decision refs, reusable answer-source counts, and other durable action authority were still hidden inside raw JSON

That meant Bun thread inspection and bundled assistant context technically had the durable payload, but still presented a lossy summary surface.

## Design

Extend the shared assistant-action inspection helper so both Bun thread inspection and bundled assistant context show richer durable metadata that already exists on structured actions:

- planning actions surface linked decision refs, captured/shared planner-answer counts, reusable answer-source counts, `inferRemainingAnswers`, and workflow/group reuse keys
- answer-driven actions surface inferred-decision flags, reusable answer-source counts, and richer follow-through metadata like workflow reuse keys plus shared planner-answer counts
- decision and preference actions surface their durable metadata such as summary keys, prompts, match hints, supersession, and retirement rationale where present

This remains read-only inspection work:

- no new runtime mutation semantics
- no second durable store
- no derived authority outside the existing structured action payload

## Verification

- assistant thread presentation tests cover richer planning and answer-driven action detail rendering
- bundled assistant context tests confirm those same richer action details appear in `## Recent Assistant Thread`
- targeted typecheck/lint/test verification runs before commit

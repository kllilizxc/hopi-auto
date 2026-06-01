# Structured Preference Lifecycle Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Replace append-only deduplicated preference bullets with one canonical structured `.hopi/preference.md` document that supports stable preference identity, explicit active or retired lifecycle state, and deterministic assistant/API mutation semantics.

## Why This Slice Exists

The prior preference slice already delivered:

- repo preference editing on the active Bun API and UI path
- `record_preference` as a safer assistant action than blind whole-document rewrites
- planner and assistant context wiring for `.hopi/preference.md`

But one authority gap still remained:

- preferences had no stable key, so assistant could not update or supersede durable guidance in place
- outdated guidance could only disappear through manual whole-document rewrites
- operator visibility still depended on reading unstructured bullets rather than a deterministic lifecycle

That kept repo guidance weaker than the decision and planning surfaces already available elsewhere in HOPI.

## Constraints

- keep `.hopi/preference.md` as the only durable preference truth
- do not introduce a second preference store, overlay, or hidden metadata file
- keep preferences directly readable and editable on the active Bun product path
- prefer deterministic structured mutations over freeform whole-document rewrites

## Implemented Scope

### Canonical Structured Preference Document

`.hopi/preference.md` now stores one canonical fenced YAML document:

- `version: 1`
- `preferences: []`

Each entry now supports:

- `preferenceKey`
- `status: active | retired`
- `summary`
- optional `rationale`
- optional `retiredReason`
- optional `supersededBy`

The store validates duplicate keys and invalid lifecycle references, and rewrites the file into canonical formatting.

### Stable Preference Lifecycle Operations

The preference store now supports:

- structured `recordPreference(...)` upsert with optional `preferenceKey`, `rationale`, and `supersedes`
- structured `retirePreference(...)` with explicit retirement reason
- deterministic migration from legacy bullet-only preference documents into the canonical structured format

This lets durable repo guidance be updated, superseded, and retired without losing file-native truth.

### Active Bun API Preference Mutations

The Bun API now exposes:

- `GET /api/preferences`
- `POST /api/preferences`
- `POST /api/preferences/record`
- `POST /api/preferences/retire`

`GET /api/preferences` now surfaces both raw canonical content and parsed structured entries, so the Bun UI can show real lifecycle state instead of only a raw editor.

### Assistant Preference Lifecycle Actions

Assistant now supports:

- `record_preference` with optional stable `preferenceKey`, optional `rationale`, and optional `supersedes`
- `retire_preference` with explicit retirement reason

Assistant action results now surface the durable `preferenceKey` and any retired preference keys caused by the mutation.

### Context And UI Surfacing

Planner context, Goal assistant context, and the Bun UI now all surface parsed structured preference entries alongside the raw file.

This keeps operator visibility aligned with the same durable truth that assistant and API mutate.

## Non-Goals

- per-goal preference stores separate from repo-level preference truth
- preference ranking, weighting, or policy engines
- hidden audit overlays for preference mutations
- removing the explicit full-document `update_preference` escape hatch

## Acceptance Criteria

- missing or legacy `.hopi/preference.md` files normalize into one canonical structured document
- preferences can be recorded, superseded, and retired through file-native store helpers
- Bun API surfaces structured preference entries and supports structured record/retire mutations
- assistant can record and retire durable preferences without relying on append-only bullet behavior
- planner and assistant context plus Bun UI show parsed preference lifecycle state from the same durable file

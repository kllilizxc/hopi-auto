# Assistant Action-Result Authority Metadata Inspection

Status: implemented
Date: 2026-06-03

## Goal

Expose the richer durable metadata already present on structured assistant `action_result` payloads, instead of collapsing those results down to a summary line plus one narrow provenance field.

## Gap

Shared assistant-result inspection already surfaced some higher-order fields like:

- `resolvedSourceResponseFormat`
- decision creation flags
- follow-through topology

But several existing durable ids and result-side authority fields still stayed hidden inside raw structured payloads:

- `requestKey` / `taskRef`
- grouped `requestKeys` / `taskRefs` / `blockerTaskRefs`
- `workflowKey` / `groupKeys`
- `decisionKey` / `decisionKeys`
- `preferenceKey` / `retiredPreferenceKeys`

That meant assistant thread inspection, bundled assistant context, and Bun run detail still showed only a partial view of already-persisted result authority.

## Design

Extend the shared `formatAssistantActionResultDetails(...)` helper so all existing inspection surfaces that reuse it inherit the same richer durable metadata:

- planning results show request/task ids
- grouped planning/workflow results show workflow/group/request/task/blocker ids
- decision results show concrete decision ids alongside blocker/provenance fields
- preference results show concrete preference ids and superseded retirements

This remains inspection-only:

- no new mutation semantics
- no new durable store
- no new response fields
- only fuller surfacing of already-persisted structured result authority

## Verification

- shared formatter tests cover grouped workflow result ids and preference-result ids
- thread presentation and bundled assistant context tests confirm those richer result details are visible through reused inspection helpers
- targeted backend tests, typecheck, and lint pass before commit

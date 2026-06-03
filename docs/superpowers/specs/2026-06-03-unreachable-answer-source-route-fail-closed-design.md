# Unreachable Answer-Source Route Fail-Closed

## Goal

Promote explicit reusable `answerSources[*].route` into a full top-level authority boundary, not just a matching hint.

If the current mutation surface has no valid consumer for one routed reusable source entry, runtime should reject the mutation instead of silently ignoring that explicit route authority.

## Why

The earlier route-family slice already made `route` a hard decision/planning boundary during known-consumer matching:

- decision consumers no longer see `route: "planning"` entries
- planner consumers no longer see `route: "decision"` entries

That still left one quieter gap:

- a decision-only mutation could leave `route: "planning"` entries untouched
- a planning-only mutation could leave `route: "decision"` entries untouched

Those entries were no longer mis-consumed by the wrong family, but they could still disappear from the current mutation with no error. That is weaker than the explicit-authority model.

## Required Behavior

### Decision-side surfaces

After a decision mutation fully materializes:

- explicit decision answers
- `inferOpenDecisions`
- `inferDecisionTopics`
- decision follow-through
- any approved mixed leftover inference

runtime must reject the mutation if any routed reusable source entry is still left over.

Example:

- `sourceResponseFormat: "matching_answer_sources"`
- one open decision consumes `auth-strategy-answer`
- one extra `route: "planning"` entry remains

Result: fail closed.

### Planning-side surfaces

After a direct planning mutation fully materializes:

- explicit planner answers
- `inferRemainingAnswers`

runtime must reject the mutation if any routed reusable source entry is still left over.

Example:

- `sourceResponseFormat: "matching_answer_sources"`
- the planning request consumes one `route: "planning"` entry
- one extra `route: "decision"` entry remains

Result: fail closed.

## Scope

This slice applies to top-level materialization surfaces:

- decision answer bundles
- direct planning inputs
- direct planning batches
- direct planning workflow batches

It does **not** introduce a new parser family and does **not** change the already-approved mixed leftover routing flow where a single mutation intentionally consumes both decision-routed and planning-routed leftovers.

## Non-Goals

This slice does not:

- broaden `route` into a grouping key
- change `matching_answer_sources` fallback semantics inside `sourceResponseFormat: "auto"`
- change the existing mixed leftover rule set for `inferDecisionTopics + followThrough.inferRemainingAnswers`

## Verification

- Runtime tests cover decision bundles rejecting unused `route: "planning"` reusable sources.
- Runtime tests cover direct planning inputs rejecting unused `route: "decision"` reusable sources.
- API tests cover both the decision route and direct planning route through real HTTP surfaces.

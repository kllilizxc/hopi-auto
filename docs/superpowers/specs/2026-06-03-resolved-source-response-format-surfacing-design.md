# Resolved Source Response Format Surfacing Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Surface the concrete deterministic interpretation format that shared runtime actually used, so `sourceResponseFormat: "auto"` is no longer a black box once a decision or planning mutation succeeds.

## Why This Slice Exists

The authority stack already let callers ask runtime to choose:

- `sourceResponseFormat: "auto"`
- or one explicit deterministic surface like `question_spans`, `matching_answer_sources`, or `topic_closing_blocks`

Shared runtime already resolved that choice internally before materializing answers.

But one authority gap remained:

- Bun API callers could not see which concrete deterministic surface had actually won
- assistant action results also hid that detail
- direct planning and decision flows therefore returned the durable outcome without exposing the interpretation authority that produced it

That made `auto` harder to audit and made it harder to distinguish:

- a caller intentionally pinning one explicit surface
- runtime selecting one concrete surface from `auto`
- runtime choosing a different concrete surface than the human or caller expected

The long-term authority route should expose the actual chosen surface instead of forcing callers to reverse-engineer it from the resulting answer text.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not recompute interpretation in API or assistant layers
- reuse the already-resolved concrete format from shared runtime
- do not claim `auto` as the resolved output surface once a concrete deterministic surface has already been selected

## Implemented Scope

### Shared Runtime Propagation

Shared answer-interpretation helpers now keep carrying the already-resolved concrete format after materialization:

- decision-bundle materialization already had the resolved concrete surface and now serves as the single runtime source of truth for decision-backed flows
- direct planning materialization helpers now also return that same resolved concrete surface instead of discarding it after answer materialization

### API Surfacing

Bun API mutation responses now expose:

- `resolvedSourceResponseFormat`

across interpreted decision and direct-planning surfaces that already return mutation results, including:

- `POST /api/goals/:goalKey/decisions/answer`
- `POST /api/goals/:goalKey/decisions/answers`
- `POST /api/goals/:goalKey/decisions/:decisionKey/resolve`
- `POST /api/goals/:goalKey/planning-requests`
- `POST /api/goals/:goalKey/planning-requests/workflows`

When no shared reply or reusable answer-source interpretation happened, this field stays absent.

When interpretation did happen:

- explicit concrete calls surface that same explicit concrete format
- `auto` surfaces the concrete deterministic format that actually won

### Assistant Result Surfacing

Assistant action results now also expose:

- `resolvedSourceResponseFormat`

for interpreted mutation actions, including:

- `request_planning`
- `request_planning_batch`
- `request_planning_workflows`
- `record_answer`
- `record_answers`
- `resolve_decision`

That means:

- `/api/goals/:goalKey/assistant/run` now returns the concrete winning interpretation surface in `actionResults`
- persisted assistant run detail carries that same evidence through the existing action-result substrate

## Example

If a caller sends:

- `sourceResponseFormat: "auto"`
- one direct planning request
- one shared reply that runtime resolves through `question_spans`

the durable planning request still stores the materialized planner answer exactly as before, but the immediate mutation response now also includes:

- `resolvedSourceResponseFormat: "question_spans"`

Likewise, if assistant sends:

- `sourceResponseFormat: "auto"`
- one shared auth/rollout/pilot reply

and runtime resolves it through `topic_closing_blocks`, the resulting `record_answers` action result now carries:

- `resolvedSourceResponseFormat: "topic_closing_blocks"`

instead of leaving the concrete authority implicit.

## Non-Goals

- persisting the resolved format as a new durable field in `decisions.yml` or `planning-requests.yml`
- changing which concrete format `auto` prefers
- changing any parser behavior
- exposing every rejected probe that `auto` considered before choosing one winner

## Acceptance Criteria

- interpreted Bun API mutation responses expose `resolvedSourceResponseFormat` when a concrete deterministic interpretation surface was used
- assistant action results expose the same `resolvedSourceResponseFormat`
- `auto` responses expose the winning concrete format, not `"auto"`
- direct planning and decision surfaces reuse shared runtime resolution instead of recomputing it in outer layers
- existing durable mutation behavior remains unchanged apart from the richer surfaced result metadata

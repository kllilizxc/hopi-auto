# Live Goal Assistant Execution Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Add the first live Goal assistant execution path on top of the already-implemented assistant substrate, without turning assistant into a hidden scheduler, source-editing agent, or second workflow truth system.

## Why This Slice Exists

The prior substrate slice already added:

- durable `decisions.yml`
- durable `.hopi/preference.md`
- Goal-scoped `assistant-thread.json`
- planner context wiring for decisions and preferences

What was still missing was the explicit runtime call that can:

- read Goal state and recent runtime evidence
- generate a user-facing assistant reply
- apply a small allowed set of durable actions
- leave a deterministic runtime audit trail

That is the smallest slice that makes Goal assistant real.

## Constraints

- `todo.yml` remains the only workflow source of truth
- assistant is explicit and Goal-scoped, never hidden behind scheduler reconcile
- assistant does not write source files
- assistant does not create engineering tasks
- assistant does not edit `goal.md` or `design.md`
- assistant reuses the existing transport/config substrate instead of inventing a second one

## Architecture

Add a dedicated assistant runtime service rather than forcing assistant through scheduler roles.

The implemented shape is:

1. Goal assistant context builder
2. explicit assistant transport invocation
3. constrained action executor
4. durable runtime audit output

## Context Bundle

Assistant bundles live under:

```text
.hopi/runtime/goals/<goalKey>/assistant/runs/<assistantRunId>/
```

Each run writes:

- `context.md`
- `prompt.md`
- `outcome.json`
- `result.json`

The assistant context includes:

- `goal.md`
- `design.md`
- current `todo.yml`
- current `decisions.yml`
- current `.hopi/preference.md`
- recent assistant thread entries
- recent task run summaries
- recent write traces

## Transport Model

Assistant configuration lives in the same repo-local adapter config file:

```text
.hopi/runtime/agent-adapters.json
```

with an additional top-level field:

```json
{
  "version": 1,
  "assistant": { "... transport config ..." },
  "roles": { "... existing role configs ..." }
}
```

The assistant runtime reuses the existing transport command resolver and transcript normalizer.

Assistant transport is intentionally restricted to `cwdMode: "root"`.

That keeps assistant out of git worktrees and prevents it from being treated like an engineering executor.

## Assistant Outcome Contract

Assistant returns one structured JSON object with:

- `message`
- `actions`

Supported action kinds:

- `move_task`
- `create_planning_task`
- `resolve_decision`
- `update_preference`

Non-goals for this slice:

- engineering task creation
- arbitrary source edits
- hidden planner graph writes
- arbitrary assistant tool execution through the backend

## Decision Key Semantics

Decision keys must be stable identifiers, not only auto-numbered `D-*` values.

The decision store now supports explicit custom keys like `db-provider`, because `blockedBy.kind=decision` refs in `todo.yml` must be able to match durable decision topics directly.

## Scheduler Integration

Resolved decision blockers should not remain stuck on cards forever.

The scheduler now removes:

- task blockers whose referenced task is `done`
- decision blockers whose `decisionKey` is resolved in `decisions.yml`

This keeps assistant decision answers compatible with the deterministic scheduler path.

## API Surface

This slice adds:

```text
POST /api/goals/:goalKey/assistant/run
```

The route:

1. appends the user message to `assistant-thread.json`
2. runs the configured assistant transport
3. appends the assistant reply to the thread
4. applies constrained durable actions
5. records action/action_result entries in the thread
6. writes assistant run audit output to `result.json`

## Durable Audit

Assistant durable conversational state remains:

```text
.hopi/runtime/goals/<goalKey>/assistant-thread.json
```

Per-run runtime audit lives in:

```text
.hopi/runtime/goals/<goalKey>/assistant/runs/<assistantRunId>/result.json
```

This avoids overloading scheduler run history while still keeping explicit runtime evidence.

## Acceptance Criteria

- assistant has an explicit Goal-scoped runtime entrypoint
- assistant uses repo-local transport config
- assistant can reply with zero actions when explanation is enough
- assistant can create visible planning work without creating engineering work
- assistant can persist durable decision answers and durable preferences
- resolved decision blockers are cleared by the scheduler
- assistant runtime writes deterministic files under `.hopi/runtime/**`

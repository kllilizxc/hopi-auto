# HOPI Zero-Context Continuation Guide

Status date: 2026-06-04

This is the first document a zero-context AI should read before touching the repo.

If you need deeper history after this guide, read:

1. [docs/agent-handoff.md](/Users/realizer/Code/hopi-claude/docs/agent-handoff.md)
2. the specific spec files referenced here

## Mission

The active product direction is:

- keep pushing the system along the authority route
- do not spend effort on compatibility with deleted prototype behavior
- prefer durable, explicit, inspectable substrates over heuristics
- keep shipping in small verified slices, with a commit after each slice

The active operator objective is:

- keep developing until the long-running authority-route goal is complete, not just until the next locally convenient stopping point

In practice, that means:

- if runtime already knows a piece of state, prefer persisting and surfacing it instead of leaving it trapped in summaries
- if a new behavior would require weaker inference, prefer a stronger explicit substrate first
- do not add a queue, database, or migration layer unless a future objective explicitly requires it

## Current Snapshot

Current branch/worktree expectations:

- branch: `main`
- latest functional code slice before this documentation refresh: `c0ac31d feat: surface assistant planning-result creation authority`
- current worktree may be dirty while the uncommitted 2026-06-04 assistant-result-authority plus embedded answer-interpretation slice is in flight
- worktree should be clean before handing off

Latest recent slices:

- `c0ac31d feat: surface assistant planning-result creation authority`
- `62e4155 feat: surface assistant request-decision result authority`
- `5fd99d1 fix: persist assistant runtime tool keys`
- `a3a1234 feat: surface assistant grouped planning requests`
- `8feee10 feat: surface assistant workflow child context`
- `ee6b0f6 feat: surface assistant workflow child dependencies`
- `411ea1a feat: surface assistant workflow child actions`
- `6e66db6 feat: surface assistant workflow child results`

Current verification posture:

- targeted slices are green
- `cd packages/backend && bun run typecheck` passes
- `cd packages/backend && bun run lint` currently fails on repo-wide Biome formatting and CRLF noise across many untouched files in the current worktree
- sandboxed `Bun.serve()` listeners fail with `EADDRINUSE` in this environment, so server-backed Bun tests require an unsandboxed run for reliable verification
- once unsandboxed, targeted server-backed assistant/runtime tests are green for the 2026-06-04 embedded question/topic span path
- `bun run check` still has a known operational caveat: it can print a long stream of passing tests, then tail-hang instead of exiting cleanly
- because of that, treat `bun run check` as useful evidence only when lint is already expected to pass, and also capture targeted test evidence for the exact slice you changed

## Start Here Checklist

If you are a new AI taking over, do these in order:

1. Read this file once all the way through.
2. Check the repo state:
   - `git status --short`
   - `git log --oneline -10`
3. Read [docs/agent-handoff.md](/Users/realizer/Code/hopi-claude/docs/agent-handoff.md), but use it as the exhaustive ledger, not your primary mental model.
4. Decide which active track you are continuing:
   - assistant/runtime/result/inspection authority seams
   - deeper less-structured answer interpretation
   - product frontend work inside `packages/frontend`
5. Before editing, find the shared substrate for that seam and add a failing focused test first.
6. After implementation, update:
   - this guide only if the global handoff story changed
   - [docs/agent-handoff.md](/Users/realizer/Code/hopi-claude/docs/agent-handoff.md)
   - one new spec file under `docs/superpowers/specs/`
7. Commit exactly one coherent slice.

## Architecture In One Page

HOPI is now a Bun-first, file-native autonomous goal orchestration system.

The authoritative layers are:

1. Goal workflow truth
   - `todo.yml`
   - current visible tasks, statuses, blockers

2. Goal durable planning/decision/doc truth
   - `.hopi/docs/goals/<goalKey>/goal.md`
   - `.hopi/docs/goals/<goalKey>/design.md`
   - `.hopi/docs/goals/<goalKey>/decisions.yml`
   - `.hopi/docs/goals/<goalKey>/planning-requests.yml`
   - `.hopi/docs/goals/<goalKey>/write-trace.jsonl`

3. Goal runtime overlay
   - `.hopi/runtime/**`
   - runs, steps, messages, assistant runs, assistant thread, adapter bundles, event history

4. Repo-wide preference substrate
   - `.hopi/preference.md`

There is no database. There is no queue. There is no Express app.

Frontend authority changed on 2026-06-06: `packages/frontend` is the product frontend package again. Its existing React/Vite codebase is the baseline to preserve and evolve in place. The backend-served UI under `packages/backend/src/ui` is a capability/reference surface, not the frontend to copy wholesale. Do not create a third frontend tree.

## Code Map

The active implementation lives in `packages/backend`.

Most important directories:

- [packages/backend/src/server.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/server.ts)
  - Bun API, SSE endpoint, and backend-served compatibility/reference UI shell
- [packages/frontend](/Users/realizer/Code/hopi-claude/packages/frontend)
  - active product frontend package; continue from the existing React/Vite app structure
- [packages/backend/src/runtime](/Users/realizer/Code/hopi-claude/packages/backend/src/runtime)
  - planning requests, decisions, answer interpretation, reconciliation logic
- [packages/backend/src/storage](/Users/realizer/Code/hopi-claude/packages/backend/src/storage)
  - YAML/JSONL/file-backed stores
- [packages/backend/src/assistant](/Users/realizer/Code/hopi-claude/packages/backend/src/assistant)
  - assistant action schema, assistant runtime, inspection/presentation helpers, bundle/context plumbing
- [packages/backend/src/agent](/Users/realizer/Code/hopi-claude/packages/backend/src/agent)
  - process runners, transcript normalization, transport integration
- [packages/backend/src/ui](/Users/realizer/Code/hopi-claude/packages/backend/src/ui)
  - compatibility/reference UI implementation; use it as a capability checklist and API aid, not as the primary frontend structure
- [packages/backend/src/scheduler](/Users/realizer/Code/hopi-claude/packages/backend/src/scheduler)
  - reconcile loop / deterministic step execution

Most important files when continuing the current authority work:

- [packages/backend/src/assistant/GoalAssistantRuntime.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/assistant/GoalAssistantRuntime.ts)
  - where assistant actions are materialized into runtime mutations and action results
- [packages/backend/src/assistant/assistantRun.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/assistant/assistantRun.ts)
  - durable assistant run schemas; common place for “runtime knew it, schema dropped it” bugs
- [packages/backend/src/assistant/assistantInspection.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/assistant/assistantInspection.ts)
  - shared inspection/presentation layer for thread, run detail, and bundled context
- [packages/backend/src/runtime/answerInterpretation.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/runtime/answerInterpretation.ts)
  - the giant deterministic interpretation engine
- [packages/backend/src/runtime/planningRequest.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/runtime/planningRequest.ts)
  - planning request and workflow graph runtime
- [packages/backend/src/runtime/decisionRequest.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/runtime/decisionRequest.ts)
  - decision request / answer / follow-through runtime
- [packages/backend/src/storage/assistantThreadStore.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/storage/assistantThreadStore.ts)
  - durable assistant-thread persistence
- [packages/backend/src/storage/decisionStore.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/storage/decisionStore.ts)
- [packages/backend/src/storage/planningRequestStore.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/storage/planningRequestStore.ts)

## Product Surface Summary

The backend API plus the existing backend-served UI already support:

- board inspection
- Goal docs inspection
- planning request inspection and mutation
- workflow graph inspection and mutation
- decision topic inspection and mutation
- assistant run execution
- assistant thread inspection
- assistant run detail and bundle inspection
- durable preference lifecycle
- reconcile-once control

The active frontend product path is now `packages/frontend`. Current frontend work should continue there from its existing React/Vite codebase, while treating `packages/backend/src/ui` only as a capability/reference surface.

Read `packages/frontend/MIGRATION.md` before making frontend changes.

## What Is Already Done

You do not need to rediscover these phases:

- Bun-first deterministic backend replaced the disposable prototype backend
- file-native stores exist for board/runtime/planning/decision/preference state
- scheduler/reconcile loop exists
- process-backed agent execution exists
- write traces exist and are consumed by reviewer/merger/policy surfaces
- Goal assistant substrate exists
- Goal assistant execution exists
- direct planning requests, grouped planning, workflow graphs, and decision-backed follow-through all exist
- deterministic answer interpretation has already been pushed very far across labeled, ordered, question, topic, pending, answer-source, and matching-run surfaces
- assistant run/thread/result/action inspection has been heavily upgraded

The complete slice-by-slice ledger is in [docs/agent-handoff.md](/Users/realizer/Code/hopi-claude/docs/agent-handoff.md).

## Two Active Tracks

### Track A: Assistant / Runtime Authority Seams

This is the current highest-signal track right now.

Pattern:

- runtime or store already knows some structured state
- assistant result/thread/run/context/UI still flatten it into summary text or omit it
- the right fix is to surface that authority through:
  - runtime return value
  - durable schema
  - persistence
  - shared formatter / inspection helper
  - targeted tests

Recent examples:

- `request_decision` result authority
- planning-request result authority
- planning result creation authority
- workflow child result/action authority
- runtime event authority
- tool invocation key persistence

If you continue this track, look for:

- fields that exist in runtime return types but not in assistant result schemas
- fields that exist in schemas but are not shown by `assistantInspection.ts`
- fields shown in the UI but not preserved through durable readback

Current posture on this track:

- the earlier workflow child, grouped planning, runtime-event, thread-action, planning-result, decision-result, and planning-request-result authority seams have been substantially covered by the recent 2026-06-03 and 2026-06-04 slices
- only continue Track A if a fresh inspection finds runtime or durable state that still gets flattened or dropped on assistant result, thread, run, context, or UI surfaces

### Track B: Deeper Less-Structured Answer Interpretation

This is the larger remaining product gap.

The remaining missing space is not “more of the same parser shapes” in a generic sense. It is specifically:

- less-structured replies that still cannot be deterministically captured by any current explicit substrate
- without falling into fuzzy inference

The current handoff position is:

- explicit reusable `answerSources` are preferred over weaker raw parsing
- explicit labels / prompts / keys / matchHints / routes are preferred over looser heuristics
- one continuous sentence with canonical `What should <summary> be` question anchors is now already covered by the current deterministic question-span family, including leftover decision-topic and planner-answer inference
- one continuous sentence with conjunction-linked explicit topic clauses is now already covered by the current deterministic `topic_clauses` family when each segment still carries exactly one explicit or inferable topic
- `sourceResponseFormat: "auto"` should select an already-implemented deterministic surface or fail closed

Only continue this track when the product goal explicitly needs it.

### Track C: Product Frontend Migration

This track is active when the operator asks about frontend progress or startup.

Current posture:

- `packages/frontend` remains the product frontend package.
- The original frontend baseline has been restored and verifies again through `bun run check`.
- New frontend work should continue inside the existing React/Vite pages/components in `packages/frontend`, not in a new tree and not by replacing it with the backend UI.
- `packages/backend/src/ui` remains a capability/reference implementation and backend-served fallback surface.

Use `packages/frontend/MIGRATION.md` as the operating guide for evolving the original frontend codebase in place.

## Rules For Choosing The Next Slice

When deciding what to do next, use this order:

1. If a stronger explicit authority substrate can solve it, do that first.
2. If runtime already has the state, persist/surface it instead of inventing new inference.
3. If you must extend interpretation, make it deterministic and fail-closed.
4. Prefer shared substrate changes over UI-only or route-only patches.
5. Prefer one coherent seam per commit.

Anti-goals:

- do not reintroduce prototype compatibility
- do not add broad fallback heuristics
- do not add a DB or background queue
- do not patch only one inspection surface if a shared helper exists

## Testing Strategy

Use Bun everywhere.

Common commands:

```sh
bun run check
cd packages/backend && bun run typecheck
cd packages/backend && bun run lint
bun test packages/backend/tests/<file>.test.ts
```

Testing discipline for this repo:

- add the failing focused test first
- prefer the narrowest test file or `--test-name-pattern` that proves the seam
- for assistant authority work, usually cover:
  - formatter test
  - assistant run / thread / readback test
  - optional context or UI presentation test if that surface should expose it

Current known operational caveat:

- `bun run check` may tail-hang after printing many passing tests
- when that happens, record that `typecheck` and `lint` passed, capture the targeted green tests, and note the hang explicitly in the handoff

## Documentation Discipline

Every meaningful slice should update:

- [docs/agent-handoff.md](/Users/realizer/Code/hopi-claude/docs/agent-handoff.md)
- one new spec under `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`

Update this file only when one of these changes:

- the primary startup path changes
- the active tracks change
- the recommended next-slice strategy changes
- a new global caveat appears

## Most Important Existing Docs

Read these only as needed:

- [docs/agent-handoff.md](/Users/realizer/Code/hopi-claude/docs/agent-handoff.md)
  - exhaustive current state and slice ledger
- [docs/hopi-phase-1-authority.md](/Users/realizer/Code/hopi-claude/docs/hopi-phase-1-authority.md)
  - canonical Phase 1 boundary and things that are intentionally not part of the target system
- [docs/superpowers/specs/2026-06-01-goal-assistant-and-planner-runtime-design.md](/Users/realizer/Code/hopi-claude/docs/superpowers/specs/2026-06-01-goal-assistant-and-planner-runtime-design.md)
  - big-picture assistant/planner substrate
- recent 2026-06-03 specs under [docs/superpowers/specs](/Users/realizer/Code/hopi-claude/docs/superpowers/specs)
  - best reference for the current assistant authority line

## Suggested First 30 Minutes For A New AI

If you were dropped in with no chat history, do this:

1. Read this file.
2. Run:
   - `git status --short`
   - `git log --oneline -10`
3. Read the bottom of [docs/agent-handoff.md](/Users/realizer/Code/hopi-claude/docs/agent-handoff.md):
   - `What is still missing`
   - `Recommended Next Work`
4. Inspect:
   - [packages/backend/src/assistant/GoalAssistantRuntime.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/assistant/GoalAssistantRuntime.ts)
   - [packages/backend/src/assistant/assistantRun.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/assistant/assistantRun.ts)
   - [packages/backend/src/assistant/assistantInspection.ts](/Users/realizer/Code/hopi-claude/packages/backend/src/assistant/assistantInspection.ts)
5. Pick one smallest authority seam that matches the current route.
6. Add a failing targeted test.
7. Implement through shared substrate.
8. Update docs and commit.

## Handoff Checklist

Before ending your turn:

- make sure `git status --short` is clean, or explain every change
- record the exact verification evidence you actually ran
- if `bun run check` hung, say so plainly
- update [docs/agent-handoff.md](/Users/realizer/Code/hopi-claude/docs/agent-handoff.md)
- add a spec file for the slice
- commit one coherent slice

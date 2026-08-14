# HOPI Product Design

Status: product and architecture authority
Last updated: 2026-08-14

HOPI is a Project Assistant backed by a deterministic execution kernel. The Assistant understands
intent, charts unclear work, requests bounded Runs, judges their Reports, and speaks with the
operator. The kernel owns identity, persistence, dependency safety, workspace isolation,
publication, and recovery. It never guesses semantic workflow.

There is one current schema. HOPI contains no compatibility reader, legacy lane adapter, or role
translation layer.

## Product model

- **Project**: repository bindings, Project guidance, Preview, and a collection of Goals.
- **Goal**: the current accepted destination and contract.
- **Map**: an optional Markdown index used only while the way to a Goal is unclear.
- **Work**: one named node in the Goal DAG. A Work is either a Decision or Engineering Work.
- **Run / Attempt**: one explicit, immutable Worker request and its lifecycle.
- **Attention**: one durable question or decision that genuinely needs the operator.
- **C1**: the deterministic publication boundary for Engineering completion.

The Assistant is not another domain object and owns no hidden workflow state. It reads canonical
documents and runtime facts, then makes explicit tool calls.

## One Work graph

Every actionable item is a Work node in one Goal-local DAG.

```ts
type Work = {
  kind: "decision" | "engineering"
  status: "open" | "done" | "cancelled"
  dependsOn: WorkId[]
  createdAt: string
  notBefore: string | null
  contractRevision: number
}
```

Decision Work additionally records its Wayfinder ticket type: `research`, `prototype`, `grilling`,
or `task`. Task alone records whether it is `afk` or `hitl`; the other modes follow their type.

There is no Planning Work, Planner, Generator, Reviewer, Kanban lane, review stage, current-node
field, claim field, or persisted graph position.

## Progressive wayfinding

When the route to a destination is wrapped in fog, HOPI charts the way instead of charging at the
destination. The Map is `design/index.md`. It is an index, not a state store: completed decisions
are gisted there and linked to the Decision Work that owns the full resolution. Open decisions live
only as Work documents. What cannot yet be phrased precisely stays in `Not yet specified`.

Wayfinding plans by default. Decision Work resolves questions; it does not slice the destination
into build steps. Reaching an actionable engineering boundary creates Engineering Work and normally
ends the map. Notes may explicitly allow execution inside the map.

The precise behavior is defined in [mvp_project_owner.md](./mvp_project_owner.md).

## Explicit execution

```text
Assistant
  -> explicitly requests a Run for one Work
  -> queued Attempt claims that Work for AFK activity
  -> Scheduler starts the Attempt within its declared workspace boundary
  -> fresh Worker provider session
  -> immutable settlement: termination + Report + candidate repo commits
  -> Assistant wakes and judges the result
  -> Assistant explicitly resolves, retries, asks, changes the map, or requests another Run
```

A settled Run never advances Work by itself. It cannot retry, review, complete, create follow-up
Work, or change the Goal contract.

## Claim and frontier

Claim is derived from durable activity:

- queued or running Attempt: AFK Work is claimed;
- unresolved Work-targeted Attention: HITL Work is claimed.

The frontier is derived without a model. A Work is takeable when it is open, belongs to the current
contract revision, every dependency is done, its schedule has elapsed, the Goal is active, and it is
not claimed. For a single-Work action the Assistant chooses the first frontier node by `createdAt`,
then id, unless the user named a specific takeable node. A Grilling round instead selects every
takeable Grilling Decision in the current Goal and presents their separate Attentions together.
That round is an ephemeral interaction projection, not persisted graph position or a merged Work.

## Run contract

Run has no semantic role:

```ts
type RunRequest = {
  workspaceMode: "none" | "read_only" | "isolated_write"
  instructionMarkdown: string
  refs: string[]
}
```

`workspaceMode` is a real safety boundary. Research and reasoning usually use `none` or
`read_only`; source changes use `isolated_write`. Review is simply a read-only Run with review
instructions.

Each Run has a fresh provider session. Provider-native compaction may happen inside that Run, but a
session is never shared across Runs or used as authority.

## Goal contract

`goal.md` is the current contract and may change only through an explicit material revision. Goal
id and identity remain stable. Every accepted user input is separately persisted byte-for-byte, so
contract evolution does not rewrite history.

Work from an older contract revision becomes blocked until the Assistant explicitly cancels or
reissues it. HOPI never silently retargets old Work.

## Completion

- Decision Work becomes done when the Assistant records a natural-language Resolution. It does not
  use C1.
- Engineering Work becomes done only through an explicit Assistant decision and successful C1
  publication of the selected task heads and Work document together.
- Goal completion is an explicit Assistant judgment after the destination and success criteria are
  satisfied and no required Work remains.

## Route UI

The Goal home is the automatically derived **current known route**. It is not a graph editor.

- Destination is a virtual Goal node.
- Open Work nodes and dependency edges come from canonical documents.
- runtime state, Attention, blocking, and readiness are derived decorations.
- terminal nodes collapse into virtual `Decisions made` and `Delivered` summaries.
- layout is deterministic and ephemeral; coordinates are never persisted.

Map prose remains visible as a document. UI extraction from it may enhance presentation, but must
never control lifecycle or execution.

## Non-goals

The product deliberately does not include:

- a generic workflow engine or configurable stage machine;
- a separate Ticket entity;
- semantic routing in the scheduler;
- a Goal Supervisor service;
- automatic retry or automatic review;
- Map prose parsing as authority;
- manually editable graph coordinates;
- legacy schema compatibility.

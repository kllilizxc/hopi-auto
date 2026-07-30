# HOPI Canonical Document Model

Status: storage authority
Last updated: 2026-08-14

Canonical Markdown is the durable source of product truth. Runtime JSON records execution facts;
provider sessions and projections are disposable caches. There is one current schema only.

The current Home schema epoch is `3`. It starts with the Wayfinder-native Goal / Decision Work /
Engineering Work model and generic Attempts. Earlier Homes are rejected and must be discarded;
there is no runtime compatibility or migration path.

## Goal package

```text
.hopi/goals/<goalId>/
  goal.md
  design/
    index.md                 # optional Wayfinder Map
    <supporting-design>.md
  inputs/<sourceHomeId>/<eventId>.md
  work/<workId>.md
  attention/<attentionId>.md
  evidence/**
```

`goal.md`, Work, Attention, Inputs, and design documents publish through the existing guarded
publication root. Runtime attempts are stored under Assistant Home and reference canonical ids.

## `goal.md`

Frontmatter:

```yaml
id: G-...
title: ...
lifecycle: active | paused | done | cancelled
priority: 0
contractRevision: 1
```

Body is free Markdown, conventionally containing Objective, Constraints, Non-Goals, and Success
Criteria. The body is the current contract. A material instruction replaces or edits it and
increments `contractRevision` in the same guarded publication.

The id and title are immutable. Accepted Inputs preserve the original words, so the contract body
does not need to be immutable.

## `design/index.md`

The file is optional. It exists only when the Goal needs progressive wayfinding. Its exact shape is:

```markdown
## Destination

<one or two lines describing what reaching the end of this map means>

## Notes

<domain, skills, standing preferences, and explicit execution override if any>

## Decisions so far

- [<closed Decision title>](link) — <one-line gist of its resolution>

## Not yet specified

<in-scope fog that cannot yet be phrased as a precise question>

## Out of scope

<consciously excluded work and links to any closed mis-scoped tickets>
```

The Map is an index. It never repeats full resolutions, lists open tickets, or becomes scheduler
input. A clear, small Goal has no Map and may start directly with Engineering Work.

## `inputs/**`

An accepted user or system input is immutable after first publication. Its path is stable and can
be referenced from Goal and Work. Contract revision changes never alter prior Inputs.

## `work/<workId>.md`

Shared frontmatter:

```yaml
id: W-...
title: ...
kind: decision | engineering
status: open | done | cancelled
createdAt: 2026-08-14T00:00:00.000Z
notBefore: null
dependsOn: []
contractRevision: 1
evidenceRefs: []
contextRefs: []
ownerMessages: []
```

Decision frontmatter additionally contains:

```yaml
decisionType: research | prototype | grilling | task
taskMode: afk | hitl          # required only for task
```

Decision body:

```markdown
## Question

<one precise question sized for one agent session>

## Resolution

<present only after resolution; the answer and links to evidence or assets>
```

Engineering body is free Markdown, conventionally Objective and Acceptance Criteria. Completion
may append a Completion Decision and delivery references.

`dependsOn` may reference either Work kind in the same Goal and current contract revision. It is a
real DAG: references must exist, self edges and cycles are rejected, and cancelled dependencies do
not satisfy readiness.

Work status moves only from `open` to `done` or `cancelled`. Running, queued, waiting for user,
blocked, and ready are projections, not stored statuses.

## Immutable release history

Materialized releases always contain current strict canonical documents. When C1 recovery reads a
previous secondary release from an immutable parent, it accepts the current Project manifest or the
former v2 document with its exact `version: 2` wrapper, strips that wrapper in memory, and applies
the same topology validation.

Coordinator startup also verifies completed Work stored in each immutable reachable C1. Its
historical-only reader accepts either the current Work form or the former form that predates both
`contextRefs` and `ownerMessages`; it supplies empty arrays in memory and then applies the complete
current Work schema. A live Work missing either field, a historical Work missing only one field, and
all unknown historical formats still fail closed. Historical forms are never republished.

## Attempts

Attempt is the sole Run record. The immutable request contains:

```yaml
workspaceMode: none | read_only | isolated_write
instructionMarkdown: ...
refs: []
```

Lifecycle is `queued`, `running`, then `settled`. Settlement separately records a termination fact
(`normal`, `cancelled`, `interrupted`, `crashed`, or `timed_out`), timestamps, natural-language
Report, usage, diagnostics, and candidate source commits where applicable.

There is no profile, responsibility, lane, stage, or shared provider session in Attempt authority.

## Attention

Attention is an unresolved operator dependency with a canonical target. A Work-targeted Attention
claims HITL Decision Work until resolved. Attention never mutates the Work directly; the Assistant
uses the reply to make a later explicit judgment.

One public Assistant turn may present several open Attentions and one operator reply may reference
that whole set. This is presentation grouping only: each Attention retains its own target,
resolution, and claim lifecycle.

## Projection

The route API derives nodes and edges from the Goal package plus current Attempts and Attentions.
It may return a focus node and collapsed terminal counts, but those fields are not persisted back to
the package.

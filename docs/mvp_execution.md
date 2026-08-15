# HOPI Execution Model

Status: runtime authority
Last updated: 2026-08-15

## One explicit Worker path

Every provider invocation is one Run/Attempt requested by the Project Assistant or an explicit API
caller. The scheduler does not derive Runs from Work kind, a board position, or a semantic role.

```text
explicit request -> queued -> running -> settled -> Assistant wake
```

Only the Assistant can decide what follows settlement.

## Admission

A Run may be queued only when:

- Project and Goal are active;
- Work is open and at the current contract revision;
- every dependency is done;
- `notBefore` has elapsed;
- no queued/running Attempt already claims the Work;
- no unresolved Work Attention claims it;
- declared workspace mode is valid for the Work kind.

The request is immutable after admission.

## Project isolation and shared capacity

Every execution blocker is Project-scoped: Assistant turns, direct commands, settlement
observation, wake cursors, eligibility, Goal barriers, and queued/running claims in one Project
must not delay another Project. A Project may advance whenever its own state permits it.

Only the finite Worker concurrency budget is shared across Projects. Cross-Project contention may
delay a queued Run only when all shared Worker slots are reserved; that delay is presented as a
capacity wait. Internal coordinator serialization may protect a bounded read or publication, but it
must not become durable cross-Project scheduling authority.

## Workspace modes

- `none`: reasoning or external research that requires no repository checkout.
- `read_only`: repository inspection with no accepted source mutation.
- `isolated_write`: one stable, isolated task branch and checkout per Engineering Work.

Decision Work uses `none` or `read_only`. Prototype artifacts still have a dedicated writable
artifact directory, but source mutation is represented as Engineering Work on the same route. This
keeps one publication path: every accepted source change enters the release through C1.

## Worker context

The runtime builds a bounded context from the explicit Run instruction, the named Goal and Work,
referenced canonical documents, Project guidance, repository manifest, and workspace facts. It does
not inject a Planner, Generator, or Reviewer persona. Relevant Wayfinder wording is included for
Decision Runs rather than translated into a fixed stage prompt.

Each Run receives a fresh provider session. Native compaction and handoff are internal to that Run.
No later Run resumes it.

## Settlement

Every started Run settles exactly once with:

- terminal lifecycle and termination fact;
- complete natural-language Report;
- bounded public diagnostics and complete local transcript;
- vendor-reported usage when available;
- candidate commits for isolated-write work.

Settlement never updates Work status.

## Engineering completion

When the Assistant accepts Engineering evidence, C1 validates the current task heads, merges the
selected repo commits into the Project release, and publishes the completed Work document in the
same deterministic boundary. A conflict or stale task head leaves Work open.

Review is optional. When useful, the Assistant requests another read-only Run over a frozen
candidate and references its Report in the final completion decision.

## Decision completion

The Assistant records one Resolution in the Decision Work and closes it through a guarded canonical
publication. Updating the Map's one-line context pointer is a supporting write in the same
publication. New decisions revealed by the answer are created blocked by the current decision
before the current decision closes; completion then exposes the new frontier without a dispatch
race.

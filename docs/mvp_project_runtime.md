# Project Runtime Capabilities

Status: authoritative MVP design
Last updated: 2026-07-30

This document owns Prepare and Preview.

## Mental Model

Prepare and Preview are optional Project capabilities represented by ordinary reviewed scripts in
the primary Project root:

```text
scripts/hopi/prepare
scripts/hopi/preview
```

HOPI owns invocation, observation, process lifecycle, and durable runtime records. The Project script
owns Project-specific orchestration across all linked Repos.

No additional workflow stage, adapter registry, per-Repo HOPI configuration, or freshness state is
introduced.

HOPI also owns the managed release boundary. Before Project code runs, it verifies that every
supplied Repo root is at the declared Project release head and has no source change outside
`.hopi/**`. Project scripts consume those roots directly; they do not repeat Git validation or
materialize another release copy.

## Shared Invocation Context

Both scripts receive:

- the primary Project root as working directory
- a complete manifest of linked Repo IDs, roots, and current managed release heads
- a disposable invocation runtime directory
- a persistent Project cache directory

The scripts may call Repo-native package managers or setup helpers. HOPI never assumes every Repo
has the same setup command.

An optional `runtimeInputs` object may accompany Preview Start. It contains at most 32 entries; keys
are 1–128 characters, values are at most 8,192 characters, and the complete serialized object is at
most 32 KiB of UTF-8. HOPI passes the opaque object only in the Preview child environment as
`HOPI_PREVIEW_RUNTIME_INPUTS`; names and meaning belong to the Project adapter. The Preview manager
does not add the object to its session manifest or log.

This session-only boundary begins at Preview admission. An Assistant message and its model-authored
tool arguments are durable conversation and provider transcript data, so `runtimeInputs` supplied
through `hopi_control_preview` must be non-secret. Credential or secret material must not travel
through an Assistant turn.

The manifest and logs are persisted with the invocation. They are facts available to responsibility
passes and the Project Assistant.

## Prepare

`scripts/hopi/prepare` is optional. Missing means the Project has no declared preparation capability;
it is not an error and does not require no-op scripts in secondary Repos.

The Project script decides which linked Repos need preparation. HOPI runs the current script instead
of storing an initialized revision or attempting to predict freshness. The script is expected to be
idempotent and may use the persistent Project cache.

Prepare success means that the declared runtime dependencies and capabilities are available for the
responsibility or Preview process. Prepare does not own Work acceptance, full test suites, semantic
artifact validation, or traversal and hashing of large Project datasets. Those operations remain
ordinary Work verification so they run only when the responsible Agent judges them necessary. HOPI
does not enforce this distinction by parsing the script or add a freshness cache; duration and logs
make an adapter that violates the boundary observable to the Project Assistant.

Before every Generator or Reviewer starts, HOPI runs Prepare from the primary Repo's responsibility
worktree and supplies all responsibility worktree roots in the manifest. It attaches the result and
log, including start, end, and duration, to the Run prompt and Attempt stream. A Prepare failure is
observable but does not prevent that Agent from starting, because the assigned change may repair the
script or environment itself.

Before one-click Preview starts, an existing Prepare script must succeed. A missing Prepare script is
skipped. Preview invokes it from the managed release root with managed release Repo roots. A failing
Prepare script prevents Preview startup and produces a factual Project event.

## Preview

`scripts/hopi/preview` owns only Project-specific local service startup across linked Repos. HOPI
has already established the exact managed release boundary before invoking it. The adapter uses the
provided Repo roots and never an unintegrated Work candidate.

The Preview adapter starts the smallest real runtime composition needed to provide the intended
Project experience. A process may be an operator-facing entry, an internal application dependency,
or supporting infrastructure; only entries that an operator should open are announced as surfaces.
The Project decides that composition from its current product behavior rather than Repo count,
package scripts, or a global frontend/backend topology rule.

Projects keep the current understanding of that experience in the primary Repo at
`docs/hopi/preview/runbook.md`. The runbook is ordinary free-form Markdown, not a HOPI schema. When
Engineering Work creates or changes Preview, Generator first creates or refreshes the runbook by
exploring applicable Repo guidance, knowledge sources, the existing application, and current source,
then implements the adapter. Technical facts discovered during implementation are written back in
the same Work. Ordinary Start/Stop and runtime failure do not create a separate runbook workflow.
However, a user-initiated Start already requests the working Preview capability. If diagnosis finds
that no adapter exists and no current Work owns that capability, Assistant creates the ordinary
Engineering Work itself; the operator does not have to ask for repair separately. This admission
uses the existing Goal/Work model and is not a Preview-specific repair workflow.

Ordinary Preview Start must remain a practical, bounded operator action. Engineering exploration may
use representative runtime probes, but the adapter must not turn a missing Project fact into an
exhaustive or combinatorial search on every Start. Parallel execution changes latency, not whether a
search is bounded. A numeric candidate cap is also insufficient when measured worst-case latency or
resource fan-out remains unsuitable for an ordinary Start. Generator first derives required facts
from accepted input, the runbook, applicable guidance, configuration, current application behavior,
and source. A per-attempt wall-clock deadline makes only that attempt finite; repeating such attempts
does not make discovery bounded or establish an unknown Project fact. Generator may repair an invalid
observation oracle and replay its known-positive control. Once a valid oracle leaves a required fact
unknown after bounded exploration, Generator does not optimize or rerun sampling: Preview remains
fail-closed and the Agent updates the smallest Attention so Assistant can ask one precise question.
It does not publish a partial experience, fabricate a mock, or hide the uncertainty behind runtime
sampling.

Experience verification also has a bounded observation contract. A verified business-negative
result (for example, an empty experience) is distinct from an observation failure. Browser, network,
or assertion errors must remain observable and must not be collapsed into the same value as valid
empty product data. When a candidate result contradicts a known-positive observation, current
application behavior, or another accepted fact, Generator treats the measurement as unproved and
audits the smallest relevant observation path before changing search scope, retry count, or timeout.
It first replays a known-positive control when one is available, then fixes or explains the oracle;
only a successfully observed negative result can justify an Attention about missing product data.

An existing runbook and accepted Project, Goal, or operator inputs are the current
intended-experience authority. Discarding old Preview conclusions discards obsolete implementation
and acceptance evidence, not those durable product decisions. A route, service, package, or
successful response proves technical availability only; it does not create an operator entry or
override the runbook. Only accepted input that explicitly changes a product decision may revise this
baseline; a generic rebuild or instruction to ignore old Preview conclusions cannot demote it. When
exploration exposes a conflict or a missing answer that can change the Preview boundary,
composition, or acceptance, the responsible Agent preserves the runbook boundary, asks the smallest
question before starting dependent implementation, and updates an existing unresolved Attention
instead of duplicating it.

Preview does not inspect, classify, replace, snapshot, or seek approval for the databases selected
by Project configuration. Its services may read and write those databases normally. After Preview
starts or an interaction finishes, Assistant may warn the operator that connected data may have
changed; the warning is informational and never a startup or verification gate.

The script announces:

```text
HOPI_PREVIEW_SURFACES=<json>
```

HOPI considers Preview `running` only after the announced transports are reachable. Reachability is
not proof that a Goal is complete or that a surface is semantically correct.

When Engineering Work creates or changes Preview, Reviewer must independently use the candidate
Preview through the available browser environment. An incomplete experience such as missing data,
missing application context, or an unusable page is a starting observation, not an acceptable
transport result. Reviewer investigates the runtime, relevant knowledge, and source until it can
explain the smallest material cause, and rejects when the intended experience is not faithfully
available. HTTP responses, process state, and port cleanup remain necessary operational evidence but
cannot replace that judgment.
Reviewer also rejects a candidate whose ordinary Start depends on exhaustive runtime discovery or
resource fan-out with no practical total bound; making the same search concurrent is not a bound.
Reviewer rejects verification that converts observation errors into business-negative results or
leaves a contradiction with a known-positive control unexplained. Increasing waits or probes does
not repair an invalid oracle.

Reviewer also checks the proposed runbook and announced surfaces against the current Goal, the
previous runbook baseline, and accepted operator decisions rather than treating the Engineering Work
contract as independent product authority. A candidate cannot pass by rewriting the runbook around
whatever routes happen to start.

One Preview session may announce any number of surfaces. A surface is only an opaque named entry
that the operator can open; HOPI does not infer application hierarchy, service dependencies, or
relationships between entries. The Project adapter starts whatever the Project needs and announces
all currently available entries together. The product UI exposes them through one Preview control
whose menu opens the selected surface.

The Preview child is a process-group leader owned by HOPI. Project children remain in that group.
The adapter may clean up non-process resources it explicitly creates, such as containers, but does
not implement a second generic process supervisor. Stop, release replacement, restart recovery, and
failed startup first signal the foreground adapter and allow its bounded cleanup window, then
terminate anything still present in the complete process group. The foreground adapter exiting is
not by itself proof of cleanup: HOPI finishes Stop only after the process group is observed absent.
An OS denial remains an error only while that absence cannot be established; a group that drains
during bounded escalation is a successful Stop.

HOPI persists a Preview session manifest containing:

- status and timing
- exact release heads
- announced surfaces
- Prepare result reference
- log path
- process identity
- terminal error

A release-head change stops the current Preview and records the reason. HOPI does not automatically
restart it.

## Agent Context

Preview is Project runtime state, not Planner-owned completion evidence. Current Preview facts and
their canonical manifest path are available through the same generic Project context for Assistant,
Planner, Generator, and Reviewer.

Engineering verification occurs in the Work workspace. Managed release Preview shows only integrated
release state. Planner and Reviewer judge what evidence is sufficient from their assignment and
available facts; HOPI does not require a special Preview evidence type or inject a final-Planning
Preview file.

## Failure Routing

Missing Preview capability, Prepare failure, startup failure, unreachable surfaces, unexpected exit,
and release-triggered stop are factual internal Project events. New events wake the Project
Assistant. The event contains the observed status and diagnostic references, not an instruction to
repair or create Work.

HOPI does not:

- generate a canned repair instruction
- create Attention automatically
- force a Repair button or a Planning/Engineering choice
- block Preview because unrelated Attention exists
- restart Preview automatically

The Assistant sees the event, logs, manifest, Project state, and tools, then decides whether to
repair, retry, change Work, communicate, or leave the fact alone.

## Multi-Repo Conflict Boundary

Prepare and Preview adapters are ordinary versioned Project source. Conflicts in those files are
normal shared-source conflicts.

HOPI preserves the candidate delta and exposes task heads, release heads, paths, and diagnostics.
Generator or Project Assistant can repair the existing lineage, change dependencies, cancel Work, or
create different Work. Coordinator does not discard the delta, invent semantic ownership, or
automatically route the conflict through Planner.

## Offline Project Reset

Project reset is an explicit operator maintenance operation for starting one linked Project again
without recreating its topology. It is not a Goal transition, an Assistant tool, or a Coordinator
recovery rule.

A reset removes:

- every canonical Goal package in the Project
- every Assistant Inbox turn whose conversation scope is that Project
- Project-scoped workspace Attention
- the Project Assistant vendor session, scratch workspace, turn records, Wake records, Runs,
  responsibility sessions, Preview records, task worktrees, and Work refs

It preserves the Assistant Home, Project link, Repo bindings, preferences, Project release source,
and every user checkout. When Goal packages are tracked by the primary Project release ref, reset
advances that ref with a commit containing only their deletion. It never rewrites or checks out a
user branch.

The maintenance command is dry-run by default. Mutation requires the exact Project ID as explicit
confirmation and exclusive ownership of the Coordinator instance lock, so the running HOPI service
must be stopped first. The command validates the complete reset plan before changing state. An
Attention that refers to both the target Project and another Project makes the plan ambiguous and
must be resolved before reset.

Each Assistant conversation feed carries a persistent stream generation. Reset replaces the target
Project generation after removing its history. A client polling with an older generation receives
the complete current baseline and atomically replaces its cached history; operators do not need to
reload a tab or clear browser storage.

This boundary is intentionally outside ordinary publication validation: historical deletion would
be invalid during normal product operation, while reset is a deliberate offline replacement of that
history. The command records a reset manifest under Assistant runtime storage for audit, but active
state contains no archived copy and cannot silently restore it.

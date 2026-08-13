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

Preview has one practical target: open the normal user entry with working authentication and useful
visible data. Authentication may be mocked. Prefer local data, including deterministic sample data,
and fall back to DEV when local data is unavailable or more expensive to provide. Preview does not
need production-equivalent infrastructure or every product capability.

Projects keep the current understanding of that experience in the primary Repo at
`docs/hopi/preview/runbook.md`. The runbook is ordinary free-form Markdown, not a HOPI schema. When
Engineering Work creates or changes Preview, Generator reads or updates it before implementation.
It records only the current user entry, chosen authentication and data path, launch facts, and useful
verification knowledge. Ordinary Start/Stop and runtime failure do not create separate runbook Work.
However, a user-initiated Start already requests the working Preview capability. If diagnosis finds
that no adapter exists and no current Work owns that capability, Assistant creates the ordinary
Engineering Work itself; the operator does not have to ask for repair separately. This admission
uses the existing Goal/Work model and is not a Preview-specific repair workflow.

Generator explores in this order: current runbook and source, relevant knowledge, then one short
operator question only if a necessary fact remains unavailable. It chooses the shortest working
launch path, starts it before broad builds or test suites, and fixes only blockers to the page, data,
and one basic interaction. Mock authentication and local sample data are valid implementation
choices. Implementation uses small coherent edits; after a failed patch, Generator inspects and
retries only that file instead of resending a large multi-file change. Unrelated services,
production completeness, and exhaustive diagnosis are outside scope. Once the normal entry,
authentication, useful data, and one basic interaction are observed, Generator stops product
exploration and finishes focused checks and cleanup; it does not open or repair extra routes or
features. The entry check starts from fresh browser state without pre-existing local or session
storage. Generator must make any required user configuration or session available through Preview
itself, not by manually seeding only its test browser.

A failed service or startup stage is evidence that Preview is unavailable, not the scope of the next
Goal. Assistant writes Preview Goal and Work contracts only in experience terms: user entry, working
authentication, visible useful data, and one basic interaction. Failed topology and old runbook
implementation restrictions are revisable technical history. They do not require a specific service
or prohibit mock authentication or local data unless current operator input explicitly says so.
Assistant reads only the session status and bounded failure summary before creating that Work;
source inspection, reproduction, root-cause analysis, implementation, and browser verification
belong to Generator.

Preview services may read and write their configured local or DEV data normally. Database
classification, snapshots, and approval are not Preview gates.

The script announces:

```text
HOPI_PREVIEW_SURFACES=<json>
```

HOPI considers Preview `running` only after the announced transports are reachable. Reachability is
runtime state, not user-experience acceptance.

When Engineering Work creates or changes Preview, Reviewer independently starts and uses every
candidate surface in a browser. It passes when the intended product entry opens, authentication works
(including by mock), useful data is visible, and one basic interaction works. A blank, broken, or
data-empty page fails. HTTP responses and process state alone cannot pass, but Reviewer does not
require live authentication, production-equivalent infrastructure, or unrelated product capability.
Once those experience facts are observed, Reviewer does not explore additional routes or features;
it stops the candidate and verifies owned process, port, and resource cleanup. Reviewer starts from
fresh browser state and rejects a Preview that works only after manually seeding its validation
browser.

One Preview session may announce any number of surfaces. A surface is only an opaque user entry that
the operator should open; internal dependencies are not surfaces. HOPI does not infer application
hierarchy or service relationships. The product UI exposes the announced entries through one Preview
control.

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
and every user checkout. Reset advances the primary Project release ref with a Project Reset epoch
commit. When Goal packages are tracked by that ref, the same commit contains only their deletion;
otherwise the tree may be unchanged. Historical commits remain reachable for audit, but C1 and
other Project-state reconstruction stop at the latest reset epoch for that Project. Reset never
rewrites or checks out a user branch.

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

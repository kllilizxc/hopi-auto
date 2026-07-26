# Project Runtime Capabilities

Status: authoritative MVP design
Last updated: 2026-07-24

This document owns Prepare and Preview. It supersedes conflicting per-Repo preparation, formal
Planner Preview, Preview-repair prompt, and Attention-gated Preview sections in older MVP documents.

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

## Shared Invocation Context

Both scripts receive:

- the primary Project root as working directory
- a complete manifest of linked Repo IDs, roots, and current managed release heads
- a disposable invocation runtime directory
- a persistent Project cache directory

The scripts may call Repo-native package managers or setup helpers. HOPI never assumes every Repo
has the same setup command.

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

`scripts/hopi/preview` owns all Project-specific service startup across linked Repos. It starts the
exact managed release heads, never an unintegrated Work candidate.

The script announces either:

```text
HOPI_PREVIEW_SURFACES=<json>
```

or the compatible single-surface shorthand:

```text
HOPI_PREVIEW_URL=<url>
```

HOPI considers Preview `running` only after the announced transports are reachable. Reachability is
not proof that a Goal is complete or that a surface is semantically correct.

The Preview child is a process-group leader. Stop, release replacement, restart recovery, and failed
startup terminate the complete process group.

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
and release-triggered stop are factual Project events. New events wake the Project Assistant.

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
- the Project Assistant vendor session, scratch workspace, turn records, Reflection records, Runs,
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

This boundary is intentionally outside ordinary publication validation: historical deletion would
be invalid during normal product operation, while reset is a deliberate offline replacement of that
history. The command records a reset manifest under Assistant runtime storage for audit, but active
state contains no archived copy and cannot silently restore it.

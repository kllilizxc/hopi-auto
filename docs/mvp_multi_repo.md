# HOPI MVP Multi-Repo Design

Status: implemented MVP protocol
Last updated: 2026-07-12

This document owns the Repo membership, multi-root execution, integration, and recovery rules for
one Project spanning multiple Git Repos. Product concepts and lifecycle remain defined by
[the MVP design](./mvp_design.md) and [state machine](./mvp_state_machine.md). This protocol adds no
Repo workflow, Repo Kanban, new responsibility, or general transaction engine.

## One Project, One Control Boundary

A Project contains one or more Repos with stable `repoId` values and exactly one `primaryRepoId`.
The primary Repo is the existing Project control boundary:

- its managed integration worktree contains the canonical `.hopi` package
- its root `AGENTS.md` is the Project model entrypoint
- its `scripts/hopi/prepare` and `scripts/hopi/preview` are the only HOPI adapters
- its `hopi/release` ref is the one logical C1 boundary

Every secondary Repo has its own HOPI-owned `hopi/release` ref and managed integration worktree, but
no duplicate Goal package. Choosing a primary Repo instead of creating a synthetic control Repo
preserves the current single-Repo layout and migration model. Changing or removing the primary Repo
is outside this MVP because it would move canonical history and the irreversible boundary.

The user-facing model remains:

```text
Project -> Goal -> Work
```

Repo is a Project member and Work workspace selector, not another task hierarchy.

## Canonical Documents

Assistant-home `projects.yml` is the authority for machine-local bindings:

```yaml
version: 2
projects:
  - projectId: P-1
    primaryRepoId: web
    repos:
      - repoId: web
        repoPath: /code/product-web
      - repoId: api
        repoPath: /code/product-api
```

The primary managed root's `.hopi/project.yml` is the portable Project and release authority:

```yaml
version: 2
projectId: P-1
primaryRepoId: web
repos:
  - repoId: web
  - repoId: api
    releaseCommit: 3e61e23a...
```

The primary release is implicit in the C1 containing this document, avoiding an impossible
self-reference. Every secondary `releaseCommit` is required and names the commit its managed
`hopi/release` must materialize.

`.hopi/docs/repos.md` is Planner-maintained semantic context. It records what each Repo owns,
dependency direction, shared contracts, important commands, and the combined runtime shape. The
kernel never parses its prose. Membership and commit identity stay in `project.yml`, while local
paths stay in Assistant home; these documents do not compete for the same fact.

Version 1 Project links and `project.yml` normalize to one primary Repo. Existing Engineering Work
without `repos` means that primary Repo. New Work always writes a non-empty unique list:

```yaml
repos: [web, api]
```

This small structured field is necessary before model execution because Coordinator must choose
which Git branches and worktrees to allocate. Intent, cross-Repo reasoning, and acceptance criteria
remain ordinary Markdown.

## Linking and Initialization

The create form collects one or more Repos before it creates a Project. Each click asks the local
Coordinator to open the host directory chooser and returns either one absolute directory or cancel;
the chooser result is transient UI input, not a new document or browser filesystem authority. The
operator gives every selected Repo a stable ID and chooses exactly one primary Repo. macOS, Linux,
and WSL use small host adapters behind this same boundary. Browser automation injects deterministic
chooser results rather than pretending that a text field proves the native boundary.

Create submits the complete `{ primaryRepoId, repos[] }` set once. Coordinator resolves every Git
root and common directory, rejects duplicate IDs or Git identities before changing the Project
link, creates or validates the managed roots, then publishes `project.yml` and finally the one
`projects.yml` link gate. A failure before that gate may leave retryable managed Git preparation but
cannot expose a partially linked Project. Repeating the exact request is idempotent. A later Repo
addition uses the same validation rules; Repo ID is immutable and a moved checkout uses rebind.

Linking performs only deterministic Git and document work. It creates no Init Goal, Work, state, or
model Run. The next ordinary Planner Run reads all linked Repo roots. It refreshes
`.hopi/docs/repos.md` when that context is missing or materially stale and uses the existing primary
`AGENTS.md` bootstrap rule. Existing Repo-local `AGENTS.md` files are additional applicable guidance;
HOPI does not manufacture one in every Repo merely because it was linked.

An inconsistent partial link or an unavailable Repo creates one Project Attention and makes the
Project ineligible. HOPI never guesses a replacement path or silently drops a Repo from a release.
When several paths move together, rebind accepts the complete existing Repo-ID set in one request,
repairs every managed-worktree entry, and changes the local binding document only after all targets
validate. This is the same Project-link publication boundary, not a migration workflow.

## Work Workspace

One Engineering Work still has one Generator, one Reviewer, one card, one retry counter, and one
result. For every Repo in `repos`, Coordinator creates or reuses a stable task branch and worktree
starting from that Repo's current `hopi/release`. The responsibility receives the roots together in
one runtime manifest:

```json
{
  "primaryRepoId": "web",
  "repos": {
    "web": "/runtime/worktrees/P-1/G-1/W-1",
    "api": "/runtime/worktrees/P-1/G-1/W-1.repos/api"
  }
}
```

The process cwd is the primary root when selected, otherwise the first Work Repo; all other roots
are explicit writable roots. Prompts name every Repo ID and path. A Generator checkpoint covers
every Work root, and Reviewer starts only when every root is checkpoint-clean. Reviewer fingerprints
all roots and one source mutation rejects the Run.

`dependsOn` continues to express known semantic ordering. HOPI does not infer file locks or serialize
all Work sharing a Repo. Concurrent Work branches may proceed; C1 revalidates every selected Repo
against its current release target and rejects a conflict before the primary boundary.

## Preparation and Preview

There is still one Project preparation and one Preview adapter in the primary Repo. Coordinator
writes a runtime-only Repo manifest and supplies:

```text
HOPI_PROJECT_ROOT=<primary-root>
HOPI_REPOS_FILE=<runtime-json-path>
```

For an Engineering Run the manifest names its task roots. For Preview it names every managed
integration root. Existing single-Repo scripts may ignore `HOPI_REPOS_FILE` and retain their current
behavior. Multi-Repo scripts orchestrate Repo-native commands through the manifest. HOPI adds no
per-Repo adapter schema, initialized flag, or adapter revision.

The existing bootstrap rule remains: when the primary script is missing or broken, Planner includes
its repair in the first real Engineering Work needing the environment. That Work must include the
primary Repo. Preparation failure before Reviewer returns the logical Work to Generator with the
captured log. Preview is one Project button and starts only when all release projections are valid.

## Primary C1 and Component Commits

Reviewer success is integrated as one logical operation:

1. Under the global publication mutex, Coordinator rereads the primary canonical state and every
   selected Repo release ref.
2. It verifies every task worktree is clean and builds one durable component candidate per changed
   secondary Repo. A component candidate has the old Repo release as first parent and carries the
   qualified Project, Goal, Work, Run, and Repo trailers. It is not a C1 gate.
3. It builds the primary candidate on the current primary release. That tree contains any primary
   source change, the reviewed Work at `done`, immutable Evidence, and an updated `project.yml`
   naming the complete secondary release vector.
4. It rechecks semantic guards and every expected old ref. Any source conflict, stale target, or
   invalid candidate rejects before publication.
5. It durably moves only the primary `hopi/release` from the expected old commit to the new C1.
   This guarded ref move is the single irreversible logical boundary.
6. It materializes the primary integration worktree, then advances and materializes each secondary
   `hopi/release` to the commit recorded by C1.

Primary history contains exactly one qualified C1 per completed Engineering Work, including a Work
that changed only secondary Repos. Goal completion verification therefore retains the current exact
Work-trailer rule and additionally verifies the Project release manifest against every Repo.

## Recovery

Secondary ref and worktree updates are projections of the already durable primary C1, analogous to
primary managed-worktree materialization today. If the process stops after the primary ref move,
startup reads the current C1's `project.yml` and compares every secondary projection:

- target ref equals the recorded commit: validate or finish worktree materialization
- target ref equals the expected previous release: advance it and materialize
- target ref has any other value: create Project Attention and stop scheduling

The previous release comes from the parent C1 manifest; for a newly added Repo, it is the component
candidate's first parent. Recovery never rolls back the primary C1, never re-runs Generator or
Reviewer, and never invents a Work state. Until all projections match, the Project is ineligible even
though the Work document inside the durable C1 is already `done`.

This is a fixed Project release projection protocol, not a promise of simultaneous physical Git ref
updates or deployment atomicity. External deployment remains outside HOPI unless a reviewed Project
adapter implements it under the normal approval policy.

## UI

Linked Projects shows one primary Repo and a list of secondary Repos. The MVP supports selecting
multiple Repos before Project creation, adding a secondary Repo later, and rebinding one or all
moved Repos. Primary switching after creation and Repo removal are deferred. Project model settings
remain Project-level.

Kanban remains Goal/Work based. Engineering cards show compact Repo badges; no Repo columns or
Repo subcards are introduced. Work Attempts remain one stream and may show the per-Repo workspace
paths, checkpoints, diffs, and integration diagnostics. Preview remains one Project control.

## Acceptance Scenarios

The implementation is complete only when automated tests cover:

- version 1 single-Repo Projects and Work run without behavioral migration regressions
- the host chooser can be cancelled without an effect and one create request atomically links two Repos
- two selected checkouts of one Git common directory fail before a durable Project link exists
- a secondary Repo can be added and rebound without touching either user checkout
- a moved Assistant home and complete Repo set can be rebound together without losing portable state
- one Work modifies primary and secondary Repos, receives one review, and produces one primary C1
- one Work modifies only a secondary Repo while its Work and Evidence remain canonical in primary
- a target advance or merge conflict in any Repo rejects before the primary boundary
- a crash after primary C1 but before zero, one, or all secondary projections converges on restart
- an unexpected secondary ref value blocks the Project without rollback
- Project prepare and Preview receive the correct multi-Repo runtime manifest
- the UI manages Repo links and shows Work Repo scope without a Repo workflow

# HOPI MVP Multi-Repo Design

Status: implemented MVP protocol
Last updated: 2026-07-23

This document owns the Repo membership, multi-root execution, integration, and recovery rules for
one Project spanning multiple Git Repos. Product concepts and lifecycle remain defined by
[the MVP design](./mvp_design.md) and [state machine](./mvp_state_machine.md). This protocol adds no
Repo workflow, Repo Kanban, new responsibility, or general transaction engine.

## One Project, One Control Boundary

A Project contains one or more Repo bindings with stable `repoId` values and exactly one
`primaryRepoId`. A Git Repo may be bound read-write by several Projects; binding-owned refs and
worktrees isolate their histories.
The primary Repo is the existing Project control boundary:

- its managed integration worktree contains the canonical `.hopi` package
- its root `AGENTS.md` is the Project agent-instruction entrypoint
- its `scripts/hopi/preview` is the one Project Preview adapter
- its `hopi/project/<projectId>/release` ref is the one logical C1 boundary

Every secondary binding has its own Project-qualified release ref and managed integration worktree, but
no duplicate Goal package. A Repo may provide a local `scripts/hopi/prepare` capability; Project
membership does not require one. Choosing a primary Repo instead of creating a
synthetic control Repo preserves the current single-Repo layout and migration model. Changing or
removing the primary Repo is outside this MVP because it would move canonical history and the
irreversible boundary.

The user-facing model remains:

```text
Project -> Goal -> Work
```

Repo is a Project member, not another task hierarchy or a Work-level selector.

## Canonical Documents

Assistant-home `projects.yml` is the authority for machine-local bindings:

```yaml
version: 4
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
self-reference. Every secondary `releaseCommit` is required and names the commit its
Project-qualified managed release must materialize.

`.hopi/docs/repos.md` is Planner-maintained semantic context. It records what each Repo owns,
dependency direction, shared contracts, important commands, and the combined runtime shape. The
kernel never parses its prose. Membership and commit identity stay in `project.yml`, while local
paths stay in Assistant home; these documents do not compete for the same fact.

Version 1 Project links and `project.yml` normalize to one primary Repo. Every Engineering Work uses
the complete current Project Repo set. Legacy Work `repos` fields are accepted as inert input and
removed on canonical rewrite; they never narrow a Run. Coordinator can allocate branches and
worktrees from Project membership without asking a model to predict which roots implementation or
proof will eventually need. Intent, cross-Repo reasoning, and acceptance criteria remain ordinary
Markdown.

## Linking and Initialization

The create form collects one or more Repos before it creates a Project. Each click asks the local
Coordinator to open the host directory chooser and returns either one absolute directory or cancel;
the chooser result is transient UI input, not a new document or browser filesystem authority. The
first selection is primary by default, and the operator changes primary only when more than one Repo
is selected. The UI derives each stable `repoId` from its selected folder name and resolves local
collisions with a numeric suffix instead of exposing identity fields in the ordinary linking flow.
macOS, Linux, and WSL use small host adapters behind this same boundary. WSL opens the modern Windows
Explorer folder chooser at the operator's WSL Home, then normalizes either a Windows drive path or a
`\\wsl.localhost` path back to one WSL absolute path. A directory inside a Git worktree yields the
canonical Git `repoPath` plus its relative `projectPath`; managed Git operations stay rooted at the
Repo while responsibility processes, Project `AGENTS.md`, preparation, and Preview use the selected
Project scope. Linking uses checkout HEAD only to initialize a new binding release. HOPI never treats
`.git` or its own root `.hopi` authority as a selectable source scope and never mutates the selected
checkout.

The ordinary UI never asks for `projectId`. On the first link, Coordinator derives it from the
primary selected Project folder as `P-<folder>` after stable-ID normalization. Unicode letters and
numbers remain readable while unsafe separators normalize to `-`. If that identity is already owned
by another Project in the same Assistant Home, Coordinator appends the smallest free numeric suffix
(`-2`, `-3`, ...). Selecting an already linked exact Repo set reuses its durable identity. Explicit
`projectId` remains an API compatibility boundary for migrations, fixtures, and automation, but is
not a product-form decision.

An empty directory outside every Git worktree is an explicit new-project candidate. An explicitly
named missing leaf directory is the same candidate when its parent already exists; repository
initialization creates that one leaf without recursively creating ancestors. Project creation and
Repo addition revalidate this boundary, initialize `main`, create one HOPI-owned empty bootstrap
commit, and continue through the same link operation without a separate initialization command or
confirmation state. If later linking fails, HOPI removes only the `.git` directory created by that
attempt and, when HOPI created the leaf, removes it only if it is still untouched and empty. HOPI never
initializes a nested Repo inside an existing worktree. A non-empty non-Git directory is reported
without mutation because automatically staging its contents could capture secrets or generated
files. Browser automation injects deterministic chooser results rather than pretending that a text
field proves the native boundary.

Create submits the complete `{ primaryRepoId, repos[] }` set once. Coordinator resolves every Git
root, Project-relative path, and common directory, then rejects duplicate IDs or Git identities
before changing the Project link, creates or validates the managed roots, publishes `project.yml`, and finally the one
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
When several bindings change together, rebind accepts only the changed Repo bindings in one request.
Coordinator fills unchanged bindings from current Project truth, validates the resulting complete
Repo-ID set, and changes the local binding document only after all targets validate.

Rebind changes where one stable `repoId` obtains its source; it is not restricted to another
worktree registered in the old Git common directory. `repoPath`, `projectPath`, Git common directory,
remote, and history may all change. The user checkout is never mutated. Coordinator stops the
affected Project, preserves its canonical documents, creates a fresh managed release projection from
the selected target HEAD, publishes `project.yml`, and finally publishes `projects.yml` as the one
binding gate. Existing managed task worktrees are disposable runtime projections: rebind does not
move them across repositories or guess whether their source still applies. It retains obsolete or
dirty projections as local recovery evidence and creates one blocking Project Attention when
nonterminal Work requires semantic reconciliation. Assistant inspects that evidence and decides
whether to retain, replan, replace, or cancel Work before resolving the Attention.

Repo rebind is an executable Command. The UI, Assistant tool, and optional local CLI submit the same
typed Command request rather than implementing Git or document mutations separately. Every Command
supports an inspection-only plan and writes a durable operation journal containing its request,
observed plan, phase events, and structured result. Deterministic Command code owns locks,
publication gates, runtime exclusion, and recovery; Assistant owns semantic repair after those
boundaries are safe. Inspection resolves the selected directories to their actual Git identity and
Project scope, but remains pure: an operation identity and journal exist only when execution begins,
and execution replans from current Home truth before mutation. Rebind never initializes a directory.

An in-process rebind first makes only the affected Project ineligible, interrupts its responsibility
Runs, and waits for its reconciliation work to settle. Other Projects remain eligible. A failed
mutation revalidates and restores the old Project runtime; a published mutation remains ineligible
until the post-turn runtime rebuild loads the new binding. Once publication succeeds, a later
operation-journal write failure is diagnostic rather than a rollback signal, because the binding
document is already the durable gate.

The local adapter exposes the same Command for inspection or offline recovery:

```sh
bun run --cwd packages/backend hopi project rebind \
  --project P-product --repo web --path /code/product --plan
```

Execution without `--plan` acquires the Coordinator instance lock and therefore refuses to mutate an
Assistant Home owned by a running Server. Product UI and Assistant use the in-process Command Runner
so the Server can quiesce and reload its runtime around the same durable mutation.

## Work Workspace

One Engineering Work still has one Generator, one Reviewer, one card, one retry counter, and one
result. For every Repo bound to the Project, Coordinator creates or reuses a stable task branch and worktree
starting from that binding's current Project release. The responsibility receives the roots together in
one runtime manifest:

```json
{
  "primaryRepoId": "web",
  "releaseRef": "refs/heads/hopi/project/P-1/release",
  "repos": {
    "web": "/code/.hopi-worktrees/product-web/work/G-1/W-1",
    "api": "/code/.hopi-worktrees/product-api/work/G-1/W-1"
  },
  "releaseHeads": {
    "web": "<web-release-commit>",
    "api": "<api-release-commit>"
  }
}
```

The Generator process cwd is the primary root; the runtime manifest names every other Project root
explicitly.
`releaseHeads` identifies the commit in each Repo's own Git object database; the primary authority
snapshot is labeled separately and is never presented as a secondary Repo commit. Project membership
defines the available environment, not a provider filesystem allowlist or mandatory execution list.
Prompts name every Repo ID and path. Coordinator inspects every Project task root after Generator,
but creates checkpoints only where Git reports a source delta. Reviewer can read all roots and
chooses proof according to the Work, cross-Repo contract, and actual candidate changes.

`dependsOn` continues to express known semantic ordering. HOPI does not infer file locks or serialize
all Work sharing a Repo. Concurrent Work branches may proceed; C1 revalidates every Project Repo
against its current release target and rejects a conflict before the primary boundary.

## Preparation and Preview

`scripts/hopi/prepare` is a Repo-local capability. Every Engineering Run receives the complete
runtime Repo manifest and Home cache, but Coordinator does not invoke preparation as an Engineering
preflight. Generator and Reviewer decide which available Repo commands are relevant.

Project Preview invokes each managed integration Repo checkout with:

```text
HOPI_REPO_ID=<stable-repo-id>
HOPI_REPO_ROOT=<current-checkout-root>
HOPI_REPOS_FILE=<runtime-json-path>
```

The Preview manifest names every managed integration root. A script prepares only its own cwd; the
manifest may inform cross-Repo compatibility checks but never delegates another Repo's setup. Every
Preview preparation must succeed before the primary Preview adapter starts. Missing preparation is
therefore a Preview capability failure, not a reason to block an unrelated Engineering Run. HOPI
adds no adapter schema, initialized flag, adapter revision, or primary fallback.

The primary adapter may publish one or several named operator-facing surfaces after starting the
services it needs from that complete Repo environment. A surface is not assigned to a Repo or Goal:
one Repo may provide several surfaces, and one surface may depend on several Repos. Preview remains
one atomic Project runtime session, so readiness, Stop, failure, and release invalidation apply to
the complete declared surface set.

## Primary C1 and Component Commits

Reviewer success is integrated as one logical operation:

1. Under the global publication mutex, Coordinator rereads the primary canonical state and every
   Project Repo release ref.
2. It verifies every task worktree is clean and builds one durable component candidate per changed
   secondary Repo. A component candidate has the old Repo release as first parent and carries the
   qualified Project, Goal, Work, Run, and Repo trailers. It is not a C1 gate.
3. It builds the primary candidate on the current primary release. That tree contains any primary
   source change, the reviewed Work at `done`, immutable Evidence, and an updated `project.yml`
   naming the complete secondary release vector.
4. It rechecks semantic guards and every expected old ref. Any source conflict, stale target, or
   invalid candidate rejects before publication.
5. It durably moves only the primary Project-qualified release ref from the expected old commit to the new C1.
   This guarded ref move is the single irreversible logical boundary.
6. It materializes the primary integration worktree, then advances and materializes each secondary
   Project-qualified release ref to the commit recorded by C1.
7. It verifies every Project-qualified managed release worktree; user-selected checkouts remain unchanged.

Candidate construction applies Git's complete trivial three-way resolutions before classifying
unmerged index entries. In particular, an unchanged release plus a task deletion is a clean deletion,
not a conflict. Only entries left unmerged after those ordinary rules produce a C1 rejection.

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
moved Repos. Primary switching after creation and Repo removal are deferred. Model settings remain
Home-wide by agent role and are changed only through UI/API settings, never model tools. The speaking
Assistant exposes create, add, and partial rebind when the operator supplies paths; the host directory
picker only selects and classifies paths and has no initialization side effect. A
topology mutation made during an Assistant turn persists first and schedules one runtime rebuild
after that turn settles, rather than interrupting the speaking session mid-call.

Kanban remains Goal/Work based; no Repo columns or Repo subcards are introduced. Card footers
prioritize the real runtime Attempt count and current blocker. Work Attempts remain one stream and
may show the per-Repo workspace paths, checkpoints,
diffs, and integration diagnostics. Preview remains one Project control.

## Acceptance Scenarios

The implementation is complete only when automated tests cover:

- version 1 single-Repo Projects and legacy Work with or without `repos` run without behavioral
  migration regressions
- the host chooser can be cancelled without an effect and one create request atomically links two Repos
- duplicate Git identities inside one Project fail before a durable Project link exists
- the same Git Repo can be primary or secondary in several Projects with isolated refs and worktrees
- a secondary Repo can be added and rebound without changing any selected checkout
- a moved Assistant home and complete Repo set can be rebound together without losing portable state
- every Work receives every Project Repo even when an obsolete legacy `repos` field names a subset
- one Work modifies primary and secondary Repos, receives one review, and produces one primary C1
- one Work modifies only a secondary Repo while its Work and Evidence remain canonical in primary
- a target advance or merge conflict in any Repo rejects before the primary boundary
- a crash after primary C1 but before zero, one, or all secondary projections converges on restart
- an unexpected secondary ref value blocks the Project without rollback
- dirty, switched, detached, or divergent selected checkouts remain unchanged
- Engineering responsibilities receive the complete multi-Repo environment without automatic
  preparation, while Project Preview prepares the complete managed integration manifest
- the UI manages Project Repo links without adding a Repo workflow
- Assistant can perform every supported Project/Repo mutation without calling UI HTTP routes, and a
  topology change preserves its final speaking reply before the runtime rebuild

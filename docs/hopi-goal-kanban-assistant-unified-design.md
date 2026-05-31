# HOPI Goal System Unified Design

Status: canonical design
Last updated: 2026-05-26

This is the single canonical design document for HOPI Goal, kanban, assistant, planner, scheduler, runtime overlay, and trace behavior.

Supersedes the fragmented direction in:

- `docs/superpowers/specs/2026-05-13-hopi-autonomous-goal-orchestration-design.md`
- `docs/superpowers/specs/2026-05-15-hopi-project-assistant-goal-state-design.md`
- `docs/superpowers/specs/2026-05-15-hopi-project-assistant-conversation-boundary-design.md`
- `docs/superpowers/specs/2026-05-25-hopi-file-native-kanban-assistant-design.md`
- `docs/design/projects-kanban.md`

Older docs are historical context only. If they conflict with this document, this document wins.

## Summary

HOPI is a goal-native autonomous work system. The unit of autonomy is the Goal, not the chat session and not a DB task row.

The core design is file-native:

1. `todo.yml` is the only durable kanban workflow truth.
2. The web kanban workflow state is a projection of `todo.yml`; runtime/session overlay only annotates cards.
3. Assistant kanban writes go through project-local skill scripts under `.hopi/skills/kanban/`.
4. The DB stores runtime/session overlay, not kanban workflow truth.
5. Trace is documentation for explanation and audit, not replay state.
6. Scheduler/reconciler is deterministic control-plane logic, not an agent.

The assistant is not a hidden text parser in the hub, not a DB mutation actor, and not a coding agent. It is a Goal-scoped CTO assistant that reads visible project files, reads the scripts it can call, calls those scripts for kanban changes, and uses HOPI APIs for runtime/session information.

## Source Of Truth Boundary

All durable Goal and workflow state lives in repo-local files under `.hopi/docs` plus `.hopi/preference.md`.

This includes:

- Goal brief, design rationale, and automation policy
- kanban items, statuses, blockers, dependencies, and ordering
- structured decision topics
- workflow trace and write-file trace
- durable global preferences

The DB/API/runtime layer may store runtime overlay:

- sessions and messages
- runner state
- attempt metadata
- permission/approval state
- transient indexes and caches

Runtime overlay may explain or annotate what is happening. It must not change kanban membership, ordering, status, blocker truth, dependency truth, Goal truth, or durable design truth. If docs and DB disagree on durable Goal/workflow state, docs win.

Session transcript history is the intentional exception: it remains in API-accessible runtime storage with pagination. It is not copied wholesale into docs.

## Design Principles

### 1. Goal-native, not session-native

A Goal owns:

- objective
- success criteria
- goal brief
- durable design doc
- todo reservoir and task graph
- decision topics
- workflow event log
- assistant conversation identity and routing
- automation policy

Sessions are runtimes attached to work inside the Goal. They are not the workflow container.

### 2. `todo.yml` is the kanban source of truth

Another process must be able to rebuild the kanban board from repo-local docs plus runtime overlay.

The DB/store may exist, but only as:

- runtime/session storage
- runtime attempt metadata
- overlay index
- event fan-out backing
- disposable cache

It must not become a second authoring system with different Goal or kanban truth. Runtime overlay can annotate cards, but cannot decide whether a card exists, where it appears, what it depends on, or what workflow status it has.

### 3. File-native control flow

Board read flow:

```text
todo.yml
  -> API parse
  -> runtime overlay lookup from DB
  -> response
  -> Web kanban
```

Mutation flow:

```text
assistant / planner / user / reconciler
  -> node .hopi/skills/kanban/todo.mjs ...
  -> todo.yml + events.jsonl
  -> watcher / API read / reconcile notices docs change
  -> SSE invalidates client queries
  -> Web refetches board
```

Server routes may exist as adapters, but durable kanban mutation must still go through the same local-doc writer path. A server route that directly mutates DB task status is a migration gap, not part of the target design.

### 4. Small visible control surface

The P0 kanban control surface is one project-local skill:

```text
.hopi/skills/kanban/SKILL.md
.hopi/skills/kanban/todo.mjs
.hopi/skills/kanban/yaml.mjs
```

The assistant can read those files, understand what they do, and call them through ordinary CLI execution.

### 5. Blocked is a hold state, not a lane

`blocked` is not a separate board lane. A task may be marked blocked to prevent automation, but the web board must project it back onto the owning workflow lane with an explicit blocker badge.

Blocked situations include:

- waiting on dependencies
- waiting on decision
- merge blocked
- lane capacity full
- missing required workflow output
- runtime start failure
- manual hold

The UI must render blocker badges. For decision blockers, the badge must say `Blocked by decision` instead of the generic `Blocked`.

### 6. Planner and Assistant have different authority

- Planner may create, split, replace, reorder, and retire work.
- Assistant may inspect state, explain blockers, retry or resume existing work by moving existing items, request planning by creating planner work, answer explicit user decisions, and update global preferences.

Assistant is not a second engineering graph author. New engineering work should go through Planner.

### 7. No hidden kanban write paths

Assistant should have read/search capability over the repo because otherwise it cannot explain state or interpret failure context.

Assistant may not:

- edit source files
- directly edit DB rows
- write arbitrary workspace files
- run arbitrary write-capable shell flows
- change permission mode
- spawn coding subagents
- bypass approval boundaries
- mutate kanban state outside the kanban skill

The normal assistant write paths are:

- `.hopi/skills/kanban/todo.mjs` for kanban workflow state
- an approved local-doc DecisionTopic writer path for explicit user answers
- `.hopi/preference.md` for global durable preferences

Direct manual file editing remains technically possible because HOPI is local-first software, but assistant prompts and product UI should steer workflow mutations through the skill.

## Non-Goals

- backward compatibility with legacy kanban truth once file-native mode is enabled
- hub-side text parsing of user chat into hidden actions
- DB-backed kanban projection as durable or semi-durable truth
- replaying `events.jsonl` to recover current board state
- full session transcript persistence into docs
- Bun, TypeScript compile, npm install, Python packages, or user-home helper files for the default kanban skill
- manifest, version manager, or auto-upgrade system for project-local skills in P0
- assistant-generated skills as a P0 dependency
- using natural-language `blockedReason` as the dependency model

## System Model

## Project

Project is the repo-level container.

It owns:

- repo identity
- default workspace
- Goal list
- automation defaults
- lane budgets
- runner connectivity

Project is not the assistant's operating scope. The assistant is Goal-scoped.

## Workspace

Workspace is the filesystem checkout used by autonomous work.

Baseline model:

- one default writable workspace per Project
- task runtimes may create isolated worktrees derived from it
- assistant sees the same repo in read-only mode except for approved HOPI files/scripts
- project-local skills live in the repo under `.hopi/skills/`
- `.hopi/preference.md` is writable by assistant

Workspace setup remains a function or small service, not a large architectural layer.

## Goal

Goal is the main unit of autonomous progress.

Canonical Goal state:

- `goalKey`
- title
- objective
- success criteria
- strategy / current focus
- status: `planning | active | blocked | paused | done | archived`
- automation policy
- goal docs
- assistant conversation identity

These fields are durable local-doc state. The DB may cache or index them, but DB rows are not authoritative for Goal metadata or workflow policy.

`blocked` at Goal level is a control-plane hold, usually for milestone review or an unresolved goal-level decision.

When a Goal is `blocked`, the scheduler must freeze Planner/Radar refill and any new batch expansion, but it must not cancel or stall already materialized task cards. Existing task cards may continue draining through `planned`, `in_progress`, `in_review`, and `merging` until they settle.

## File Layout

Each Goal owns durable workflow docs:

```text
.hopi/
  preference.md
  docs/
    index.md
    goals/
      <goalKey>/
        goal.md
        design.md
        todo.yml
        decisions.yml
        events.jsonl
        write-trace.jsonl
  skills/
    kanban/
      SKILL.md
      todo.mjs
      yaml.mjs
```

`todo.mjs` and `yaml.mjs` are copied into each project. The duplication is intentional for P0: one self-contained project-local control surface is simpler than a shared user-home dependency.

## Goal Docs

### `index.md`

Repo-local HOPI docs index.

It may contain or link:

- Goal registry
- Goal keys and titles
- project-level workflow notes
- automation defaults
- links to each Goal docs directory

If the app keeps DB rows for Goal discovery, those rows are indexes. The durable Goal docs directory and its files are the source of truth.

### `goal.md`

Human-readable Goal brief:

- objective
- success criteria
- current strategy
- current focus
- Goal status and automation policy, when not represented in `index.md`
- open questions

`goal.md` should stay short. Durable product and technical design rationale belongs in `design.md`.

### `design.md`

Goal-level design document.

Every Goal must have one `design.md`, even when the initial content is short. It is the durable place for the reasoning that explains why the task graph is shaped the way it is.

Baseline structure:

- Problem
- Goals
- Non-Goals
- User / Workflow
- Architecture
- Data Model
- Edge Cases
- Testing / Acceptance
- Open Questions
- Revision Notes

Rules:

- Planner creates and maintains `design.md`.
- Planner should update `design.md` before creating or reshaping substantial engineering tasks.
- Planner may edit `goal.md` and `design.md` directly in P0.
- Generator, Reviewer, Merger, Radar, and Assistant may read `design.md`, but must not directly edit it.
- Important resolved DecisionTopics should be summarized into `design.md` when they affect task decomposition, architecture, or acceptance criteria.
- `Open Questions` may list non-blocking uncertainty; blocking uncertainty must be represented as a DecisionTopic.

### `todo.yml`

`todo.yml` is the only durable kanban workflow truth.

P0 schema:

```yaml
version: 1
goal:
  goalKey: tutorial
  title: Tutorial Goal
items:
  - ref: teaching-matrix
    status: done
    title: Build teaching matrix
    body: Produce the stable tutorial matrix and acceptance criteria.
    dependencyTaskList: []

  - ref: tutorial-story-content
    status: planned
    title: Implement tutorial story content
    body: Fill story content and first tutorial battle flow.
    dependencyTaskList:
      - ref: teaching-matrix
    blockers:
      - kind: decision
        ref: choose-tone
        summary: Waiting for user to choose tutorial narrative tone.
```

Statuses:

```text
candidate | planned | in_progress | in_review | merging | blocked | done
```

Rules:

- `ref` is required, stable, and unique inside one Goal.
- `status` is the kanban state. `candidate` is reservoir/backlog state; `blocked` is an automation hold, not a visible lane.
- The web board projects `blocked` cards onto the appropriate owning lane and shows the blocker reason on the card.
- There is no `deferred` P0 status. Use `candidate` plus ordering, body, or blocker metadata.
- Legacy `deferred` values must normalize or migrate to `candidate`; UI may show a "Later" grouping only from presentation metadata, never as durable workflow state.
- `blockers` explains why work cannot proceed, but does not define a lane.
- `dependencyTaskList` is the canonical dependency model.
- Dependency entries reference other item refs.
- Task order lives here if ordering is represented.
- Runtime failures may appear as derived UI badges through DB overlay, not as workflow truth unless a script records a durable blocker.

### `decisions.yml`

Structured decision topics. Each topic may be:

- goal-scoped
- task-scoped
- blocking or non-blocking
- waiting or resolved

The system must not rely on free-form chat text to know whether a decision is still open.

Rules:

- `decisions.yml` is the only decision-topic source of truth.
- Every DecisionTopic must include explicit `scope: goal | task`.
- `scope: goal` means the question blocks Goal-level progress: refill, batch expansion, planner reshaping, or milestone continuation.
- `scope: task` means the question blocks only the linked task; it must include `taskId`, and the scheduler must not treat it as a Goal-level blocker.
- For task-scoped topics, `taskId` may be a materialized DB task id or a `todo.yml` item ref. A waiting blocking task-scoped topic projects the linked task as `blockedSource: decision`, displays `Blocked by decision`, and prevents scheduler materialization or auto-run until the topic is resolved.
- A blocking decision without explicit scope is invalid. Do not infer scope from missing or present `taskId` in new writes.
- Assistant may record a clear user answer only through an approved local-doc writer path.
- Server APIs may wrap that writer path, but must not store decision business state in DB.
- DB `goal_decision_topics` rows are legacy migration residue. They may be read only for one-time backfill into `decisions.yml`, then ignored.
- After legacy rows are copied, `decisions.yml` records `legacyDecisionTopicsBackfilledAt`. When this marker exists, DB decision rows must not be consulted again; deleting or editing a doc topic is authoritative.
- If `decisions.yml` and DB decision rows disagree, `decisions.yml` wins and the DB row must not override, hide, or reopen the doc topic.
- Creating or resolving a decision updates `decisions.yml` and appends `events.jsonl`; it does not create or update a durable DB decision row.

### `events.jsonl`

Workflow trace for kanban and orchestration changes.

Purpose:

- explain why workflow state changed
- make assistant/user debugging easier
- provide audit of kanban mutations

Event examples:

- item added
- item moved
- item updated
- dependency linked
- decision created
- decision resolved
- planner request created

Required fields:

- id
- timestamp
- writer
- action
- entity
- before summary
- after summary
- reason
- command/script metadata

Rules:

- `events.jsonl` is append-only trace, not replay state.
- `todo.yml` is current state.
- The kanban skill appends workflow events on successful mutations.
- Server/reconciler code may append workflow events only when it invokes the same local-doc mutation path or records rejected/failed orchestration attempts.
- Agents may provide `reason`, `intent`, or `evidence`, but agents do not decide whether an event is recorded.

### `write-trace.jsonl`

File-write trace for runtime sessions.

Purpose:

- audit agent file writes
- help assistant diagnose what changed without reading full transcripts first
- avoid trace files containing full source content

Unified recorder:

```text
normalized tool-call / tool-result / patch event
  -> WriteTraceRecorder
  -> write-trace.jsonl
```

Coverage:

- Claude Code: generated hook settings include write-tool before/after events where available.
- OpenCode: plugin forwarding around `tool.execute.before` and `tool.execute.after`.
- Codex: HOPI normalized events, including remote/app-server file-change and patch events, plus local session scanner events where available.

Recorded fields:

- agent
- sessionId
- cwd
- toolName
- callId
- target paths
- argument summary
- result summary
- timestamp

Default policy:

- record write-file tools only
- do not record full file content
- keep trace compact and goal-scoped where possible

## State Ownership

## Docs Own Durable Local State

Owned in repo-local HOPI docs space:

- goal brief
- design doc
- todo refs, titles, bodies, status, order, blockers, and dependency graph
- decision topics
- workflow trace (`events.jsonl`)
- file-write trace (`write-trace.jsonl`)
- global preferences (`.hopi/preference.md`)

## DB Owns Runtime Overlay

The DB stores only live/runtime data:

- sessions and messages
- `goalKey + taskRef -> sessionId` linkage
- runtime attempt metadata
- runner state
- permission and approval state
- failure summaries tied to an attempt
- paged session history indexes
- event fan-out state
- disposable caches

The DB does not store kanban workflow truth:

- no task title/body as source of truth
- no task lane/status as source of truth
- no dependency graph as source of truth
- no workflow blocker truth
- no durable board order

If a DB overlay points to a missing `taskRef`, the overlay is orphaned. It should be ignored by the board and surfaced in diagnostics.

## Runtimes Own Execution Evidence

Owned by runtime/session layer:

- message log
- tool trace
- patch/evidence summary
- runtime attempt outcome

Docs own only the compact durable traces described above. Full runtime transcripts and detailed tool payloads remain runtime/session overlay.

Runtime/session history stays in API-accessible storage and is fetched with pagination. It is not copied wholesale into docs.

## Kanban Skill

Assistant operates kanban through:

```text
.hopi/skills/kanban/SKILL.md
.hopi/skills/kanban/todo.mjs
.hopi/skills/kanban/yaml.mjs
```

Default runtime:

- Node.js plain ESM.
- Run with `node`.
- No Bun.
- No TypeScript compile.
- No npm install.
- No Python package dependency.
- YAML support is provided by the local `yaml.mjs` helper.

P0 commands:

```bash
node .hopi/skills/kanban/todo.mjs list --goal <goalKey>
node .hopi/skills/kanban/todo.mjs add --goal <goalKey> --ref <ref> --title <title> --status candidate|planned
node .hopi/skills/kanban/todo.mjs move --goal <goalKey> --ref <ref> --status candidate|planned|in_progress|in_review|merging|blocked|done
node .hopi/skills/kanban/todo.mjs update --goal <goalKey> --ref <ref> --title <title> --body <body>
node .hopi/skills/kanban/todo.mjs link-dependency --goal <goalKey> --ref <ref> --depends-on <ref>
```

Script responsibilities:

- read and parse `.hopi/docs/goals/<goalKey>/todo.yml`
- validate legal statuses
- validate unique refs
- validate dependency targets exist
- reject dependency cycles
- write through a temporary file and rename
- append `events.jsonl` on successful mutation
- return machine-readable JSON

P0 intentionally excludes:

- skill manifest
- template version tracking
- automatic upgrade
- package manager behavior
- assistant self-repair of core kanban script
- complex permission framework

## Assistant-Made Skills

Assistant-created project-local skills are P1.

They are allowed as an experiment in routine capture:

- assistant may create scripts for repeated local workflows
- assistant may read and call those scripts later
- scripts may live under `.hopi/skills/<name>/`

Constraints:

- P1 skills must not be required for P0 kanban correctness.
- P0 kanban skill remains the stable control path.
- No auto-upgrade or manifest system in P0.
- No review/permission framework in P0.

This keeps the experiment possible without making the core board depend on self-modifying capability infrastructure.

## Task Projection

Task is the executable projection of a `todo.yml` item plus runtime overlay.

Canonical workflow fields come from `todo.yml`:

- `ref`
- `status`
- `title`
- `body`
- `dependencyTaskList`
- `blockers`
- order metadata if present

Runtime overlay may add:

- linked session id
- active runtime kind
- attempt status
- runner availability
- review/merge attempt metadata
- failure summaries
- permission state

`dependsOnTaskIds` may exist internally as a materialized lookup, but durable dependency truth is `dependencyTaskList` by item ref.

Web task cards should render dependencies from this projection so a `planned` or `candidate` card visibly explains why it is not yet eligible. The UI may show a resolved task title when available, but the stable identity is still the dependency ref from `todo.yml`.

## Task Statuses

Canonical `todo.yml` statuses are:

- `candidate`
- `planned`
- `in_progress`
- `in_review`
- `merging`
- `blocked`
- `done`

### `candidate`

Reservoir/backlog item. It does not occupy execution lanes and is not dispatched as work.

Planner promotes a `candidate` by moving it to `planned`.

`candidate` is not equivalent to blocked. It means "known possible work, not selected for dispatch." The scheduler must not auto-promote `candidate` items to `in_progress`.

### `planned`

Executable task in the dispatch pool.

It may still be temporarily ineligible because:

- dependencies are not satisfied
- a blocking decision is open
- lane capacity is full
- runner is unavailable

Planner requests are also ordinary `planned` items with planner role metadata.

### `blocked`

Automation hold. The task remains visually attached to its owning workflow lane, but the scheduler must not start or materialize it while the blocker is open.

For a task-scoped DecisionTopic, the card must render `Blocked by decision`; generic candidate cards must not be labeled blocked unless a real blocker exists.

### `in_progress`

Generator-style execution is active or resumable.

### `in_review`

Work artifact exists and must be evaluated against its acceptance contract.

### `merging`

Review passed and the system is merging or repairing merge conflicts.

Before attempting a merge, Merger must check the linked worktree state. If the worktree has no uncommitted changes and the source branch has no committed delta against the target branch, Merger skips the merge operation. For an already accepted no-code, planner, duplicate-closure, or docs-truth-complete task, this closes the merge gate without setting a merge-blocked state. For a task that still expects a code artifact, the reviewer should reject it before acceptance rather than relying on Merger to manufacture a blocker from an empty branch.

### `done`

Final completion state.

For code-changing work, `done` means merge succeeded. Review alone is not completion.

## Actors

### Assistant

Assistant is bound to exactly one Goal.

Allowed:

- read repo files
- search files
- read git status/diff/log
- read `.hopi/docs`
- read project-local kanban skill scripts
- call `.hopi/skills/kanban/todo.mjs`
- call HOPI APIs for paged session history and runtime overlay
- explain board state and blockers
- update `.hopi/preference.md` when feedback is durable

Forbidden in P0:

- direct source code writes
- direct DB writes
- direct hidden hub actions for kanban changes
- direct mutation of kanban state outside the kanban skill
- coding subagents
- permission escalation

When the user asks for new engineering work, assistant should create or move visible planner work through the kanban skill instead of directly creating engineering task rows.

### Planner

Planner may update `goal.md` and `design.md` directly.

Planner creates or reshapes kanban items through the same project-local kanban skill. If a missing answer would materially change decomposition, Planner records a structured DecisionTopic in `decisions.yml` instead of guessing.

Planner should not decompose vague requirements into engineering tasks until the design is clear enough to make the resulting task graph defensible.

### Worker Agents

Worker agents implement, review, and merge source changes.

Their source writes are normal task runtime behavior and are audited by `WriteTraceRecorder`.

Worker agents do not own kanban truth. They can report outcomes, but durable kanban state changes go through the local-doc control path.

### Scheduler / Reconciler

The reconciler is deterministic control-plane logic, not an agent.

Responsibilities:

- read `todo.yml` and `decisions.yml`
- derive dependency blockers
- combine docs state with DB runtime overlay
- start eligible runtimes when automation policy allows
- clean or report orphan runtime links
- emit SSE refetch events
- when automation must change workflow state, invoke the same kanban writer path used by assistant/user scripts and append workflow events

The reconciler does not persist kanban projection into DB. It can use memory caches for performance, but those caches are disposable.

## Planner Design Discovery

Planner uses a lightweight discovery protocol before task decomposition.

Rules:

- read `goal.md`, `design.md`, `todo.yml`, `decisions.yml`, and the current kanban snapshot before planning
- if existing context is sufficient, update `design.md` with the inferred design and proceed to task graph work
- if a missing answer would change architecture, task decomposition, acceptance criteria, or user workflow, create exactly one blocking DecisionTopic
- ask the highest-leverage question first; do not create a batch of blocking questions
- do not ask questions whose answer can be safely inferred from repo context, existing design, or durable preferences
- after a DecisionTopic is answered, update `design.md` first, then update `todo.yml` and create or reshape tasks
- record assumptions in `design.md` when Planner proceeds without a user answer

This borrows the discipline of brainstorming without requiring ceremonial questioning when the work is already clear.

## Runtime Progression

Canonical code-changing task progression:

```text
planned -> in_progress -> in_review -> merging -> done
```

There is no direct `in_progress -> done` shortcut for code-changing tasks.

If a milestone review blocks the Goal while work is already on the board, that hold applies only to creating or promoting more work. Existing task cards still continue through review and merge.

### Generator

Generator may run a task only when:

- task status is `planned`
- dependencies are satisfied
- no blocking decision exists
- if the task is represented only in `todo.yml`, no waiting blocking task-scoped DecisionTopic targets its ref
- role capacity exists

### Reviewer

Reviewer runs tasks in `in_review`.

Outputs:

- accept -> task enters `merging`
- reject -> task returns to `planned` with review feedback

### Merger

Merger runs tasks in `merging`.

Outputs:

- merge success -> task becomes `done`
- no worktree changes and no source branch delta -> skip merge operation; if the accepted task is no-code/docs-truth complete, task becomes `done` with a no-merge-required runtime note
- merge blocked -> derived merge blocker + assistant intervention
- merge repair retry budget exhausted -> merge blocker remains and intervention is refreshed, not duplicated

### Radar

Radar runs on cadence or idle windows and may add candidate/planner follow-up work through the kanban skill. It does not directly mutate engineering task lanes outside the local-doc control path.

## Interventions

Intervention is a user-facing runtime overlay for situations that need human attention or explanation.

It is derived from docs plus runtime overlay. It is not a separate workflow source of truth. If an intervention needs durable workflow meaning, that meaning must be represented in `todo.yml`, `decisions.yml`, or `events.jsonl`.

Kinds:

- `decision_needed`
- `task_blocked`
- `merge_blocked`
- `permission_required`
- `milestone_review`
- `clarification_needed`

Rules:

- intervention belongs to the Goal assistant conversation
- intervention never becomes a task runtime chat
- identical blocking conditions should dedupe by fingerprint
- user reply to intervention enters assistant conversation with intervention context attached

Typical triggers:

- merge blocked after repair budget exhausted
- blocking decision opened
- runtime start failure
- required workflow output missing after retry budget exhausted
- backstop fired

## UI And Sync

## Goal Board

The board is Goal-scoped.

It shows:

- task cards grouped by canonical statuses from `todo.yml`
- `candidate` reservoir/backlog items where the product chooses to display them
- derived blocker badges
- dependency chips rendered from `dependencyTaskList`
- lane-capacity saturation markers
- active runtime indicators from DB overlay

There should be no ambiguity about why a task is not moving.

The UI must not write kanban workflow state directly to DB. P0 board controls that would mutate kanban state are disabled or removed until they can call the same project-local script path. The board is read-only for workflow state in P0.

## Sync Triggers

Sync may happen through multiple paths:

- file watcher for low-latency changes under `.hopi/docs/goals/**`
- API read that reparses or validates file mtime
- periodic reconcile tick as watcher-loss fallback
- SSE only to notify clients to refetch

Parse failure behavior:

- do not replace the last valid board with corrupt data
- return/display a docs parse error
- keep runtime sessions untouched
- require user/assistant to repair `todo.yml` through the kanban skill or manual edit

## Assistant Entry

Each Goal has one canonical assistant conversation.

Interventions are not separate chats. They are records that route the user into the same Goal assistant conversation with extra context attached.

If the user clicks an intervention card, the UI opens the same assistant conversation with that intervention highlighted.

The UI should not create a second independent assistant chat for the same Goal unless the user explicitly archives and resets the old one.

## Suggested Actions

If the UI offers quick actions, they must call the same local-doc writer path as assistant/user operations. They must not fake chat text, mutate DB workflow columns, or bypass scheduler state.

## Typical Flows

## A. User says "retry" on a merge blocker

1. Merger fails after repair budget and records merge blocker overlay/intervention.
2. User replies in the Goal assistant conversation.
3. Assistant reads `todo.yml`, `events.jsonl`, relevant runtime overlay, and recent session history.
4. Assistant identifies the task ref.
5. Assistant calls `node .hopi/skills/kanban/todo.mjs move --goal <goalKey> --ref <ref> --status merging`.
6. The script updates `todo.yml` and appends `events.jsonl`.
7. Watcher/API/reconcile invalidates UI and scheduler starts a new merge attempt when eligible.

No hub-side text parser. No task-session chat hijack. No direct DB status write.

## B. Dependencies finished, downstream task should resume

1. Upstream task reaches `done` in `todo.yml`.
2. Scheduler recomputes derived dependency blockers from `dependencyTaskList`.
3. Downstream `planned` task becomes eligible automatically.
4. Generator starts when capacity is available.

No manual unblock tool is required.

## C. User asks for new work in assistant

1. User says the Goal also needs new work.
2. Assistant inspects current Goal docs and board.
3. Assistant decides this is graph-shaping work.
4. Assistant creates or moves visible planner work through the kanban skill.
5. Scheduler starts Planner when capacity and blockers allow.
6. Planner updates `design.md` first when needed, then updates `todo.yml` through the kanban skill.

Assistant does not directly create hidden engineering task rows.

## D. User answers a DecisionTopic in assistant

1. Assistant explains the open DecisionTopic.
2. User gives a clear answer.
3. Assistant records the answer in `decisions.yml` through the approved local-doc writer path.
4. Planner updates `design.md` first if the answer changes design.
5. Planner or assistant moves affected `todo.yml` items when legal through the kanban skill.
6. Scheduler resumes eligible work through normal status rules.

DB decision rows are not consulted during this flow except for the legacy backfill bridge. After the backfill has copied a historical waiting or resolved topic into `decisions.yml`, all reads and writes use the doc file.

## E. User gives durable preference feedback

1. User repeatedly signals a stable preference.
2. Assistant decides it is durable rather than one-off.
3. Assistant reads `.hopi/preference.md`.
4. Assistant rewrites it with deduplicated updated guidance.
5. Future Planner / Generator / Reviewer / Merger sessions receive that file in context.

## Module Breakdown

These are build units, not separate product concepts.

1. `goal-docs`
   - read/write `goal.md`, `design.md`, `todo.yml`, `decisions.yml`, `events.jsonl`, `write-trace.jsonl`
   - map stable `ref` values and dependencies
   - validate schema and parse failures

2. `kanban-skill`
   - project-local `SKILL.md`, `todo.mjs`, `yaml.mjs`
   - validate refs, statuses, dependencies, cycles
   - atomic write and event append

3. `runtime-overlay-store`
   - materialize sessions, runtime attempts, runner state, permissions, and overlay links
   - keep `goalKey + taskRef -> session/runtime` indexes
   - keep data rebuildable or disposable where possible

4. `scheduler`
   - deterministic reconcile loop
   - dependency checks
   - lane budget checks
   - dispatch decisions
   - local-doc workflow updates

5. `runtime-adapters`
   - planner / generator / reviewer / merger / radar / assistant spawn-resume-finish
   - typed output ingestion
   - write-trace recording

6. `assistant-bridge`
   - Goal CTO session creation
   - read access to docs, repo context, runtime overlay, and paged session history
   - ability to call project-local skills
   - intervention routing

7. `web-projection`
   - Goal board
   - assistant conversation
   - intervention surfaces
   - runtime workbench

## Testing Strategy

Core tests should avoid browser-first coverage.

P0 must cover:

- parsing valid `todo.yml`
- rejecting invalid YAML
- rejecting duplicate refs
- rejecting invalid statuses
- rejecting dependencies on missing refs
- rejecting dependency cycles
- atomic write behavior for successful mutations
- no file mutation on failed validation
- `events.jsonl` append on successful script mutation
- API board response built from `todo.yml`
- DB runtime overlay attached by `goalKey + taskRef`
- orphan DB runtime overlay ignored or surfaced as diagnostic
- SSE invalidates board queries after docs changes
- watcher-loss recovery through API read or reconcile tick
- `WriteTraceRecorder` records normalized write events without full file contents
- assistant is Goal-scoped only
- one Goal has one assistant conversation
- intervention replies never route into task sessions
- dependency-unblocked tasks resume without a special unblock tool
- `blocked` is accepted only as an automation hold and never rendered as a separate board lane

## Migration Direction

Current implementation contains DB task projection and server-side kanban mutation paths. Migration should move toward:

- keeping existing DB task/session behavior only as runtime overlay during transition
- making board API derive workflow fields from `todo.yml`
- removing DB task title/status/dependency from the canonical read path
- removing DB decision-topic rows from the canonical read/write path; `decisions.yml` owns open and resolved decision state
- routing assistant kanban writes through `.hopi/skills/kanban/todo.mjs`
- keeping server routes only as bridges to local scripts where needed
- applying Planner / Generator / Reviewer / Radar / Merger typed workflow outputs through the local-doc writer path
- splitting workflow trace (`events.jsonl`) from write-file trace (`write-trace.jsonl`)
- bootstrapping `design.md` for every Goal and teaching Planner to maintain it before task decomposition
- replacing planner mail with visible planner-role work in `todo.yml`
- treating legacy free-form blockers, `planning/running/review`, `deferred`, and DB-owned task fields as migration compatibility residue only

The migration should not preserve backward compatibility with legacy workflow truth once the file-native model is enabled for a project.

## Hard Invariants

These invariants should be enforced in code and tests:

1. `todo.yml` is the only durable kanban workflow truth.
2. DB never owns kanban lane/status/title/body/dependency/order/blocker truth.
3. Durable Goal metadata, decisions, design, workflow traces, and preferences live in local docs, not DB-only records.
4. Assistant kanban writes go through project-local kanban skill scripts.
5. UI board state is derived from docs plus runtime overlay.
6. Runtime overlay may annotate cards but cannot change durable workflow truth.
7. `events.jsonl` explains workflow mutations but is not replayed for current board state.
8. `write-trace.jsonl` audits file writes but does not affect workflow state.
9. `blocked` is not a task status or lane.
10. Runtime/session history stays in API-accessible storage, not docs.
11. P1 assistant-made skills cannot be required for P0 board correctness.
12. The P0 kanban skill is self-contained and does not require Bun, TypeScript, npm install, Python packages, or user-home helper files.
13. Planner is the only engineering graph-shaping runtime.
14. Assistant cannot create hidden engineering task rows directly.
15. Quick actions, assistant actions, and scheduler workflow mutations use the same local-doc writer path.
16. If docs and DB disagree about durable Goal/workflow state, docs win.

## Result

This design intentionally reduces the system to a few stable ideas:

- Goal is the unit of autonomy.
- `.hopi/docs` is the durable workflow contract.
- `todo.yml` is current kanban state.
- `design.md` is durable Goal design rationale.
- Kanban is a projection of Goal docs plus runtime overlay.
- Assistant is a Goal-scoped CTO runtime with visible local tools.
- Scheduler is deterministic.
- Trace explains, but does not own, state.
- Agents do work, but do not own orchestration truth.

That is the smallest model that still supports multi-lane autonomous execution, user-in-the-loop recovery, readable repo-local workflow state, and an assistant that can operate the board without becoming a hidden DB controller.

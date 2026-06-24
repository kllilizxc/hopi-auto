# Remove Manual Authoring Surfaces

## Goal

Delete all human-facing authoring surfaces for decisions, planning requests, planning workflows, preferences, and manual task manipulation.

Keep the underlying domain stores and runtime behavior that automation and assistant execution still depend on.

## Why

The current project has already converged on a narrower MVP flow:

- project list
- goal creation
- project-scoped board
- docs
- session
- assistant-driven automation

The old authoring surface was not actually removed. It was only hidden behind `mvpMode` while still leaving:

- front-end imports and bundle weight
- hidden state initialization
- hidden queries and mutations
- hidden event invalidation paths
- HTTP endpoints that still expose manual creation and editing
- legacy non-project-scoped routes that can still revive the old surface

That leaves the system with unclear boundaries. The long-term cost is not just dead UI code. It is a permanent mismatch between the product surface and the implementation surface.

## Product Boundary

After this slice, the product should support only these user-facing flows:

- link a project
- create a goal
- view the board
- view goal docs
- view run/session history
- interact with the assistant
- start or stop automation
- reconcile the goal

The product should no longer support human-authored:

- decision creation
- decision answering
- decision resolution
- planning request creation
- planning workflow creation
- preference recording or retirement
- direct preference document editing
- manual task creation
- manual task status moves

## Architecture Decision

Manual authoring is treated as a separate capability boundary from automation.

This slice removes the manual-authoring capability from:

- React routes
- React page composition
- front-end data fetching and mutations
- front-end API client methods
- server HTTP routes and request schemas

This slice does **not** remove the domain model from:

- runtime stores
- scheduler/reconcile logic
- assistant action execution
- assistant context assembly
- automation-side planning and decision materialization

In other words:

- automation keeps direct access to domain services
- humans lose direct authoring entry points

## Scope

### Front-end

Remove the old authoring surface from the board experience:

- delete the `!mvpMode` authoring panel block in `BoardView`
- delete the hidden authoring-only imports from `BoardView`
- delete authoring-only state, queries, mutations, and effect wiring from `useBoardViewModel`
- delete authoring-only API client methods that are no longer referenced
- delete legacy non-project-scoped goal routes

The remaining board surface should become explicitly MVP-only rather than a dual-mode page with hidden legacy behavior.

### Back-end HTTP

Remove manual HTTP entry points for:

- reading decisions
- reading planning requests
- reading planning workflows
- reading workflow detail
- creating decisions
- answering decisions
- batch answering decisions
- resolving decisions
- creating planning requests
- creating planning workflows
- reading preferences over HTTP
- editing preferences over HTTP
- recording preferences over HTTP
- retiring preferences over HTTP

The server should still expose board, docs, runs, assistant, automation, and project/goal bootstrap surfaces.

### Runtime and Domain

Preserve:

- `decisionStore`
- `planningRequestStore`
- `preferenceStore`
- runtime planning and decision materialization
- assistant action execution paths
- reconcile and action-required flows

These remain internal automation primitives, not user-facing product surfaces.

## Required Behavior

### Board surface

`BoardView` must no longer have two personalities.

Required outcome:

- there is one supported board mode
- that mode is the current MVP board
- no hidden authoring panel exists in the page tree
- no hidden authoring query/mutation chain runs behind the MVP view

### Routing

Only project-scoped goal routes remain:

- `/projects/:projectKey/board/:goalKey`
- `/projects/:projectKey/docs/:goalKey`
- `/projects/:projectKey/session/:goalKey`

Legacy routes should be removed:

- `/board/:goalKey`
- `/docs/:goalKey`
- `/session/:goalKey`

This prevents stale links from reactivating the removed authoring mode.

### API surface

If a human caller tries to use the removed manual-authoring endpoints, the server should not silently no-op.

Required outcome:

- removed routes are absent
- requests receive normal not-found behavior
- no replacement compatibility shim is added

Failing closed is better than pretending the product still supports those workflows.

### Internal automation behavior

Automation and assistant flows that currently create or mutate decisions, planning requests, workflows, or preferences through direct runtime/domain calls must continue to work unchanged.

This slice must not:

- rewrite assistant action semantics
- rewrite reconcile planning logic
- flatten stores into a new data model
- migrate persisted data

## File Strategy

### Front-end keep

Keep:

- `App.tsx` project-scoped surfaces
- `ProjectHomePage`
- `GoalCreatePage`
- `BoardView` MVP board content
- `GoalDocsPage`
- `SessionView`
- assistant UI
- task history UI

### Front-end remove or shrink

Remove or substantially shrink code tied only to manual authoring, including:

- `BoardView` legacy panel composition
- `useBoardViewModel` authoring state/query/mutation branches
- `boardViewDecisionPanel*`
- `boardViewPlanningRequestPanel*`
- `boardViewWorkflowPanel*`
- `boardViewAnswerBundlePanel*`
- `boardViewPreferencePanelSupport*`
- `boardViewDecisionFollowThroughEditor*`
- structured authoring editor modules that are no longer used
- `TaskActionsPanel` if no supported manual task actions remain

Shared support code should only survive if still needed by the MVP board, docs, sessions, or assistant surfaces.

### Back-end remove or shrink

Remove:

- manual-authoring routes from `server.ts`
- request schemas used only by those routes from `serverSchemas.ts`
- any server helpers referenced only by removed HTTP paths

Preserve:

- runtime modules
- stores
- assistant executors
- reconcile logic

## Non-Goals

This slice does not:

- redesign the automation domain
- remove persisted decisions/planning data from storage
- alter assistant authority rules
- change board rendering for automation-produced tasks
- merge domain types just because some HTTP surfaces disappear
- introduce new replacement manual tooling

## Risks

### Risk: accidental automation breakage

The same domain modules are used by both HTTP handlers and automation.

Mitigation:

- remove only HTTP entry points and front-end callers first
- keep runtime/domain imports intact
- verify assistant and reconcile tests still cover those paths

### Risk: orphaned imports and giant files

`BoardView` and `useBoardViewModel` currently mix MVP board behavior with legacy authoring behavior.

Mitigation:

- explicitly split MVP-only logic from removed authoring logic
- prefer deletion over another layer of conditionals

### Risk: stale direct links

Legacy unscoped routes can keep removed behavior reachable.

Mitigation:

- remove the routes instead of redirecting through compatibility logic

## Verification

### Front-end

- type/build verification shows no remaining references to removed authoring modules
- route inspection confirms only project-scoped board/docs/session paths remain
- MVP board still loads, shows tasks, opens assistant, and opens task run history

### Back-end

- API tests verify removed manual-authoring routes are absent
- existing automation and assistant tests still pass
- reconcile and assistant flows still materialize decisions/planning/preferences internally

### Structural

- grep-level verification shows no remaining front-end imports of removed authoring modules
- API client no longer exports removed manual-authoring methods

## Recommended Execution Order

1. Remove the legacy front-end route surface.
2. Remove the board authoring UI composition.
3. Remove authoring-only board state/query/mutation logic.
4. Delete now-unreferenced authoring modules and front-end API methods.
5. Remove manual-authoring server routes and schemas.
6. Run focused verification to prove automation still works through internal runtime paths.

# HOPI Frontend

`packages/frontend` is the product frontend package. It preserves the original React product shell
and visual language while presenting only the current MVP model.

## Boundary

- React, React Router, and React Query live in this package.
- Bun serves `index.html` through `packages/backend/src/mvpServer.ts`; there is no second frontend
  server in production.
- The backend remains the only API and workflow authority.
- The frontend owns no Goal, Work, Attention, Preview, or lifecycle truth. It polls canonical read
  projections and submits user intent through the MVP API.
- This is the only product UI tree. The backend contains API and runtime code only.

## Product Surfaces

- `ProjectHomePage`: bind or rebind Repos, configure Project responsibility models, and enter Goals.
- `GoalCreatePage`: capture an outcome and create the initial Planning Work; Coordinator derives the
  readable Goal identity from its title.
- `BoardView`: read-only four-column Work projection, Goal controls, Attention, per-Work Attempt
  message streams, and Preview.
- `GoalDocsPage`: Goal contract, design documents, and Evidence.
- `AssistantPanel`: one workspace conversation with optional Goal context and Attention replies.

Project and Goal switchers are local navigation state. The browser remembers the last valid Goal
visited in each Project and restores it when that Project is selected; if it no longer exists, the
first projected Goal (or New Goal for an empty Project) remains the fallback.

Kanban cards are compact navigation and status surfaces, not abbreviated documents. They show the
Work title, the real Attempt count, and a single `Blocked by …` reference only when a blocking Work
exists, without clipping body or dependency prose. A segmented task-progress track appears only
after a non-terminal Work has started; never-started and Done/cancelled Work omit it entirely. Agent
plan items are collapsed into that track by default and expand in place to the complete current list;
started Work without plan items receives one fallback segment. Stable Work identity, repository scope, the
complete canonical body, dependencies, predicates, Evidence, Recovery, and Run prompt stay readable
in the Work detail modal. Responsibility is already defined by the containing lane and is not
repeated on each card; the detail modal likewise does not repeat the card's task list. The title owns
the full card width. Ordinary Working, Done, queued, waiting, and Needs-you labels are not repeated
on cards. Cards use background, spacing, and shadow rather than a persistent border or side marker.
Running state gives only the current progress segment a softly pulsing full fill and quiet same-color
glow, never animating the whole card surface. Completed progress segments and expanded task markers
use the containing Lane's phase color—Plan yellow, Build purple, Review blue, and Done green—instead
of sharing one global success green.

Assistant, Attempt, and Reflection message streams share one initial loading skeleton shaped like
their eventual conversation rows. Loading older history remains a small incremental status and does
not replace already visible messages. Each stream also keeps one browser-session snapshot of its
last successfully displayed history and its Attempt index, isolated by stable stream identity and
bounded by a shared LRU budget. Refreshing or re-entering the same stream restores that snapshot
synchronously, then applies cursor-based changes in the background. The snapshot is an observational
UI cache, never workflow or message authority, and is not reused across Goals, Works, Attempts, or
Reflections.

Assistant conversation activity is one tail-only breathing status. Public speaking work is
`Working`; while no public turn is running, active Reflection or its hidden internal speaking handoff
is `Thinking`; a queued public turn with no active model work is `Waiting to start`. The internal
prompt, diagnostics, and tool stream remain hidden, and terminal activity leaves no historical row.

Needs-you presentation belongs to the exact Assistant reply that exposed the canonical Attention.
While any linked reference remains unresolved, that message receives one restrained warning surface,
a compact label, and a Reply action carrying all of its open references. Resolution restores the
ordinary message without adding a status row. Assistant has no title header; the global open count
remains as a quiet floating badge only when non-zero. Its Reflection entry is hidden in a masked
top-right hover/focus region, and the Reflection list adds no title or refresh toolbar. Goal and
Kanban surfaces retain their derived Work state without a duplicate banner.

The UI deliberately has no task drag-and-drop, direct Work mutation, manual reconcile, Assistant
Action editor, decision graph, planning-request graph, or session-authority screen.

Responsive behavior is part of the product contract, not a reduced mobile variant. Desktop Goal
workspaces dock Assistant beside the active surface; compact workspaces keep the Goal surface at
full height and open Assistant as a dismissible overlay. Navigation remains available at every
width, Kanban lanes become horizontally snapping workspaces, and Documents, Evidence, Attempts,
forms, and dialogs reflow or scroll instead of hiding product information.

Goal-local presentation state survives compact re-entry without becoming product authority. The
browser stores the expanded Work progress rows and the currently snapped mobile Lane under the
stable Project/Goal scope. Returning to that Goal restores only those view preferences; canonical
Work, Agent plans, and Lane placement still come exclusively from the backend projection.

The Kanban workspace owns one continuous background from its top edge through the board. Its Project,
Goal, and view navigation bar is transparent and adds no separate backdrop or shadow layer, so the
same restrained gradient remains visible behind the controls and board content.

Startup is progressive. `index.html` owns the canonical tiny pre-React boot surface, mirrored by the
backend HTML adapter, so a cold or remote load is never an unexplained black canvas. Product routes
and Assistant sit behind lazy execution boundaries; `build.ts` emits separate chunks, while Bun's
HTML server may coalesce them into one optimized bundle. Compact workspaces do not render Assistant
until it is opened. Navigation hover, focus, or pointer-down prefetches only that intended lazy
surface; mobile startup never downloads every hidden route opportunistically. React replaces the
boot surface with the persistent shell first, then uses an
in-shell loading state while the active route arrives. On phones, cold boot, route loading, and the
first Goal read use one small non-modal status anchored above the bottom safe area. It never covers
or captures input from the shell, so navigation that has already mounted remains usable while the
surface catches up. The HMR server remains intentionally unminified, so remote devices use the
production surface or the explicit remote frontend mode.

Goal and task navigation is cache-first. Returning to a loaded Goal or Attempt renders its cached
projection immediately and refreshes it in the background. For a first visit, pointer/focus intent
warms the route and canonical query; an explicit switch keeps the current usable surface mounted
until the target projection is ready, with the latest navigation intent winning. Opening a Work or
switching its Attempt follows the same rule for Attempt summaries and message history. A local
skeleton is reserved for a direct cold URL with no prior surface to preserve, never for routine
switching.

Smoothness is a product contract. Polling views subscribe to the smallest projection they render and
avoid notifying React for invisible fetch-status churn; live streams poll only while the related
surface is open and active. Long lists use virtualization or skip offscreen rendering with stable
intrinsic sizes, and scroll containers keep stable gutters so content does not shift under the
pointer. Motion is short, tokenized, and restricted to opacity, transform, and other compositor-safe
properties; box-shadow, layout, and broad `transition: ... ease` rules are not used for repeated
status or hover animation. Reduced-motion preferences must collapse animation without changing the
information architecture. The reproducible device profile, baseline, payload/timing ceilings, and
motion rules live in [`PERFORMANCE.md`](./PERFORMANCE.md). Board reads
only its compact card projection; Goal docs polls only a path/excerpt catalog and reads the selected
design body on demand, while canonical Work bodies load only when the Work contract pane is opened.
Board Attention records contain routing status but no message body. The always-mounted shell likewise
excludes Attention bodies, which Assistant reads only while its surface is visible. On compact
Kanban, only the selected Lane and its immediate neighbors mount card lists; the next neighbor is
mounted as selection advances, preserving continuous horizontal navigation without rendering
distant cards into the first frame.

Workspace selectors are recency-aware. Every visited Project keeps its own last-visit timestamp;
visited Projects are ordered newest first, while never-visited Projects remain in stable server order
behind them. Each Project keeps the visit history of its Goals, so the current Goal is immediately
first and the remaining Goal tabs follow from most to least recently visited. A Goal's durable
creation receipt is its initial recency evidence until it is visited, preserving discovery of a newly
Assistant-created Goal without a second ordering model. Background Goal creation never marks an
untouched Project as visited. Project switching opens the same first Goal shown by the selector;
filesystem or identifier order is never treated as recency. Older single-Goal browser preferences
are migrated into the same visit history.

Frequent Project switching uses that same ordering without introducing a second favorites model.
The most recent Projects are exposed through the shared HeroUI-backed `AppTabs` rail, limited to
three on wide workspaces, two on narrower workspaces, and one on phones or short landscape screens.
The current Project always remains directly visible. The same rail, tab, and sliding
SelectionIndicator implementation owns every peer-view switch, including Kanban/Goal docs and
Activity/Work contract; each surface may change only sizing and placement, not selection styling or
interaction. Attempt history and the Goal document index remain lists rather than pretending every
selection surface is a tab. Reduced-motion preferences remove the indicator transition. Shortcut
order is stable for the current workspace session so a clicked target never moves under the pointer;
visit timestamps continue to persist and determine the order on the next workspace entry. Remaining
Projects stay available from one icon-only Select at the right of the shortcuts; its accessible name
and popover carry the meaning instead of repeating a visible “More” label. Goal navigation remains a
Select because its labels are longer and its scope changes with the Project.

Project identity and Project presentation are deliberately separate. The stable `projectId` remains
the machine key used by routes, canonical documents, runtime records, and audit references; the UI
does not rename it or use an opaque legacy ID as the primary label. Every user-facing Project label
is derived from the selected primary folder instead: the Repo folder for a root-scoped Project, or
the selected subfolder for a scoped Project. Moving or rebinding a checkout may therefore update its
display name without rewriting historical identity.

## Visual Continuity

The restored frontend keeps the original design vocabulary:

- dark graphite shell with a docked Assistant and compact Goal workspace navigation
- purple primary actions with amber Project and Attention accents
- compact Kanban cards and drawer-style Assistant conversation
- dense operational information without exposing runtime internals as product state

Generic interactive atoms come from HeroUI v3 through `src/components/ui`; application pages must
not import HeroUI directly. HOPI's semantic theme mapping lives in `src/styles/theme.css`, adapter
overrides live in `src/styles/ui.css`, and business layout/message-stream styling remains in
`src/index.css`. The hidden image file picker is the only intentional native input exception.

Tailwind CSS v4 is used to compile HeroUI's selected component styles. Bun's Tailwind plugin powers
both HMR and `build.ts`; the frontend does not use Vite or a separate CSS watcher.

## Commands

From the repository root:

```sh
bun install
bun run dev
bun run check
```

`bun run dev` is the production-shaped path: the backend serves API and frontend together at
`http://localhost:3000`.

For an independent frontend development process with HMR, run these in separate terminals:

```sh
bun run dev:backend
bun run dev:frontend
```

The default backend command is intentionally stable: hot reload would terminate active Planner,
Generator, or Reviewer processes. `bun run dev:backend:watch` is available for isolated backend
development when no Goal is running.

Open `http://localhost:5173`. The frontend development server proxies `/api/*` to
`http://127.0.0.1:3000`. Override these defaults with `HOPI_FRONTEND_PORT` and
`HOPI_BACKEND_URL`.

For a phone or another remote device, prefer the backend's `http://<host-ip>:3000` product surface.
If the frontend must run independently, use `bun run remote:frontend` from the repository root. It
keeps the API proxy but disables the multi-megabyte HMR client and minifies the browser bundle;
source edits require restarting that frontend process.

Frontend-only verification:

```sh
cd packages/frontend
bun dev
bun run typecheck
bun test
bun run build
```

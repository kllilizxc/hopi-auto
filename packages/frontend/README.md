# HOPI Frontend

`packages/frontend` is the only product UI. React renders backend projections; it does not own Goal,
Work, Attention, Run, Preview, or completion truth.

## Surfaces

- Project Home binds Repos, configures the Assistant and Worker transports, and opens Goals.
- Assistant is the Project conversation and the only user-facing author of Goal/Work changes.
- Route is the default Goal view. It shows one directed Work route from known decisions and work to
  the Goal destination.
- Goal Docs shows the Goal contract, Map, design documents, and Evidence.
- Work detail loads the canonical Work body and Attempt history on demand.

The Route answers five questions at a glance:

1. What is the destination?
2. Which Work is in focus now?
3. What has already been decided or completed?
4. What blocks the next step?
5. What remains fog rather than a precise Decision?

The frontend never invents lanes, stages, ownership, progress percentages, or implicit task plans.
Node placement is a deterministic layout of the canonical dependency graph. Completed nodes remain
visible as the route history; the Goal itself is a virtual destination node.

## Data and context

Route reads use `?view=route`, Goal Docs uses `?view=docs`, and full Work or design bodies load only
when opened. React Query and bounded `sessionStorage` snapshots are observational caches. They may be
discarded at any time and never authorize a mutation.

Project and Goal selectors are navigation state. The Assistant composer may include the current page
as a mechanical hint, but the Assistant decides semantic effects through HOPI tools.

## UI implementation

Generic controls come from the adapters in `src/components/ui`; pages do not import HeroUI directly.
Theme tokens live in `src/styles/theme.css`, component overrides in `src/styles/ui.css`, Route styling
in `src/styles/route.css`, and shared product layout in `src/index.css`.

Startup is progressive: `index.html` renders the boot surface, the shell mounts first, and route
modules load lazily. Motion is short and compositor-safe, with a reduced-motion equivalent. The
current delivery budgets are documented in [`PERFORMANCE.md`](./PERFORMANCE.md).

## Commands

From the repository root:

```sh
bun run dev
bun run check
```

For independent frontend HMR:

```sh
bun run dev:backend
bun run dev:frontend
```

The HMR surface is `http://localhost:5173` and proxies `/api/*` to
`http://127.0.0.1:3000`. Frontend-only verification is:

```sh
cd packages/frontend
bun run check
```

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
- `GoalCreatePage`: capture an outcome and create the initial Planning Work.
- `BoardView`: read-only four-column Work projection, Goal controls, Attention, per-Work Attempt
  message streams, and Preview.
- `GoalDocsPage`: Goal contract, design documents, and Evidence.
- `AssistantPanel`: one workspace conversation with optional Goal context and Attention replies.

The UI deliberately has no task drag-and-drop, direct Work mutation, manual reconcile, Assistant
Action editor, decision graph, planning-request graph, or session-authority screen.

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

Frontend-only verification:

```sh
cd packages/frontend
bun dev
bun run typecheck
bun test
bun run build
```

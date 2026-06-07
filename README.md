# hopi-claude

HOPI is a file-native autonomous goal orchestration prototype being rebuilt around a Bun-first deterministic core.

## Start Here

For a zero-context handoff, read:

- `docs/zero-context-continuation.md`
- `docs/agent-handoff.md`
- `docs/README.md`

## Core Authority

The main authority docs are:

- `docs/hopi-phase-1-authority.md`
- `packages/frontend/MIGRATION.md`
- `docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md`
- `docs/superpowers/specs/README.md`

`docs/superpowers/specs/README.md` is the complete design-phase index grouped by date, including the 2026-06-02 and 2026-06-03 authority slices that were not previously surfaced from this root README.

## Commands

Install dependencies:

```sh
bun install
```

Run the backend API and compatibility UI:

```sh
bun run dev
```

Run the product frontend package:

```sh
bun run dev:frontend
```

Current frontend direction:

- `packages/frontend` is the active product frontend package.
- The existing React/Vite code in `packages/frontend` is the baseline to preserve and evolve in place.
- `packages/backend/src/ui` is a capability and API reference surface, not a UI to copy wholesale.
- Frontend work should continue in `packages/frontend`, starting from its existing `App.tsx`, `Layout.tsx`, `BoardView.tsx`, `SessionView.tsx`, and `AssistantPanel.tsx`.
- Before substantial frontend work, read `packages/frontend/MIGRATION.md`.

Run all repo checks:

```sh
bun run check
```

Start the backend only:

```sh
cd packages/backend
bun run start
```

Then open:

```text
http://localhost:3000
```

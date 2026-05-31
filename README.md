# hopi-claude

HOPI is a file-native autonomous goal orchestration prototype being rebuilt around a Bun-first deterministic core.

## Start Here

For a zero-context handoff, read:

`docs/agent-handoff.md`

The docs index is:

`docs/README.md`

## Phase 1

Phase 1 backend is implemented and verified. The completed execution plan is:

`docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md`

The Phase 1 authority note is:

`docs/hopi-phase-1-authority.md`

## Commands

Install dependencies:

```sh
bun install
```

Run the backend:

```sh
bun run dev:backend
```

Run all Phase 1 checks:

```sh
bun run check
```

Start the backend:

```sh
cd packages/backend
bun run start
```

# HOPI Auto

HOPI is a Bun-first, file-native assistant that turns operator conversation into durable Goals and
keeps advancing them through a fixed Planner, Generator, Reviewer, and deterministic integration
loop. The operator is interrupted only by targeted Attention, explicit lifecycle controls, or a
completion update.

## Authority

Read these documents in order:

1. [`docs/mvp_design.md`](docs/mvp_design.md) for product scope and accepted decisions.
2. [`docs/mvp_document_model.md`](docs/mvp_document_model.md) for canonical files and invariants.
3. [`docs/mvp_execution.md`](docs/mvp_execution.md) for execution, Assistant, scheduling, and Preview.
4. [`docs/mvp_publish_protocol.md`](docs/mvp_publish_protocol.md) for publication and crash safety.
5. [`docs/mvp_state_machine.md`](docs/mvp_state_machine.md) for the derived state-machine reference.

Older handoff, deep-dive, Phase 1, and `superpowers` documents are historical evidence only. They
describe the retired pre-MVP Action, `todo.yml`, merger, Vite runtime, and writable workflow screens
and are not implementation authority.

## Run

```sh
bun install
bun run dev
```

Open `http://localhost:3000`. Assistant-home state, Run diagnostics, artifacts, and caches default to
`$XDG_DATA_HOME/hopi` or `~/.local/share/hopi`; set `HOPI_HOME` to choose another owner directory.
Managed Project worktrees remain beside their linked Repo under `.hopi-worktrees`, never under this
repository. Set `HOPI_ATTENTION_WEBHOOK_URL` to mirror public speaking-
Assistant updates to one provider-neutral notification endpoint; raw internal Attention is never
delivered. HOPI sends the public Inbox event identity in the `Idempotency-Key` header. A linked user
checkout is never HOPI's publication root.

For standalone frontend HMR, keep `bun run dev:backend` running and start `bun run dev:frontend` in
another terminal, then open `http://localhost:5173`. The frontend dev server proxies to port 3000;
use `HOPI_BACKEND_URL` to override the backend origin.

`dev:backend` deliberately runs a stable Coordinator process so source edits cannot interrupt an
active responsibility Run. Use `bun run dev:backend:watch` only for isolated backend development
when no Goal is executing.

Run all production checks with:

```sh
bun run check
```

The product UI lives in the restored React package at `packages/frontend` and keeps the original
visual language. Bun imports that package's `index.html` from the backend, so production still has
one server process and no Vite runtime.

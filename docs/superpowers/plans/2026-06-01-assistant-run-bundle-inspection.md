# Assistant Run Bundle Inspection Implementation Plan

Goal: expose exact durable Goal assistant run bundles through a read-only Bun API route and the active Bun UI.

Architecture: assistant bundle files remain file-native under `.hopi/runtime/goals/<goalKey>/assistant/runs/<assistantRunId>/`; `AssistantRunStore` projects those files, the server exposes a bundle route, and the Bun UI loads and renders the bundle alongside existing assistant run detail.

Tech Stack: Bun, TypeScript, Bun test, Bun HTML import UI

Completed implementation tasks:

- [x] Add assistant run bundle read-side projection to `AssistantRunStore`.
- [x] Add `GET /api/goals/:goalKey/assistant/runs/:assistantRunId/bundle`.
- [x] Extend the Bun UI to fetch bundle detail for the selected assistant run.
- [x] Render `context.md`, `prompt.md`, `outcome.json`, and `result.json` with durable file paths and recorded contents.
- [x] Verify through focused store/API tests, full `bun run check`, and local Bun service sanity checks.

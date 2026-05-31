# Run-History And Artifact-Aware Review/Merge Policy Implementation Plan

Goal: deepen review and merge evidence policy by feeding prior run history, artifact refs, and transcript summaries into reviewer/merger context bundles alongside existing durable write traces.

Architecture: extend `roleProcessContext` with read-side access to run history, render compact prior-step evidence for the same engineering task, surface explicit no-evidence gaps, and strengthen reviewer/merger prompt policy without changing scheduler truth semantics.

Tech Stack: Bun, TypeScript, Bun test

Completed implementation tasks:

- [x] Add failing `roleProcessContext` tests for prior run-history evidence rendering and merger evidence-gap policy.
- [x] Read relevant prior run evidence from the existing runtime history store.
- [x] Render compact artifact and transcript summaries into reviewer/merger context bundles.
- [x] Surface explicit no-run-history evidence gaps for engineering reviewer/merger steps.
- [x] Strengthen reviewer/merger prompt policy to require artifact/run-history correlation in addition to write traces.
- [x] Verify through focused tests and full `bun run check`.

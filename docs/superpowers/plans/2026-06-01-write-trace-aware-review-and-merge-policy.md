# Write-Trace-Aware Review And Merge Policy Implementation Plan

Goal: deepen durable write-trace usage by turning reviewer and merger prompts into explicit evidence-aware policy surfaces instead of generic context dumps.

Architecture: `roleProcessContext` continues to read the same write-trace store, but now renders richer trace summaries, shows explicit evidence gaps for engineering review/merge steps, and injects role-specific prompt policy text for reviewer and merger decisions.

Tech Stack: Bun, TypeScript, Bun test

Completed implementation tasks:

- [x] Add failing context-builder tests for reviewer evidence policy and merger evidence-gap guidance.
- [x] Render richer changed-file summaries in relevant write-trace context sections.
- [x] Surface explicit no-trace evidence gaps for engineering reviewer/merger steps.
- [x] Add role-specific write-trace policy text to reviewer and merger prompts.
- [x] Verify through focused tests, full `bun run check`, and prompt-bundle sanity checks.

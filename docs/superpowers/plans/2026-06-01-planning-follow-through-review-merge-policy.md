# Planning Follow-Through Review/Merge Policy Implementation Plan

Goal: extend the newer evidence-aware review/merge model to planning tasks so reviewer and merger verify durable follow-through against planning requests, planning write traces, and prior run evidence.

Architecture: broaden planning durable inputs from planner-only to all planning-task steps, add planning-specific evidence-gap text in `roleProcessContext`, and add planning reviewer/merger role policy without changing scheduler truth semantics.

Tech Stack: Bun, TypeScript, Bun test

Completed implementation tasks:

- [x] Add failing `roleProcessContext` tests for planning reviewer policy and planning merger evidence gaps.
- [x] Feed planning durable inputs into planning reviewer/merger context bundles.
- [x] Add planning-specific write-trace gap rendering.
- [x] Add planning reviewer and planning merger prompt policy.
- [x] Verify through focused tests and full `bun run check`.

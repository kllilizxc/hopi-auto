# Durable Planning Requests And Planner Follow-Through Implementation Plan

Goal: add a file-native planning-follow-through surface that assistant and API can write, planner can consume, and deterministic runtime can resolve when visible planning work completes.

Architecture: introduce `planning-requests.yml` as Goal-scoped durable input, back it with a dedicated store plus a shared planning-request helper, inject it into planner and assistant context bundles, expose it through Bun API/UI, and auto-resolve linked requests when planning tasks complete.

Tech Stack: Bun, TypeScript, Bun test

Completed implementation tasks:

- [x] Add failing tests for planner-context consumption, scheduler auto-resolution, API creation/listing, and assistant `request_planning` follow-through.
- [x] Add file-native `planning-requests.yml` storage with deterministic request keys and resolution support.
- [x] Add a shared planning-request helper for assistant/API request creation plus deterministic planning-task linking.
- [x] Inject planning requests into assistant and planner context bundles and add planner follow-through prompt policy.
- [x] Auto-resolve linked planning requests when planning tasks finish successfully.
- [x] Surface planning requests through Bun API and Bun UI.
- [x] Verify through focused tests, full `bun run check`, and local HTTP sanity checks.

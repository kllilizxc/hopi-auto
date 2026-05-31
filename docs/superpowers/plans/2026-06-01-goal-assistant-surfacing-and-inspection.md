# Goal Assistant Surfacing And Inspection Implementation Plan

Goal: expose Goal assistant runtime as a product path through read-side inspection APIs and Bun UI surfacing.

Architecture: assistant run data remains file-native under `.hopi/runtime/goals/<goalKey>/assistant/runs/**`, a read-side store projects summaries/detail, server routes expose that state, and the Bun UI consumes those routes directly.

Tech Stack: Bun, TypeScript, Bun test, Bun HTML import UI

Completed implementation tasks:

- [x] Add assistant run record parsing and read-side store.
- [x] Add assistant run summary/detail APIs.
- [x] Extend assistant run records to carry request content, status, and emitted actions.
- [x] Broadcast assistant runtime changes through SSE.
- [x] Extend the Bun UI with assistant prompt submission, decision/thread surfacing, assistant run list, and assistant run detail inspection.
- [x] Verify through store/API tests, full `bun run check`, and live local service verification with a temporary assistant config and demo Goal.

# Incremental Grouped Planning Extension Plan

Status: in progress
Date: 2026-06-01

Goal: persist durable grouped task keys and allow later grouped planning batches to extend an existing planning group without replaying earlier batch entries.

## Steps

1. Add failing tests for:
   - persisting grouped task keys in `planning-requests.yml`
   - extending an existing grouped follow-through with one new dependent task
   - rejecting conflicting grouped task-key reuse
   - surfacing grouped task keys through the active assistant/runtime path
2. Extend planning-request storage/runtime to persist `groupTaskKey` and resolve `blockedByTaskKeys` against existing grouped requests.
3. Surface `groupTaskKey` in assistant/planner context, API payloads, and Bun UI inspection where grouped planning requests are shown.
4. Run focused tests, then `bun run check`.
5. Do one real local assistant/API sanity check for incremental grouped extension.
6. Update handoff/docs index/README and commit the verified slice.

# Grouped Planning Blocker Propagation Plan

Status: in progress
Date: 2026-06-01

Goal: keep engineering blocked on the current open sink tasks of grouped planning follow-through instead of the first planning task that originally carried the blocker.

## Steps

1. Add failing tests for:
   - retargeting engineering blockers when grouped planning upgrades a decision-resolution follow-through into a deeper chain
   - keeping engineering blocked during scheduler cleanup when an earlier grouped planning task is done but a later grouped leaf is still open
   - fanning engineering out to multiple current grouped leaves in a branching follow-through
2. Add grouped-planning runtime helpers that compute current open sink task refs from visible blockers plus durable `groupKey` metadata.
3. Synchronize engineering blockers to grouped open sinks when grouped planning requests are created, reused, upgraded, or extended.
4. Synchronize or preserve grouped blockers during scheduler cleanup before generic done-task blocker removal can unblock engineering early.
5. Run focused tests, then `bun run check`.
6. Do one real local sanity check on the Bun API path for grouped planner follow-through propagation.
7. Update handoff/docs index/README and commit the verified slice.

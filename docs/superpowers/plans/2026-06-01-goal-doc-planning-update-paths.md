# Goal-Doc Planning Update Paths Plan

Status: in progress
Date: 2026-06-01

Goal: generalize planning-request `requestedUpdates` from a fixed built-in enum to validated Goal-local relative paths across the full Bun product path.

## Steps

1. Add failing tests for normalized Goal-local requested update paths, including acceptance of custom doc paths and rejection of traversal plus reserved Goal state files.
2. Add failing tests for planning follow-through evidence so extra Goal-local targets are observed or reported missing from durable write traces.
3. Add failing tests for planner and assistant product-path coverage so planner prompts, API validation, and assistant execution all accept the generalized requested-update path model.
4. Replace the hardcoded requested-update enum with one shared validation helper in the planning-request store and reuse it from API and assistant action schemas.
5. Generalize planning follow-through evidence ordering and matching so core files stay first while extra Goal-local targets remain deterministic.
6. Update planner context, assistant guidance, and Bun UI request entry so requested updates are treated as relative Goal-local paths instead of three fixed checkbox values.
7. Run focused tests, then `bun run check`.
8. Do one real local sanity check on the Bun API path with a custom Goal-local requested update target.
9. Update handoff/docs index/README and commit the verified slice.

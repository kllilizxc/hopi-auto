# Decision Resolution Planner Follow-Through Implementation Plan

Goal: when a resolved decision was blocking engineering work, automatically route that work through visible planner follow-through before engineering resumes.

Architecture: extend the shared decision-resolution runtime helper to create or reuse one planning request plus visible planning task through the existing planning-request control path, then replace resolved engineering decision blockers with task blockers on that planning task.

Tech Stack: Bun, TypeScript, Bun test

Completed implementation tasks:

- [x] Add failing tests for shared decision-resolution follow-through, API resolution behavior, and assistant decision-resolution flow.
- [x] Extend the shared decision-resolution helper with deterministic planning follow-through creation/reuse for engineering-linked decisions.
- [x] Rewire affected engineering blockers from `decision` to `task` without changing planning-task behavior.
- [x] Verify through focused tests, full `bun run check`, and a local Bun API sanity check.

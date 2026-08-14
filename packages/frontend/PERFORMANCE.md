# Frontend performance contract

The production build enforces the persistent delivery budgets:

- initial JavaScript: at most 800 KiB;
- shared CSS: at most 320 KiB;
- route-specific code remains lazy;
- no continuous animation after the page settles.

Routine navigation renders an exact cached target immediately and revalidates it in the background.
An uncached target uses a local non-blocking loading state; it never shows the previous Goal under the
new URL. Query keys include the exact Project, Goal, Work, Attempt, and view identity.

The Route projection excludes canonical Work bodies and full Evidence. Work bodies load only when a
node is opened; design bodies load only when selected in Goal Docs. This keeps polling proportional
to the graph, not to accumulated execution history.

Long streams use bounded caches and virtualization or offscreen rendering. Motion uses opacity or
transform rather than layout or animated shadow. Reduced-motion preferences remove transitions
without removing information.

`bun run build` writes `dist/performance-budget.json` and fails when a delivery budget is exceeded.
Re-measure with a populated directed graph when the Route layout or payload changes.

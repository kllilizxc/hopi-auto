# Frontend delivery performance and motion contract

Frontend performance is a product behavior, not a release-time cleanup step. Measurements use the
production-shaped backend surface on port `3000`; the HMR surface is intentionally excluded because
its development client and unminified modules do not represent remote-device delivery.

## Reproducible baseline

The reference route is a populated Goal with roughly 36 Work cards. A cold run disables the browser
cache, waits for the persistent shell and active surface, then records Navigation/Resource Timing,
CDP main-thread metrics, DOM size, active animations, and requestAnimationFrame gaps for 1.2 seconds.
The mobile profile is 390 × 844 CSS pixels, 4× CPU slowdown, 120 ms latency, 1.6 Mbit/s download and
0.72 Mbit/s upload. Record the route and Work count with every comparison because canonical data
size is part of the result.

The 2026-07-18 pre-optimization baseline was:

| Signal | Desktop local | Controlled mobile |
| --- | ---: | ---: |
| First contentful paint | 72 ms | boot surface rendered before application data |
| Initial JavaScript transfer | 714,428 B | completed at 5.65 s |
| CSS transfer | 303,366 B | shared with desktop |
| Shell-state response | 76,088 B | completed at 7.78 s |
| Full Goal response | 422,529 B | first completed at 9.58 s |
| Board DOM | 645 elements / 36 cards | same logical surface |
| Initial CSS animations | 39 total / 2 continuously running | same logical surface |
| Idle frame gaps over 20 ms | 0 in 1.2 s | measured again after data settles |

On the reference Goal, 365,412 B of the full Goal response was design content, Evidence, artifact
references, and canonical Work bodies that cards do not render. Under the controlled mobile profile,
the fixed two-second poll repeatedly transferred the 422 KB response as soon as the preceding read
finished, so the connection never became quiet.

The verified 2026-07-18 optimized result for the same 36-card Goal is:

| Signal | Verified result |
| --- | ---: |
| Persistent JavaScript build graph | 766.6 KiB |
| Shared CSS | 296.4 KiB |
| Shell-state response | 10,238 B transfer |
| Board response | 23,764 B transfer |
| Goal docs catalog | 45,953 B transfer |
| Selected 2,346-character design document | 2,774 B transfer |
| Desktop FCP | 120 ms |
| Desktop settled frame gaps | 9.8 ms maximum; 0 over 20 ms |
| Controlled-mobile FCP | 3.396 s |
| Controlled-mobile first Work card | 6.636 s |
| Controlled-mobile shell → first Work card | 408 ms |
| Controlled-mobile initial Board DOM | 190 elements / 2 adjacent-Lane cards |
| Settled continuous animations | 0 |

The Board transfer is 94.4% smaller than the previous full-Goal response. Desktop still mounts all
36 cards and measured 622 DOM elements; compact rendering intentionally defers the distant completed
Lane while retaining all four Lane shells and counts. Reduced-motion verification reported zero
running animations and a 0.01 ms tab-indicator transition.

## Delivery budgets

- The persistent shell's raw production JavaScript stays at or below 800 KiB and shared CSS at or
  below 320 KiB. Lazy route chunks are not charged to the shell budget; `build.ts` reports and gates
  both totals so growth is visible in every build.
- Lazy Goal, Project, and Assistant modules prefetch only from explicit navigation intent—hover,
  keyboard focus, or touch/pointer down. Compact startup does not download every hidden surface in
  an idle callback.
- Routine Goal, Work, and Attempt switching never replaces an already usable surface with a cold
  loading screen. Cached data renders immediately while refreshing; an uncached target is warmed
  behind the current surface, and only the latest requested target may commit navigation.
- Assistant, Attempt, and Reflection streams persist their latest successfully rendered page—and
  the Work's small Attempt index—in a bounded browser-session LRU keyed by exact stream identity.
  Re-entry and same-tab reload render that snapshot before issuing incremental synchronization;
  cache data never crosses streams and never becomes canonical product state.
- Reflection diagnostics are a nested lazy surface. Opening the ordinary Assistant does not load
  Reflection list/detail code or start its queries; that boundary is crossed only when the operator
  explicitly opens the debug stream.
- The Board reads a card projection, not the document reader projection. For the reference 36-card
  Goal it stays below 80 KiB and never includes design content, Goal Evidence bodies, artifact lists,
  canonical Work bodies, or Goal Attention bodies. Cards retain only open Attention status and the
  reference needed to route the operator to Assistant. A Work body is read only when its contract
  pane is opened. Compact
  Kanban mounts the selected Lane and its immediate neighbors; selecting a Lane advances that
  window before the next horizontal gesture, so distant card lists do not tax the first frame.
- Goal docs reads a document catalog containing paths and short display excerpts. It does not poll
  Work, Attention, artifact, design-body, or Evidence-body data. The selected design document is
  fetched independently and cached by path plus contract revision; changing the catalog never
  re-downloads every canonical document.
- The shell projection does not transfer Attention bodies. Assistant Attention detail is read only
  while Assistant is mounted and visible.
- Active canonical projections may poll every two seconds. Settled Goal projections back off to
  fifteen seconds, inactive live streams stop, and browser-hidden polling remains disabled. A slow
  request must never create an overlapping request for the same query.
- On the controlled mobile profile, the already-downloaded shell should expose the Board no more
  than 1.5 seconds after its shell-state request finishes. Cold Board readiness should remain below
  7.5 seconds for the reference route, with a visible non-modal boot/loading surface throughout.
- A settled 1.2-second frame sample has no gap above 50 ms. Ordinary route, card, disclosure, and
  feedback interaction does not create layout animation on the main thread.

Budgets are regression ceilings, not targets to fill. A change that stays below a byte or timing
ceiling can still be rejected when it adds work without improving the interaction.

## Motion language

Motion communicates continuity, selection, or genuinely live work. It never decorates every item in
a long list.

- Durations and easing come from the semantic motion tokens in `styles/theme.css`. Page and modal
  entrances finish within 260 ms; direct hover, press, and selection feedback finishes within 160 ms.
- A surface may animate once when it replaces another surface. Cards in a populated lane do not each
  run mount animations, and polling never replays an entrance.
- Repeated status animation is reserved for one currently running progress segment or one tail-only
  Assistant activity indicator. It uses opacity and transform only; the surrounding card remains
  still.
- Hover lift runs only on devices that actually support hover. Touch interaction uses pressed/focus
  feedback without leaving a synthetic hover transform behind.
- `prefers-reduced-motion: reduce` removes continuous and spatial motion while preserving selection,
  progress, loading, and Attention information.

## Verification

The frontend check covers projection shape, adaptive polling, bundle ceilings, compositor-safe
motion, and reduced motion. Browser verification repeats the reference desktop and controlled-mobile
profiles, exercises Project/Goal/tab navigation and card expansion, and records the audit trail's
final hash without editing prior records.

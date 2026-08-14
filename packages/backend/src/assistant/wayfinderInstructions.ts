/**
 * Faithful HOPI-native adaptation of the Wayfinder skill. Only the physical
 * tracker primitives are translated: issue -> document, child issue -> Work,
 * assignee -> claim, and native blocking -> dependsOn.
 */
export const WAYFINDER_ASSISTANT_INSTRUCTIONS = `## Wayfinder

A loose idea has arrived—too big for one Worker Run, and wrapped in fog: the way from here to the destination is not visible yet. Wayfinding is about finding that way, not charging at the destination. It charts the way as a shared Map of Decision Work—questions whose resolution is a decision, not slices of a build to execute—one dependency-consistent frontier round at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting. It shapes every Decision. It might be a spec to hand off and iterate on, a decision to lock before execution starts, or a change made in place. The Map is domain-agnostic.

### Plan, do not execute

Wayfinder is planning by default: each Decision resolves a question, and the Map is done when the way is clear—nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal that the edge of the Map has been reached and it is time to create actionable Engineering Work. An effort may override this in Notes, carrying execution into the Map itself, but absent that, produce decisions, not deliverables.

### Refer by name

Every Map and Work has a title. In everything the operator reads, including Decisions so far, refer to it by that name, never by a bare id or slug. IDs remain inside links and tool calls; names read at a glance.

### The Map

The canonical Map is design/index.md. Decision Work belongs to that Map. The Map is an index, not a store: it lists decisions made and points at the Decision Work that holds their detail. A decision lives in exactly one place, so the Map never restates it; it only gists it and links it.

The Map has exactly these ordered sections: Destination, Notes, Decisions so far, Not yet specified, and Out of scope. Destination is one or two lines describing what reaching the end looks like. Notes holds domain guidance and standing preferences. Decisions so far is one linked line per completed Decision: enough to judge relevance, then zoom into the Work for detail. Not yet specified holds in-scope fog that cannot be made precise yet. Out of scope holds work consciously ruled beyond the destination.

### Decision Work

Each Decision Work body is one precise Question with its own durable Resolution. Its decisionType is research, prototype, grilling, or task.

- Research is AFK: read documentation, APIs, repositories, or knowledge sources to surface a fact a decision waits on. Request a bounded read-only or no-workspace Worker Run, then judge its Report; never trust it automatically.
- Prototype is HITL: make the cheapest rough concrete artifact that raises the fidelity of discussion, link it, and obtain the operator's reaction before resolving the Decision.
- Grilling is HITL: claim every takeable Grilling Decision in the current Goal with a separate Work Attention, then present the whole set in one numbered round. Give a recommended answer for each question, while leaving acceptance to the operator.
- Task may be AFK or HITL: manual work that must happen before a decision can be made. It earns its place by unblocking a decision, never by delivering the destination.

A Decision is claimed before any work so concurrent turns skip it. In HOPI, a queued or running Run is the claim for AFK Work; an unresolved Work Attention is the claim for HITL Work. dependsOn is the native blocking relationship. A Decision is unblocked when every dependency is done; the frontier is the open, unblocked, unclaimed Decision Work at the edge of the known.

### Fog of war

The Map is deliberately incomplete: do not chart what cannot yet be seen. Beyond live Decisions lies the fog of war—the dim view of decisions and investigations that are coming but cannot yet be pinned down because they hang on questions still open. Resolving a Decision clears the fog ahead of it, graduating whatever is now specifiable into fresh Decision Work until the way is clear and no Decisions remain.

Not yet specified is where that dim view lives. Fog or Decision? The test is whether the question can be stated precisely now—not whether it can be answered now. Create Decision Work when the question is already sharp, even if blocked. Keep it in Not yet specified when the question cannot yet be phrased that sharply. Do not pre-slice fog into speculative Work. Not yet specified excludes what is already decided, what is already live Work, and what is out of scope.

### Out of scope

Fog only gathers toward the destination. Work beyond it is out of scope, not fog. Out-of-scope work never graduates. When existing Decision Work proves to sit past the destination, cancel it and add one linked line under Out of scope explaining the boundary. Do not add it to Decisions so far, because a scope boundary is not a step on the route.

### Chart the Map

1. Name and settle the destination first; it fixes the scope.
2. Explore breadth-first across the whole space rather than deeply down one branch, surfacing open decisions and the first steps takeable now.
3. If this surfaces no fog and the whole journey fits one Worker Run, create no Map and proceed directly with one Engineering Work.
4. Otherwise create the Map with Destination and Notes filled, Decisions so far empty, and the fog sketched in Not yet specified.
5. Create every Decision that can be stated precisely now, then wire dependsOn in a second pass because Work identities must exist before edges can reference them.
6. Request every unblocked Research Run so research may proceed in parallel.
7. Open one targeted Attention for every frontier Grilling Decision and present them together as one numbered round, with a recommended answer for each question.
8. Stop. Charting does not hand-resolve a Decision.

### Work through the Map

1. Load the low-resolution Map, not every Decision body.
2. When the operator replies to a presented Grilling round, zoom into those referenced Works and related Evidence. Record each answered Decision's own Resolution, close its Attention and Work, and append one linked gist per Decision to Decisions so far. Never collapse the round into a synthetic Decision.
3. Re-read canonical state after settling the round. If the operator explicitly named a takeable Decision, limit the next round to it; otherwise use the current Goal frontier.
4. Request all selected frontier Research Decisions as separate Worker Runs so they proceed in parallel.
5. Claim every selected frontier Grilling Decision with its own targeted Attention, then present all those Attentions together as one numbered round in one present_attention_to_user call. Give a recommended answer for each question, but never invent operator acceptance. A question whose answer depends on an unresolved Decision belongs to a later round.
6. Handle at most one selected Prototype or Task Decision in the turn, claiming it before work and resolving it according to its type.
7. Create newly surfaced Decisions first, wire dependencies second, and remove graduated fog from Not yet specified so it exists in one place only.
8. If the answer exposes Work beyond the destination, rule it out of scope. If it invalidates other parts of the Map, revise or cancel them.

Research Runs and Grilling questions are the frontier-wide concurrency cases. Each retains a separate Attempt or Attention and a separate Resolution; a Grilling batch changes interaction latency, not Work identity or dependency semantics. Expect concurrent activity and re-read current canonical state before every mutation.`

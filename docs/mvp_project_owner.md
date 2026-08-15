# Project Assistant And Wayfinder

Status: semantic behavior authority
Last updated: 2026-08-15

The Project Assistant is the only semantic supervisor. It speaks with the operator, reads canonical
state, uses Wayfinder when the route is unclear, explicitly requests Workers, judges Reports, and
raises Attention. There is no Planner role or Goal Supervisor service.

## Wayfinder concepts

A loose idea may be too large for one session and wrapped in fog. Wayfinding finds the route to the
destination; it does not charge at the destination.

- The **Map** is one optional `design/index.md`, the shared low-resolution index.
- A **Decision Work** is one precisely stated question with its own durable Resolution.
- The **frontier** is the set of open, unblocked, unclaimed Decision Works.
- **Fog** is in-scope uncertainty that cannot yet be phrased as a precise question.
- **Out of scope** lies beyond the destination and never graduates into Work unless the destination
  is explicitly redrawn.

Always refer to Map and Work by human-readable title in operator-facing text. Ids ride inside links
and tool calls; they never replace names.

## Plan, do not execute

Decision Work resolves decisions rather than delivering slices of the destination. Wanting to start
implementation usually means the Assistant has reached the edge of the map and should create
Engineering Work. Map Notes may explicitly override this and carry execution inside the map.

## Decision types

- **Research** (`afk`): obtain facts outside the current conversation or repository context. Resolve
  through an explicit Worker Run, normally parallel with other research.
- **Prototype** (`hitl`): create a cheap concrete artifact to make a design discussion higher
  fidelity. The human reacts to the artifact; the Assistant cannot invent that reaction.
- **Grilling** (`hitl`): ask the whole current Grilling frontier in one dependency-safe round. Each
  question keeps its own Work and Attention, and the human speaks for themselves. This is the
  default.
- **Task** (`afk` or `hitl`): prerequisite manual work needed before a decision can be made. It may
  unblock the route but must not quietly deliver the destination.

## Chart the map

Charting is one Assistant session:

1. Name the destination. Grill until it is precise enough to fix scope.
2. Explore breadth-first across the space and identify the first precise decisions plus coarse fog.
3. If there is no fog and the whole route fits one session, do not create a Map. Ask or proceed with
   the clear Engineering Work as appropriate.
4. Otherwise create the Map with Destination, Notes, empty Decisions so far, Not yet specified, and
   Out of scope.
5. Create every Decision Work whose question is precise now.
6. Wire dependencies in a second pass, after ids exist.
7. Explicitly request Worker Runs for all frontier Research decisions in parallel.
8. Open one targeted Attention for every frontier Grilling decision and present them together as one
   numbered round, with a recommended answer for each question.
9. Stop. The charting session resolves no Decision Work.

For a newly created Goal, the Goal, Map, and first Decision publish together. Later Decision Works
may be added sequentially during the same serialized Assistant turn; the dispatch barrier prevents
them from starting before charting finishes.

## Work through the map

Advance the Map one dependency-consistent frontier round at a time:

1. Load the Map at low resolution, not every ticket body.
2. If the operator replied to a presented Grilling round, zoom into those referenced Works and
   related evidence. Record each answered Decision's own Resolution, close its Attention and Work,
   and append one linked gist per Decision to Decisions so far. Never merge the round into one
   synthetic Decision.
3. Re-read canonical state after settling the round. If the operator explicitly named a takeable
   Decision, limit the next round to it; otherwise use the current Goal frontier.
4. Request all selected frontier Research Decisions as separate Worker Runs so they proceed in
   parallel.
5. Claim every selected frontier Grilling Decision with its own targeted Attention, then present all
   of those Attentions together as one numbered round. Include the Assistant's recommended answer
   for each question, but never invent the operator's acceptance. A question that depends on an
   unresolved Decision belongs to a later round.
6. Handle at most one selected Prototype or Task Decision in the session. Claim it before work and
   resolve it according to its type.
7. Create newly visible Decision Works and then wire their dependencies.
8. Graduate newly precise fog into those Works and remove it from Not yet specified.
9. Close mis-scoped Work as cancelled and record the scope boundary under Out of scope.

Research Runs and Grilling questions are the two frontier-wide concurrency cases. Each still owns a
separate Attempt or Attention and a separate Resolution; batching Grilling changes interaction
latency, not Work identity or dependency semantics.

Project supervision is isolated across Projects. A turn, wake, settlement observation, Attention,
or other scheduling barrier in one Project cannot hold another Project; only the shared Worker
capacity budget is global.

## Handoff to Engineering

When no decision remains between the current state and an actionable build, the Assistant creates
Engineering Work with explicit objective, acceptance criteria, and dependencies on the decisions
that justify it. It does not execute Engineering merely because it became ready; requesting a Run
is a separate semantic judgment.

## Report judgment

A Worker Report is evidence, not a command. After settlement the Assistant may:

- resolve the Decision;
- request another bounded Run with corrected instructions;
- create or rewire Decision Work exposed by the findings;
- request review;
- complete Engineering through C1;
- ask the operator through Attention;
- cancel work that is now outside the destination.

Natural language is preferred. Structured state is used only for identity, dependency safety,
claims, runtime lifecycle, and publication.

## Interruptions

Only genuinely outcome-changing user input interrupts the operator. Questions from different Goals
remain separate Attentions, while the Assistant may merge their presentation. A user reply is never
silently treated as a Work mutation.

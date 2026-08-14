# HOPI Assistant

Status: Assistant boundary authority
Last updated: 2026-08-14

## Mental model

The operator speaks with one HOPI Assistant. Home conversation handles project selection and global
questions; each Project has a durable speaking session and serialized supervision queue. Sessions
are context caches. Canonical documents, Inbox events, Attempts, and Attentions are authority.

The Project Assistant is a PMO and semantic supervisor, not an execution worker. It may read state,
chart a Wayfinder Map, create Work, request bounded Worker Runs, judge Reports, update contracts,
complete or cancel Work, and ask the operator.

## Context boundaries

The Assistant receives bounded conversation history plus compact current Project and Goal indexes.
It retrieves full Goal, Work, Map, Report, or evidence content through tools only when needed. It
must not preload every Goal or every Run transcript.

Provider-native session resume is a cache optimization. Handoff or rebuild preserves visible
conversation while discarding provider context. No effect depends only on remembered chat.

## Wayfinder behavior

When the route is unclear, the Assistant follows the original Wayfinder loop defined in
[mvp_project_owner.md](./mvp_project_owner.md): destination first, breadth-first charting, precise
Decision tickets, coarse fog, create-then-wire dependencies, parallel research, and no hand-resolved
ticket in the charting session.

When working a Map it loads the low-resolution Map and advances one dependency-consistent frontier
round. Independent Research Decisions may receive separate Runs in parallel, and every takeable
Grilling Decision receives its own Attention but is presented in one operator round. One reply may
resolve every answered Grilling Decision separately before the Assistant recomputes the frontier;
dependent questions wait for the next round. Prototype and Task Decisions remain single-Work
activity.

These are Assistant behavioral instructions. The kernel enforces only identity, DAG validity,
claims, lifecycle, workspace safety, and publication.

## Tool surface

The minimal semantic tools are:

- list/read Project, Goal, Map, Work, Attempts, Reports, evidence, and Attention;
- create Goal with either direct Engineering Work or Map plus first Decision;
- revise the Goal contract;
- write supporting design Markdown;
- create Decision or Engineering Work;
- set Work dependencies or schedule;
- request a generic Run with explicit workspace mode and instruction;
- record a Decision Resolution and optional Map update;
- complete Engineering through C1;
- cancel Work or Goal;
- create, continue, resolve, or cancel Attention;
- pause, resume, reopen, and prioritize Goal.

There are no tools for Planning admission, lane movement, generate/review focus, start-review,
return-to-generate, role selection, or automatic workflow progression.

## Communication

The Assistant communicates outcomes and meaningful decisions, not internal tool choreography. It
uses Work titles rather than bare ids, distinguishes a requested action from an applied effect, and
does not claim completion before canonical publication succeeds.

It interrupts only for a real operator dependency, important deviation, blocker, or completion.
Routine Worker settlement is handled in the Project supervision queue.

## Recovery

Every side effect is reconstructable from durable records. On context exhaustion the Assistant
rebuilds from bounded public conversation plus current canonical state. On process restart it
reconciles active Attempts and pending Inbox events before admitting later Runs.

## Non-goals

- hidden model memory as authority;
- one long-running Goal agent;
- a second semantic router;
- a Planner/Generator/Reviewer stage machine;
- automatically trusting Worker output;
- parsing free prose into kernel state;
- compatibility with superseded schemas.

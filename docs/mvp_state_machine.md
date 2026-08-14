# HOPI State Model

Status: deterministic state authority
Last updated: 2026-08-14

## Goal

```text
active <-> paused
active|paused -> done
active|paused -> cancelled
done|cancelled -> active only through explicit reopen and contract revision
```

Resume and reopen do not manufacture Planning Work. They wake the Assistant to inspect the current
route.

## Work

```text
open -> done
open -> cancelled
```

Kind and identity are immutable. Dependencies of open Work may be rewired while preserving the DAG.
Terminal Work is fully immutable.

## Derived Work state

For presentation and admission, one open Work derives exactly one state in precedence order:

1. `needs_user`: unresolved Work-targeted Attention;
2. `running`: running Attempt;
3. `queued`: queued Attempt;
4. `blocked`: Goal inactive, stale contract revision, or missing/cancelled/open dependency;
5. `scheduled`: no harder blocker exists and `notBefore` is in the future;
6. `waiting_assistant`: the latest Attempt matches current Work authority and awaits judgment;
7. `ready`: all admission facts are satisfied and no current Run result awaits judgment.

Done and cancelled are terminal projection states. No derived state is written into Work Markdown.

## Attempt

```text
queued -> running -> settled
queued -> settled
```

The separate termination fact records `normal`, `cancelled`, `interrupted`, `crashed`, or
`timed_out`. An active Attempt claims exactly one Work. Restart settles orphaned active Runs
deterministically; it never resumes a provider session as hidden authority.

## Attention

```text
open -> resolved
open -> cancelled
```

An open Work-targeted Attention claims the Work for HITL activity. A reply creates an Inbox event;
only a subsequent Assistant judgment resolves the Attention or changes Work.

## Cancellation

Cancelling Work also cancels every open descendant that depends on it, across Decision and
Engineering kinds, in reverse topological order. Active Runs are interrupted and open Attentions
are closed through their own deterministic operations.

## Restart

After restart, canonical documents, Attempts, Attentions, and Inbox events reconstruct the complete
route and claims. No model call, saved board state, or provider session is needed.

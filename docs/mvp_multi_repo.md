# HOPI Multi-Repo Projects

Status: topology and integration authority
Last updated: 2026-08-14

A Project is one ordered set of bound Git Repos with exactly one primary Repo. Goal and Work
semantics remain Project-wide: HOPI does not create Repo-local boards, Work roles, or workflows.

## Canonical topology

`.hopi/project.yml` records the Project id, primary Repo id, Repo ids, optional sub-project paths,
and release commits for secondary Repos. The primary release is represented by the Project C1 ref;
secondary release commits are explicit. Repo ids and order are stable within a binding revision.

`.hopi/docs/repos.md` is optional semantic guidance about ownership and cross-Repo relationships.
It helps models reason; it is not routing authority.

## Runtime projection

Every repository-backed Run receives the complete Project Repo manifest. HOPI never asks a Work to
maintain a restricting Repo subset. A workspace mode applies to the whole projection:

- `read_only`: inspect all roots, accept no source delta;
- `isolated_write`: create stable task worktrees for all roots and checkpoint actual deltas;
- `none`: no checkout; release roots may still be named as read-only context when required.

The primary Project path is the Worker cwd. Other roots are explicit in `HOPI_REPOS_FILE`; parent or
sibling scanning is forbidden.

## C1 publication

Engineering completion is one logical multi-Repo operation:

1. freeze current Goal, Work, Project topology, release heads, and task heads;
2. preflight every candidate source delta against its Repo release;
3. build secondary component commits without moving release refs;
4. build the primary C1 commit containing primary source, canonical documents, and updated secondary
   release commits in `project.yml`;
5. atomically move the primary release ref;
6. materialize secondary release refs and managed worktrees to the commits named by C1;
7. recover idempotently after a crash by treating the reachable primary C1 as authority.

Before the primary ref moves, a conflict is a clean rejection and Work stays open. After it moves,
failure is `blocked_after_boundary`; recovery completes projections from the immutable C1 rather
than pretending rollback occurred.

## Rebinding

Repo add/rebind is an explicit Project command. It makes the affected Project temporarily
ineligible, interrupts its active Runs, validates the new topology and release heads, publishes one
new binding, rebuilds runtime projections, then restores eligibility. Other Projects continue.

No model invents missing Repos, release heads, or integration order. The Assistant may propose a
topology change; deterministic command and C1 code own its effects.

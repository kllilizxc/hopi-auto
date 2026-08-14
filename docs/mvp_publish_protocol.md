# HOPI Publication Protocol

Status: atomic publication ADR
Last updated: 2026-08-14

HOPI has one in-process publication coordinator per canonical root. Documents remain the source of
truth; publication supplies serialization, compare-and-swap, validation, and recovery.

## Transaction shape

A publication contains zero or more supporting writes and at most one gate write. Every write names
an expected content hash (`null` means create). Under the root lock HOPI:

1. snapshots the current authority and generation;
2. checks every expected hash;
3. overlays all writes in memory;
4. parses and validates the complete candidate Goal/Project package;
5. optionally runs a narrow deterministic transition validator;
6. writes files through temporary siblings and atomic rename;
7. advances the in-memory generation and invalidates projections.

The gate is an ordering convention, not a semantic workflow stage. For example, a Decision
completion may update the Map as a supporting write and close the Work as the gate; either both
become visible or neither does.

## Concurrency

Only explicit hashes and immutable ids coordinate concurrent callers. A stale caller receives a
conflict and must reread current authority. Publication never merges prose, guesses intent, retries
semantic commands, or translates old schemas.

## Git boundary

Ordinary canonical publications update the managed Project release through the publication
coordinator. Engineering completion additionally uses C1 so source commits and the completed Work
cross one durable Git boundary. Reachable C1 history is the recovery authority after an uncertain
process crash.

## Recovery

Temporary files are non-authoritative and may be removed after restart. Canonical files plus the
release ref reconstruct the accepted state. If a process dies after C1 ref movement, HOPI detects
the reachable integration marker and idempotently rematerializes Repo projections. It never writes
an inverse transaction merely to simulate atomic rollback.

## Validation boundary

Deterministic validation covers schema, identity, lifecycle, DAG acyclicity, immutable history,
expected hashes, path ownership, and release provenance. Whether a Report answers a question or an
implementation satisfies the Goal remains the Assistant's semantic judgment expressed through an
explicit subsequent command.

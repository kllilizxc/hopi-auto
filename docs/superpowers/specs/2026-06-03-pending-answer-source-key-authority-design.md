# Pending Answer-Source Key Authority Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Strengthen `pending_answer_sources` so ordered reusable source entries stop behaving like anonymous list items once they already carry explicit durable key authority.

## Why This Slice Exists

The reusable-source substrate already had three relevant properties:

- `pending_answer_sources` could feed more than one known consumer by stable order
- `matching_answer_sources` could already honor explicit keys when targeting known consumers
- `matching_answer_sources` and its leftover path could already merge adjacent reusable source entries under explicit durable key authority

But one asymmetry remained:

- if ordered reusable sources already carried explicit `decisionKey`, `answerKey`, or `summaryKey`, `pending_answer_sources` still consumed them blindly by position

That left two avoidable failure modes:

- two adjacent ordered reusable source entries for the same known consumer were split across two consumers instead of merged
- a wrong-key reusable source entry could silently bind to the next consumer just because it appeared next in order

The long-term authority route should prefer explicit durable key authority over blind positional consumption whenever that authority is already present.

## Constraints

- keep `pending_answer_sources` as the ordered reusable-source surface
- do not invent a new `sourceResponseFormat`
- preserve existing order-only behavior when the next reusable source entry has no explicit durable key authority
- do not broaden into fuzzy matching
- fail closed when explicit ordered keys contradict the next known consumer

## Implemented Scope

### Ordered Reusable Sources Now Honor Explicit Durable Keys

When the next unconsumed `pending_answer_sources` entry already carries explicit durable key authority, runtime now validates that authority against the next known consumer instead of consuming the entry blindly by order.

This applies to:

- decision-side ordered pending consumers through explicit `decisionKey` or `summaryKey`
- planner-side ordered pending consumers through explicit `answerKey` or `summaryKey`

If the explicit durable key does not match the next known consumer, runtime now fails closed.

### Adjacent Ordered Entries Can Merge Into One Known Consumer

When adjacent `pending_answer_sources` entries all explicitly point at the same next known consumer, runtime now merges them into one answer with blank-line separation instead of advancing to the next consumer after the first entry.

This lets one known ordered consumer receive more than one reusable snippet without switching to `matching_answer_sources`.

### Non-Contiguous Repeats Fail Closed

If ordered reusable source entries explicitly point at one known consumer, then another entry intervenes, and then the same explicit authority appears again later, runtime now raises an explicit error instead of silently treating the later entry as the next consumer or leaving it behind.

That keeps ordered explicit authority aligned with the same contiguous-only merge rule already enforced elsewhere in the reusable-source substrate.

### Order-Only Behavior Still Exists For Anonymous Entries

When the next `pending_answer_sources` entry has no explicit durable key authority, runtime keeps the original ordered behavior:

- consume one entry
- advance one consumer

This slice only changes the branch where explicit durable keys already exist.

## Non-Goals

- changing `matching_answer_sources`
- grouping anonymous ordered reusable source entries by heuristics
- broadening prompt-only or summary-only ordered grouping
- changing leftover `pending_answer_sources` inference in this slice
- adding fuzzy recovery when explicit ordered keys conflict

## Acceptance Criteria

- `pending_answer_sources` merges adjacent ordered reusable source entries into one known decision consumer when they share explicit durable key authority for that consumer
- `pending_answer_sources` merges adjacent ordered reusable source entries into one known planner-answer consumer when they share explicit durable key authority for that consumer
- explicit ordered reusable source keys that conflict with the next known consumer now fail closed
- non-contiguous repeats of the same explicit ordered reusable source authority now fail closed
- existing anonymous ordered reusable-source behavior still works when no explicit durable key authority is present

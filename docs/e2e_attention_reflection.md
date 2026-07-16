# Attention → Reflection → Speaking Assistant E2E Test Plan

## 1. Purpose

Verify the complete clarification loop introduced by the Assistant coordination design:

```text
Role pass
  → targeted Attention
  → Reflection assessment on a stable snapshot
  → durable internal Speaking Assistant inbox event
  → Assistant resolves internally or asks the user
  → user answer or “skip”
  → atomic Input + Attention Resolution
  → blocked Work becomes runnable again
```

The test boundary includes the browser UI, HTTP API, coordinator, canonical documents, Role pass
processing, Reflection, the persistent Speaking Assistant session, and optional webhook delivery.
Raw Attention content must never be treated as user-facing output.

This document defines test cases only. A case is not `PASSED` until it has been executed through
Playwright with the evidence required in section 5.

## 2. Risks and assumptions under test

The design depends on several assumptions that must be tested rather than inferred from unit tests:

1. A model-generated `attention` pass does not advance stage or consume an attempt.
2. Reflection completion is not equivalent to delivery. Only a stable handoff creates an internal
   Speaking Assistant event.
3. A user message does not interrupt Reflection, but it takes priority over an internal Speaking
   Assistant turn.
4. The Speaking Assistant can safely translate one or several raw Attentions into one coherent user
   question without leaking internal prompt text.
5. Resolving an Attention publishes both the user's raw Input and the Assistant's contextual
   Resolution atomically.
6. “Skip” is ordinary user input, not a separate UI or state-machine path.
7. Restart recovery is based on durable canonical state and inbox events, not process memory.
8. A failed historical internal handoff is local to its event and cannot suppress notification of
   later Attention in the same Goal, another Goal, or another Project.

## 3. Required deterministic test harness

Do not run these cases against uncontrolled production models. Model variability would make failures
non-reproducible and could hide ordering bugs.

The E2E environment must provide a deterministic transport script with these controls:

| Control | Required behavior |
| --- | --- |
| `planner_attention` | Planner emits one valid targeted Attention with a known question |
| `multi_attention` | Two roles emit independent Attentions under the same Goal |
| `reflection_hold` | Reflection starts and waits until explicitly released |
| `reflection_fail_once` | First Reflection run fails; the next run succeeds for the same digest |
| `reflection_stale` | Reflection prepares a handoff while canonical state is changed before completion |
| `assistant_resolve` | Speaking Assistant resolves from existing documents without asking the user |
| `assistant_ask` | Speaking Assistant asks one consolidated public question |
| `assistant_skip_default` | Speaking Assistant interprets “跳过” using the declared safe recommendation |

The fixture must create an isolated Home, Project, Goal, Repo checkout and webhook recorder. It must
expose fixture controls through test-only endpoints or a test process API. Production routes must not
contain fault-injection behavior.

If this harness does not exist when execution begins, cases requiring it are `BLOCKED`; the evaluator
must not substitute timing sleeps or a real model.

## 4. Environment and preflight

- Repository root: `/Users/realizer/Code/hopi-auto`
- Start command: `bun run dev`
- Target URL: read the actual listening URL from server output; do not assume a port.
- Authentication: local application session; record any required credentials before execution.
- Browser: Chromium through `playwright-cli`.
- Artifact directory: `artifacts/e2e/attention-reflection/`.
- Canonical-state evidence: copy relevant Goal package and Assistant workspace documents into the
  artifact directory after each state transition. Redact secrets, but do not rewrite state.
- Reflection evidence: use `/api/debug/reflections` and the corresponding Reflection event endpoint.

Preflight commands must be adapted to the URL printed by the server and recorded verbatim:

```sh
playwright-cli open <target-url>
playwright-cli snapshot
playwright-cli close
```

Before each case, reset the isolated fixture. Never share Goal, Attention, inbox, or webhook state
between cases.

## 5. Evidence gate

For every case, retain:

- exact Playwright CLI command trace and exit codes;
- full-session `.webm` video;
- at least one screenshot after each meaningful visible state change;
- observed UI text and expected-versus-actual comparison;
- browser console errors and failed network requests;
- relevant canonical document snapshots;
- relevant Reflection manifest/events and Speaking Assistant inbox event IDs.

Snapshot YAML is useful for element discovery but is insufficient by itself. Without screenshot and
video evidence, the result is `NOT_RUN` or `BLOCKED`, never `PASSED`.

## 6. Test cases

### E2E-01 — A role requests clarification without advancing Work

**Fixture:** `planner_attention`.

**Steps:**

1. Open the seeded Goal board and record the Work stage and attempt count.
2. Release the Planner pass that returns `result: attention` and one targeted Attention.
3. Wait for the board to settle through observable API/UI polling; do not use a fixed sleep as the
   assertion mechanism.
4. Inspect the Work card, Assistant conversation and canonical Goal package.

**Expected:**

- Work displays `Waiting for Assistant`.
- Stage and attempt count are unchanged.
- Exactly one unresolved targeted Attention exists.
- The raw Attention body is absent from the public Assistant conversation and board.
- No `replan` pass or planning-guard Work is created.

### E2E-02 — Stable Reflection handoff is processed by the same Speaking Assistant

**Fixture:** `planner_attention` followed by `assistant_ask`.

**Steps:**

1. Trigger the Attention and observe a Reflection run.
2. Wait until Reflection records a successful stable digest and handoff.
3. Inspect the internal inbox event and then the public Assistant conversation.

**Expected:**

- Reflection prompt/brief remains internal.
- One durable internal event references the Attention and observed digest.
- The persistent Speaking Assistant handles that event; no third conversational session is created.
- The UI receives only the Assistant's user-oriented question.
- The question includes necessary context, recommendation and trade-off, without copying raw internal
  instructions.

### E2E-03 — User message does not interrupt Reflection

**Fixture:** `reflection_hold` and `assistant_ask`.

**Steps:**

1. Trigger an Attention and hold Reflection after it starts.
2. While Reflection is running, send `我补充一下：必须兼容离线模式` in the Assistant UI.
3. Verify the public user event becomes pending/handled normally.
4. Release Reflection and observe its final status and subsequent coordinator ordering.

**Expected:**

- Reflection is not marked interrupted or cancelled.
- The user event is processed before any pending internal Speaking Assistant event.
- Reflection may complete, but the Speaking Assistant revalidates its brief against current state.
- The final user-facing message accounts for the new offline requirement or safely suppresses a stale
  question.

### E2E-04 — Stale Reflection handoff is discarded and rerun

**Fixture:** `reflection_stale`.

**Steps:**

1. Start Reflection for digest A and hold it before completion.
2. Change canonical state so the semantic digest becomes B.
3. Release the run for digest A.
4. Observe Reflection history, inbox events and the next Reflection run.

**Expected:**

- The run for digest A may finish, but creates no Speaking Assistant handoff event.
- A new Reflection run assesses digest B.
- Only the stable digest B can produce a durable internal event.
- The user sees no duplicate or stale question.

### E2E-05 — Reflection failure retries the same digest

**Fixture:** `reflection_fail_once`.

**Steps:**

1. Trigger an Attention and wait for the first Reflection run to fail.
2. Record its digest and failure state.
3. Without changing canonical state, wait for coordinator retry.
4. Observe the second run and resulting handoff.

**Expected:**

- Failure does not mark the digest assessed.
- A later run retries the same digest and succeeds.
- Exactly one internal handoff is created after success.
- No failure stack or raw Attention is exposed in the public conversation.

### E2E-06 — Multiple Attentions become one coherent user clarification

**Fixture:** `multi_attention` and `assistant_ask`.

**Steps:**

1. Trigger two independent Attentions under the same Goal before Reflection settles.
2. Observe the stable Reflection brief and internal event references.
3. Inspect the public Assistant message.

**Expected:**

- The handoff references both Attention IDs.
- The Speaking Assistant asks all currently actionable independent questions in one message.
- Dependent branches are not asked prematurely.
- The UI does not render separate raw Attention cards.
- Both affected Works remain `Waiting for Assistant` until their questions are resolved.

### E2E-07 — User answer publishes Input and Resolution atomically

**Fixture:** `planner_attention` and `assistant_ask`.

**Steps:**

1. Wait for the Assistant clarification question.
2. Reply with a unique marker: `选择方案 B；缓存上限为 128 MiB。E2E-ANSWER-07`.
3. Observe the public reply and Work state.
4. Inspect canonical Input, Attention and relevant design/decision documents.

**Expected:**

- A durable Input contains the user's raw answer including `E2E-ANSWER-07`.
- The resolved Attention contains a contextual Resolution and references that Input.
- No observable canonical state contains only one half of the Input/Resolution pair.
- The appropriate domain document and `design/decisions.md` are updated when the answer is a design
  decision.
- The Work is no longer `Waiting for Assistant` and can resume without changing its previous attempt
  count merely because clarification occurred.

### E2E-08 — “Skip” uses the safe recommendation without a separate UI path

**Fixture:** `assistant_skip_default` with an explicit safe recommendation.

**Steps:**

1. Wait for a clarification containing a recommended default and trade-off.
2. Confirm there is no Skip button.
3. Send `跳过` as an ordinary chat message.
4. Inspect the resulting Input and Resolution.

**Expected:**

- `跳过` is stored as the raw user Input.
- The Resolution explicitly records which recommended default was adopted and why it is safe.
- The Attention resolves and Work resumes.
- If no safe default exists, the Assistant must not fabricate one; it keeps the Attention unresolved
  and explains the minimum decision still required.

### E2E-09 — Assistant resolves from existing documentation without asking the user

**Fixture:** `assistant_resolve`; seed the answer in canonical project documentation.

**Steps:**

1. Trigger an Attention whose answer already exists in project docs.
2. Observe Reflection and Speaking Assistant processing.
3. Inspect public conversation and canonical state.

**Expected:**

- The Assistant resolves the Attention from cited project context.
- No unnecessary clarification question appears in the public conversation.
- Resolution identifies the source used.
- Work resumes normally.

### E2E-10 — Restart preserves unresolved work and pending internal handoff

**Fixture:** `planner_attention` and `reflection_hold`.

**Steps:**

1. Run once with an unresolved Attention; restart and confirm it is recovered.
2. Run again until a stable Reflection internal event exists but before Speaking handles it.
3. Stop the backend cleanly, start it again against the same isolated Home, and reopen the Goal.
4. Wait for coordinator recovery.

**Expected:**

- Attention, digest references and pending internal inbox event survive restart.
- Speaking processes the pending event exactly once.
- No duplicate public question or duplicate Resolution is created.
- Work remains blocked until durable resolution, not merely until process restart.

### E2E-11 — Webhook mirrors only public Speaking Assistant output

**Fixture:** `planner_attention`, `assistant_ask` and webhook recorder.

**Steps:**

1. Trigger the full clarification flow through the public Assistant question.
2. Inspect all webhook recorder requests.
3. Restart delivery processing and inspect requests again.

**Expected:**

- Exactly one webhook payload mirrors the public Speaking Assistant message.
- No payload contains the raw Attention, Reflection brief or internal inbox prompt.
- Delivery checkpoint prevents duplication after retry/restart.

### E2E-12 — Invalid Attention output fails closed

**Fixture:** a role pass with `result: attention` and either no targeted Attention or more than one
targeted Attention.

**Steps:**

1. Release the invalid pass.
2. Inspect Work, pass diagnostics, Attention collection, Assistant conversation and webhook recorder.

**Expected:**

- The pass is rejected as protocol-invalid.
- No partial Attention, handoff or public question is created.
- Stage and attempts do not silently advance.
- A diagnosable internal failure is retained without leaking raw protocol details to the user.

### E2E-13 — A blocked historical handoff does not silence later Attention

**Fixture:** one Reflection-sourced Inbox turn with unresolved event-target Attention, followed by
one independent unnotified Goal Attention.

**Steps:**

1. Persist the blocked internal turn and its event-target Attention.
2. Create the new Goal Attention in the same Goal, another Goal, and another Project variants.
3. Repeat one variant after restarting from the same Home.
4. Let Coordinator, Reflection, and Speaking Assistant converge, then resolve the old event Attention.

**Expected:**

- The blocked event is not retried before its own Attention resolves.
- The new Attention is handed to Speaking Assistant, exposed once, and records `notifiedAt`.
- Resolving the old event allows one current-state revalidation without a duplicate public message.
- The workspace settles without a new loop-exhaustion Attention.

## 7. Cross-case assertions

Run these checks after every case:

- Public UI contains neither `result: attention` nor raw Attention document headings.
- No Work card displays the retired `Needs you` label.
- No newly written pass uses `result: replan`.
- At most one public Assistant message represents a single stable handoff.
- Every resolved Attention either references a durable answer Input or records a documented internal
  resolution source.
- Browser console contains no uncaught exception; relevant API requests have no unexpected 4xx/5xx.

## 8. Execution report template

Write results to `artifacts/e2e/attention-reflection/e2e_test_report.md`:

```markdown
# Attention / Reflection E2E Evaluation Report

## Summary
- Commit:
- Target URL:
- Fixture transport version:
- Total / Passed / Failed / Blocked / Not run:

## Playwright preflight
- Open command:
- Snapshot command:
- Close command:
- Exit codes and raw errors:

## E2E-XX — Name — PASSED | FAILED | BLOCKED | NOT_RUN
- Expected:
- Actual:
- Commands:
- Screenshots:
- Video:
- Canonical state evidence:
- Reflection and inbox IDs:
- Console/network findings:
- Defect and reproduction steps, if any:

## Generated Playwright tests
- Only list scripts generated from dynamically passed flows.
```

After dynamic execution, convert only proven passing flows into permanent Playwright tests. Prefer
user-facing locators such as roles, labels and visible status text; do not bind tests to generated CSS
class names or timing sleeps.

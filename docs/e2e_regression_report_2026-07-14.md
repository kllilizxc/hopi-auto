# HOPI E2E Regression Report: 2026-07-14

Base commit: `07d2d795a9ce03b1e093604d24ac136bfeb31fec`

Result: every scenario with an independent executable runner in the current catalog passed at its
claimed layer. Final repository checks and the complete deterministic Contract suite also passed.
Planned scenarios without an independent runner remain coverage gaps rather than inferred passes.

The retained command-log root is:

```text
/home/kllilizxc/Code/hopi-auto/test-artifacts/full-regression-2026-07-14T05-49-42Z/logs
```

## Final Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `bun run check` | Passed | 278 backend tests with 1,099 assertions; 43 frontend tests with 146 assertions; runtime, types, Biome, and production build passed. Log `27-final-check.log`. |
| `bun run e2e:contract` | Passed | 157 tests with 771 assertions and zero provider calls. Log `28-final-contract.log`. |
| `git diff --check` | Passed | No whitespace errors. Existing CRLF conversion warnings remain informational. |

## Executed Scenario Evidence

### Deterministic Runtime

| Scenario | Result | Retained artifact |
| --- | --- | --- |
| `HOPI-E2E-011` multiple instructions | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/multiple-instructions-2026-07-14T11-32-53-121Z-ed094fac` |
| `HOPI-E2E-012` active design revision | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/design-revision-active-delivery-2026-07-14T11-32-53-118Z-a783e378` |
| `HOPI-E2E-016` process restart | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/restart-during-generator-2026-07-14T11-32-53-158Z-faec050d` |
| `HOPI-E2E-020` configuration rebind | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/configuration-rebind-2026-07-14T11-32-53-165Z-939e7cb4` |
| `HOPI-E2E-025` webhook retry | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/webhook-delivery-retry-2026-07-14T11-32-53-177Z-5ab53eac` |

### Browser

All required screenshots were opened and visually checked; file existence alone was not treated as
presentation proof.

| Scenario | Result | Retained artifact |
| --- | --- | --- |
| `HOPI-E2E-001` Assistant ingress | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/global-assistant-browser-2026-07-14T11-34-01-659Z-8c1fde13` |
| `HOPI-E2E-014` operational recovery | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/operational-recovery-browser-2026-07-14T11-34-32-454Z-b808f0f9` |
| `HOPI-E2E-015` Pause and Resume | Passed after semantic-wait fix | `/home/kllilizxc/Code/hopi-auto/test-artifacts/pause-resume-browser-2026-07-14T12-20-30-660Z-05c70bc8` |
| `HOPI-E2E-023` Cancel and Reopen | Passed after evidence fix | `/home/kllilizxc/Code/hopi-auto/test-artifacts/cancel-reopen-browser-2026-07-14T12-20-59-140Z-f2a2fbf8` |

### Live Agents And Inspection

| Scenario | Reality | Result | Retained artifact |
| --- | --- | --- | --- |
| `HOPI-E2E-002` autonomous delivery | Codex speaking Assistant, Reflection, Planner, Generator, Reviewer, browser, and project test | Passed with every responsibility attempt succeeding first time | `/home/kllilizxc/Code/hopi-auto/test-artifacts/goal-delivery-2026-07-14T12-46-27-273Z-f2d75a55` |
| `HOPI-E2E-003` immutable inspection | Browser and retained truth; zero new model calls | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/goal-delivery-inspection-2026-07-14T11-52-20-291Z-f039b273` |
| `HOPI-E2E-010` page-context boundary | Codex speaking Assistant | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/conversation-page-context-boundary-2026-07-14T11-38-18-627Z-708f68b4` |
| `HOPI-E2E-013` Attention continuation | Codex speaking Assistant, Reflection, and responsibility Agents | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/blocking-attention-continuation-2026-07-14T11-53-39-342Z-ccbd832e` |
| `HOPI-E2E-026` session recovery | Claude speaking Assistant | Passed with a marker withheld from the recovery turn | `/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-14T13-02-16-562Z-dd665414` |
| `HOPI-E2E-026` session recovery | Codex speaking Assistant | Passed with the same vendor-neutral proof | `/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-14T13-03-04-579Z-51102843` |

## Findings And Fixes

1. Browser lifecycle evidence used timing rather than meaning. Pause now waits for Resume to become
   available and for the working indicator to disappear. Reopen now retains both the terminal
   revision and the cancelled archive in browser evidence.
2. Planner staging left avoidable ambiguity around initially empty sparse proposals, zero-byte
   result markers, the owning Planning Work completion gate, compact historical Evidence, and
   terminal Engineering Work. The role contract now states those existing boundaries directly.
   The final delivery run needed no recovered responsibility attempt.
3. Attention `createdAt` was model-authored persistence metadata. Coordinator now normalizes new
   Attention time at publication, while preserving model judgment over the Attention content.
4. Intermediate Assistant prose was projected as public speech. The feed now presents only the
   durable final reply as speech and keeps tool/progress detail in Activity and raw event logs.
5. Concurrent JSONL reads could parse a partially appended final record and return HTTP 500. One
   shared durable reader now defers only an unterminated tail; malformed completed records still
   fail visibly. Assistant turn, Reflection, and Attempt stores use the same rule.
6. The original session-recovery case repeated its expected markers in the recovery instruction.
   The strengthened case withholds all markers and requires the model to recover the newest public
   marker while excluding compacted public and private Reflection history.

These changes reuse existing concepts and boundaries. No new workflow state, retry subsystem,
scenario DSL, or vendor-specific product rule was introduced.

## Model Cost

`HOPI-E2E-002` retained the same eight logical model Runs while removing recoverable prompt
misinterpretations:

| Run | Input | Cached input | Uncached input | Output | Logical Runs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Clean baseline | 815,757 | 603,904 | 211,853 | 18,944 | 8 |
| Final fixed run | 768,756 | 631,168 | 137,588 | 18,673 | 8 |
| Reduction | 47,001 (5.8%) | - | 74,265 (35.1%) | 271 (1.4%) | 0 |

The strengthened `HOPI-E2E-026` canary used 61,500 input and 147 output tokens on Claude, and
58,329 input, 33,280 cached input, and 111 output tokens on Codex.

## Remaining Gaps

1. Catalog rows still marked Planned or Partial do not become Live or Browser successes through the
   global Contract suite. Their missing independent layers remain listed in `docs/e2e_test_cases.md`.
2. The current host has no `opencode` executable, so OpenCode received deterministic transport
   coverage but no Live session-recovery canary in this pass.
3. Live fixes were validated before commit and therefore record `dirty: true` plus an exact
   worktree digest. Final `check` and Contract gates ran against the complete resulting worktree;
   retained provenance makes the tested content auditable.

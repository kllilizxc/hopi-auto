# HOPI E2E Regression Report: 2026-07-14

Examined baseline: `07d2d795a9ce03b1e093604d24ac136bfeb31fec`

Integrated upstream base: `4774800`

Product code under the final clean Live delivery run: `590d283fb3d1499bc187bf622e111d3cb41cc125`

Result: all 16 scenarios with an independent executable runner passed at the layer actually
executed. Planned or Partial catalog rows keep their missing layers; a global Contract pass is not
used to infer Browser, Live, multimodal, or vendor behavior.

The retained command-log root is:

```text
/home/kllilizxc/Code/hopi-auto/test-artifacts/final-integrated-regression-2026-07-14T13-45Z/logs
```

## Final Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `bun run check` | Passed | 289 backend tests / 1,156 assertions; 45 frontend tests / 154 assertions; types, Biome, and production build passed. Log `02-check.log`. |
| `bun run e2e:contract` | Passed | 164 tests / 816 assertions across 18 files; zero provider calls. Log `03-contract.log`. |
| `git diff --check` | Passed | No whitespace errors after the final documentation update. |

The first integrated `check` found only a Planner prompt formatting defect introduced while resolving
the upstream integration. Its retained failure is `01-check-format-failure.log`; `590d283` fixed it
before the passing final gate.

## Executed Evidence

### Deterministic Runtime

| Scenario | Result | Retained artifact |
| --- | --- | --- |
| `HOPI-E2E-011` multiple instructions | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/multiple-instructions-2026-07-14T13-56-56-717Z-23037082` |
| `HOPI-E2E-012` active design revision | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/design-revision-active-delivery-2026-07-14T13-57-24-167Z-1486cebb` |
| `HOPI-E2E-016` process restart | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/restart-during-generator-2026-07-14T13-57-52-455Z-bc709ade` |
| `HOPI-E2E-020` configuration rebind | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/configuration-rebind-2026-07-14T13-58-14-929Z-97a29362` |
| `HOPI-E2E-025` webhook retry | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/webhook-delivery-retry-2026-07-14T13-58-24-692Z-8c881df3` |

### Browser

Each required screenshot was opened and visually checked. File existence alone was not treated as
presentation proof.

| Scenario | Result | Retained artifact |
| --- | --- | --- |
| `HOPI-E2E-001` Assistant ingress | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/global-assistant-browser-2026-07-14T13-58-46-219Z-3e5d6530` |
| `HOPI-E2E-014` operational recovery | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/operational-recovery-browser-2026-07-14T13-59-11-593Z-f0e2cdb9` |
| `HOPI-E2E-015` Pause and Resume | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/pause-resume-browser-2026-07-14T13-59-57-926Z-158fc511` |
| `HOPI-E2E-023` Cancel and Reopen | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/cancel-reopen-browser-2026-07-14T14-01-58-523Z-e2ec5115` |
| `HOPI-E2E-028` Project Attention recovery | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/project-attention-recovery-browser-2026-07-14T13-26-52-980Z-284e9726` |
| `HOPI-E2E-029` terminal provider error | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/assistant-provider-error-2026-07-14T13-28-07-182Z-8becaf32` |

### Live Agents And Inspection

| Scenario | Reality | Result | Retained artifact |
| --- | --- | --- | --- |
| `HOPI-E2E-002` autonomous delivery | Codex Assistant, Reflection, Planner, Generator, Reviewer, browser, and project test | Passed cleanly; every responsibility attempt succeeded first time | `/home/kllilizxc/Code/hopi-auto/test-artifacts/goal-delivery-2026-07-14T14-19-50-381Z-129b3baf` |
| `HOPI-E2E-003` immutable inspection | Browser and retained truth; zero new model calls | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/goal-delivery-inspection-2026-07-14T14-30-49-550Z-1b716569` |
| `HOPI-E2E-010` page-context boundary | Codex speaking Assistant | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/conversation-page-context-boundary-2026-07-14T14-03-18-669Z-1f9f936a` |
| `HOPI-E2E-013` blocking continuation | Codex Assistant, Reflection, Planner, Generator, and Reviewer | Passed through completion | `/home/kllilizxc/Code/hopi-auto/test-artifacts/blocking-attention-continuation-2026-07-14T14-04-38-824Z-44936659` |
| `HOPI-E2E-026` session recovery | Codex Assistant | Passed the withheld-marker history proof | `/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-14T14-13-17-516Z-cd3efc41` |
| `HOPI-E2E-026` session recovery | Claude Assistant | Passed the same vendor-neutral proof | `/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-14T14-14-33-926Z-44810d87` |
| `HOPI-E2E-028` Project Attention recovery | Codex Assistant, Reflection, recovery tool, and Planner wake-up | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/project-attention-agent-recovery-2026-07-14T13-43-21-110Z-fa02c0ba` |

The unique executed scenario IDs are `001`, `002`, `003`, `010`, `011`, `012`, `013`, `014`, `015`,
`016`, `020`, `023`, `025`, `026`, `028`, and `029`.

## Findings And Fixes

1. Browser lifecycle evidence used timing instead of meaning. Pause now waits for Resume and the
   absence of the working indicator. Reopen retains both the terminal revision and cancelled archive.
2. Sparse proposals left avoidable ambiguity. Prompts now explain empty proposal creation,
   zero-byte result replacement, compact historical Evidence, and terminal Engineering Work. The
   integrated design keeps the simpler authority boundary: Planner never edits Planning Work;
   Coordinator validates the proposal and derives the terminal Planning gate.
3. Model-authored Attention time was being trusted as persistence metadata. Coordinator now
   normalizes new Attention `createdAt` values at publication while leaving content judgment to the
   model.
4. Intermediate speaking-Assistant prose appeared as multiple public messages. The ordinary feed now
   presents only the durable final reply as speech and keeps progress, tools, and raw streams in
   Activity and retained logs. Provider retries collapse into one terminal error.
5. Concurrent JSONL reads could parse a partially appended final record. Assistant turn, Reflection,
   and Attempt stores now share one durability rule: defer only an unterminated tail, but fail visibly
   on a malformed completed record.
6. The old session-recovery instruction leaked its expected marker. The Live case now withholds all
   markers, requires the newest public marker, and rejects compacted public and private Reflection
   markers.
7. Upstream Project Attention recovery and terminal provider-error work was integrated rather than
   duplicated. The Codex Live recovery canary now proves the Assistant can inspect external repair,
   resolve canonical Project Attention, and wake Planner.

These fixes add no workflow state, scenario DSL, vendor-specific product rule, or retry subsystem.
They strengthen existing document, Coordinator, feed, and evidence boundaries.

## Model Cost

The final clean `HOPI-E2E-002` run kept the same eight logical model Runs as the original clean
baseline. It used more total input because cached context increased, but less uncached input and less
output:

| Run | Input | Cached input | Uncached input | Output | Logical Runs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Clean `07d2d79` baseline | 815,757 | 603,904 | 211,853 | 18,944 | 8 |
| Final `590d283` run | 862,773 | 679,040 | 183,733 | 14,668 | 8 |
| Change | +47,016 (+5.8%) | +75,136 (+12.4%) | -28,120 (-13.3%) | -4,276 (-22.6%) | 0 |

`HOPI-E2E-028` Live used four logical Runs, of which two reached provider usage: 122,889 input
(79,360 cached; 43,529 uncached) and 1,446 output tokens. Final `HOPI-E2E-026` used 58,571 input
(26,624 cached) and 105 output on Codex, and 61,054 input and 127 output on Claude.

## Remaining Gaps

1. Catalog rows `017`, `018`, `019`, `021`, `022`, `024`, and `027` still lack their planned
   independent Live, Browser, or multimodal layers. Partial rows retain any layers not named as
   executed above.
2. OpenCode has deterministic adapter coverage but no Live canary because its executable is absent on
   this host.
3. Some Live artifacts ran from a retained exact dirty worktree digest containing only the subsequent
   Planner prompt format fix. The final `HOPI-E2E-002` run and final gates used clean `590d283`, so the
   released code path has clean end-to-end provenance.

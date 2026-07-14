# HOPI E2E Test Issue Log

Last updated: 2026-07-14

This append-only file records failures, executions, and environment limits observed while running
the E2E gates. It does not own scenario status: `docs/e2e_test_cases.md` is the single coverage
catalog, and a retained `run.json` is the authority for one invocation. A passing deterministic or
browser preflight is not recorded as a Live Agent success.

Latest verification: `bun run check` passed on integrated `main` at `590d283`: backend **289 passing
tests / 1,156 assertions**, frontend **45 passing tests / 154 assertions**, with type checks, static
checks, and frontend build all passing. `bun run e2e:contract` passed **164 tests / 816 assertions**.

Latest remaining-scenario run: `bun test tests/projectReconciler.test.ts tests/multiRepoC1.test.ts
tests/mvpServer.test.ts tests/assistantReflection.test.ts tests/coordinatorReconciler.test.ts
tests/previewManager.test.ts tests/assistantTools.test.ts tests/roleContextStager.test.ts` passed with
**79 tests / 478 assertions / 0 failures**. This is direct execution evidence for the existing
contract/runtime coverage of `017`, `018`, `019`, `021`, `022`, and `027`; it does not replace their
specified independent Browser or Live layers.

## 2026-07-14: Real Live Baseline

| Scenario       | Result                                                       | Artifact                                                                                        |
| -------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `HOPI-E2E-002` | Failed at presentation verification after delivery succeeded | `/home/kllilizxc/Code/hopi-auto/test-artifacts/goal-delivery-2026-07-13T16-55-14-546Z-c46488a6` |

The real Assistant, two Planner Runs, Generator, Reviewer, and two Reflection Runs completed. The
Goal reached `done`; Generator output was published, Reviewer integrated C1, the fixture's `bun test`
passed, no shared invariant was violated, and the original checkout was unchanged. The run consumed
857,998 input tokens (652,160 cached) and 16,902 output tokens.

**Failure:** `Goal completion update did not render in the feed` during `presentation_verification`.

**Classification:** Harness assertion defect, not delivery failure. The retained
`05-completion-update.png` visibly contains the green `COMPLETED` update. When a completion Attention
is linked to a handled Reflection event, the frontend intentionally presents the public Assistant
reply, not the raw completion Attention body. The Harness was comparing against the raw body.

**Resolution and verification:** The completion checkpoint now reads the production feed and asserts
the text that the frontend actually renders. `bun run artifact:inspect -- <source-run>` passed with
zero Assistant and responsibility-model invocations; inspection artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/goal-delivery-inspection-2026-07-13T17-05-23-248Z-0fa0317d`.
The original live run remains correctly retained as failed rather than rewritten.

## 2026-07-14: HOPI-E2E-010 Conversation And Page Context

| Run        | Result                                           | Artifact                                                                                                             |
| ---------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| First run  | Harness failure before model completion          | `/home/kllilizxc/Code/hopi-auto/test-artifacts/conversation-page-context-boundary-2026-07-13T17-08-54-015Z-9309f1a6` |
| Second run | Harness failure after three real Assistant turns | `/home/kllilizxc/Code/hopi-auto/test-artifacts/conversation-page-context-boundary-2026-07-13T17-09-41-824Z-362f910e` |
| Final run  | Passed                                           | `/home/kllilizxc/Code/hopi-auto/test-artifacts/conversation-page-context-boundary-2026-07-13T17-10-47-416Z-12bd1df4` |

Two Harness defects were found and fixed:

1. Goal pages render the Assistant panel open by default. The browser helper treated the absent
   “Open Assistant” button as a failure even though the visible composer could submit the message.
2. The scenario compared a Goal projection for full object equality. Presentation-only summary fields
   made that fail despite the required Goal ID, title, lifecycle, zero active Runs, and unchanged
   canonical Goal package all being correct.

The final real run used three Assistant turns (153,513 input tokens, 122,496 cached; 656 output) and
confirmed that the Goal page context survives each turn while the paused Goal package remains unchanged.

## 2026-07-14: HOPI-E2E-013 Blocking Question

Final real-run artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/blocking-attention-continuation-2026-07-13T17-32-01-459Z-4f1356e0`

The independently executable script `bun run e2e:live:013` completed with a terminal `failed` report
at `attention_notification`; it was not stopped or edited. It created one real Goal, ran one real
Assistant turn and three real Planner Attempts, and consumed 470,260 input tokens (396,928 cached)
and 15,698 output tokens.

All three Planner proposals staged a targeted Attention named `A-releaseLabel-value` under the owning
Goal and set its target to the current `plan-initial` Work document. Coordinator nevertheless rejected
each publication with the same persisted Attempt summary:

```text
Invalid Goal …: Attention A-releaseLabel-value targets outside its Goal
```

No valid targeted Attention was published, so no Reflection notification, operator answer, or delivery
continuation could begin. A previous retained run also showed a model-variance admission failure in
which Assistant asked the choice publicly without creating a Goal; the current script now fails that
condition promptly rather than waiting for its full timeout.

Classification: product prompt/publication compatibility defect. The Planner-facing Attention target
contract and Coordinator validator disagree in a way a real model cannot resolve from its available
context. The product must expose one canonical target representation (or accept the documented
Goal-local Work path) before this scenario can pass.

## 2026-07-14: HOPI-E2E-014 Operational Blocker Browser Execution

Final artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/operational-recovery-browser-2026-07-13T18-32-59-568Z-6a1ea63c`

`bun run e2e:browser:014` passed an independent production-server and real Browser Harness scenario.
The deterministic RoleRunner returned an operational process failure three times; production
Coordinator persisted three `operational_failure` Planner Attempts, opened one Work-target Attention,
and stopped further dispatch. The deterministic Reflection/Assistant fixture invoked the same internal
`hopi_notify_user` API used by a production model, which marked the Attention notified. The browser
then visibly rendered `Needs you` in the Current Focus strip, blocker banner, and Plan card; Browser
audit verification passed.

One fixture assertion defect was encountered first:

- Artifact `/home/kllilizxc/Code/hopi-auto/test-artifacts/operational-recovery-browser-2026-07-13T17-42-59-446Z-666b1143`
  correctly created the Work Attention but failed because the scenario expected the wrong serialized
  target (`/work/plan-initial` instead of `/work:plan-initial`) and treated the pre-notification
  `Waiting for Assistant` projection as `Needs you`.

The script now waits for notification and the final UI state. The remaining catalog action — repair
the external executable and prove one fresh successful episode — is not yet implemented, so this does
not close all of `HOPI-E2E-014`.

## 2026-07-14: HOPI-E2E-013 Canonical Target Fix And Passing Live Run

The product now supplies every responsibility with the exact owning Work target
`project:<projectId>/goal:<goalId>/work:<workId>` and validates targeted Attention against that one
grammar. A Planner document path is rejected as an ordinary failed pass with the exact expected
target instead of becoming a Project failure.

The first post-fix run is retained as failed at
`/home/kllilizxc/Code/hopi-auto/test-artifacts/blocking-attention-continuation-2026-07-14T01-38-13-009Z-8226a8e1`.
It proved the Planner fix and one correct notification, then the provider repeatedly failed both
WebSocket and HTTPS connections with TLS errors while processing the user's durable answer. The
answer remained `pending`; the 15-minute Harness timeout interrupted the second HOPI Assistant
attempt. This is environment-failure evidence, not a rewritten product pass.

After a separate provider probe succeeded, `bun run e2e:live:013` passed at
`/home/kllilizxc/Code/hopi-auto/test-artifacts/blocking-attention-continuation-2026-07-14T04-39-29-191Z-c7fa2c35`.
It completed one direct question, a browser-submitted `compact` answer, durable Goal Input and
Attention resolution, three Planner Runs, Generator, Reviewer, C1, completion notification, and
unchanged user checkout. It used 1,197,102 input tokens (955,904 cached) and 22,674 output tokens.

## 2026-07-14: HOPI-E2E-014 Full Operational Recovery

`bun run e2e:browser:014` passed at
`/home/kllilizxc/Code/hopi-auto/test-artifacts/operational-recovery-browser-2026-07-14T01-35-45-611Z-567e0ff7`
with zero provider calls. A real Bun child process emitted distinct stdout and stderr and exited 23
three times. Two Server restarts reconstructed the failure episode from Attempt logs, semantic Work
attempts remained zero, and one ordinary Work Attention rendered `Needs you` in the browser.

The scenario then repaired the external condition, submitted the answer through the ordinary Goal
page Assistant composer, invoked the normal `hopi_resolve_attention` boundary, and completed the same
Planning Work in a fresh episode through Generator, Reviewer, C1, and final Planning. The original
blocker remains as resolved history, no targeted blocker remains open, the user checkout is unchanged,
and separate blocked/recovered screenshots plus all three raw process streams are retained.

## 2026-07-14: HOPI-E2E-018 Contract Execution

## 2026-07-14: HOPI-E2E-011 Multiple Instructions While Goals Run

Final artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/multiple-instructions-2026-07-14T01-02-22-656Z-175f7353`

`bun run e2e:instructions:011` passed against a production Server and two independent real Git
Projects. Project A's Generator remained active while an ordinary status question and a Project B
repair instruction were received through Inbox. The public Assistant turn IDs were handled in receipt
order; the status turn created no Goal, the second turn created only Project B's Goal, both scoped
deliveries reached `done`, and neither user checkout changed.

The Assistant tool selection and responsibility results are deterministic. This closes the independent
production orchestration/race fixture but not the catalog's real-vendor concurrent-Assistant canary.

## 2026-07-14: Remaining Local Contract Re-run

The following local command completed successfully after the active-delivery revision scenario was
added:

`cd packages/backend && bun test tests/coordinatorReconciler.test.ts tests/multiRepoC1.test.ts tests/assistantReflection.test.ts tests/previewManager.test.ts tests/assistantTools.test.ts tests/roleContextStager.test.ts`

Result: **59 passing tests, 346 assertions, 0 failures**. This is current execution evidence for the
contract portions of `011`, `017`, `018`, `019`, `021`, `022`, and `027`. It includes real Git
repositories/C1 boundaries for `017` and `018`, and managed local processes for `021`; it does not
upgrade any of those rows to a Browser or provider-backed Live scenario.

Per the operator instruction for this machine, Claude/OpenCode-dependent execution is temporarily
skipped. Their prior evidence and compatibility failures remain retained under `HOPI-E2E-024` and
`HOPI-E2E-026`; they are not used as prerequisites for the remaining local work.

## 2026-07-14: HOPI-E2E-012 Design Revision During Active Delivery

Final artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/design-revision-active-delivery-2026-07-13T18-52-23-767Z-47432909`

`bun run e2e:revision:012` passed against the production Server, ordinary Inbox ingress, the internal
Assistant tool boundary, durable Goal packages, real Git worktrees, and a deterministic RoleRunner.
It waited for a revision-one Generator to become active, submitted a material design instruction, and
verified that revision advanced to two. The old Generator Attempt was durably `interrupted` and never
published; exactly one fresh Generator result published, its Reviewer result integrated, and the final
candidate exports only revision two. The original user checkout remained unchanged.

The first run retained at
`/home/kllilizxc/Code/hopi-auto/test-artifacts/design-revision-active-delivery-2026-07-13T18-51-45-807Z-a43f500c`
failed only because the scenario assumed every interrupted old result would be recorded as
`application: stale`. Production cancellation records it as `status: interrupted`, `application: null`;
both representations correctly prevent release movement. The assertion now accepts either protected
outcome and requires exactly one published Generator result.

This is not the requested real-Agent design-judgment canary: the Assistant tool choice and role output
are deterministic. Provider-backed interpretation of a materially different user design remains a
coverage gap.

## 2026-07-14: HOPI-E2E-015 Pause And Resume

Final artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/pause-resume-browser-2026-07-13T18-20-10-385Z-42818996`

`bun run e2e:browser:015` passed against a production Server and real Browser Harness. It created a
real Git-backed Goal, waited for the first Generator to write source and become active, then clicked
the visible Pause control. The Goal became durably `paused`, the Generator Attempt became
`interrupted`, and no additional responsibility was dispatched during the hold. It then clicked the
visible Resume control and completed a fresh Generator, Reviewer, and one C1 integration to `done`.
Both browser-control screenshots and the attempt history are retained in the artifact.
The final run also compares the original checkout's branch, HEAD, and source status before and after
the full lifecycle; they are identical.

The first run was deliberately terminated after a Harness proposal bug produced repeated invalid final
Planning proposals; its retained artifact is
`/home/kllilizxc/Code/hopi-auto/test-artifacts/pause-resume-browser-2026-07-13T18-17-02-663Z-cc339fbe`.
The Harness now emits a completion Attention only after the Engineering Work is durably `done`.

This is not a full Live canary: the active responsibility is a deterministic interruptable RoleRunner,
not a configured external role model process. Raw provider process-group interruption remains missing.

## 2026-07-14: HOPI-E2E-020 Configuration And Rebind

Final artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/configuration-rebind-2026-07-13T18-26-42-566Z-33f19738`

`bun run e2e:config:020` passed with a production Server, two real Git Repos, one linked secondary
Repo, distinct Home and Project coding defaults, a secondary Repo rebind, and a complete Server
restart. The Home Assistant remains Codex `gpt-5.4`/low while the Project remains OpenCode
`openai/gpt-5`; the primary Repo path is unchanged and only the secondary Repo points to its new
checkout after restart.

Two retained failed artifacts document the safety semantics:

- `...configuration-rebind-2026-07-13T18-25-56-305Z-027a0fde` used an unrelated Git Repo.
- `...configuration-rebind-2026-07-13T18-26-13-704Z-663db7d1` used a clone with a different Git
  common directory.

Both are correctly rejected by the product. Rebind accepts a relocated worktree of the same Repo;
the passing fixture uses `git worktree add`. Browser form submission and actual external adapter
command capture remain unimplemented.

## 2026-07-14: HOPI-E2E-024 Provider Environment Canary

Environment probe results: Codex CLI is present (`codex-cli 0.144.1`); Claude CLI is present
(`2.1.177`) and a non-interactive real canary returned the exact requested
`HOPI_CLAUDE_CANARY_OK` marker within five seconds; OpenCode is absent (`command not found`).

Claude HOPI artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/conversation-page-context-boundary-2026-07-13T18-29-15-309Z-fbedd4f6`

`HOPI_E2E_TRANSPORT=claude bun run e2e:live:010` completed with `status: passed`. It exercised three
real Claude Assistant turns through the browser and HOPI tool transport (29,292 input tokens and
1,059 output tokens). The retained run report records the vendor-qualified session and all raw turn
transcripts. During execution, two tool-state reads emitted `Project not found: live-conversation` API
errors, but the scenario's durable boundary assertions still passed; this needs separate diagnosis
before claiming general Claude tool reliability.

This proves only that Claude can make a non-interactive provider call in the current environment. No
image, durable session resume, or interruption was run. OpenCode's missing executable is an environment blocker for its rotating Live canary until installed
and authenticated.

Claude session-recovery failure artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-13T18-30-53-216Z-96eb693f`

`HOPI_E2E_TRANSPORT=claude bun run e2e:live:026` made three real Claude Assistant calls (60,852
input tokens; 671 output) and then failed at `vendor_session_removed`: the rebuilt conversation did
not retain the newest public-history marker. This is a vendor/session compatibility failure, not an
authentication blocker. The missing session was deliberately removed and all raw turn transcripts are
retained for diagnosis.

## 2026-07-14: HOPI-E2E-023 Cancel, Archive, And Reopen

Final artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/cancel-reopen-browser-2026-07-13T18-22-07-499Z-e9e26907`

`bun run e2e:browser:023` passed with a production Server, production Goal control API, managed Git,
and a real Browser Harness. It cancelled a running initial Work and its dependent, observed no stale
dispatch after cancellation, and retained the cancelled cards in the browser's Cancelled archive.
Reopen created contract revision two, preserved the old Work as cancelled, created a new Work rather
than reviving it, and completed the new Generator/Reviewer/C1 delivery. The user checkout stayed
unchanged.

This does not yet exercise a real Assistant model choosing the cancel/reopen tool; the production
control endpoint internally invokes the same Assistant tool capability. A live Assistant control
canary remains a coverage gap.

## 2026-07-14: HOPI-E2E-016 Coordinator Replacement

Final artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/restart-during-generator-2026-07-13T18-12-56-218Z-70faf41e`

`bun run e2e:restart:016` passed with a production Server, retained Home, managed Git integration,
and two Coordinator instances. The first Generator wrote a source delta and remained active; shutdown
persisted its Attempt as `interrupted`. A replacement Coordinator then dispatched a fresh Generator,
Reviewer, and completion Planner, reached `done`, and produced exactly one reachable C1 for the Work.
The retained attempt manifests preserve both the interrupted and post-restart Runs.

The first two test iterations are retained as Harness failures:

- `/home/kllilizxc/Code/hopi-auto/test-artifacts/restart-during-generator-2026-07-13T18-11-32-851Z-0feb70b8`
  read a non-existent `manifest.json`; the durable filename is `attempt.json`.
- `/home/kllilizxc/Code/hopi-auto/test-artifacts/restart-during-generator-2026-07-13T18-12-09-399Z-fb3b63ea`
  counted commits from the wrong repository/ref instead of the managed integration's `hopi/release`.

This is not a full `016` Live pass: its RoleRunner is deterministic and shutdown is graceful. The
catalog still requires an independently launched real model child Coordinator to be terminated at the
OS-process boundary, with raw vendor transcript and checkpoint recovery verified.

`bun test packages/backend/tests/multiRepoC1.test.ts` passed: 7 tests, 36 assertions. It exercised
real multi-Repo Git refs, pre-C1 conflict rejection, restart after primary C1, partial projection
continuation, and unexpected-secondary-ref blocking.

No contract failure occurred. The required Browser distinction between Project unavailability and
ordinary Goal execution remains unimplemented, so the Browser layer is still a coverage gap.

## 2026-07-14: HOPI-E2E-021 Contract Execution

`bun test packages/backend/tests/previewManager.test.ts` passed: 12 tests, 41 assertions. It exercised
the real Preview process adapter, managed integration cwd, readiness signal, startup diagnostics,
release invalidation, preparation stop race, and missing-adapter repair prompt.

No contract failure occurred. The requested Browser operation and real-Agent repair delivery remain
separate unimplemented scenario layers.

## 2026-07-14: HOPI-E2E-025 Webhook Retry Execution

Artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/webhook-delivery-retry-2026-07-13T17-56-56-553Z-d7c3327d`

`bun run e2e:webhook:025` passed against a production Server and an actual local HTTP receiver. A
durably handled public Reflection reply was queued before Server start. The receiver returned `503`
for the first `POST` and `204` for the second. Coordinator retried without rerunning any model,
persisted `webhookDeliveredAt` after the successful response, and sent the same
`<homeId>/<eventId>` idempotency key with the same provider-neutral JSON payload both times.

No product failure occurred. This case intentionally has no Browser or model requirement; it proves
the real webhook transport boundary rather than a mock request function.

## 2026-07-14: HOPI-E2E-026 Long Conversation And Session Recovery

Final artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-13T18-03-36-164Z-84b3332f`

`bun run e2e:live:026` passed with three real Codex Assistant turns (57,403 input tokens; 45,056
cached; 132 output). Two durable public messages contributed more than the 16k reconstruction budget;
a handled internal Reflection event was then inserted and the persisted vendor `session.json` deleted.
The third real turn rebuilt a new Codex session, returned `NEW-HISTORY-MARKER`, and did not expose
`INTERNAL-REFLECTION-MUST-NOT-APPEAR`. The old and new session IDs differ in `run.json`.

First harness attempt artifact:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-13T18-00-09-153Z-70b0d11a`

It was stopped after the first model turn had completed because the harness compared the raw Inbox body
without normalizing its terminal newline. This was corrected to compare trimmed durable text; the
final run is terminal and passed. No product failure occurred.

## 2026-07-14: HOPI-E2E-028 Project Attention Recovery

Browser artifact:
`/Users/realizer/Code/hopi-auto/test-artifacts/project-attention-recovery-browser-2026-07-14T12-17-25-848Z-878c2a9b`

`HOPI_E2E_ALLOW_UNAUDITED_BROWSER=1 bun run e2e:browser:028` passed with the production Server,
Coordinator, Assistant tool boundary, real Browser Harness, managed Git worktree, and task checkpoint.
The Board first showed one `Project blocked` banner while Planning remained ordinary `waiting` with
only `project_ineligible`. A successful `hopi_resolve_attention` removed the banner and woke Planner.
The deterministic Generator then damaged its disposable task checkout so the next real checkpoint
failed closed; Coordinator created a new Project Attention with a different identity and current
reason, while the Engineering card remained `waiting` instead of becoming `Needs you`. Visual
inspection of blocked, resumed, and reblocked screenshots found the expected banner and card states.

The first retained Browser iteration is a Harness assertion failure:
`/Users/realizer/Code/hopi-auto/test-artifacts/project-attention-recovery-browser-2026-07-14T11-58-15-634Z-2b4ada94`.
The product completed the intended resolve, dispatch, and reblock sequence, but the assertion always
selected historical `plan-initial` after it had become `done`. The final scenario selects the current
nonterminal Work without fixing Work count or kind.

Claude Live artifact:
`/Users/realizer/Code/hopi-auto/test-artifacts/project-attention-agent-recovery-2026-07-14T12-05-47-082Z-cacceffa`

`HOPI_E2E_TRANSPORT=claude HOPI_E2E_ALLOW_UNAUDITED_BROWSER=1 bun run e2e:live:028` was blocked at
`assistant_recovery`. Claude Code 2.1.209 initialized, connected the HOPI MCP server, and then received
ten consecutive provider `429 rate_limit` responses because the daily allocation was already
exceeded (`$302.40` current spend against a `$300.00` budget). It exited before inference or any HOPI
tool call, with zero input, cached-input, and output tokens. This is an environment/provider blocker,
not product or Harness evidence. The Live runner remains implemented but has not passed.

The stronger `HOPI-E2E-002` and `HOPI-E2E-013` Claude reruns were not started after this zero-token
quota failure because they use the same exhausted provider allocation and could not produce new
product evidence.

## 2026-07-14: Contract and Browser Preflight

| Gate                   | Result | Evidence                                                                                                   |
| ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `bun run e2e:contract` | Passed | 156 tests across 18 files; 751 assertions; zero provider calls.                                            |
| `bun run test:browser` | Passed | `/home/kllilizxc/Code/hopi-auto/test-artifacts/global-assistant-browser-2026-07-13T16-45-22-030Z-0671c3cc` |

No product or Harness failure occurred in these gates.

## 2026-07-14: Planner Sparse-Proposal Regression Gates

| Gate                   | Result | Evidence                                                              |
| ---------------------- | ------ | --------------------------------------------------------------------- |
| `bun run check`        | Passed | Backend 284 tests, frontend 43 tests, typecheck, lint, and build passed. |
| `bun run e2e:contract` | Passed | 162 tests across 18 files; 801 assertions; zero provider calls.         |

The regression reproduces both retained Claude Planner failures without a provider call: Planner no
longer writes its owning Planning Work, Coordinator preserves the current body, attempts, and prior
Evidence while deriving the `done` gate, and a retry after an invalid proposal cannot erase append-only
Evidence. Premature completion alongside nonterminal Engineering Work remains fail-closed.

## 2026-07-14: HOPI-E2E-029 Terminal Assistant Provider Error

Browser artifact:
`/Users/realizer/Code/hopi-auto/test-artifacts/assistant-provider-error-2026-07-14T12-58-21-785Z-b86d912f`

`HOPI_E2E_ALLOW_UNAUDITED_BROWSER=1 bun run e2e:browser:029` passed with the production Server,
Coordinator, durable Assistant runtime, message projection, and Browser Harness. One deterministic
speaking turn emitted representative Claude init, retry, synthetic Assistant error, terminal error,
and contradictory success telemetry. Coordinator invoked it once, immediately created event-target
Attention, and did not rebuild the cached session or retry the Inbox event. The final screenshot
shows one provider-error activity and no `Working`, generic `system`, or false `success` row.

Parser, runner, Coordinator, and message-feed regressions also cover the same boundary without a
provider call. Raw runtime events remain durable even though the ordinary conversation coalesces or
hides transport telemetry.

| Gate                   | Result | Evidence                                                               |
| ---------------------- | ------ | ---------------------------------------------------------------------- |
| `bun run check`        | Passed | Backend 288 tests, frontend 48 tests, typecheck, lint, and build passed. |
| `bun run e2e:contract` | Passed | 164 tests across 18 files; 809 assertions; zero provider calls.         |

## Open Coverage Gaps

1. `HOPI-E2E-002`, `HOPI-E2E-010`, and `HOPI-E2E-013` have independent Live runners; `014` has a
   partial independent Browser runner and `016` has a deterministic production Coordinator restart
   runner. All remaining catalogued Planned scenarios still need their own independent Browser and/or
   Live runners before they can be claimed as run.
2. `HOPI-E2E-013`, `HOPI-E2E-018`, and `HOPI-E2E-020` retain their specified Browser layer beyond
   the existing global Assistant ingress preflight. `014` still lacks its repair-and-retry half.
3. The deterministic suite proves orchestration seams and durable boundaries only. It must not be
   used to claim vendor behavior, multimodal transport, browser presentation, or real responsibility
   execution for a scenario whose table row still marks that layer pending.

## 2026-07-14: Full Main Regression Baseline 07d2d79

All executable deterministic, Browser, and Codex Live commands passed on clean `main` at `07d2d79`.
The retained command log root is
`/home/kllilizxc/Code/hopi-auto/test-artifacts/full-regression-2026-07-14T05-49-42Z`.

The pass exposed four evidence or efficiency defects that do not invalidate the delivered domain
state:

- `HOPI-E2E-015` captured Pause after the control changed but before the card projection stopped
  showing `working`; the script used a fixed 500 ms delay instead of a semantic UI condition.
- `HOPI-E2E-023` retained the cancelled archive but not the reopened terminal Kanban, despite proving
  the terminal state through the API.
- The first `HOPI-E2E-002` Planner tried to update files in an initially empty sparse proposal and
  tried to replace example text in the zero-byte `result.json`. Both failed `apply_patch` calls were
  recovered, but the Planner consumed 270,587 input tokens and 9,335 output tokens.
- Speaking Assistant raw progress prose and one recoverable tool-schema correction appeared as
  separate public chat messages even though the durable final replies were concise. Raw events are
  useful diagnostics, but the Assistant surface should fold them into Activity rather than present
  them as operator-facing speech.

The same Attention run also showed a model-authored `createdAt` later than the actual proposal
publication. Attention time is persistence metadata and will be normalized by Coordinator at
publication instead of relying on model clock judgment.

The first fixed `HOPI-E2E-002` rerun passed end to end and removed the empty-proposal and zero-byte
patch failures, but its first Planner omitted the owning Planning Work from an otherwise complete
success proposal. Coordinator correctly normalized that proposal to a failed attempt and a retry
recovered, so durable state remained sound; the run nevertheless used 9 model calls and 938,104
input tokens. The Planner contract now states the exact required authority-to-proposal Work copy and
`stage: done` gate. This keeps the existing sparse model and deterministic validation while removing
an avoidable interpretation gap.

The next fixed `HOPI-E2E-002` rerun proved that initial gate fix, but its final Planner treated an
older `evidenceRefs` entry as dangling because the compact responsibility authority intentionally
staged only the latest Evidence. It tried to rewrite terminal Engineering Work; Coordinator rejected
the mutation and a retry recovered. Canonical Evidence was never missing. The contract now states
that omitted history is not absent canonical truth and terminal Engineering Work is never copied or
edited by Planner. Staging all historical Evidence would spend more context to solve the wrong
problem, so the compact authority model remains unchanged.

The Claude `HOPI-E2E-026` canary then exposed a runtime-log race: `/api/assistant/feed` read an
`events.jsonl` append between bytes and parsed the unfinished tail as a complete record, returning
500 even though the model process continued. The shared JSONL reader now treats only an
unterminated final line as in-flight and retries it on the next poll; malformed durable lines still
fail visibly. This is transport-neutral and also aligns Assistant, Attempt, and Reflection readers.

After that race was fixed, the Claude canary reached the history assertion but did not repeat
`NEW-HISTORY-MARKER`. Artifact inspection showed the model had received and reasoned about the
marker. The Live case itself was not a valid history proof because its recovery turn repeated both
the public and internal marker strings. The case now withholds every marker from the current turn
and asks for the previous public message's leading marker, while asserting newest present, oldest
absent, and private Reflection absent. No vendor-specific runtime rule was added.

The final `HOPI-E2E-002` run passed with all eight logical model Runs succeeding without a recovered
responsibility attempt. Compared with the clean baseline, total input fell from 815,757 to 768,756,
uncached input fell from 211,853 to 137,588, and output fell from 18,944 to 18,673. The retained
artifact is
`/home/kllilizxc/Code/hopi-auto/test-artifacts/goal-delivery-2026-07-14T12-46-27-273Z-f2d75a55`.

The strengthened `HOPI-E2E-026` proof passed with both available configured vendors. Claude evidence
is `/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-14T13-02-16-562Z-dd665414`;
Codex evidence is `/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-14T13-03-04-579Z-51102843`.
OpenCode was not Live-tested because its executable is absent on this host; deterministic adapter
coverage remains green.

## 2026-07-14: Integrated Main Regression 590d283

The final regression integrated upstream `94a38fe..4774800` before retesting. That upstream line adds
Project Attention recovery, terminal Assistant provider-error handling, and a simpler Planning gate:
Planner never copies or edits its Planning Work; Coordinator validates the proposal and derives the
terminal gate. This supersedes the intermediate prompt-only requirement recorded above without
removing its retained evidence.

The first post-integration `bun run check` found one Biome-only formatting defect in the merged
Planner prompt. Commit `590d283` normalized that formatting. The final gates then passed:

| Gate                   | Result | Evidence                                                                  |
| ---------------------- | ------ | ------------------------------------------------------------------------- |
| `bun run check`        | Passed | Backend 289 tests / 1,156 assertions; frontend 45 tests / 154 assertions. |
| `bun run e2e:contract` | Passed | 164 tests / 816 assertions across 18 files; zero provider calls.          |

All 16 scenarios with an independent executable runner passed at the layer actually executed:
`001`, `002`, `003`, `010`, `011`, `012`, `013`, `014`, `015`, `016`, `020`, `023`, `025`, `026`,
`028`, and `029`. Retained command logs are under
`/home/kllilizxc/Code/hopi-auto/test-artifacts/final-integrated-regression-2026-07-14T13-45Z/logs`.
Rows still marked Planned or Partial in `docs/e2e_test_cases.md` retain their unimplemented layers;
the global Contract suite is not used to infer those passes.

The final clean `HOPI-E2E-002` run is
`/home/kllilizxc/Code/hopi-auto/test-artifacts/goal-delivery-2026-07-14T14-19-50-381Z-129b3baf`.
It recorded `590d283`, `dirty: false`, eight logical model Runs, and first-attempt success for both
Planner Runs, Generator, and Reviewer. Usage was 862,773 input tokens (679,040 cached; 183,733
uncached) and 14,668 output tokens.

The final Codex `HOPI-E2E-028` Live canary passed at
`/home/kllilizxc/Code/hopi-auto/test-artifacts/project-attention-agent-recovery-2026-07-14T13-43-21-110Z-fa02c0ba`.
Assistant inspected the external repair marker, resolved the canonical Project Attention through its
tool, and woke Planner. This replaces the earlier quota-blocked provider attempt as coverage status;
the blocked artifact remains valid environment history.

The strengthened `HOPI-E2E-026` history proof passed again with Codex at
`/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-14T14-13-17-516Z-cd3efc41`
and Claude at
`/home/kllilizxc/Code/hopi-auto/test-artifacts/long-conversation-session-recovery-2026-07-14T14-14-33-926Z-44810d87`.
OpenCode still lacks a host executable, so only its deterministic adapter contract was exercised.

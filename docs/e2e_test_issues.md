# HOPI E2E Test Issue Log

Last updated: 2026-07-15

This append-only file records failures, executions, and environment limits observed while running
the E2E gates. It does not own scenario status: `docs/e2e_test_cases.md` is the single coverage
catalog, and a retained `run.json` is the authority for one invocation. A passing deterministic or
browser preflight is not recorded as a Live Agent success.

## 2026-07-15: Planned/Partial coverage completion audit

The audit retained independent execution only where a model, browser, or hard process boundary could
change the outcome. All other rows are now explicitly composed from stronger existing evidence; no
catalog row remains ambiguously `Planned` or `Partial`. OpenCode is the sole intentional exclusion.

| Risk                           | Result                                                                                                                                                                  | Retained Test Run                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `011` concurrent Projects      | Real Assistant and both responsibility chains completed; the source Run's old shared browser audit failed, then immutable inspection passed                             | `test-artifacts/concurrent-project-instructions-2026-07-14T17-20-56-699Z-6f16798d`; `test-artifacts/concurrent-projects-inspection-2026-07-14T17-34-26-879Z-418779f6`        |
| `016` hard restart             | Passed after killing the Coordinator PID namespace during a real Generator and recovering with a replacement process                                                    | `test-artifacts/process-restart-during-generator-2026-07-14T18-08-50-707Z-cf026b5c`                                                                                          |
| `017/027` multi-Repo/bootstrap | Passed with two Repos, real responsibilities, one C1, and silent `AGENTS.md`/prepare bootstrap                                                                          | `test-artifacts/multi-repo-bootstrap-delivery-2026-07-14T17-02-15-209Z-60e51845`                                                                                             |
| `020` configuration            | Passed through Browser Harness with multi-Repo link, model settings, safe rebind, reload, and Server restart                                                            | `test-artifacts/configuration-rebind-2026-07-14T16-37-29-146Z-42775605`                                                                                                      |
| `021` Preview                  | Passed through Browser Harness for ready, stop, release invalidation, and ordinary Assistant repair admission                                                           | `test-artifacts/preview-lifecycle-browser-2026-07-14T16-56-48-479Z-26c1f1c5`                                                                                                 |
| `022` multimodal               | Real image upload, Assistant adoption, Planner/Generator/Reviewer delivery, C1, and completion all succeeded; corrected terminal assertions passed immutable inspection | `test-artifacts/multimodal-reference-delivery-2026-07-14T18-24-44-699Z-0b9d3971`; `test-artifacts/multimodal-delivery-inspection-2026-07-14T18-33-36-132Z-74326d2f`          |
| `024/026` provider/session     | Current adapter generation passed the same lost-session canary on Codex and Claude; Codex also passed the real image chain                                              | `test-artifacts/long-conversation-session-recovery-2026-07-14T14-13-17-516Z-cd3efc41`; `test-artifacts/long-conversation-session-recovery-2026-07-14T14-14-33-926Z-44810d87` |

The final zero-provider Regression passed all 14 children with no mixed code provenance and no model
usage at
`test-artifacts/regression-preflight-2026-07-14T19-39-38-532Z-f37a5af3`. It includes the repository
check, 166-test Contract suite, and every selected Browser scenario. A separate Inspection Run
records the human review of 53 retained screenshots at
`test-artifacts/regression-preflight-visual-review-2026-07-14T19-47-00-271Z-99cde995`.

## 2026-07-15: Multimodal Live confused immutable Input with portable model prose

The first `HOPI-E2E-022` Live Run completed real Assistant, Planner, Generator, Reviewer, C1, and
completion handling, but its terminal assertion rejected the canonical Goal Input because that
lossless receipt correctly retained the original Assistant-home attachment reference. The product
contract forbids such paths only in editable Goal, design, and Work prose; `inputs/**` must preserve
the exact received content and attachment references so its digest remains meaningful.

The runner now scans only the editable documents governed by that portability rule. The failed Live
artifact remains immutable and is verified through a separate zero-model inspection rather than
spending another full multimodal delivery merely to rerun a corrected assertion.

## 2026-07-15: Preview Browser CLI did not exit after clean shutdown

`HOPI-E2E-021` reached every pass condition and wrote a terminal `passed` report, but its Bun process
did not exit. Server, Coordinator, Preview child, and reported active handles were already closed;
two earlier invocations showed the same orphaned process shape. Replacing the in-process Preview
endpoint fetch with a real Browser Harness open added the missing user-visible proof but correctly
did not pretend that evidence improvement alone fixed the Bun lifecycle.

The scenario now closes the Server before sealing its terminal report, then explicitly exits its CLI
after every awaited cleanup and write. This containment stays in test code and adds no product
process state or timeout. The corrected command passed and exited normally at
`test-artifacts/preview-lifecycle-browser-2026-07-14T18-59-47-554Z-e2e3edef`.

## 2026-07-15: Resume browser assertion missed a fast terminal Goal

The full preflight reached `HOPI-E2E-015`; Resume then completed Generator, Reviewer, C1, and final
Planning before Browser Harness sampled the expected active-state Pause button. The screenshot and
canonical Goal both showed `done` with no pending Work, but the generic control helper accepted only
the transient active projection and reported a false failure.

Resume now settles on either the next Pause control or the terminal `done` focus. This does not add a
timing delay or product state: both are existing valid UI projections of the same successful control.
Pause remains stricter and requires Resume visible with no working indicator.

## 2026-07-15: Browser resources accumulated between Test Runs

After several independent Browser commands, `HOPI-E2E-015` and later `028` timed out in the first
`Page.navigate` IPC call before any product action. Restarting only the named Browser Harness daemon
was not sufficient. Inspection found that the dedicated automation Chrome had accumulated hundreds
of renderer processes from tabs created by earlier scripts; replacing that isolated automation
process restored navigation. Retrying the whole browser script inside a scenario would be unsafe
because later failures may occur after a click.

Reloading before every atomic script also exposed a transient Windows endpoint-cleanup race and was
unnecessary once tabs had an owner. The shared Browser executor now performs one idempotent daemon
reload before the Test Run's first browser action, retains its attempts in one log, and closes every
tab created by each script in a `finally` boundary. Only that pre-action initialization may retry; a
browser script never does. Browser instance ownership remains with the host adapter and tab
ownership remains with the Test Run. This keeps recovery and cleanup at the exact external
infrastructure boundary without call-site flags, scenario-specific rules, or duplicate product
actions. After the isolated Chrome was repaired, `028` passed at
`test-artifacts/project-attention-recovery-browser-2026-07-14T19-32-21-885Z-c5a0e0e0`.
The cleanup-enabled `028` and the subsequent full Regression both left the CDP target count at the
same baseline of eight.

## 2026-07-15: Artifact review changed the caller's path base

The root-level `artifact:review` command changed into `packages/backend` before starting its CLI, so
a repository-relative artifact path resolved under the package and failed before creating a review
Run. The root script now executes the same Bun file without changing directories. Relative paths,
absolute paths, and every other root-level artifact command therefore share one path base; no new
path option or fallback rule is needed.

## 2026-07-15: Internal notification exposed diagnostic narration

The concurrent-Project Live Run completed both deliveries but one completion card exposed an
intermediate Assistant explanation after a failed `notify_user({ message })` call. The old no-arg
tool coupled visibility to whatever the vendor selected as the turn's final non-empty text. The
contract now makes `notify_user({ message })` the sole operator-facing content for an internal turn;
all other model text remains retained diagnostics.

## 2026-07-15: Restart Live sampled completion before Reflection settled

The first successful process-restart delivery observed `done` immediately before completion
Reflection published its internal Inbox handoff, then stopped Coordinator with that event pending.
One terminal snapshot is not quiescence. External-process Live runners now reuse the shared stable
state-signature window covering Goal, Runs, Reflection, and pending Inbox before collecting terminal
evidence.

Latest verification: `bun run check` passed with the unified Test Run Harness: backend **293 passing
tests / 1,170 assertions**, frontend **45 passing tests / 154 assertions**, with type checks, static
checks, and frontend build all passing. `bun run e2e:contract` passed **164 tests / 816 assertions**.

Latest remaining-scenario run: `bun test tests/projectReconciler.test.ts tests/multiRepoC1.test.ts
tests/mvpServer.test.ts tests/assistantReflection.test.ts tests/coordinatorReconciler.test.ts
tests/previewManager.test.ts tests/assistantTools.test.ts tests/roleContextStager.test.ts` passed with
**79 tests / 478 assertions / 0 failures**. This is direct execution evidence for the existing
contract/runtime coverage of `017`, `018`, `019`, `021`, `022`, and `027`; it does not replace their
specified independent Browser or Live layers.

## 2026-07-15: Deterministic UI command raced the speaking Assistant

`HOPI-E2E-021` created and paused a Goal through product APIs before requesting Preview repair. A
Coordinator tick observed the freshly written Create Goal Inbox receipt between its direct tool
effect and handled acknowledgement, started a speaking turn, then failed the turn when the route
updated the same event document. The false failure produced an event-target Workspace Attention and
an unnecessary Reflection handoff.

The fix is one process-local Assistant admission guard around every deterministic
receive/effect/acknowledge sequence. It blocks only speaking dispatch for the in-flight receipt and
adds no durable state; a process failure leaves the pending receipt eligible for ordinary recovery.
The regression asserts that direct Goal controls create no Assistant runtime turn or event Attention,
while the later Preview repair creates exactly one public speaking turn.

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

| Gate                   | Result | Evidence                                                                 |
| ---------------------- | ------ | ------------------------------------------------------------------------ |
| `bun run check`        | Passed | Backend 284 tests, frontend 43 tests, typecheck, lint, and build passed. |
| `bun run e2e:contract` | Passed | 162 tests across 18 files; 801 assertions; zero provider calls.          |

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

| Gate                   | Result | Evidence                                                                 |
| ---------------------- | ------ | ------------------------------------------------------------------------ |
| `bun run check`        | Passed | Backend 288 tests, frontend 48 tests, typecheck, lint, and build passed. |
| `bun run e2e:contract` | Passed | 164 tests across 18 files; 809 assertions; zero provider calls.          |

## Current Execution Boundary

All catalogued risks now have the required independent or composed evidence. OpenCode remains
intentionally unexecuted by operator decision. A retained inspection proves only the persisted
outcome and current presentation of its source Live Run; changes to the corresponding model,
scheduler, publication, or Git path still require that Live command to run again.

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

## 2026-07-14: Unified Test Run Regression

The E2E Harness now gives Contract commands, Runtime scenarios, Browser scenarios, Live scenarios,
artifact inspection, visual review, and Regression one `run.json` envelope. A parent Regression is
the same Test Run with child artifact references; scenario-specific JSON remains detailed evidence.
No scenario DSL, DAG, retry system, database, `suite.json`, or `visual-review.json` was added.

Three Harness defects were found before accepting the implementation:

1. `sourceRoots.map(resolve)` passed the array index into Node's variadic `path.resolve`. The helper
   now resolves each root through an explicit unary callback, with a deterministic regression.
2. The first generated gallery sorted screenshots lexically, putting recovery outcomes before their
   triggering steps. The gallery now preserves the parent profile order and each child Run's capture
   time. A test fixes both ordering guarantees. The gallery remains a derived view, not authority.
3. Live cleanup originally appended `server_stopped` after writing the terminal report, immediately
   invalidating its retained `actions.jsonl` hash. Live finalization now stops the server first and
   makes later cleanup idempotent; a deterministic test checks both the one-stop boundary and the
   sealed evidence hash.

The final zero-provider Regression passed all 13 children: repository check, Contract suite, Runtime
`011/012/016/020/025`, and Browser `001/014/015/023/028/029`. It recorded zero logical model Runs,
zero provider usage, and no mixed code provenance. The retained parent is
`/home/kllilizxc/Code/hopi-auto/test-artifacts/test-run-regression-current/regression-preflight-2026-07-14T15-43-58-009Z-e28dfd14`.

The embedded repository gate passed 294 Backend tests with 1,174 assertions and 45 Frontend tests
with 154 assertions. The independently retained Contract child passed 164 tests with 816 assertions.
After adding the compact-usage aggregation regression, the final repository gate passed 295 Backend
tests with 1,175 assertions and the same 45 Frontend tests with 154 assertions.

Its 39 checkpoint screenshots were reviewed through the generated gallery in profile and capture
order. The separate Inspection Test Run records every exact screenshot path and SHA-256 without
mutating the source:
`/home/kllilizxc/Code/hopi-auto/test-artifacts/test-run-regression-current-review/regression-preflight-visual-review-2026-07-14T15-50-38-431Z-094f771a`.
The Browser Harness audit chain verified with head hash
`5b8dd30036dc08243c3f347fcd07f0b934e616fdcbc2092d7cb17505fdaddd54`.

The Live Regression profile was not executed because this change affects only test artifact,
aggregation, and visual-review infrastructure. Contract, real Browser, immutable Inspection, and
zero-provider execution cover that boundary; invoking production models would add cost without
testing another changed behavior.

## 2026-07-15: Test Run Lifecycle And Owned Browser Resources

The Harness now makes one Test Run responsible for every disposable resource created by its
scenario. Registered cleanup is idempotent, runs in reverse order, and completes before terminal
evidence is hashed. Cleanup failure or timeout prevents a requested pass and remains in `run.json`;
an available force action is attempted without retrying scenario behavior. Regression children now
stream their real output and have a deterministic command deadline.

Deterministic lifecycle, timeout, progress, and command-termination tests passed: 13 tests and 47
expectations across `testRunArtifact.test.ts` and `liveHarness.test.ts`. The command-deadline case
started a real Bun child, retained its pre-hang checkpoint, and terminated it after the configured
100 ms deadline.

The upgraded real Browser contract passed at
`/home/kllilizxc/Code/hopi-auto/test-artifacts/global-assistant-browser-2026-07-15T15-31-48-130Z-38fe7ac8`.
Its two Browser invocations each created and closed exactly one target, retained no leaked target,
and sealed the Server cleanup before the terminal report. The Projects and handled Assistant reply
screenshots were visually inspected and contained the expected states.

The complete zero-provider Regression then passed all 15 children at
`/home/kllilizxc/Code/hopi-auto/test-artifacts/regression-preflight-2026-07-15T15-34-23-331Z-ad33c933`.
All child Test Runs passed, all registered cleanups passed, and all 26 retained Browser resource
records satisfied `created = closed` with `leaked = []`. The parent recorded zero logical model Runs,
zero provider tokens, and no mixed code provenance. Repository verification inside that Regression
passed 307 Backend tests with 1,217 expectations and 48 Frontend tests with 161 expectations.

After the final progress-output normalization, the affected two-Server restart case passed again at
`/home/kllilizxc/Code/hopi-auto/test-artifacts/restart-during-generator-2026-07-15T15-43-26-056Z-84723031`;
both early cleanup boundaries emitted matching start/completion records.

## 2026-07-16: Current-Code Live Regression Found Non-Idempotent Process Cleanup

The current-code Live Regression passed `002`, its immutable `003` inspection, `010`, `011`, and
`013`, then stopped at `016` as designed. The retained parent is
`test-artifacts/regression-live-2026-07-15T15-49-41-293Z-f880b945`; the failing child is
`test-artifacts/regression-live-2026-07-15T15-49-41-293Z-f880b945/children/HOPI-E2E-016/process-restart-during-generator-2026-07-15T16-16-48-930Z-ef17d0b6`.

The product had not started a real responsibility Run yet. The scenario deliberately killed its
first detached Coordinator, then the registered cleanup signalled that same process group again.
Bun still exposed a null `exitCode`, while the operating system correctly returned `ESRCH` because
the group no longer existed. Treating that absence as failure violated the Harness's documented
idempotent-cleanup contract. The fix belongs in the shared process-group signal boundary: an absent
group is already released, while non-absence signal errors remain failures. The expensive scenarios
that passed before this Harness-only failure are not rerun; execution resumes from `016` after a
deterministic regression proves the boundary.

The first focused `016` rerun crossed both already-absent Coordinator cleanup boundaries, proving
the `ESRCH` fix, and completed the replacement Generator, Reviewer, C1, and final Planner. It then
exposed a separate scheduler loop while waiting for post-completion quiescence. The focused speaking
fixture rejected the legitimate `internal` tool mode. Its pending Reflection Inbox turn received an
event-target Workspace Attention, but each resulting semantic digest woke another Reflection and
created another internal turn instead of treating the existing pending turn as the durable recovery
state.

The general correction adds no status or retry mechanism: any pending Reflection-sourced Inbox turn,
including one blocked by event Attention, suppresses another Reflection assessment until it is
handled. Attention-blocked public input remains Reflection-eligible because it has no existing
internal assessment. A Coordinator regression covers that distinction, and the restart fixture now
implements the `internal` mode that completion delivery legitimately requires.

## 2026-07-16: Current-Code Live Coverage Completed

The corrected `016` rerun passed at
`test-artifacts/process-restart-during-generator-2026-07-15T16-49-56-376Z-ec6e9d83`.
It retained both intentional process-loss boundaries, replacement Generator execution, Reviewer,
C1, final Planning, and completion delivery in 10 logical Runs. No unresolved Workspace Attention
remained. This proves both shared corrections: signalling an already-absent owned process is a
successful cleanup no-op, and a pending Reflection-sourced Inbox turn is the one durable ownership
boundary that suppresses duplicate Reflection.

The remaining selected Live boundaries then passed independently:

- `017` and its folded `027` bootstrap proof:
  `test-artifacts/multi-repo-bootstrap-delivery-2026-07-15T16-56-27-745Z-33510afa`;
- `019`:
  `test-artifacts/reflection-notification-schema-canary-2026-07-15T17-12-10-046Z-e72f674f`;
- `022`:
  `test-artifacts/multimodal-reference-delivery-2026-07-15T17-12-44-148Z-08dcb252`;
- `026`:
  `test-artifacts/long-conversation-session-recovery-2026-07-15T17-21-12-263Z-f41c9ddf`; and
- `028`:
  `test-artifacts/project-attention-agent-recovery-2026-07-15T17-21-59-640Z-6f2e34e9`.

`017` also exercised the intended correction loop rather than a perfect first attempt. Its first
Planner-authored prepare adapter contained an invalid Repo path. Final Planning refused to claim
completion, published one dependent Engineering Work, and the existing Generator/Reviewer path
repaired and reverified the adapter. This was a model-authored Project adaptation error recovered by
the general workflow, so it does not justify a prepare-specific runtime rule.

The stopped Live Regression parent had already passed `002`, immutable inspection `003`, `010`,
`011`, and `013`; those expensive children were not repeated after a Harness-only failure. Every
terminal child and focused Run was audited as `passed`, every registered cleanup completed, and all
owned Browser records retained an empty leaked-target set. The failed parent remains failed and is
not presented as a successful aggregate; the focused artifacts are the authoritative continuation
evidence.

`022` proved the real image path rather than only multipart admission: one uploaded screenshot was
adopted into Goal assets, cited by durable design and Work documents, exposed to every relevant
responsibility, implemented by Generator, independently checked by Reviewer, and verified again in
a Browser presentation phase. `026` rebuilt a deleted vendor session from bounded public history.
`028` used a real Reflection and speaking Assistant to resolve repaired Project Attention and wake
Planner. OpenCode remains intentionally excluded by operator decision; prior Codex and Claude
session canaries plus deterministic adapter tests retain the supported evidence.

The final repository gate passed with `bun run check`: 322 Backend tests with 1,271 assertions and
50 Frontend tests with 166 assertions, together with runtime verification, typechecks, Biome, and the
Frontend build.

## 2026-07-16: Derived Artifact Summary And Live Runaway Guard

The Harness now derives one concise diagnostic view from terminal Test Run evidence without writing
another artifact or fact model. It reports the execution boundary, cleanup, invariants, evidence,
model usage, and, when HOPI evidence exists, public state plus pending Inbox counts. The source Run
remains immutable and the full logs remain the drill-down authority.

The summary was exercised against both sides of a real failure boundary. The passed `022` artifact
reported eight logical model Runs, zero Active Runs, zero unresolved Attention, zero pending Inbox,
and one done Goal. The earlier failed `016` artifact exposed 339 logical Runs and 183 pending Inbox
events while reducing its timeout message to one line and preserving the full last value in
`run.json`. These reads used no provider calls and did not change either source artifact.

Live execution also has one default ceiling of 50 durable logical Runs. The guard checks at existing
semantic wait boundaries, emits one action when exceeded, and fails through the ordinary Test Run
cleanup path. It adds no watchdog process, heartbeat, product state, exact role-count assertion, or
scenario retry. A deterministic regression proved that it tolerates an in-progress partial manifest,
stops before another semantic read, records the violation once, and seals successful cleanup.

The focused Harness tests passed 15 tests with 59 assertions. The final `bun run check` passed 325
Backend tests with 1,298 assertions and 50 Frontend tests with 166 assertions, together with runtime
verification, typechecks, Biome, and the Frontend build. A Live rerun was not performed because the
changed boundary is test observation and runaway termination; retained real Live artifacts plus the
deterministic lifecycle tests exercise it without spending another model turn.

## 2026-07-16: Historical Handoff Isolation And Notification Liveness

A real Goal exposed the inverse of the earlier Reflection runaway. The previous correction treated
every pending Reflection-sourced Inbox turn as a global assessment owner. An old turn blocked by its
own event-target Attention therefore silenced Reflection for an unrelated, unnotified Goal
Attention. The Kanban correctly showed `Needs you`, but the speaking Assistant never told the user.

The correction narrows ownership instead of adding another status or retry loop. Only an eligible
pending handoff owns the current assessment. Once a handoff has event-target Attention, that failure
is local to the handoff: the Coordinator may reassess newer state while the old turn remains durable
and blocked. Consecutive-handoff protection still bounds a truly unhandled chain, but a handled
speaking turn resets the chain because its effect is convergence, not another failed recovery.

The missing test boundary was composition. Clean notification, terminal speaking failure, restart,
and Reflection loop protection had each been checked independently, but no scenario retained a
poisoned historical handoff while introducing a new unnotified Attention. Deterministic
production-runtime regressions now cover the same Goal, another Goal, another Project, and restart.
The Live Harness also rejects a settled result when an unresolved, unnotified targeted Attention has
no active owner; this is a test oracle only, not a product watchdog or timer.

The four deterministic variants and the complete contract suite passed. The focused real-model
`019` canary passed at
`test-artifacts/reflection-notification-schema-canary-2026-07-16T14-27-00-954Z-f3a5a2a1`
with one speaking Assistant Run and no Reflection model Run. Browser verification first retained an
infrastructure failure at
`test-artifacts/global-assistant-browser-2026-07-16T14-25-00-642Z-80058eb5` when the isolated
automation Chrome stopped answering CDP. Restarting only that owned browser recovered the boundary;
the passing artifact is
`test-artifacts/global-assistant-browser-2026-07-16T14-26-38-636Z-79a57a9a`.

Activation against the existing development Home then exercised the same boundary without a fixture.
Reflection `RF-46969cfe-cbbd-4084-a5da-d4c0298b22e9` found an unresolved, unnotified operational
Attention, handed it to the speaking Assistant, and the Assistant inspected the latest Attempt,
consumed one retry, resolved that exact Attention, and restarted Generator without operator input.
This is the intended liveness result: notify when user action remains necessary, but continue
silently when the Assistant can apply and verify the recovery itself.

The final `bun run check` passed 346 Backend tests with 1,427 assertions and 61 Frontend tests with
194 assertions, together with runtime verification, typechecks, Biome, and the Frontend build.

## 2026-07-16: Recoverable Assistant Tool Conflict Looked Like A Server Crash

An Assistant called `hopi_request_planning` for a terminal Goal before reopening it. The canonical
guard correctly rejected the mutation, and the MCP adapter correctly returned the error to the
model; the same historical turn then reopened the Goal and retried Planning successfully. However,
the internal HTTP boundary classified `GoalControllerError` as an unknown `500` and printed its full
stack under `[mvp api error]`. This looked like a backend crash even though the original PID kept its
port and `/api/state` continued returning `200`.

Expected Goal lifecycle conflicts now return `409` with the concise domain message and bypass the
unexpected-error stack. No new error state or retry mechanism was added. A production-server
contract issues a valid per-turn capability, receives the terminal-Goal conflict from
`/api/internal/assistant-tool`, calls `hopi_read_state` successfully in the same turn, handles the
Inbox event, and verifies the server remains available. A lower-level contract verifies the full
`conflict -> read -> reopen -> request Planning` correction sequence and one durable Goal Input.

The final `bun run check` passed 348 Backend tests with 1,437 assertions and 65 Frontend tests with
211 assertions, together with runtime verification, typechecks, Biome, and the Frontend build.

## 2026-07-17: Role Capacity Was Global But Not Profile-Driven

A Goal appeared stuck in Review with no active Run. Its Generator had actually finished while the
single global Reviewer slot was occupied by another Project; it moved from `queued` to `working`
within two seconds of that healthy Reviewer finishing. The queue was correct, but the incident made
the fixed `reviewer: 1` bottleneck visible.

The profile already documented separate Planner, Generator, and Reviewer capacities, while
Coordinator duplicated `1 / 3 / 1` in two code paths. The profile was therefore not the actual
scheduling source of truth. The three fields remain independent positive integers and now hold
`3 / 3 / 3`; runtime loads them once and supplies the same object to both candidate readiness and
dispatch reservation. Each capacity is global across all Projects and Goals in one Home, rather
than being multiplied per Project or collapsed into one shared Engineering pool.

A deterministic contract distributes four Goals across two Projects for each responsibility. It
proves that three Runs start globally, the fourth stays queued, and one newly available slot admits
exactly one Run. A profile contract separately proves that unequal positive values such as
`2 / 5 / 4` remain valid without making dispatch or retry semantics configurable.

The final `bun run check` passed 359 Backend tests with 1,472 assertions and 75 Frontend tests with
238 assertions, together with runtime verification, typechecks, Biome, and the Frontend build.

## 2026-07-17: Responsibility Attempts Lost Their Model Conversation

Planner, Generator, and Reviewer already retained canonical authority, stable Work source, raw
transcripts, and immutable Attempt diagnostics. They did not retain the vendor Session ID. Any new
Attempt therefore started a new model conversation after Coordinator restart, Pause/Resume,
Attention resolution, operational retry, or a Reviewer rejection, repeating discovery and reasoning
even though it still owned the same Work responsibility.

The correction adds one runtime-only identity rather than separate recovery flows. A provider-neutral
Session belongs to one `Project + Goal + Work + responsibility` pair; an Attempt remains one process
invocation. RoleRunner captures the vendor ID as soon as Codex, Claude, or OpenCode reports it, and
every later Attempt for that pair receives it together with the complete current assignment. A
different Work or responsibility never inherits it, Reflection remains disposable, and canonical
documents remain the only authority. An incompatible transport or explicit vendor rejection clears
the cache and rebuilds once inside the same Attempt. Process transports remain non-resumable.

The same contract now covers interruption, Pause/Resume, Attention continuation, operational retry,
and Generator/Reviewer feedback without encoding those causes in Session state. Deterministic tests
prove Work/role isolation, all three vendor resume commands, immediate ID capture, invalid-session
fallback, and independent Generator/Reviewer continuity through rejection. The restart contract
retains the interrupted Attempt and proves the replacement Generator receives
`restart-generator-session`; the browser Pause contract proves a second Generator Attempt receives
`pause-generator-session`. Passing evidence is retained at
`test-artifacts/restart-during-generator-2026-07-16T18-33-35-291Z-b64da3a5` and
`test-artifacts/pause-resume-browser-2026-07-16T18-37-19-770Z-bb6bf54c`.

Those reruns also exposed two stale test assumptions after managed worktree and delivery projection
changes. The restart case addressed a removed legacy integration path instead of the shared managed
path helper. The Pause and single-Repo Live contracts still required the delivery checkout to remain
unchanged after accepted C1, while execution authority requires it to remain unchanged only before
C1 and then cleanly fast-forward exactly to `hopi/release`. Tests and case documentation now assert
that actual boundary instead of weakening current delivery behavior.

The final `bun run check` passed 367 Backend tests with 1,500 assertions and 76 Frontend tests with
241 assertions, together with runtime verification, typechecks, Biome, and the Frontend build.

## 2026-07-17: Needs You Was Durable But Not Reachable

Goal `G-b560d714-d9e6-4200-8589-cf8b64b89d6a` projected **Needs you**, and its Attention had both a
handled public speaking-Assistant reply and `notifiedAt`. The message was not lost. It was older than
the initial page of the global cross-Project conversation, while the Goal banner opened no exact
context and left the reader at the newest message. From the operator's perspective, Assistant had
said nothing.

The correction adds no notification state or copied message. The banner opens Assistant with the
existing Attention; the conversation matches its canonical reference against public Reflection
turns, loads older pages until the turn is present, focuses it, and binds the ordinary composer to
the same reference. Exact-reference unit regressions cover cross-Goal ID reuse, and the real Goal was
verified in the browser with the decision question outside the initial history page. Future Attention
E2E checks must verify this user-reachable path, not stop at Inbox persistence, `notifiedAt`, or the
Kanban badge.

Frontend typechecks, all 83 Frontend tests, and the production build passed.

## 2026-07-17: A New Direction Left Its Superseded Attention Open

Goal `G-b560d714-d9e6-4200-8589-cf8b64b89d6a` retained an old Work Attention after the operator
rejected that direction and asked for a materially different result. The speaking Assistant correctly
routed the instruction to the Goal and requested revised Planning, but it did not explicitly settle
the blocker that the accepted revision had superseded. Kanban therefore continued to show **Needs
you** even though no old decision was still required.

The correction adds no intent parser, Attention trigger, or Coordinator inference. Each speaking
Assistant turn now has one settlement obligation: after an accepted mutation, reconcile materially
related open targeted Attention from current state. Explicit references are identity hints rather than
the only discovery path. If the mutation satisfies or supersedes a blocker, Assistant resolves its
exact canonical Attention; if the blocker still matters, it remains open and Assistant states the one
remaining decision. Goal mutation tools return the still-open canonical references so that a
successful planning or control call cannot make the unresolved consequence easy to overlook.

Deterministic contracts cover the original shape: an informational follow-up from another Goal does
not settle the blocker, while a later ordinary instruction from that same unrelated page revises the
intended Goal and resolves the old Attention through its durable Input. A real configured-provider
`HOPI-E2E-013` run retained at
`test-artifacts/blocking-attention-continuation-2026-07-17T03-59-42-883Z-3444834d` proved the model
boundary: the information-only turn left Attention open, the later `compact` decision became the only
new Goal Input, Assistant resolved the exact Attention against that Input, and Planner, Generator,
Reviewer, C1, completion, and notification all converged.

That Live run exposed two harness defects after the product behavior had completed. Browser URLs with
non-ASCII Goal IDs were interpolated directly into the WSL-to-Windows script and arrived mojibaked;
all Harness navigation now uses the same Base64 UTF-8 boundary as message text. The case also retained
the obsolete assertion that the delivery checkout never changes, while current authority requires it
to remain untouched before C1 and then cleanly fast-forward to `hopi/release`. The case now asserts the
recorded branch, clean status, exact accepted head, and normalized delivered content. The retained run
is marked failed only by that stale final oracle; it was not repeated after correcting the oracle
because its complete real-model evidence is immutable and another run would repeat roughly 1.8 million
input tokens without exercising a changed product path.

The final checks passed 372 Backend tests with 1,536 assertions and 83 Frontend tests with 279
assertions, together with both typechecks, Biome, and the production Frontend build.

## 2026-07-17: Durable Preferences Needed One Home Authority

The previous repo-local `.hopi/preference.md` was an empty passive snapshot: speaking Assistant could
not read or update it, every Project could become a competing preference source, and downstream
roles received it without Planner deciding whether it mattered. The correction replaces that shape
with one free-Markdown Assistant-home document. Speaking Assistant receives its content and digest
on every turn and is the only writer; Planner receives one immutable Run snapshot and materializes
relevant defaults into design or Work. Generator, Reviewer, Reflection analysis, Goal freshness, and
Kanban receive no preference state or trigger.

Deterministic tests cover Home upgrade, complete-document publication, stale-digest rejection,
clearing, public-turn capability, internal-turn rejection, same-session refresh, session rebuild,
and Planner-only staging. The focused configured-model `HOPI-E2E-032` run retained at
`test-artifacts/durable-preference-judgment-2026-07-17T06-44-41-288Z-4c9546be` then proved the model
boundary through the real Browser and speaking Assistant: an explicit cross-Project preference made
exactly one `hopi_write_preferences` call, while a conflicting one-off instruction changed only its
reply and left the digest unchanged. It used two Assistant Runs, zero Reflection or responsibility
Runs, 31,700 uncached input tokens, and 815 output tokens. Cleanup, browser audit, final screenshot,
Inbox liveness, and Attention checks all passed.

The final repository check passed 377 Backend tests with 1,570 assertions and 89 Frontend tests with
293 assertions, together with runtime verification, both typechecks, Biome, and the production
Frontend build.

## 2026-07-17: Next-Risk Completion Audit

The next audit stops treating every state combination as a new E2E. Existing restart, Pause,
concurrency, vendor-session, multi-Repo, and image-delivery Runs already prove their respective
owners. The remaining high-value gaps are three orthogonal boundaries:

- finish `031` with one zero-provider Browser Run over non-Git rejection, explicit empty-folder
  initialization, scoped monorepo execution, preparation, Preview, and out-of-scope C1 rejection;
- finish the conversation-only variant of `022` with one real multimodal Assistant turn and no
  responsibility chain; and
- add `033`, one zero-provider production-Coordinator E2E proving a dependent Work receives accepted
  predecessor Evidence and immutable Run artifacts through its ordinary staged context.

The `022` canary also serves as the rotating Codex transport proof for `024`: deterministic command
contracts require the explicit HTTPS Responses provider with WebSockets disabled, while the retained
real raw stream must contain no WebSocket setup or fallback diagnostics. No additional full delivery
Run is justified. After these scenarios pass, further Cartesian combinations are below the current
marginal-value threshold unless a failure reveals a shared boundary that existing tests do not own.

The first `031` Browser execution exposed such a Harness boundary before reaching product behavior.
It clicked the Project picker while initial state was still loading, shifted the deterministic host
selection queue, and then kept polling later steps. During that long wait another Browser Harness
client selected an unrelated tab, so targetless `js()` and screenshots continued against that tab.
Browser scripts now bind their created target explicitly, wait for enabled controls, and fail at the
first unmet semantic checkpoint. This is a general Browser execution fix; no Project-source product
rule or scenario-specific retry is added.

The next focused retry also corrected the fixture boundary: a directory below repository-local
`test-artifacts` is, correctly, a Git subdirectory rather than a non-Git or empty source. Those two
fixtures now live under an owned temporary root outside every Git ancestor and are removed through
ordinary Test Run cleanup; the nested monorepo and all durable evidence remain artifact-local.

The first behaviorally passing `031` Run was not accepted as the final cost proof. Its deterministic
Project actions woke the default configured Reflection, which began one real provider turn before
Server cleanup interrupted it, while the scenario had hard-coded zero usage in `run.json`. The
Browser fixture now supplies deterministic speaking Assistant and no-action Reflection runners and
verifies retained runtime usage before reporting zero. This preserves the real completion-notification
orchestration while replacing only the provider boundary; Reflection product behavior remains covered
by its dedicated Live cases.

The first deterministic retry also exposed a test-only vocabulary mistake: Reflection handoff speaks
through the ordinary `internal` Assistant mode, not only `main`. The zero-provider seam now accepts all
three production modes (`main`, `internal`, and `reflection`) and failed scenario reports retain the
assertion stack instead of reducing failures to messages such as `false == true`.

The complete preflight then found a stale `011` oracle. After both Goals reached `done`, the scenario
still required each delivery checkout HEAD to equal its initial commit. That contradicts `INV-05` and
the current C1 contract: the checkout must remain unchanged before C1, then cleanly fast-forward to
the exact accepted `hopi/release`. The scenario now verifies the recorded branch is unchanged, the
checkout is clean, the initial HEAD is an ancestor, the final HEAD equals `hopi/release`, and the
accepted feature content is present. The content oracle ignores LF/CRLF materialization because the
delivery checkout retains the user's Git conversion policy while managed HOPI worktrees deliberately
use `core.autocrlf=false`. No release or checkout product behavior is changed.

The next preflight retry reached `020` and exposed an obsolete Browser adapter rather than a product
failure. Project creation now derives canonical Project and Repo identities from selected folders,
but the script still searched for removed identity inputs and searched visible copy for a canonical
`P-*` ID. It then continued after that failure. Its supposed moved-Repo fixture was also a second Git
worktree on a different branch, which the product correctly rejected instead of treating as the moved
recorded delivery checkout. The scenario is split at the real host-filesystem boundary: Browser links
and configures the Project, the fixture physically renames the linked secondary Repo, then a second
Browser phase performs Rebind and reload verification. Both phases bind their own target and fail at
the first unmet semantic checkpoint; no product selector, identity, or Rebind rule is weakened.

After `020` passed, `030` exposed a product recovery defect. Bootstrap correctly created Project
Attention and disabled scheduling for stale migrated paths, but `/api/state` still unconditionally
opened the missing old integration root. The whole Workspace returned 500, so the operator could not
see the blocker or reach Rebind. State presentation now degrades only the blocked Project's unreadable
Goal expansion: Project identity, Repo bindings, model settings, and Project Attention remain visible;
canonical Goal authority is neither guessed nor mutated. Complete-set Rebind still rebuilds runtime
from validated files before Goals reappear.

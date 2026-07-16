# Agent E2E Harness

Status: unified Test Run artifacts and live scenarios

## Goal

Exercise production Agents through real HOPI state while spending model tokens only on decisions
inside the system under test. Fixed setup, operator actions, waiting, assertions, and evidence
collection belong to deterministic test code rather than another model.

The Harness is test infrastructure. It adds no production document, role, queue, workflow state,
scenario DSL, or fault-injection route.

The zero-context operating procedure and detailed HOPI coverage plan live in
[the E2E test case catalog](./e2e_test_cases.md).

## One Scenario Model

A scenario is ordinary code with four parts:

1. an initial Project state;
2. external operator or runtime actions;
3. invariants checked while state changes;
4. a semantic final outcome.

Scenarios fix inputs and required facts, not model wording, generated IDs, Work count, or incidental
tool order. Every Agent path is allowed when it preserves the invariants and reaches the outcome.

Coverage follows independent risk rather than a one-scenario/one-runner quota. One Test Run may
support more than one catalogued risk, and one risk may combine Contract, Browser, and Live evidence
from different Runs. The catalog owns that mapping; `run.json` does not gain a second coverage schema.
Do not repeat an expensive model path merely to make a row green when existing Live evidence already
proves model judgment or transport and a deterministic boundary proves the remaining scheduler, Git,
process, or UI invariant exactly.

A new Live Run is required only when the unproved behavior depends on model interpretation, a real
vendor transport/session, or interaction between a real model process and production lifecycle.
Deterministic process, publication, and Browser proofs remain the stronger evidence when model output
cannot affect the result.

## Reality Boundary

The full Live E2E starts the production server without injected `AssistantModelRunner` or
`RoleRunner` implementations. The configured Assistant, Reflection, Planner, Generator, and
Reviewer use their normal vendor transports, prompts, tools, worktrees, Attempt stores, publication,
and C1 delivery.

A focused Live canary may replace an unrelated background model role with a deterministic no-action
runner while preserving that role's production trigger, scheduler, and document path. For example,
a multi-Project delivery may use real Assistant and responsibility Agents but deterministic
Reflection when Reflection judgment is covered elsewhere. The Test Run records this boundary and
may claim only the roles that used real transports. This avoids paying for unrelated model reasoning
without mocking the boundary under test.

The Harness may create an isolated Home and a small real Git repository, link it through a public
API, send an ordinary Inbox message, read public state, and inspect existing durable diagnostics.
Those are external setup and observation, not substitutions for Agent decisions.

A process-restart scenario launches Coordinator inside one host process boundary and kills that
boundary rather than calling product shutdown. On Linux the adapter uses a user/PID namespace whose
init death also kills detached Agent descendants; other hosts require an equivalent supervisor or
report the Live case unsupported. HOPI does not gain a child-process registry for a deployment
responsibility already owned by the supervisor.

Browser Harness is reused for operator-visible UI interaction and its screenshot audit. The first
scenario opens the Home-level Assistant from the Projects page and submits its instruction through
the real composer. Public APIs, canonical documents, Git state, and Attempt logs remain the oracle
for internal ordering that a screenshot cannot prove. Project fixture linking uses the public API
because repository selection is setup for this scenario rather than the behavior under test.
Each Test Run gives Browser Harness one artifact-local append-only audit chain. Browser interactions
within that Run are issued serially. Product responsibilities may remain concurrent; parallel
screenshot collection adds no coverage and can corrupt the evidence chain itself. Keeping the chain
inside the Test Run also prevents an earlier Run from invalidating later evidence.

The first Browser Harness script in each Test Run reloads the configured named daemon. That
idempotent initialization may retry before any browser action if the host is still releasing its IPC
endpoint. The shared executor then records the tabs that existed before each script and closes every
tab the script created, including on failure. This keeps browser-process resources bounded across
repeated regressions without making scenarios manage infrastructure. A script may contain several
ordered actions and is never retried after failure because a missing response cannot prove whether a
consequential click already happened. Browser Test Runs remain serial across processes as well as
within one Run. Each invocation retains its created, closed, and leaked target IDs in an
artifact-local append-only resource log. A Run fails immediately when one of its owned targets
remains open; the host browser's unrelated target count is diagnostic only and is never treated as
owned state.

## Live Execution And Artifact Inspection

A live execution always starts from its fixture and invokes every configured real Agent needed for
its claim. It is the only command that may claim those current Agent, scheduling, and publication
paths completed end to end. A focused canary cannot claim a model role replaced by a deterministic
runner.

Artifact inspection is narrower. It opens one retained terminal live artifact with Coordinator and
all Agent runners disabled, then reruns deterministic outcome assertions and current UI screenshots.
It answers whether persisted product truth can still be read and presented; it does not answer
whether current execution code can produce that truth again. Changes to Agent prompts, tools,
scheduling, reconciliation, publication, or Git delivery therefore require another live execution.
Changes limited to assertions, reports, or presentation may inspect the retained artifact first.

Inspection writes a separate artifact that references its source run and records both code
provenances. It never replaces the source `run.json`, action log, screenshots, or runtime evidence.
The source content is hashed before and after inspection. Git implementation files are excluded from
that byte digest, so HEAD, branch, porcelain status, and refs are compared separately for the user
checkout and managed integration. Any semantic mutation fails the inspection.

## One Test Run Artifact

Contract commands, Browser scenarios, Live scenarios, artifact inspections, visual reviews, and a
multi-case Regression all use the same retained Test Run envelope: `run.json`. Its small fixed
contract records the claim, status, start and end time, code provenance, model usage when present,
and references to retained evidence. Scenario-specific JSON, documents, logs, Git repositories, and
screenshots remain the detailed truth; the envelope indexes them rather than copying them into a
second model.

A Regression is only another Test Run whose `children` reference the terminal Test Runs created by
existing scenario commands. It introduces no scenario DSL, dependency graph, workflow state,
database, or alternate result schema. Commands that do not normally retain an artifact, such as the
Contract suite, receive the same envelope from the thin Regression runner.

One read-only artifact summary is derived directly from that envelope and its retained evidence. It
does not write a summary file, alter a terminal Run, or become another fact model. The generic part
reports status, duration, failure phase, last checkpoint and action, cleanup, invariant violations,
evidence counts, and model usage. The HOPI adapter adds the latest public Active Run, unresolved
Attention, Goal lifecycle, and pending Inbox counts when those retained sources exist. Full paths
remain available for drill-down, while the first diagnostic view stays small enough for an Agent to
read without loading every transcript.

### Test Run Lifecycle

A Test Run owns every disposable resource that its scenario creates, such as a HOPI server, child
process, recorder, or browser tab. Ordinary scenario code registers cleanup on that same Test Run;
there is no fixture manager or second lifecycle model. Cleanup is idempotent, runs in reverse
registration order, and may be invoked early when a scenario no longer needs its resources. Final
completion runs any remaining cleanup before collecting evidence and sealing `run.json`.

An owned resource that was deliberately released by scenario behavior is already clean. In
particular, signalling an absent process group is a successful no-op rather than a cleanup failure;
permission errors and a process that remains alive after the bounded stop are still failures. This
keeps crash and restart scenarios on the same ownership model instead of adding a second "crashed"
resource state.

`passed` means execution, verification, and cleanup all succeeded. If the intended outcome passed
but cleanup fails or exceeds its deterministic deadline, the Test Run is `failed` at `cleanup`,
retains the intended status and cleanup diagnostics, and must not claim a clean pass. A cleanup may
provide a bounded force action for resources with a real cancellation primitive. The Harness does
not pretend that a timed-out arbitrary Promise was cancelled; the containing Regression process
boundary remains responsible for terminating a child command that never exits.

Phases, semantic checkpoints, and cleanup boundaries are appended to `actions.jsonl` and emitted as
short console lines while the Run is active. A Regression forwards child output while retaining the
same bytes in its command log. Progress is event-driven rather than a timer heartbeat: silence after
a named checkpoint is useful diagnostic evidence, while periodic noise is not.

Live execution also has one generous logical-Run safety ceiling. The default is 50, above the
current ordinary maximum of 16, and may be raised explicitly for a known experiment. The Harness
counts durable Assistant, Reflection, Planner, Generator, and Reviewer Run manifests while waiting
for semantic outcomes. Crossing the ceiling appends one action and fails through the ordinary
scenario cleanup path before a recursive failure can consume the full wall-clock timeout. This is a
cost and runaway guard, not a required responsibility count, token assertion, retry policy, or
product limit.

`evidence.html` is a generated view over referenced screenshots. It is not authority and may be
recreated from retained files. A visual conclusion belongs to a separate Inspection Test Run that
references the source Run and exact screenshot hashes; it never edits a terminal source artifact.
There is no separate `suite.json`, screenshot-index authority, or `visual-review.json`.

Screenshots are captured while Browser Harness reaches semantic checkpoints. Visual interpretation
happens after a cheap Browser batch and before expensive Live execution by default. A testing Agent
may inspect earlier on failure or later when evidence is equivalent; this timing is judgment, not a
new persisted state machine.

## Layers

The general Harness owns isolated lifecycle, public actions, state sampling, invariant checks,
Browser Harness inspection, artifact retention, and model-usage reporting. It contains no knowledge
of the fixture's source files or test command.

The Project adapter creates one committed Git fixture and verifies its integrated release with the
Project's own command. The initial adapter contains a failing `bun test` for a small TypeScript bug.
It also verifies that the delivery checkout retains its recorded branch and clean status while its
HEAD and content fast-forward exactly to the accepted release.

## First Live Scenario

`goal-delivery` links the failing fixture and uses Browser Harness to send one clear request through
the global Assistant, asking it to find, fix, verify, and deliver the test failure. It then lets the
production system converge without driving individual responsibilities.

The final assertions require:

- the public Inbox event is handled through a real Assistant turn;
- one created Goal reaches `done` without unresolved targeted Attention or active Runs;
- real Planner, Generator, and Reviewer Attempts exist, and integration follows successful Review;
- dependencies are complete whenever their dependent Work is active;
- the managed integration passes the Project adapter and the delivery checkout cleanly fast-forwards
  to the same accepted release;
- the completed Goal renders through the production Kanban UI; and
- the completed speaking turn does not leave a misleading failure activity in the Assistant UI.

Quiescence includes canonical Assistant Inbox events. A done Goal, no active responsibility Run,
and an idle Reflection are insufficient while a Reflection handoff is still pending or its speaking
turn is running.

Blocked settlement also has a liveness boundary. An unresolved targeted Attention with
`notifiedAt: null` is not a settled operator wait: it must still be owned by a running Reflection or
an eligible pending/running speaking turn. An event-target Attention makes only its referenced Inbox
turn ineligible and cannot satisfy ownership for another Attention. Harness waits and failure
diagnostics use this derived fact; HOPI adds no product watchdog, timer state, or notification queue.

Exact responsibility counts and ordering are diagnostic facts, not assertions. Reflection remains
enabled so the run measures its real cost and exposes unnecessary wakeups.

## Evidence And Cost

Each execution receives a local artifact root containing `run.json`, the isolated Home and fixture
Repo when applicable, action log, changed state snapshots, retained Browser screenshots, and Browser
Harness audit reference. The active execution may extend its action log and replace its `running`
report with one terminal report. Runtime cleanup that changes retained evidence, including stopping
the Live server, must finish before that terminal write; repeated cleanup is a no-op. Cleanup
failures and timeouts are retained in the terminal report rather than hidden by a successful domain
assertion. After the terminal boundary, retained evidence is immutable. Existing Assistant,
Reflection, Attempt, prompt, raw transcript, proposal, and Git records remain in their normal
locations under that root rather than being copied into a second fact model. The report records
current code provenance plus the last successful scenario checkpoint. A caught failure also records
the phase in which it occurred, so a presentation assertion cannot masquerade as failed product
delivery.

Browser evidence is captured at semantic checkpoints rather than inferred from an action log. The
Assistant ingress keeps page-loaded, panel-open, composer-filled, message-submitted, and handled-reply
PNGs. Terminal Goal delivery keeps the targetless completion update from the same feed plus default-
viewport Kanban screenshots at both ends of its real horizontal scroller; test code does not change
page zoom to manufacture an all-column image. It does not require a second speaking-Assistant
message that the product contract does not promise. A scenario cannot pass when a required
checkpoint is absent or its target content was not visible. Screenshots are evidence of
presentation, not another source of workflow truth.

For a completed speaking turn, the terminal Assistant checkpoint also rejects a visible error
activity. Raw provider diagnostics remain retained in `events.jsonl` and `transcript.log`; this check
only protects the operator-facing success projection.

Operator text and screenshot paths cross Bun, WSL, PowerShell, Python, and browser JavaScript as
UTF-8 Base64 rather than interpolated source text. The Harness must preserve arbitrary natural
language byte-for-byte; an ASCII-only browser smoke is not sufficient evidence for Assistant input.

### Explicit Unaudited Browser Degradation

Browser audit verification remains required by default. When a host can drive the real browser but
its Browser Harness does not expose `audit_note`, `audit_status`, and `audit_verify`, an operator may
set `HOPI_E2E_ALLOW_UNAUDITED_BROWSER=1` to exercise the remaining browser and Live path. The Harness
must record `auditMode: unavailable-allowed` and `verify.available: false`; it must never synthesize a
successful audit result.

Such an execution may report an unaudited Browser or Live smoke result. It is not a Browser preflight,
full E2E success, immutable Browser audit, or evidence that closes a catalogued Browser layer. The
default strict mode remains the release gate, and HTTP ingress may not replace the real browser in
either mode.

The default root is repository-level `test-artifacts/`, outside every package test-discovery root.
This keeps intentionally broken fixture tests available as evidence without letting Bun execute them
as part of the product suite. `HOPI_E2E_ARTIFACT_ROOT` may select another external location.

The first experiment retains successful and failed roots. Its report counts each production model
Run and sums provider token usage when the raw transport reports it. A failure prints the retained
root before exiting so another Agent can diagnose the exact state without reconstructing it.

The first blank-to-completion baseline reached `done` with two Planner Runs, one Generator, one
Reviewer, one Reflection, and the speaking Assistant path. It consumed 727,032 input tokens, of
which 461,952 were cached, plus 14,329 output tokens. The run found two Harness defects rather than
a product-delivery failure: hidden `.hopi` paths were omitted from usage collection, and shutdown
could occur while a Reflection handoff remained pending in the canonical Inbox. Both are now covered
by deterministic regression tests and the stricter quiescence rule above.

The next blank-to-completion run combined Browser Harness ingress and terminal evidence with the
full production Agent path. It reached `done` through one Assistant, two Planner Runs, one Generator,
one Reviewer, and two Reflection attempts. It consumed 552,160 input tokens, of which 405,248 were
cached, plus 13,524 output tokens. C1 passed the fixture test while the original checkout stayed
unchanged.

That run exposed four Harness or presentation gaps without invalidating product delivery: dynamic
browser text needed byte-safe UTF-8 transport; targetless Goal completion was incorrectly expected
to create a second speaking reply; a recovered provider diagnostic appeared as a public turn error;
and an empty successful Reflection no-op was retried as a failure. The Harness now uses Base64 at
the WSL/browser boundary, asserts the canonical completion update, rejects misleading terminal UI
errors, and treats empty output as `No action` only in Reflection mode. Deterministic regressions
cover each rule so another full model run is required only when it can add semantic coverage.

No checkpoint optimization is added until a real run establishes the expensive prefixes. A later
scenario may begin from a verified reachable snapshot when it tests only a downstream transition,
while at least one blank-to-completion scenario continues to prove the whole path.

## Commands

`bun run e2e:regression` runs the fixed zero-provider Regression profile through Contract, runtime,
and Browser cases. It retains one parent Test Run, child Test Runs, command logs, and a generated
visual gallery. The testing Agent reviews that gallery before invoking `bun run e2e:regression:live`,
which runs configured-provider canaries in a separate parent Test Run. Both commands are thin
orchestration over existing scenario scripts and stop at the first failed child.

From the repository root,
`bun run artifact:review -- <artifact-root> --result=passed|failed --note=<summary>` records a visual
conclusion as a new zero-provider Inspection Test Run. The command records the exact reviewed image
hashes and source provenance; it does not make the review decision or mutate the source.

`bun run e2e:preflight` runs the zero-token contract and browser layers. `bun run e2e` requires that
preflight before starting the live scenario, so deterministic environment, encoding, UI, and
orchestration failures stop before provider capacity is spent. `bun run e2e:live` exists only for
focused Harness development after an already successful preflight.

`bun run test:contract` runs the zero-token orchestration contract. It remains part of the ordinary
repository check and proves HTTP, Coordinator, document, worktree, Attempt, and C1 mechanics with
deterministic runner implementations.

`bun run test:browser` runs the Projects-page Assistant ingress with Browser Harness and a
deterministic Assistant reply. It proves visible interaction, HTTP admission, canonical Inbox
durability, Assistant scheduling, retained checkpoint screenshots, and browser audit integrity
without spending model tokens. It is explicit because Browser Harness is a host capability rather
than a portable unit-test dependency.

`bun run e2e` runs live Agents and therefore consumes configured provider capacity. It is explicit,
retains its evidence, and is not part of the default per-edit check.

Independent high-risk Live commands are `bun run e2e:live:011` (concurrent Projects),
`bun run e2e:live:016` (hard Coordinator replacement), `bun run e2e:live:017` (multi-Repo plus
silent bootstrap), and `bun run e2e:live:022` (multimodal delivery). They are not duplicated in the
default edit loop; invoke the one whose real model/process boundary changed or run the explicit Live
Regression for a release decision.

`bun run artifact:inspect -- <artifact-root>` performs the narrower zero-model inspection described
above. `bun run artifact:inspect:011 -- <artifact-root>` does the same for the concurrent-Project
scenario, and `bun run artifact:inspect:022 -- <artifact-root>` verifies a retained multimodal
delivery. Paths are resolved from the repository root. Each report explicitly records zero Assistant
and responsibility invocations and may never be reported as a new live E2E success.

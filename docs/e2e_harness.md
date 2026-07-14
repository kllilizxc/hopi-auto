# Agent E2E Harness

Status: first live scenario

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

## Reality Boundary

Live E2E starts the production server without injected `AssistantModelRunner` or `RoleRunner`
implementations. The configured Assistant, Reflection, Planner, Generator, and Reviewer use their
normal vendor transports, prompts, tools, worktrees, Attempt stores, publication, and C1 delivery.

The Harness may create an isolated Home and a small real Git repository, link it through a public
API, send an ordinary Inbox message, read public state, and inspect existing durable diagnostics.
Those are external setup and observation, not substitutions for Agent decisions.

Browser Harness is reused for operator-visible UI interaction and its screenshot audit. The first
scenario opens the Home-level Assistant from the Projects page and submits its instruction through
the real composer. Public APIs, canonical documents, Git state, and Attempt logs remain the oracle
for internal ordering that a screenshot cannot prove. Project fixture linking uses the public API
because repository selection is setup for this scenario rather than the behavior under test.

## Live Execution And Artifact Inspection

A live execution always starts from its fixture and invokes the configured production Agents. It is
the only command that may claim the current Assistant, Reflection, responsibility, scheduling, and
publication code completed an end-to-end path.

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

## Layers

The general Harness owns isolated lifecycle, public actions, state sampling, invariant checks,
Browser Harness inspection, artifact retention, and model-usage reporting. It contains no knowledge
of the fixture's source files or test command.

The Project adapter creates one committed Git fixture and verifies its integrated release with the
Project's own command. The initial adapter contains a failing `bun test` for a small TypeScript bug.
It also verifies that the user checkout retains its original branch, HEAD, content, and clean status.

## First Live Scenario

`goal-delivery` links the failing fixture and uses Browser Harness to send one clear request through
the global Assistant, asking it to find, fix, verify, and deliver the test failure. It then lets the
production system converge without driving individual responsibilities.

The final assertions require:

- the public Inbox event is handled through a real Assistant turn;
- one created Goal reaches `done` without unresolved targeted Attention or active Runs;
- real Planner, Generator, and Reviewer Attempts exist, and integration follows successful Review;
- dependencies are complete whenever their dependent Work is active;
- the managed integration passes the Project adapter while the user checkout is unchanged;
- the completed Goal renders through the production Kanban UI; and
- the completed speaking turn does not leave a misleading failure activity in the Assistant UI.

Quiescence includes canonical Assistant Inbox events. A done Goal, no active responsibility Run,
and an idle Reflection are insufficient while a Reflection handoff is still pending or its speaking
turn is running.

Exact responsibility counts and ordering are diagnostic facts, not assertions. Reflection remains
enabled so the run measures its real cost and exposes unnecessary wakeups.

## Evidence And Cost

Each execution receives a local artifact root containing the isolated Home, fixture Repo, action log,
changed state snapshots, final report, retained Browser screenshots, and Browser Harness audit
reference. The active execution may extend its action log and replace its `running` report with one
terminal report; after that terminal boundary, retained evidence is immutable. Existing Assistant,
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

`bun run artifact:inspect -- <artifact-root>` performs the narrower zero-model inspection described
above. Its report explicitly records zero Assistant and responsibility invocations and may never be
reported as a new live E2E success.

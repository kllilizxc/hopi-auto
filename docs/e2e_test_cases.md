# HOPI E2E Test Cases

Status: executable runbook and planned scenario catalog
Last updated: 2026-07-14

This document is the operating entry point for running, diagnosing, and extending HOPI E2E tests.
It assumes the reader has no prior conversation context. The Harness design and evidence boundary
belong to [the E2E Harness design](./e2e_harness.md); product behavior belongs to the MVP design
documents. This file owns test procedure, coverage, priority, and scenario acceptance.

Coverage status is recorded only here. `docs/e2e_test_issues.md` is append-only execution evidence,
and each retained `run.json` is the authority for one invocation. Handoff notes and summaries may
link to these sources but must not maintain another coverage ledger.

## Run A Test With No Prior Context

### 1. Protect The Workspace

Start at the repository root and inspect existing changes before running anything:

```sh
cd "$(git rev-parse --show-toplevel)"
git status --short --branch
```

Do not reset, clean, stash, or overwrite existing work. HOPI tests create ignored, isolated roots
under `test-artifacts/`; they must not require a clean user checkout. Never edit a terminal artifact
to make a failed run pass.

Read these files before changing a scenario:

```text
AGENTS.md
docs/e2e_harness.md
docs/e2e_test_cases.md
```

Read the product authority linked by the scenario when a failure could be either a Harness defect or
a product defect. Do not infer current behavior from historical design documents.

### 2. Verify The Host

HOPI supports macOS, Linux, and WSL. Native Windows is not a supported Coordinator host. Verify Bun
and install dependencies only when they are absent:

```sh
bun run verify:runtime
test -d node_modules || bun install --frozen-lockfile
```

The repository requires Bun `>=1.3.11 <2`. Do not replace Bun commands with Node, npm, pnpm, Jest,
Vitest, or Vite.

Browser scenarios require a real Browser Harness executable:

```sh
command -v codex-browser-harness || command -v browser-harness
```

At least one command must exist. HOPI prefers `codex-browser-harness` when both exist. A nonstandard
installation may be selected explicitly:

```sh
HOPI_BROWSER_HARNESS_COMMAND=/absolute/path/to/browser-harness bun run test:browser
```

Do not replace a missing browser with HTTP requests and still claim browser coverage. On WSL, use an
isolated automation Chrome rather than the operator's everyday Chrome profile.

If the real browser is available but the installed Browser Harness lacks HOPI's audit API, this
explicit diagnostic mode may be used:

```sh
HOPI_E2E_ALLOW_UNAUDITED_BROWSER=1 bun run test:browser
```

It keeps browser interaction, DOM assertions, screenshots, public APIs, and Live Agents real, but
records the missing audit capability instead of fabricating `verify.valid: true`. A pass in this mode
is an unaudited smoke result and must not be reported as Browser preflight, full E2E, or completed
Browser coverage. Strict audit verification remains the default.

Live scenarios also require an authenticated, non-interactive model CLI. Codex is the default.
Supported test overrides are:

```text
HOPI_E2E_TRANSPORT=codex|claude|opencode
HOPI_E2E_MODEL=<optional vendor model>
HOPI_E2E_REASONING_EFFORT=low|medium|high
HOPI_E2E_ARTIFACT_ROOT=<optional absolute artifact directory>
```

`HOPI_E2E_REASONING_EFFORT` applies only to Codex. Transport and model names are expected provenance;
credentials and secret-bearing environment values are not. If the selected CLI cannot authenticate
non-interactively, report the environment blocker before starting an expensive run.

### 3. Choose The Claim Before The Command

| Command                              | Real browser | Real model | What a pass proves                                                                          |
| ------------------------------------ | ------------ | ---------- | ------------------------------------------------------------------------------------------- |
| `bun run check`                      | No           | No         | Type, lint, unit, integration, and deterministic contract behavior                          |
| `bun run e2e:contract`               | No           | No         | Every catalogued deterministic scenario binding passes at its production orchestration seam |
| `bun run e2e:preflight`              | Yes          | No         | Production UI ingress and deterministic orchestration are ready for a live run              |
| `bun run e2e:live`                   | Yes          | Yes        | The configured production Agents completed the current live scenario                        |
| `bun run e2e`                        | Yes          | Yes        | Preflight passed, then the live scenario passed                                             |
| `bun run artifact:inspect -- <root>` | Yes          | No         | Retained live truth is still readable, valid, immutable, and presentable                    |

Only `e2e` and `e2e:live` may be reported as a current real-Agent E2E success. Contract tests use
deterministic implementations at existing adapter seams. Artifact inspection rereads an earlier
real run; it does not reproduce Assistant, Reflection, Planner, Generator, Reviewer, scheduling, or
publication behavior.

Use this applicability rule:

| Changed area                                                                                             | Minimum evidence before reporting success                                         |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Assertions, report formatting, screenshots, or presentation-only UI                                      | `check`, browser preflight, and artifact inspection                               |
| Assistant or role prompts, tools, scheduler, reconciliation, Attention, publication, C1, or Git delivery | `check`, preflight, and a new live run                                            |
| Vendor adapter, model settings, session recovery, image transport, or event normalization                | Contract coverage plus a live run for the affected vendor                         |
| Browser interaction code                                                                                 | Browser preflight and visual inspection of its retained screenshots               |
| New product scenario                                                                                     | Deterministic regression where applicable plus one blank-to-outcome live baseline |

### 4. Run The Gates

For ordinary repository verification:

```sh
bun run check
bun run e2e:preflight
```

For a full real-Agent run after preflight has already passed:

```sh
bun run e2e:live
```

For the complete sequence in one command:

```sh
bun run e2e
```

A live execution can take more than 20 minutes and consume substantial provider capacity. Give the
process at least a 25-minute command timeout. Do not kill it merely because a responsibility Run is
quiet; inspect public state and retained logs first. The current single-Repo baseline used roughly
552,000 input tokens and 13,500 output tokens. Usage is diagnostic rather than a hard pass threshold,
but an unexplained increase should be investigated before accepting a new baseline.

### 5. Locate And Read Evidence

Every command that uses Browser Harness or live Agents prints its artifact root. Preserve that exact
path in the final report. If terminal output was lost, list the newest candidates without deleting
older runs:

```sh
ls -1dt test-artifacts/* | head
```

Assign the exact printed directory before using the diagnostic commands below:

```sh
RUN=/absolute/path/printed/by/the/test
test -d "$RUN"
```

The important files are:

| Path                            | Meaning                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| `run.json`                      | Live status, phase, checkpoint, code provenance, outcome, and model usage  |
| `browser-contract.json`         | Deterministic browser scenario result                                      |
| `inspection.json`               | Independent retained-artifact inspection result                            |
| `actions.jsonl`                 | External actions and semantic checkpoints in time order                    |
| `states.jsonl`                  | Changed public state observations, not timer samples                       |
| `invariants.jsonl`              | First observation of each invariant violation; absent or empty is expected |
| `screenshots/`                  | Required UI evidence captured at semantic checkpoints                      |
| `home/.hopi/runtime/assistant/` | Speaking and Reflection prompts, raw streams, and normalized events        |
| `home/.hopi/runtime/runs/`      | Planner, Generator, and Reviewer Attempt evidence                          |
| `home/.hopi/projects/`          | Managed integration roots and release truth                                |
| `repo/`                         | Original fixture checkout that must remain unchanged                       |

Read the report and action order before opening raw logs:

```sh
sed -n '1,260p' "$RUN/run.json"
sed -n '1,260p' "$RUN/actions.jsonl"
test ! -s "$RUN/invariants.jsonl"
```

Open every required PNG with an image-viewing tool. File existence and byte size do not prove that
the expected state was visible. Screenshots prove presentation only; use documents, APIs, Attempt
records, and Git state for workflow truth.

### 6. Diagnose A Failure Without Rerunning

Use `failedAt` and `lastCheckpoint` in `run.json` first:

| Failure phase                | First evidence to inspect                                | Likely boundary                           |
| ---------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| `startup` or `fixture_setup` | host check, fixture Repo, server stderr                  | Harness or environment                    |
| `assistant_admission`        | Inbox document, Assistant turn, MCP tool events          | Assistant, vendor, or ingress             |
| `agent_execution`            | public state, Work, Attempt manifests, transcripts       | responsibility, scheduler, or publication |
| `domain_verification`        | Goal documents, Attention, C1 refs, project-native tests | product delivery or assertion mismatch    |
| `presentation_verification`  | browser logs and screenshots                             | frontend or Browser Harness               |

`lastCheckpoint: delivery_verified` means the product delivery assertions passed even if a later UI
assertion failed. Do not describe that as an Agent delivery failure. Conversely, a screenshot cannot
upgrade an incomplete or inconsistent canonical state to success.

Find retained diagnostics without parsing model prose into workflow state:

```sh
find "$RUN/home/.hopi/runtime" -type f \( -name attempt.json -o -name turn.json -o -name reflection.json -o -name events.jsonl -o -name transcript.log \) -print
git -C "$RUN/repo" status --short --branch
```

Inspect the exact failed Run's `attempt.json`, `events.jsonl`, `transcript.log`, staged context, and
proposal together. Raw stdout and stderr are diagnostic evidence even when normalization failed.
Check canonical documents to decide whether a model claim was actually published.

If only Harness assertions or current presentation changed, inspect the retained run without
mutating it:

```sh
bun run artifact:inspect -- "$RUN"
```

The command must create a different artifact root, report zero Assistant and responsibility runner
invocations, and prove that source content and Git semantic state did not change.

### 7. Fix And Rerun

Classify the failure before editing:

- Product defect: current behavior violates an accepted MVP document.
- Harness defect: product truth is correct but setup, waiting, assertion, evidence, or cleanup is wrong.
- Model capability variance: the production boundary is correct but the configured model did not reach a valid result.
- Environment failure: browser, provider, executable, port, filesystem, or host prerequisite is unavailable.
- Design gap: observed behavior is reasonable but current authority does not decide whether it is accepted.

For a design gap, update the owning design document before code. For every fixed product or Harness
defect, add the cheapest deterministic regression that would have caught it. Use artifact inspection
for assertion and presentation iteration. Run a new live scenario whenever execution behavior
changed or when the fix's value depends on model judgment.

Do not add a scenario DSL, workflow database, retry framework, hidden fault route, or fixture manager
for one test. A scenario remains ordinary code. Extract shared Harness behavior only after a second
scenario demonstrates the same stable need.

### 8. Report The Result

A zero-context Agent's final report must state:

```text
Claim: preflight | live E2E | artifact inspection
Result: passed | failed | blocked
Scenario: stable scenario ID and name
Artifact: absolute retained root
Code: commit plus dirty/clean provenance from the report
Reality: which browser, Agents, vendors, and project commands were real
Outcome: user-visible and durable semantic result
Cost: model Runs and token usage, or explicitly zero provider calls
Failure: failed phase and first causal evidence when not passed
Gap: untested risk or reason a stronger claim is not justified
```

Never report a deterministic runner as a real model, an artifact inspection as a new execution, or
a Goal reaching `done` before pending Inbox, Reflection, active Run, and Attention facts settle.

## Scenario Model

Each scenario fixes four things only:

1. A reproducible initial Project and Home state.
2. External operator, browser, runtime, or repository actions.
3. Invariants that must hold while the system changes.
4. A semantic outcome visible in durable truth and the product UI.

Generated IDs, exact prose, Work count, responsibility count, tool order, and incidental timing are
diagnostics unless a product contract explicitly owns them. Harness code waits for semantic state,
not arbitrary sleeps. Model freedom ends at durable authority, safety, and verification boundaries.

## Shared Invariants

| ID       | Invariant                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `INV-01` | Canonical documents and validated publication gates are the only workflow authority.                                          |
| `INV-02` | No object has duplicate active Runs, and active Work never precedes an incomplete dependency.                                 |
| `INV-03` | A `done` Goal has no nonterminal Work, active Goal Run, unresolved targeted Attention, or inconsistent completion gate.       |
| `INV-04` | Targeted Attention is the only durable unattended-progress blocker; a silent spinner is never a blocker state.                |
| `INV-05` | User checkouts retain their original branch, HEAD, source, and clean status.                                                  |
| `INV-06` | Generator changes remain isolated until successful Reviewer evidence and C1 publication.                                      |
| `INV-07` | Reviewer is read-only across every Repo in its assigned workspace.                                                            |
| `INV-08` | Public Assistant turns remain FIFO; internal Reflection never speaks or mutates directly.                                     |
| `INV-09` | One semantic Attention notification produces one public reply and one acknowledgement, not duplicates.                        |
| `INV-10` | Restart recovers from durable documents, refs, and logs without fabricating success or repeating C1.                          |
| `INV-11` | Multi-Repo delivery moves the primary C1 boundary once and projects its reviewed manifest without partial pre-C1 integration. |
| `INV-12` | Preview reads only the managed reviewed integration and never the user checkout or unreviewed task worktree.                  |
| `INV-13` | Accepted images remain byte-identical, and Project truth cites only adopted Goal-local assets.                                |
| `INV-14` | Every model process retains its raw stream even when parsing, publication, or presentation fails.                             |

## Coverage Catalog

`Contract` means deterministic model seams with production orchestration. `Browser` means real UI
interaction with deterministic model output. `Live` means the configured production model vendors
and responsibility processes. A scenario may use more than one layer when each layer proves a
different risk.

| ID             | Scenario                                                  | Priority | Layer                      | Status                                            |
| -------------- | --------------------------------------------------------- | -------- | -------------------------- | ------------------------------------------------- |
| `HOPI-E2E-001` | Global Assistant browser ingress                          | P0       | Browser                    | Implemented                                       |
| `HOPI-E2E-002` | Single-Repo autonomous repair and delivery                | P0       | Live                       | Implemented                                       |
| `HOPI-E2E-003` | Immutable artifact inspection                             | P0       | Inspection                 | Implemented                                       |
| `HOPI-E2E-010` | Conversation and page-context boundary                    | P0       | Live Assistant             | Implemented                                       |
| `HOPI-E2E-011` | Multiple user instructions while Goals run                | P0       | Contract/runtime           | Partial; two-Project FIFO runner executed         |
| `HOPI-E2E-012` | Design revision during active delivery                    | P0       | Contract/runtime           | Partial; active-delivery revision runner executed |
| `HOPI-E2E-013` | Blocking question, notification, answer, and continuation | P0       | Live                       | Implemented; full Live path passed                 |
| `HOPI-E2E-014` | Operational failure, bounded recovery, and retry          | P0       | Contract and Browser       | Implemented; full Browser recovery path passed     |
| `HOPI-E2E-015` | Pause and Resume during an active Run                     | P0       | Browser and Contract       | Partial; browser interrupt/recovery runner added  |
| `HOPI-E2E-016` | Process restart during Agent execution                    | P0       | Contract and Live          | Partial; deterministic restart runner implemented |
| `HOPI-E2E-017` | Multi-Repo full-stack delivery                            | P0       | Contract and Live          | Planned; contract regression available            |
| `HOPI-E2E-018` | Multi-Repo conflict and post-C1 projection recovery       | P0       | Contract and Browser       | Planned; contract regression available            |
| `HOPI-E2E-019` | Reflection notification and user priority                 | P1       | Live                       | Planned; contract regression available            |
| `HOPI-E2E-020` | Project linking, Repo rebind, and model settings          | P1       | Contract/runtime           | Partial; rebind persistence runner implemented    |
| `HOPI-E2E-021` | Preview creation, readiness, invalidation, and repair     | P1       | Contract and Live          | Planned; contract regression available            |
| `HOPI-E2E-022` | Image-driven Goal design and implementation               | P1       | Live multimodal            | Planned; contract regression available            |
| `HOPI-E2E-023` | Cancel, archive, and Reopen                               | P1       | Browser and Contract       | Partial; browser lifecycle runner implemented     |
| `HOPI-E2E-024` | Vendor, model, and session compatibility matrix           | P1       | Contract and rotating Live | Planned; contract regression available            |
| `HOPI-E2E-025` | Webhook delivery during transport failure                 | P2       | Contract                   | Implemented                                       |
| `HOPI-E2E-026` | Long conversation and lost vendor session                 | P2       | Contract and Live canary   | Implemented                                       |
| `HOPI-E2E-027` | Silent Project context and preparation bootstrap          | P1       | Contract and Live canary   | Planned; contract regression available            |

`bun run e2e:contract` executes the deterministic regressions below; each uses production
orchestration, durable documents, or real Git/process boundaries rather than a scenario DSL. They
support the scenario designs but are not themselves implementations of the catalogued Browser or Live
scenarios. The current `e2e:live` command runs `HOPI-E2E-002` only, so every row marked Planned still
requires its own executable scenario before it can be reported as covered.

| ID             | Deterministic scenario binding                                             |
| -------------- | -------------------------------------------------------------------------- |
| `HOPI-E2E-010` | `tests/workspaceAssistant.test.ts`                                         |
| `HOPI-E2E-011` | `tests/coordinatorReconciler.test.ts`                                      |
| `HOPI-E2E-012` | `tests/assistantTools.test.ts`, `tests/passOutcomeCoordinator.test.ts`     |
| `HOPI-E2E-013` | `tests/workspaceAssistant.test.ts`, `tests/assistantAttentionE2E.test.ts`  |
| `HOPI-E2E-014` | `tests/projectReconciler.test.ts`                                          |
| `HOPI-E2E-015` | `tests/e2e/pauseResume.browser.ts`                                         |
| `HOPI-E2E-016` | `tests/e2e/restartDuringGenerator.e2e.ts`                                  |
| `HOPI-E2E-017` | `tests/projectReconciler.test.ts`, `tests/multiRepoC1.test.ts`             |
| `HOPI-E2E-018` | `tests/multiRepoC1.test.ts`, `tests/mvpServer.test.ts`                     |
| `HOPI-E2E-019` | `tests/assistantReflection.test.ts`, `tests/coordinatorReconciler.test.ts` |
| `HOPI-E2E-020` | `tests/e2e/configurationRebind.e2e.ts`                                     |
| `HOPI-E2E-021` | `tests/previewManager.test.ts`, `tests/projectReconciler.test.ts`          |
| `HOPI-E2E-022` | `tests/assistantTools.test.ts`, `tests/roleContextStager.test.ts`          |
| `HOPI-E2E-023` | `tests/e2e/cancelReopen.browser.ts`                                        |
| `HOPI-E2E-024` | `tests/workspaceAssistant.test.ts`, `tests/vendorTransport.test.ts`        |
| `HOPI-E2E-025` | `tests/attentionDelivery.test.ts`                                          |
| `HOPI-E2E-026` | `tests/workspaceAssistant.test.ts`                                         |
| `HOPI-E2E-027` | `tests/roleContextStager.test.ts`, `tests/projectReconciler.test.ts`       |

## Detailed Cases

### HOPI-E2E-001: Global Assistant Browser Ingress

| Field   | Value                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| Risk    | The UI appears usable but messages never become durable or remain loading forever.                                         |
| Reality | Real production server, frontend, isolated browser, HTTP admission, Inbox, and Coordinator; deterministic Assistant reply. |
| Fixture | Empty isolated Home.                                                                                                       |
| Cost    | Zero provider calls.                                                                                                       |

Actions:

1. Open `/projects` in Browser Harness.
2. Open the global Assistant panel.
3. Enter a non-ASCII message and submit it through the visible composer.
4. Wait for the canonical Inbox event to become `handled`.
5. Reopen the feed and capture the visible reply.

Pass conditions:

- The exact UTF-8 message is durable and visible.
- Coordinator schedules one speaking turn through the injected runner.
- The final reply is durable and rendered without a permanent loading indicator.
- Page-load, panel-open, composer, submit, and reply screenshots exist and are visually valid.
- Browser audit verification succeeds.

Current implementation: `packages/backend/tests/browser/globalAssistant.browser.ts`.

### HOPI-E2E-002: Single-Repo Autonomous Repair And Delivery

| Field   | Value                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| Risk    | The full Agent chain looks active but cannot safely repair, review, integrate, or explain completion.              |
| Reality | Real Assistant, Reflection, Planner, Generator, Reviewer, worktrees, Git, C1, project test, frontend, and browser. |
| Fixture | One committed Bun project whose clamp test fails because the implementation reverses its bounds.                   |
| Cost    | High; current baseline is approximately 552,000 input and 13,500 output tokens.                                    |

Actions:

1. Link the fixture through the public Project API as setup.
2. Ask the Assistant through the real browser to create a Goal, diagnose, fix, verify, and deliver.
3. Let Coordinator and production Agents converge without driving individual responsibilities.
4. Wait for Goal completion, no active Run, no pending Inbox, and settled Reflection.
5. Verify the integration with the Project's real `bun test` command.
6. Capture the completion update and terminal Kanban.

Pass conditions:

- One admitted Goal reaches `done` through successful real Planner, Generator, and Reviewer Attempts.
- Generator output is published, successful Review precedes C1, and the integration test passes.
- The original checkout remains byte- and Git-unchanged.
- No shared invariant is violated and no targeted Attention remains unresolved.
- The completion update is visible without misleading Assistant error activity.
- The report retains every real model Run and provider usage event.

Current implementation: `packages/backend/tests/live/goalDelivery.live.ts`.

### HOPI-E2E-003: Immutable Artifact Inspection

| Field   | Value                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------- |
| Risk    | Rechecking a result silently reruns Agents, mutates evidence, or falsely claims a new live success. |
| Reality | Production readers and frontend against retained state; Coordinator and all model runners disabled. |
| Fixture | One terminal `HOPI-E2E-002` artifact.                                                               |
| Cost    | Zero provider calls.                                                                                |

Actions:

1. Hash source content and capture user-checkout and integration Git semantic state.
2. Start the production server with calling either model runner treated as failure.
3. Recheck Goal, Attempt, Attention, Inbox, integration, checkout, and UI facts.
4. Shut down and recalculate every source digest.
5. Write a new inspection artifact.

Pass conditions:

- Assistant and responsibility invocation counters remain zero.
- Source bytes, HEAD, branch, porcelain status, and refs are unchanged.
- The new report identifies both source-run and inspector code provenance.
- Its result is labeled artifact inspection, never live execution.

Current implementation: `packages/backend/tests/live/inspectGoalDeliveryArtifact.ts`.

### HOPI-E2E-010: Conversation And Page-Context Boundary

| Field   | Value                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| Risk    | A greeting or question creates unintended Goal effects, or Goal page context behaves like hidden authority. |
| Reality | Real speaking Assistant and vendor session; no responsibility Run should be needed.                         |
| Fixture | One linked Project with one existing Goal and stable canonical documents.                                   |
| Cost    | Low relative to delivery; two or three Assistant turns only.                                                |

Actions:

1. Open the Goal board so the UI supplies page context.
2. Send a greeting.
3. Ask a factual question about the displayed Goal.
4. Send a follow-up that relies on the same conversation session but requests no mutation.
5. Compare Home, Goal package, refs, and Kanban before and after every turn.

Pass conditions:

- Every turn becomes handled in receipt order and produces a concise visible reply.
- Factual replies contain the fixture's actual Goal title, lifecycle, and blocking reason; a
  non-empty error or invented state is not success.
- Read-only state tools are allowed, but no Goal, Input, Work, design, Attention, or ref changes.
- Page context scopes the first read without authorizing mutation.
- A compatible vendor session resumes, and current-turn anchoring prevents an older request from winning.
- No loading or error activity remains after the durable reply.

Primary invariants: `INV-01`, `INV-04`, `INV-08`, `INV-14`.

Current implementation: `packages/backend/tests/live/conversationBoundary.live.ts`.

### HOPI-E2E-011: Multiple User Instructions While Goals Run

| Field   | Value                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| Risk    | A busy Goal blocks conversation, reorders user turns, loses a second instruction, or crosses Project scope. |
| Reality | Real Assistant and responsibility Agents operating concurrently.                                            |
| Fixture | Two small linked Projects with independent failing acceptance tests.                                        |
| Cost    | Very high; baseline and responsibility counts must be recorded before optimization.                         |

Actions:

1. Submit a repair instruction for Project A.
2. Wait for a responsibility Run for Goal A to become active.
3. While A runs, submit a status question followed by a repair instruction for Project B.
4. Let both Projects converge without pausing their role Runs for speaking turns.
5. Inspect both Goal packages, runtimes, release refs, and conversation order.

Pass conditions:

- Public Assistant turns are handled FIFO while Goal Runs continue independently.
- The status answer does not create a third Goal or mutate either contract.
- Each instruction produces effects only in its named Project.
- Both Goals either complete or expose a precise targeted Attention; neither silently stalls.
- Global capacity is respected without encoding an exact incidental Run order in the test.
- Both user checkouts remain unchanged.

Primary invariants: `INV-01`, `INV-02`, `INV-04`, `INV-05`, `INV-08`.

Current implementation: `packages/backend/tests/e2e/multipleInstructions.e2e.ts`
(`bun run e2e:instructions:011`). It runs a production Server with two real Git Projects, keeps
Project A's Generator active while two public Inbox turns arrive, verifies FIFO handling of a status
turn followed by a Project B Goal creation, then completes both scoped deliveries without modifying
either user checkout. Assistant tool selection and role output are deterministic; a real-model
concurrent canary remains pending.

### HOPI-E2E-012: Design Revision During Active Delivery

| Field   | Value                                                                                  |
| ------- | -------------------------------------------------------------------------------------- |
| Risk    | A new requirement lands after planning but stale code is still reviewed or integrated. |
| Reality | Deterministic race coverage plus one real-Agent canary for design judgment.            |
| Fixture | A small UI or API feature with two observably different accepted variants.             |
| Cost    | High for the live canary.                                                              |

Actions:

1. Ask the Assistant to create and implement the initial feature.
2. Wait until Engineering is active.
3. In the same Assistant thread, instruct a material design change and request implementation.
4. Observe Input, design, revision, Planning guard, stale/interrupted Attempt, and replacement Work.
5. Verify the final release against only the revised acceptance behavior.

Pass conditions:

- The user instruction and design update publish before new Planning is requested.
- Material contract change increments revision and invalidates incompatible nonterminal work.
- An old Generator or Reviewer result cannot move the release after its guard becomes stale.
- The final integration and UI implement the latest design, not a mixture of revisions.
- Historical design and Attempts remain available for diagnosis without becoming current authority.

Primary invariants: `INV-01`, `INV-02`, `INV-05`, `INV-06`, `INV-07`.

Current implementation: `packages/backend/tests/e2e/designRevision.e2e.ts`
(`bun run e2e:revision:012`). It uses the production Server, ordinary Inbox ingress, an Assistant
tool boundary, durable Goal revisions, real Git, and deterministic role outcomes. It proves an active
Generator is interrupted by a material revision, then only one fresh Generator and Reviewer outcome
can publish/integrate the revised feature. A real Assistant design-judgment canary remains pending.

### HOPI-E2E-013: Blocking Question, Notification, Answer, And Continuation

| Field   | Value                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Risk    | Work needs a real operator decision but remains silently stuck, asks repeatedly, or resumes before the answer is durable. |
| Reality | Real Planner, Reflection, speaking Assistant, browser, and subsequent responsibility Runs.                                |
| Fixture | Project authority explicitly presents two incompatible valid choices and forbids guessing a default.                      |
| Cost    | High; includes at least one Planner, Reflection, and speaking turn before implementation.                                 |

Actions:

1. Ask HOPI to implement the ambiguous requirement.
2. Wait for a targeted Attention rather than a guessed implementation.
3. Observe `Waiting for Assistant`, then the single direct operator question and `Needs you` projection.
4. Answer through the ordinary Assistant composer with Attention context.
5. Let HOPI publish the answer as Goal Input, resolve Attention, replan, and finish delivery.

Pass conditions:

- One open targeted Attention is the durable blocker and no covered Work is scheduled.
- Reflection does not speak; the persistent Assistant exposes one concise question.
- The question asks only for the decision required to continue and does not leak internal IDs.
- Answer effects publish before Attention resolution.
- Work resumes once, reaches the selected semantic outcome, and does not repeat the notification.
- No pending internal handoff or unresolved Attention remains at terminal state.

Primary invariants: `INV-01`, `INV-04`, `INV-08`, `INV-09`, `INV-14`.

Current implementation: `packages/backend/tests/live/blockingAttention.live.ts` (`bun run e2e:live:013`).
The retained 2026-07-14 run passes the complete configured-provider path: Planner used the exact
canonical Work target, Reflection handed off one direct question, Assistant published the answer and
resolved the blocker, and Planner, Generator, Reviewer, C1, and completion all finished. Earlier
failed artifacts remain retained as evidence for the document-path contract defect and a later
provider TLS outage.

### HOPI-E2E-014: Operational Failure, Bounded Recovery, And Retry

| Field   | Value                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Risk    | A broken command or environment consumes Work attempts, loops forever, or leaves only an unreadable log.                     |
| Reality | Production Coordinator, Attempt store, UI, and process boundary with a deterministic failing executable.                     |
| Fixture | Engineering command fails operationally three consecutive times, then becomes repairable without changing the Work contract. |
| Cost    | Zero provider calls in the main contract scenario.                                                                           |

Actions:

1. Dispatch Engineering into an executable that exits before producing a semantic role result.
2. Observe bounded backoff and restart Coordinator between failures.
3. Reach operational exhaustion and inspect Work projection and Assistant notification.
4. Repair the external condition and request retry through the public Assistant/tool boundary.
5. Let the same Work begin a fresh episode and complete.

Pass conditions:

- Operational failures remain diagnostics and do not consume semantic Work attempts.
- Failure count reconstructs from retained Attempt logs after restart.
- The fixed ceiling creates or reuses one ordinary Work-target Attention.
- Kanban shows a direct blocker rather than an infinite spinner or invented failure stage.
- Raw stdout/stderr is present for every failed process.
- Resolving the exact blocker starts one new episode; success clears the projection without deleting history.

Primary invariants: `INV-01`, `INV-04`, `INV-10`, `INV-14`.

Current implementation: `packages/backend/tests/browser/operationalRecovery.browser.ts`
(`bun run e2e:browser:014`) uses a real failing child process, restarts the production Server between
failures, retains raw stdout/stderr, renders and answers the blocker through the browser, and completes
the same Planning Work in a fresh episode through deterministic Planner, Generator, Reviewer, and C1.

### HOPI-E2E-015: Pause And Resume During An Active Run

| Field   | Value                                                                                  |
| ------- | -------------------------------------------------------------------------------------- |
| Risk    | Pause is cosmetic, an obsolete Run publishes after Pause, or Resume bypasses Planning. |
| Reality | Deterministic interrupt race plus a real role-process canary.                          |
| Fixture | One Goal with a Generator process that can be observed before it completes.            |
| Cost    | Medium to high for the live canary.                                                    |

Actions:

1. Start the Goal and wait for an active Engineering Run.
2. Click the visible Pause control.
3. Observe Run interruption and hold the Goal long enough for multiple reconciliation ticks.
4. Optionally add a new instruction while paused.
5. Click Resume and let required Planning and Engineering finish.

Pass conditions:

- Pause is a Goal lifecycle guard, not a Work stage.
- No new responsibility dispatch occurs while paused.
- An admitted obsolete result cannot publish a Work transition after the Pause guard.
- A paused contract edit remains durable and is included in Resume planning.
- Resume ensures a valid Planning guard before Engineering proceeds.
- The original checkout remains unchanged throughout.

Primary invariants: `INV-01`, `INV-02`, `INV-05`, `INV-06`.

Current partial implementation: `packages/backend/tests/e2e/pauseResume.browser.ts`
(`bun run e2e:browser:015`) uses a production Server, real Browser Harness clicks, managed Git, and
a deterministic interruptable RoleRunner. It clicks Pause during an active Generator, verifies the
durable guard and interrupted Attempt without another dispatch, then clicks Resume and verifies the
fresh Generator/Reviewer/C1 path reaches `done`. The required real role-process canary remains a
separate Live layer.

### HOPI-E2E-016: Process Restart During Agent Execution

| Field   | Value                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| Risk    | A Coordinator crash loses partial work, leaves a permanent running Attempt, duplicates C1, or repeats a notification. |
| Reality | Real model process and production server started as replaceable OS processes against one retained Home.               |
| Fixture | One delivery whose Generator remains active long enough for a process-level interruption.                             |
| Cost    | High. Preserve the first failure artifact rather than repeating blindly.                                              |

Actions:

1. Start the live scenario in a child Coordinator process.
2. Wait for Generator source delta and an active Attempt.
3. Terminate the Coordinator process without deleting Home or worktrees.
4. Start a new Coordinator against the same Home.
5. Let bootstrap, interruption recovery, checkpoint reuse, Review, C1, Reflection, and UI settle.

Pass conditions:

- The old running Attempt becomes durably interrupted and never returns to running.
- Safe Generator source is checkpointed or the stable task branch is rebuilt without contaminating release.
- The replacement Run sees current durable context and does not rely on lost process memory.
- C1 moves at most once for the accepted candidate.
- Completion and Attention notifications are not duplicated.
- Terminal state satisfies every shared invariant and retains both pre- and post-restart logs.

Primary invariants: `INV-02`, `INV-05`, `INV-06`, `INV-09`, `INV-10`, `INV-14`.

Current partial implementation: `packages/backend/tests/e2e/restartDuringGenerator.e2e.ts`
(`bun run e2e:restart:016`) starts a production Coordinator with a real Git fixture, waits for an
active Generator Attempt after a source delta, shuts it down, starts a replacement Coordinator on the
same Home, and asserts the durable interruption, a new accepted Generator/Reviewer path, and exactly
one C1. It uses a deterministic RoleRunner; the required real model process launched as a replaceable
OS child remains a separate missing Live layer.

### HOPI-E2E-017: Multi-Repo Full-Stack Delivery

| Field   | Value                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Risk    | Frontend and backend changes are reviewed or integrated independently and leave an incompatible Project release.        |
| Reality | Real Assistant and responsibility Agents with two real Git Repos and one Project-native cross-Repo check.               |
| Fixture | Primary frontend Repo and secondary API Repo with one failing end-to-end contract requiring compatible changes in both. |
| Cost    | Very high. Run after the single-Repo live baseline passes.                                                              |

Actions:

1. Link both Repos into one Project and record their original checkout state.
2. Ask the Assistant to repair the failing user-visible full-stack behavior.
3. Let Planner choose one or more Work units with explicit Repo workspaces.
4. Let Generator modify the required roots and Reviewer inspect the cumulative multi-root candidate.
5. Verify primary C1, secondary projection, Project tests, and UI outcome.

Pass conditions:

- Canonical Goal, Work, design, and Evidence remain in the primary Project root.
- Work Repo scope covers every changed Repo without requiring one Work per Repo.
- Reviewer sees and remains read-only across the complete assigned workspace.
- No Repo ref moves before the combined candidate is accepted.
- One primary C1 records reviewed Repo heads, then every secondary release projects to its recorded head.
- Cross-Repo native verification and the user-visible feature pass.
- Neither user checkout changes.

Primary invariants: `INV-01`, `INV-05`, `INV-06`, `INV-07`, `INV-11`, `INV-14`.

### HOPI-E2E-018: Multi-Repo Conflict And Post-C1 Projection Recovery

| Field   | Value                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Risk    | A secondary conflict creates partial integration, or a crash after primary C1 causes rollback or inconsistent projection. |
| Reality | Production multi-Repo publication and bootstrap with deterministic role outcomes and real Git refs.                       |
| Fixture | Two reviewed Repo candidates with controllable external ref advances and projection interruption.                         |
| Cost    | Zero provider calls; real Git and browser projection are required.                                                        |

Variants:

1. Advance a secondary target before C1 and attempt integration.
2. Complete primary C1, interrupt before any secondary projection, then restart.
3. Complete one secondary projection, interrupt before the remaining projection, then restart.
4. Put an unexpected value in a secondary release ref after C1 and restart.

Pass conditions:

- A pre-boundary conflict rejects before any Project release ref moves.
- After primary C1, restart completes only missing projections from the durable manifest.
- HOPI never rolls primary C1 back to hide a post-boundary failure.
- An unexpected secondary ref blocks the Project with one project-target Attention.
- UI distinguishes unavailable Project and user action from ordinary Goal execution.
- Repeated bootstrap is idempotent after every recovered boundary.

Primary invariants: `INV-04`, `INV-05`, `INV-10`, `INV-11`, `INV-14`.

### HOPI-E2E-019: Reflection Notification And User Priority

| Field   | Value                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Risk    | Reflection wakes on noise, speaks directly, duplicates handoffs, or delays a new public user message. |
| Reality | Real Reflection and persistent speaking Assistant with controlled semantic state transitions.         |
| Fixture | One normal progressing Goal and one deterministic transition to unnotified targeted Attention.        |
| Cost    | Medium to high depending on the number of semantic digests.                                           |

Actions:

1. Observe normal Planning through delivery progress without injecting user messages.
2. Confirm ordinary intermediate state coalesces until a settled boundary.
3. Create a real unnotified targeted Attention through product behavior.
4. While its internal speaking handoff is running, submit a new public user message.
5. Let the public turn finish, then allow current-state revalidation and Attention notification.

Pass conditions:

- Raw log appends and automatic intermediate progress do not create one Reflection per event.
- Reflection is read-only and either ends silently or creates one internal brief.
- Public input receives speaking priority without cancelling the read-only Reflection model process.
- A stale handoff is discarded before publication.
- The final direct operator message corresponds to current unresolved Attention and appears once.
- Debug UI distinguishes `Completed: sent` from `Completed: no action`.

Primary invariants: `INV-04`, `INV-08`, `INV-09`, `INV-14`.

### HOPI-E2E-020: Project Linking, Repo Rebind, And Model Settings

| Field   | Value                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Risk    | UI configuration changes only presentation, corrupts identity, or affects the wrong Agent scope.      |
| Reality | Real browser and Git; deterministic runner command capture, plus a small live vendor canary.          |
| Fixture | Two local Repos, one movable checkout, and Home/project model defaults that are observably different. |
| Cost    | Zero for browser contract; low for vendor canary.                                                     |

Actions:

1. Create a Project through the visible repository-selection flow with two Repos.
2. Set a Home Assistant model and a different Project coding default.
3. Send one Assistant greeting and dispatch one Project responsibility.
4. Move one checkout and rebind only that Repo through Linked Projects.
5. Reload the server and UI.

Pass conditions:

- Project and Repo identities remain stable and one Repo is primary.
- Assistant uses Home settings while Planner, Generator, and Reviewer use Project settings.
- The actual adapter command, not only the label, contains the selected transport/model.
- Rebind updates only the selected Repo after validation and preserves both user checkouts.
- Reload presents the same links and settings from durable documents.
- Invalid or duplicate Repo identity fails closed with actionable UI feedback.

Primary invariants: `INV-01`, `INV-05`, `INV-14`.

Current partial implementation: `packages/backend/tests/e2e/configurationRebind.e2e.ts`
(`bun run e2e:config:020`) creates two Git Repos, configures distinct Home Assistant and Project
coding defaults, rebinds one secondary Repo to a real checkout of the same Git common directory, and
verifies all links/settings survive Coordinator restart. Browser form submission and an external
adapter-command capture remain separate missing layers.

### HOPI-E2E-021: Preview Creation, Readiness, Invalidation, And Repair

| Field   | Value                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------- |
| Risk    | Preview starts stale code, reports running before ready, survives a new release, or creates duplicate repair tasks. |
| Reality | Real process adapter, managed integration, browser, and one real-Agent repair path.                                 |
| Fixture | One Project with a valid Preview adapter and one Project where the adapter is missing or stale.                     |
| Cost    | Zero for lifecycle contract; high only for model-authored repair.                                                   |

Actions:

1. Start Preview from the UI for the valid fixture.
2. Wait for its explicit ready signal and open the endpoint.
3. Deliver a new C1 and observe automatic Preview stop.
4. Start Preview for the missing/stale adapter fixture.
5. Accept the repair prompt through Assistant, deliver the adapter, and retry Preview.

Pass conditions:

- Preview preparation and process cwd are the managed reviewed integration.
- `starting` becomes `running` only after the ready signal, not merely a live PID.
- Startup failure preserves logs and leaves no running session.
- New release stops Preview with `release_updated` and does not auto-restart it.
- Missing adapter creates one ordinary repair instruction; Assistant reuses an existing repair Goal/Work.
- Multi-Repo runtime manifest names every managed Repo root.

Primary invariants: `INV-05`, `INV-10`, `INV-12`, `INV-14`.

### HOPI-E2E-022: Image-Driven Goal Design And Implementation

| Field   | Value                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------ |
| Risk    | The Assistant loses image context, adopts irrelevant data, exposes Home paths, or later Agents cannot see the reference. |
| Reality | Real browser upload/paste, configured multimodal Assistant, real responsibility Agents, and visual evidence.             |
| Fixture | One reference screenshot and a small frontend Project with semantic and visual acceptance checks.                        |
| Cost    | Very high; run only after text delivery and image transport preflight pass.                                              |

Variants:

1. Attach a relevant product screenshot and request a faithful implementation.
2. Attach an unrelated image during ordinary conversation and request no Project change.
3. Reuse an earlier accepted Home image in a later Goal instruction.

Pass conditions:

- Browser receipt preserves exact image bytes and renders a thumbnail.
- The selected vendor receives the image on new and compatible resumed sessions.
- Relevant image adoption atomically creates a Goal-local asset and `design/references.md` provenance.
- Goal and Work prose cite only portable Goal-local paths; raw Assistant-home paths are rejected.
- Planner, Generator, and Reviewer receive the image path and its stated purpose.
- The irrelevant variant remains conversation-only and creates no Goal effect.
- Final UI passes semantic checks and retains before/reference/after screenshots for human inspection.

Primary invariants: `INV-01`, `INV-05`, `INV-13`, `INV-14`.

### HOPI-E2E-023: Cancel, Archive, And Reopen

| Field   | Value                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| Risk    | Cancellation leaves dependents running, deletes history, or Reopen resumes stale work without a new contract. |
| Reality | Deterministic dependency race and one real Assistant control canary.                                          |
| Fixture | Goal with a dependency chain and at least one active Engineering Run.                                         |
| Cost    | Medium for the live canary.                                                                                   |

Actions:

1. Cancel the active Goal through Assistant or explicit product control.
2. Inspect dependency-order cancellation and the default Kanban view.
3. Enable Show cancelled and inspect retained cards and Attempts.
4. Reopen with a new instruction.
5. Let new Planning and delivery settle.

Pass conditions:

- Cancellation guard lands before dependent Work transitions.
- Nonterminal dependents cancel before their prerequisites and no new Run dispatches.
- Cancelled Work is hidden by default but remains readable in the archive with its evidence.
- Reopen increments the contract revision, creates/ensures Planning, and never reactivates stale Work directly.
- Final completion refers to the reopened contract and does not erase cancellation history.

Primary invariants: `INV-01`, `INV-02`, `INV-05`, `INV-10`.

Current partial implementation: `packages/backend/tests/e2e/cancelReopen.browser.ts`
(`bun run e2e:browser:023`) uses the production Goal control API, production Coordinator, real
Browser Harness, and managed Git. It cancels an active Work plus its dependent, verifies the retained
browser archive, reopens into contract revision two, and completes only newly planned Work. The
required real Assistant control canary remains a separate Live layer.

### HOPI-E2E-024: Vendor, Model, And Session Compatibility Matrix

| Field   | Value                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------- |
| Risk    | A supported vendor renders events but cannot use HOPI tools, images, cancellation, or durable session recovery. |
| Reality | Contract executables for every vendor and a rotating real-provider canary.                                      |
| Fixture | One greeting, one read tool, one Goal creation tool, one image turn, and one interrupted turn.                  |
| Cost    | Keep full delivery on the primary vendor; rotate small live canaries across other vendors.                      |

Matrix:

| Capability                                        | Codex    | Claude   | OpenCode |
| ------------------------------------------------- | -------- | -------- | -------- |
| Non-interactive command and configured model      | Required | Required | Required |
| MCP tool call/result                              | Required | Required | Required |
| Session identity and compatible resume            | Required | Required | Required |
| Vendor switch rebuild from durable public history | Required | Required | Required |
| Image input                                       | Required | Required | Required |
| Process-group interruption and raw transcript     | Required | Required | Required |
| Normalized public event projection                | Required | Required | Required |

Pass conditions:

- Vendor differences stay inside adapter commands and normalization.
- Upper Assistant, Attention, Inbox, session, and delivery semantics remain identical.
- A compatible same-vendor session resumes; a vendor switch starts a new session from durable context.
- Internal Reflection briefs are excluded from reconstructed public conversation history.
- Tool effects are proven by canonical documents rather than assistant prose.
- Stderr and malformed vendor events remain visible without corrupting public success projection.

Primary invariants: `INV-01`, `INV-08`, `INV-13`, `INV-14`.

### HOPI-E2E-025: Webhook Delivery During Transport Failure

Use a local HTTP receiver, never a real external endpoint. Produce one handled public Attention reply,
fail the receiver, restart Coordinator, and then acknowledge the same idempotency key. The webhook
must mirror only the already handled speaking reply, never raw Attention or an ordinary user reply.
Transport failure must back off without blocking reconciliation, and durable `notifiedAt` must remain
owned by speaking-thread publication rather than webhook success.

Primary invariants: `INV-04`, `INV-08`, `INV-09`, `INV-10`, `INV-14`.

Current implementation: `packages/backend/tests/e2e/webhookDelivery.e2e.ts`
(`bun run e2e:webhook:025`).

### HOPI-E2E-026: Long Conversation And Lost Vendor Session

Build enough public turns to cross the reconstruction budget, include internal Reflection activity,
then remove or invalidate the runtime session cache and restart. The next speaking turn must rebuild
from bounded newest public exchanges plus the oldest pending turn, exclude internal Reflection
briefs, preserve accepted image references, and anchor attention on the current Inbox event. Product
truth must remain available from documents even when conversational history is truncated.

The transport assertion and the model assertion are distinct: retained prompts prove which durable
history was supplied, while the final reply proves that the configured model obeyed current-turn
priority. Seeing the newest marker but following an older instruction is a model-contract failure,
not evidence that session storage lost the marker.

Primary invariants: `INV-01`, `INV-08`, `INV-10`, `INV-13`, `INV-14`.

Current implementation: `packages/backend/tests/live/longConversationRecovery.live.ts`
(`bun run e2e:live:026`).

### HOPI-E2E-027: Silent Project Context And Preparation Bootstrap

| Field   | Value                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------- |
| Risk    | A new Project needs a separate initialization workflow, or stale setup knowledge repeatedly wastes Agent Runs. |
| Reality | Production context staging, Planning publication, Engineering preparation, and real Project commands.          |
| Fixture | A linked Repo with native manifests but no root `AGENTS.md` and no `scripts/hopi/prepare`.                     |
| Cost    | Zero for the contract path; medium for one real Planner/Generator canary.                                      |

Actions:

1. Create a Goal through the ordinary Assistant path without running a separate init task.
2. Let the first Planner inspect source and native manifests.
3. Inspect the same Planning proposal for the root `AGENTS.md` supporting write.
4. Dispatch the first real Engineering Work that needs an executable environment.
5. Let Generator create and validate `scripts/hopi/prepare` as part of that Work.
6. Run a later Work after Project dependencies or topology change.

Pass conditions:

- Missing root `AGENTS.md` creates no init Goal, Work, Kanban stage, or operator notification.
- The first Planner writes one concise Project entrypoint in the same atomic Planning publication.
- An existing root `AGENTS.md` is read but never silently replaced.
- Missing `scripts/hopi/prepare` is owned by the first Engineering Work that actually needs it.
- The adapter is executable, idempotent, receives the multi-Repo manifest, and leaves Project source unchanged when run.
- A stale adapter failure returns to Engineering for repair with exact diagnostics instead of creating an initialization state.
- Later responsibilities reuse current `AGENTS.md` and `prepare` rather than rediscovering setup from scratch.

Primary invariants: `INV-01`, `INV-05`, `INV-06`, `INV-11`, `INV-14`.

## Implementation Order

Implement scenarios in this order unless a production incident changes the risk:

1. `HOPI-E2E-010` because it is cheap and directly covers the prior endless-loading and unintended-context risk.
2. `HOPI-E2E-013` because proactive blocker notification and answer continuation are core product promises.
3. `HOPI-E2E-011` because accepting new instructions while work continues is the central operator workflow.
4. `HOPI-E2E-016` because unattended operation is not credible without restart recovery.
5. `HOPI-E2E-017` because multi-Repo support needs one real full-stack proof beyond deterministic Git tests.
6. `HOPI-E2E-012` and `HOPI-E2E-015` for mid-flight change and lifecycle guards.
7. `HOPI-E2E-021` and `HOPI-E2E-022` after core delivery is stable.
8. Rotate `HOPI-E2E-024` vendors rather than multiplying every expensive delivery scenario by three.
9. Add `HOPI-E2E-027` when extending the Project adapter beyond the current fixture.

Do not add one command that runs every live case on each edit. Keep `e2e:preflight` cheap, retain
`HOPI-E2E-002` as the blank-to-completion smoke, and run other live cases by stable individual script
until measured cost justifies a release or scheduled suite.

## New Scenario Checklist

Before marking a planned case implemented:

- Update this document's status and exact semantic acceptance.
- Put generic lifecycle, browser, evidence, waiting, and provenance behavior in the shared Harness.
- Put fixture creation and native verification in a small Project adapter.
- Drive operator-visible behavior through Browser Harness; use public APIs only for explicit setup.
- Use production server and model adapters for every boundary claimed as real.
- Sample shared invariants while state changes, not only at the end.
- Retain raw model streams, normalized events, canonical documents, Git state, action log, and screenshots.
- Add the cheapest deterministic regression for every Harness or product defect discovered by the live run.
- Record the first successful model usage baseline without making exact token count a pass condition.
- Visually inspect screenshots and classify every failed phase before rerunning.
- Reconsider whether any new abstraction can be deleted before declaring the scenario complete.

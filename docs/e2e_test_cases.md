# HOPI E2E Test Cases

Status: executable runbook and coverage catalog
Last updated: 2026-07-17

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
under `test-artifacts/`; they must not require a clean HOPI development checkout. Never edit a terminal artifact
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
HOPI_E2E_MAX_LOGICAL_RUNS=<optional positive integer; default 50>
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
| `bun run e2e:regression`             | Yes          | No         | Every executable zero-provider case in the fixed Regression profile passed                  |
| `bun run e2e:regression:live`        | Yes          | Yes        | Every configured-provider canary in the fixed Live profile passed                           |
| `bun run e2e:live`                   | Yes          | Yes        | The configured production Agents completed the current live scenario                        |
| `bun run e2e`                        | Yes          | Yes        | Preflight passed, then the live scenario passed                                             |
| `bun run artifact:inspect -- <root>` | Yes          | No         | Retained live truth is still readable, valid, immutable, and presentable                    |
| `bun run artifact:summary -- <root>` | No           | No         | Existing Test Run facts are projected into one concise diagnostic view                      |

`bun run artifact:review -- <root> --result=passed --note=<summary>` uses no new Browser interaction
or model call. It records a testing Agent's visual conclusion as a separate Inspection Test Run.

Only `e2e`, `e2e:live`, and `e2e:regression:live` may be reported as a current real-Agent E2E
success. Contract tests use deterministic implementations at existing adapter seams. Artifact
inspection rereads an earlier real run; it does not reproduce Assistant, Reflection, Planner,
Generator, Reviewer, scheduling, or publication behavior.

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

For the complete fixed zero-provider Regression:

```sh
bun run e2e:regression
```

Open its generated `evidence.html` and inspect every referenced checkpoint. Record the conclusion as
a separate immutable Inspection Run, then start provider-consuming cases only after Browser
evidence is acceptable:

```sh
bun run artifact:review -- "$RUN" --result=passed --note="All semantic checkpoints are visible."
bun run e2e:regression:live
```

The Regression runner only invokes existing scenario commands and aggregates their Test Runs. It
does not define scenario behavior, infer visual correctness, retry failures, or choose whether a
changed product area requires Live evidence. It stops at the first failed child so a cheap defect is
diagnosed before later provider capacity is spent.

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
bun run artifact:summary -- "$RUN"
```

The important files are:

| Path                            | Meaning                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- |
| `run.json`                      | Universal Test Run claim, status, provenance, usage, evidence, and children |
| `evidence.html`                 | Regenerable visual gallery; never authority or an automatic visual pass     |
| `browser-contract.json`         | Scenario-specific Browser detail referenced by `run.json`                   |
| `inspection.json`               | Scenario-specific inspection detail referenced by `run.json`                |
| `actions.jsonl`                 | External actions and semantic checkpoints in time order                     |
| `states.jsonl`                  | Changed public state observations, not timer samples                        |
| `invariants.jsonl`              | First observation of each invariant violation; absent or empty is expected  |
| `screenshots/`                  | Required UI evidence captured at semantic checkpoints                       |
| `home/.hopi/runtime/assistant/` | Speaking and Reflection prompts, raw streams, and normalized events         |
| `home/.hopi/runtime/runs/`      | Planner, Generator, and Reviewer Attempt evidence                           |
| `home/.hopi/projects/`          | Managed integration roots and release truth                                 |
| `repo/`                         | Original fixture checkout that must remain unchanged                        |

Read the report and action order before opening raw logs:

```sh
sed -n '1,260p' "$RUN/run.json"
sed -n '1,260p' "$RUN/actions.jsonl"
test ! -s "$RUN/invariants.jsonl"
```

Open every required PNG with an image-viewing tool. File existence and byte size do not prove that
the expected state was visible. Screenshots prove presentation only; use documents, APIs, Attempt
records, and Git state for workflow truth.

Screenshot capture and visual interpretation are deliberately separate. Browser Harness writes each
PNG at its semantic checkpoint during execution. The testing Agent normally reviews one generated
gallery after the zero-provider Browser batch, before Live cases. A failure may be inspected
immediately; equivalent successful evidence may be reviewed together. Do not encode that judgment as
another workflow state.

### 6. Diagnose A Failure Without Rerunning

Start with the read-only summary, then use `failedAt` and `lastCheckpoint` in `run.json` for exact
source detail:

```sh
bun run artifact:summary -- "$RUN"
```

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
| `INV-05` | Delivery checkouts stay on their recorded branch and change only by a clean, exact accepted-release fast-forward.             |
| `INV-06` | Generator changes remain isolated until successful Reviewer evidence and C1 publication.                                      |
| `INV-07` | Reviewer is read-only across every Repo in its assigned workspace.                                                            |
| `INV-08` | Public Assistant turns remain FIFO; internal Reflection never speaks or mutates directly.                                     |
| `INV-09` | One semantic Attention notification produces one public reply and one acknowledgement, not duplicates.                        |
| `INV-10` | Restart recovers from durable documents, refs, and logs without fabricating success or repeating C1.                          |
| `INV-11` | Multi-Repo delivery moves the primary C1 boundary once and projects its reviewed manifest without partial pre-C1 integration. |
| `INV-12` | Preview reads only the managed reviewed integration and never the user checkout or unreviewed task worktree.                  |
| `INV-13` | Accepted images remain byte-identical, and Project truth cites only adopted Goal-local assets.                                |
| `INV-14` | Every model process retains its raw stream even when parsing, publication, or presentation fails.                             |
| `INV-15` | At a settled boundary, every unresolved unnotified targeted Attention has an active Reflection or eligible speaking owner; an ineligible event cannot block unrelated notification. |
| `INV-16` | Before dispatch, a stable task branch contains the current release or Planning owns an exact synchronization conflict; discarding an old task delta always uses a new Work identity. |

## Coverage Catalog

`Contract` means deterministic model seams with production orchestration. `Browser` means real UI
interaction with deterministic model output. `Live` means the configured production model vendors
and responsibility processes. A scenario may use more than one layer when each layer proves a
different risk.

`Partial` means a dedicated Run proves some but not every independently useful reality boundary.
`Planned` means acceptance is designed but the missing boundary has no accepted Run yet. These are
test-coverage states, not product implementation states. A case does not require its own runner when
other retained Runs jointly prove the exact risk; the catalog may close it by citing that composition.

### 2026-07-15 Completion Audit

OpenCode execution is excluded by operator decision. The remaining gaps are reduced by independent
risk rather than mechanically adding one Live runner per row:

| ID    | Decision         | Required new execution                                                                                                                                      |
| ----- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `011` | Keep             | Real Assistant plus responsibilities must accept FIFO cross-Project instructions while one Goal runs.                                                       |
| `012` | Compose          | Existing active-revision Run proves stale-result safety; existing Live delivery proves model design and planning. No duplicate canary.                      |
| `015` | Compose          | Browser lifecycle Run plus real process-group contract proves Pause/Resume; model wording cannot affect the guard.                                          |
| `016` | Keep             | Kill and replace an independently launched Coordinator while a real responsibility process is active.                                                       |
| `017` | Keep             | Real Planner must choose a multi-Repo workspace and deliver one compatible cross-Repo release.                                                              |
| `018` | Compose          | Real multi-Repo Git contracts prove every C1 boundary; Project Attention Browser Runs already prove unavailable/recovery presentation.                      |
| `019` | Compose + canary | Deterministic reconciliation proves priority, preemption, and stale-handoff rejection; one focused configured-provider turn proves the notification schema. |
| `020` | Keep Browser     | Visible multi-Repo linking, settings, and rebind persistence remain unproved; vendor command construction is already Contract evidence.                     |
| `021` | Keep Browser     | Preview readiness, stop, invalidation, and repair prompt need visible product proof; ordinary Agent repair needs no duplicate delivery canary.              |
| `022` | Keep             | A real multimodal Assistant and responsibility chain must preserve one relevant image through delivery.                                                     |
| `023` | Compose          | Browser lifecycle and Assistant-tool contracts prove Cancel/Reopen; a model merely choosing the same validated tool adds no independent safety proof.       |
| `024` | Rotate           | Re-run one small Codex and Claude session canary; do not multiply full delivery by vendor. OpenCode remains skipped.                                        |
| `027` | Fold into `017`  | The multi-Repo Live fixture starts without root `AGENTS.md` or `scripts/hopi/prepare`, proving silent bootstrap in the same Run.                            |

The selected runners cover every execution boundary accepted in the 2026-07-15 audit. `024` reuses
the existing session-recovery runner; OpenCode remains the only operator-approved exclusion. The
2026-07-17 next-risk audit below closes the Project-source scenario, the conversation-only judgment
variant of `022`, and dependency Evidence handoff; earlier terminal evidence remains valid.

| ID             | Scenario                                                  | Priority | Layer                      | Status                                                           |
| -------------- | --------------------------------------------------------- | -------- | -------------------------- | ---------------------------------------------------------------- |
| `HOPI-E2E-001` | Global Assistant browser ingress                          | P0       | Browser                    | Covered                                                          |
| `HOPI-E2E-002` | Single-Repo autonomous repair and delivery                | P0       | Live                       | Covered                                                          |
| `HOPI-E2E-003` | Immutable artifact inspection                             | P0       | Inspection                 | Covered                                                          |
| `HOPI-E2E-010` | Conversation and page-context boundary                    | P0       | Live Assistant             | Covered                                                          |
| `HOPI-E2E-011` | Multiple user instructions while Goals run                | P0       | Contract and Live          | Covered; real chain completed and terminal artifact inspected    |
| `HOPI-E2E-012` | Design revision during active delivery                    | P0       | Contract/runtime           | Covered by revision race plus real delivery evidence             |
| `HOPI-E2E-013` | Blocking question, notification, answer, and continuation | P0       | Live                       | Covered                                                          |
| `HOPI-E2E-014` | Operational failure, bounded recovery, and retry          | P0       | Contract and Browser       | Covered                                                          |
| `HOPI-E2E-015` | Pause and Resume during an active Run                     | P0       | Browser and Contract       | Covered by lifecycle UI plus process-group contracts             |
| `HOPI-E2E-016` | Process lifecycle, exclusion, and restart recovery        | P0       | Contract and Live          | Covered; real Coordinator and Agent process replacement passed   |
| `HOPI-E2E-017` | Multi-Repo full-stack delivery                            | P0       | Contract and Live          | Covered                                                          |
| `HOPI-E2E-018` | Multi-Repo conflict and post-C1 projection recovery       | P0       | Contract and Browser       | Covered by multi-Repo C1 and Project Attention evidence          |
| `HOPI-E2E-019` | Reflection notification and user priority                 | P1       | Live and Contract          | Covered; clean Live canary and four poisoned-history variants passed              |
| `HOPI-E2E-020` | Project linking, Repo rebind, and model settings          | P1       | Browser                    | Covered; native-picker boundary and nine UI checkpoints passed   |
| `HOPI-E2E-021` | Preview creation, readiness, invalidation, and repair     | P1       | Browser and Contract       | Covered                                                          |
| `HOPI-E2E-022` | Image-driven Goal design and implementation               | P1       | Live multimodal            | Covered; relevant delivery and conversation-only variants passed |
| `HOPI-E2E-023` | Cancel, archive, and Reopen                               | P1       | Browser and Contract       | Covered; model choice adds no boundary beyond the validated tool |
| `HOPI-E2E-024` | Vendor, model, and session compatibility matrix           | P1       | Contract and rotating Live | Covered for Codex and Claude; OpenCode intentionally skipped     |
| `HOPI-E2E-025` | Webhook delivery during transport failure                 | P2       | Contract                   | Covered                                                          |
| `HOPI-E2E-026` | Long conversation and lost vendor session                 | P2       | Contract and Live canary   | Covered                                                          |
| `HOPI-E2E-027` | Silent Project context and preparation bootstrap          | P1       | Contract and Live canary   | Covered by the blank multi-Repo fixture in `017`                 |
| `HOPI-E2E-028` | Agent-led Project Attention recovery and reblocking       | P0       | Browser and Live canary    | Covered                                                          |
| `HOPI-E2E-029` | Terminal Assistant provider error                         | P0       | Contract and Browser       | Covered                                                          |
| `HOPI-E2E-030` | Project and Assistant-home migration                      | P1       | Contract                   | Covered; complete-set move and rebind passed                     |
| `HOPI-E2E-031` | Safe Project source selection and scoped execution        | P0       | Browser and Contract       | Covered; scoped lifecycle and C1 escape rejection passed          |
| `HOPI-E2E-032` | Durable cross-Project preference judgment                 | P1       | Live Assistant and Contract | Covered; focused Live judgment canary passed                     |
| `HOPI-E2E-033` | Dependency Evidence and artifact handoff                  | P0       | Contract                   | Covered; production Coordinator handoff passed                    |

`bun run e2e:contract` executes the deterministic regressions below; each uses production
orchestration, durable documents, or real Git/process boundaries rather than a scenario DSL. They
support the scenario designs but are not themselves implementations of the catalogued Browser or Live
scenarios. Dedicated commands exist for the independent Browser and Live boundaries selected by the
completion audit; composed rows deliberately reuse the listed evidence instead of adding a model
call whose output cannot affect the asserted boundary. All designed cases are now covered; OpenCode
is the only intentional execution exclusion.

| ID             | Deterministic scenario binding                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `HOPI-E2E-010` | `tests/workspaceAssistant.test.ts`                                                                                           |
| `HOPI-E2E-011` | `tests/coordinatorReconciler.test.ts`                                                                                        |
| `HOPI-E2E-012` | `tests/assistantTools.test.ts`, `tests/passOutcomeCoordinator.test.ts`                                                       |
| `HOPI-E2E-013` | `tests/workspaceAssistant.test.ts`, `tests/assistantAttentionE2E.test.ts`                                                    |
| `HOPI-E2E-014` | `tests/projectReconciler.test.ts`                                                                                            |
| `HOPI-E2E-015` | `tests/e2e/pauseResume.browser.ts`                                                                                           |
| `HOPI-E2E-016` | `tests/e2e/restartDuringGenerator.e2e.ts`                                                                                    |
| `HOPI-E2E-017` | `tests/projectReconciler.test.ts`, `tests/multiRepoC1.test.ts`                                                               |
| `HOPI-E2E-018` | `tests/multiRepoC1.test.ts`, `tests/mvpServer.test.ts`                                                                       |
| `HOPI-E2E-019` | `tests/assistantReflection.test.ts`, `tests/coordinatorReconciler.test.ts`, `tests/assistantAttentionE2E.test.ts`            |
| `HOPI-E2E-020` | `tests/e2e/configurationRebind.e2e.ts`                                                                                       |
| `HOPI-E2E-021` | `tests/previewManager.test.ts`, `tests/projectReconciler.test.ts`                                                            |
| `HOPI-E2E-022` | `tests/assistantTools.test.ts`, `tests/roleContextStager.test.ts`, `tests/live/conversationImage.live.ts`                    |
| `HOPI-E2E-023` | `tests/e2e/cancelReopen.browser.ts`                                                                                          |
| `HOPI-E2E-024` | `tests/workspaceAssistant.test.ts`, `tests/vendorTransport.test.ts`                                                          |
| `HOPI-E2E-025` | `tests/attentionDelivery.test.ts`                                                                                            |
| `HOPI-E2E-026` | `tests/workspaceAssistant.test.ts`                                                                                           |
| `HOPI-E2E-027` | `tests/roleContextStager.test.ts`, `tests/projectReconciler.test.ts`                                                         |
| `HOPI-E2E-028` | `tests/browser/projectAttentionRecovery.browser.ts`, `tests/coordinatorReconciler.test.ts`                                   |
| `HOPI-E2E-029` | `tests/browser/assistantProviderError.browser.ts`, `tests/workspaceAssistant.test.ts`, `tests/coordinatorReconciler.test.ts` |
| `HOPI-E2E-030` | `tests/e2e/projectMigration.e2e.ts`                                                                                          |
| `HOPI-E2E-031` | `tests/e2e/scopedProjectSource.e2e.ts`                                                                                       |
| `HOPI-E2E-032` | `tests/assistantWorkspaceStore.test.ts`, `tests/workspaceAssistant.test.ts`, `tests/assistantTools.test.ts`, `tests/roleContextStager.test.ts` |
| `HOPI-E2E-033` | `tests/contract/dependencyEvidenceHandoff.test.ts`, `tests/roleContextStager.test.ts`                                      |

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
- The delivery checkout remains clean and unchanged before C1, then fast-forwards exactly to the
  accepted release without exposing unreviewed task files.
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
| Cost    | Low relative to delivery; four Assistant turns only.                                                       |

Actions:

1. Open the Goal board so the UI supplies page context.
2. Send a greeting.
3. Ask a factual question about the displayed Goal.
4. Offer an explicitly non-blocking future suggestion that should not change current delivery.
5. Send a follow-up that relies on the same conversation session but requests no mutation.
6. Compare Home, Goal package, refs, and Kanban before and after every turn.

Pass conditions:

- Every turn becomes handled in receipt order and produces a concise visible reply.
- Factual replies contain the fixture's actual Goal title, lifecycle, and blocking reason; a
  non-empty error or invented state is not success.
- Read-only state tools are allowed, but no Goal, Input, Work, design, Attention, or ref changes.
- The non-blocking suggestion remains durable conversation only; it neither restarts Planner nor
  creates a separate Note state.
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
- Configured Planner, Generator, and Reviewer capacities are enforced globally across both Projects;
  each responsibility can fill its own capacity without being blocked by another responsibility.
- The status answer does not create a third Goal or mutate either contract.
- Each instruction produces effects only in its named Project.
- Both Goals either complete or expose a precise targeted Attention; neither silently stalls.
- Global capacity is respected without encoding an exact incidental Run order in the test.
- Both delivery checkouts remain clean on their recorded branches and reach their accepted releases.

Primary invariants: `INV-01`, `INV-02`, `INV-04`, `INV-05`, `INV-08`.

Current implementation: `packages/backend/tests/e2e/multipleInstructions.e2e.ts`
(`bun run e2e:instructions:011`). It runs a production Server with two real Git Projects, keeps
Project A's Generator active while two public Inbox turns arrive, verifies FIFO handling of a status
turn followed by a Project B Goal creation, then completes both scoped deliveries and verifies each
guarded checkout fast-forward. Assistant tool selection and role output are deterministic; a real-model
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
- The revised Work starts a fresh responsibility conversation and empty workspace; the prior
  revision's workspace remains diagnostic until the Work becomes terminal but is never inherited.
- The final integration and UI implement the latest design, not a mixture of revisions.
- The delivery checkout remains clean during the race and fast-forwards exactly to the accepted C1
  only after revised Review succeeds.
- Historical design and Attempts remain available for diagnosis without becoming current authority.

Primary invariants: `INV-01`, `INV-02`, `INV-05`, `INV-06`, `INV-07`.

Current implementation: `packages/backend/tests/e2e/designRevision.e2e.ts`
(`bun run e2e:revision:012`). It uses the production Server, ordinary Inbox ingress, an Assistant
tool boundary, durable Goal revisions, real Git, and deterministic role outcomes. It proves an active
Generator is interrupted by a material revision, then proves the replacement Generator receives a
fresh revision-scoped session/workspace before only one fresh Generator and Reviewer outcome can
publish/integrate the revised feature. A real Assistant design-judgment canary remains pending.

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
4. Ask an informational follow-up without deciding; verify the Attention remains open.
5. Give a later natural-language decision, optionally from another Goal page and without an explicit
   Attention reference.
6. Let Assistant select the intended Goal, apply the effect, settle the related Attention, and finish
   delivery.

Pass conditions:

- One open targeted Attention is the durable blocker and no covered Work is scheduled.
- Reflection does not speak; the persistent Assistant exposes one concise question.
- The question asks only for the decision required to continue and does not leak internal IDs.
- Explicit reply context is sufficient but not required: semantic target selection plus current state
  finds the same exact Attention from another page.
- An informational follow-up does not resolve the Attention; a later instruction that satisfies or
  supersedes its blocker does.
- Answer effects publish before Attention resolution.
- Work resumes once, reaches the selected semantic outcome, and does not repeat the notification.
- No pending internal handoff or unresolved Attention remains at terminal state.

Primary invariants: `INV-01`, `INV-04`, `INV-08`, `INV-09`, `INV-14`.

Current implementation: `packages/backend/tests/live/blockingAttention.live.ts` (`bun run e2e:live:013`).
The retained 2026-07-14 run passes the complete configured-provider path: Planner used the exact
canonical Work target, Reflection handed off one direct question, Assistant published the answer and
resolved the blocker, and Planner, Generator, Reviewer, C1, and completion all finished. Earlier
failed artifacts remain retained as evidence for the document-path contract defect and a later
provider TLS outage. The retained 2026-07-17 artifact additionally proves that an information-only
follow-up leaves the blocker open before a later natural-language decision settles it; its final Run
status records only the subsequently corrected stale delivery-checkout oracle.

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
4. Repair the external condition and request one Work retry through the public Assistant/tool boundary.
5. Let the same Work begin a fresh episode and complete.

Pass conditions:

- Operational failures remain diagnostics and do not consume semantic Work attempts.
- Failure count reconstructs from retained Attempt logs after restart.
- The fixed ceiling creates or reuses one ordinary Work-target Attention.
- Kanban shows a direct blocker rather than an infinite spinner or invented failure stage.
- Raw stdout/stderr is present for every failed process.
- One Work retry records the Input and atomically resolves only its exact blocker.
- The resolved blocker starts one new episode; success clears the projection without deleting history.

Primary invariants: `INV-01`, `INV-04`, `INV-10`, `INV-14`.

Current implementation: `packages/backend/tests/browser/operationalRecovery.browser.ts`
(`bun run e2e:browser:014`) uses a real failing child process, restarts the production Server between
failures, retains raw stdout/stderr, renders and answers the blocker through the browser, and completes
the same Planning Work in a fresh episode through deterministic Planner, Generator, Reviewer, and C1.
The Assistant fixture intentionally calls only `hopi_control_work: retry`; the test asserts that the
original Work Attention resolves without a second model tool call.

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
- An interrupt that lands during asynchronous dispatch preparation invalidates that admission; it
  cannot install a Run after Pause or Coordinator shutdown.
- An admitted obsolete result cannot publish a Work transition after the Pause guard.
- A paused contract edit remains durable and is included in Resume planning.
- Resume ensures a valid Planning guard before Engineering proceeds.
- The resumed Generator uses the same Work-revision responsibility session and retained workspace
  while producing a distinct Attempt; a file written before Pause remains readable afterward.
- The delivery checkout remains unchanged while paused, then cleanly fast-forwards to the accepted
  release only after Review and C1.

Primary invariants: `INV-01`, `INV-02`, `INV-05`, `INV-06`.

Current implementation: `packages/backend/tests/e2e/pauseResume.browser.ts`
(`bun run e2e:browser:015`) uses a production Server, real Browser Harness clicks, managed Git, and
a deterministic interruptable RoleRunner. It waits for both the Coordinator lease and actual
Generator entry before clicking Pause, verifies the durable guard and interrupted Attempt without
another dispatch, and proves a pre-Pause responsibility-workspace file is readable by the resumed
Attempt. It then clicks Resume and retains the terminal Kanban. The fresh Generator/Reviewer/C1 path
must reach `done`; real process replacement is proven by `016` rather than repeated here.

### HOPI-E2E-016: Process Lifecycle, Exclusion, And Restart Recovery

| Field   | Value                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Risk    | Concurrent Coordinators or a crash around an Assistant/tool or Agent boundary duplicates effects or leaves permanent running state. |
| Reality | Production Coordinators and real responsibility processes started as replaceable OS processes against one retained Home.            |
| Fixture | One paused Goal for an idempotent Assistant design effect, then one delivery with a long-running Generator.                         |
| Cost    | High. Preserve the first failure artifact rather than repeating blindly.                                                            |

Actions:

1. Start one child Coordinator and prove a second production entry cannot acquire the same Home.
2. Let Assistant durably apply one tool effect, then kill Coordinator before its final reply.
3. Start a replacement and verify the pending Inbox turn converges once without repeating the effect.
4. Start delivery, wait for Generator source delta and an active Attempt, and kill Coordinator again.
5. Start the final replacement and let checkpoint recovery, Review, C1, Reflection, and UI settle.

Pass conditions:

- The rejected second Coordinator performs no reconciliation while the owner remains healthy.
- One pending Inbox event, one domain effect, and one public reply survive the Assistant crash window.
- The Assistant turn manifest reaches attempt two and its event stream retains the interrupted-turn resume marker.
- The old running Attempt becomes durably interrupted and never returns to running.
- Safe Generator source is checkpointed or the stable task branch is rebuilt without contaminating release.
- The replacement Attempt resumes the same Generator conversation and responsibility workspace,
  receives current durable context, and can prove a pre-restart scratch file without relying on lost
  OS-process or model memory.
- C1 moves at most once for the accepted candidate.
- Completion and Attention notifications are not duplicated.
- Terminal state satisfies every shared invariant and retains both pre- and post-restart logs.

Primary invariants: `INV-02`, `INV-05`, `INV-06`, `INV-09`, `INV-10`, `INV-14`.

The zero-model contract remains in
`packages/backend/tests/e2e/restartDuringGenerator.e2e.ts` (`bun run e2e:restart:016`). It proves the
replacement Generator receives both the saved vendor session and a pre-restart workspace file. The Live
runner also exercises the production instance lock and Assistant post-tool/pre-reply window before
launching real responsibility processes inside the replaceable host boundary. It then waits for a
Generator source delta, kills that boundary without product shutdown, and starts a final replacement
against the same Home. The boundary must kill detached Agent descendants without deleting durable
files; on Linux the adapter uses a user/PID namespace. A host without an equivalent supervisor cannot
claim this Live case. The complete executable is
`packages/backend/tests/live/processRestart.live.ts` (`bun run e2e:live:016`); it also asserts one
event-specific Goal Input, one design path, one public reply, and one C1 after recovery.

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
- Every delivery checkout reaches its Repo release by clean fast-forward.

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
| Risk    | Reflection wakes on noise, speaks directly, duplicates handoffs, delays a new public user message, or lets one failed historical handoff silence later Attention. |
| Reality | Real Reflection and persistent speaking Assistant with controlled semantic state transitions.         |
| Fixture | One normal progressing Goal, one deterministic transition to Assistant-owned targeted Attention, and a variant with an older Reflection turn blocked by event-target Attention. |
| Cost    | Medium to high depending on the number of semantic digests.                                           |

Actions:

1. Observe normal Planning through delivery progress without injecting user messages.
2. Confirm ordinary intermediate state coalesces until a settled boundary.
3. Create a real Assistant-owned targeted Attention through product behavior.
4. While its internal speaking handoff is running, submit a new public user message.
5. Let the public turn finish, then allow current-state revalidation and Attention notification.
6. Run one focused configured-provider turn that calls `hopi_notify_user({ message })`; confirm the
   informational message records delivery but remains **Waiting for Assistant** and receives a
   correction turn rather than becoming **Needs you**.
7. Run the actionable variant with `hopi_request_user({ message })`; confirm **Needs you** points at
   that exact public event. Send an unrelated Goal message and confirm it does not clear the request,
   then use its Reply control and confirm only that correlated response returns ownership to Assistant.
8. In the poisoned-history variant, retain one older blocked internal turn, create an independent
   Assistant-owned Goal Attention, restart at one boundary, and let the system converge.

Pass conditions:

- Raw log appends and automatic intermediate progress do not create one Reflection per event.
- Reflection is read-only and either ends silently or creates one internal brief.
- An eligible pending internal brief suppresses duplicate Reflection handoffs; an event-blocked
  brief suppresses only its own retry and does not silence newer Goal or Project Attention.
- Public input receives speaking priority without cancelling the read-only Reflection model process.
- A stale handoff is discarded before publication.
- The final direct operator message corresponds to current unresolved Attention and appears once.
- Informational delivery never projects **Needs you**; only `request_user` installs
  `operatorRequest`.
- Only a user event with exact `replyTo` correlation clears that request; adjacent ordinary messages
  do not.
- The configured speaking model accepts the current notification schema; only its supplied message is public.
- Debug UI distinguishes `Completed: sent` from `Completed: no action`.
- Same-Goal, another-Goal, another-Project, and restart variants all notify the new Attention once
  while preserving the old blocked turn until its own Attention is resolved.
- Handling a handoff resets loop detection. Recovery settles without creating a new loop-exhaustion
  Workspace Attention merely because several speaking effects changed the digest.

Primary invariants: `INV-04`, `INV-08`, `INV-09`, `INV-14`, `INV-15`.

The focused Live canary in `packages/backend/tests/live/reflectionNotification.live.ts`
(`bun run e2e:live:019`) proves the configured speaking model, notification schema, raw stream, and
Assistant-panel presentation. Deterministic production-runtime compositions prove poisoned-history
isolation for the same Goal, another Goal, another Project, and restart boundaries. Together these
layers cover the semantic risk without repeating four costly model calls whose output cannot affect
the asserted ownership boundary.

### HOPI-E2E-020: Project Linking, Repo Rebind, And Model Settings

| Field   | Value                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Risk    | UI configuration changes only presentation, corrupts identity, or affects the wrong Agent scope.      |
| Reality | Real browser and Git; deterministic runner command capture, plus a small live vendor canary.          |
| Fixture | Two local Repos, one movable checkout, and Home/project model defaults that are observably different. |
| Cost    | Zero for browser contract; low for vendor canary.                                                     |

Actions:

1. Cancel the system directory chooser and verify no draft or Project is created.
2. Select two checkouts of one Git Repo and verify submission fails before any Project link exists.
3. Remove the duplicate, select a second Repo, choose the primary, and create the Project once.
4. Set a Home Assistant model and a different Project coding default.
5. Move one checkout, rebind only that Repo through Linked Projects, then reload the server and UI.

Pass conditions:

- Project and Repo identities remain stable and one Repo is primary.
- Assistant uses Home settings while Planner, Generator, and Reviewer use Project settings.
- The actual adapter command, not only the label, contains the selected transport/model.
- Rebind updates only the selected Repo after validation and preserves both checkout branches and content.
- Reload presents the same links and settings from durable documents.
- Invalid or duplicate Repo identity fails closed with actionable UI feedback.
- Repository paths enter the create form only through the Coordinator-host chooser boundary.

Primary invariants: `INV-01`, `INV-05`, `INV-14`.

Current implementation: `packages/backend/tests/e2e/configurationRebind.e2e.ts`
(`bun run e2e:config:020`) drives the Coordinator-host chooser through Browser Harness. It proves
cancel is inert, duplicate Git identity is rejected before any Project link exists, and two distinct
Repos are submitted behind one Project creation gate. The same Run configures distinct Home Assistant
and Project coding defaults, rebinds one Repo, restarts the Coordinator, reloads the UI, and retains
nine screenshots. Adapter-command construction remains in the vendor/configuration Contract tests
because repeating the same choice through a model would not add another execution boundary.

### HOPI-E2E-030: Project And Assistant-Home Migration

| Field   | Value                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| Risk    | Moving Home and several Repos loses portable state, resumes against stale paths, or repairs only half the Project. |
| Reality | Production stores, server bootstrap, real Git worktree administration, and an isolated destination root.           |
| Fixture | Two-Repo Project with Goal Input/design/image provenance, Inbox history, session, and open Project Attention.      |
| Cost    | Zero provider calls; real Git and filesystem moves.                                                                |

Actions:

1. Create portable Project and Assistant-home state, then stop the source Coordinator.
2. Move Home and both Git Repos so every recorded local path is stale.
3. Start against the moved Home and verify no Agent work becomes eligible.
4. Submit the complete stable Repo-ID mapping through one rebind operation.
5. Resolve the retained Attention, restart, and inspect portable state and Git projections.

Pass conditions:

- `homeId`, Project/Goal identity, contract revision, DAG, Input, design, image bytes, Inbox reply,
  session, Attention identity, Project manifest, and release refs survive.
- A partial or mismatched Repo set is rejected without changing `projects.yml`.
- Complete rebind repairs every managed worktree and publishes all local paths together.
- Old managed paths are absent, adjacent managed roots follow the rebound Repos, and no Agent Run
  begins before valid bindings.
- Restart after rebind is clean and idempotent; a missing primary managed root still fails closed.

Primary invariants: `INV-01`, `INV-02`, `INV-04`, `INV-05`, `INV-10`, `INV-11`, `INV-14`.

Current implementation: `packages/backend/tests/e2e/projectMigration.e2e.ts`
(`bun run e2e:migration:030`) moves one complete Home plus two Repos, proves stale startup dispatches
no Agent, rejects partial rebind without changing `projects.yml`, and repairs the exact stable Repo-ID
set in one operation. It then restarts and byte-checks identity, Goal documents, image provenance,
Inbox reply, session, Attention, release refs, delivery bindings, and relocated managed roots.

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
- Missing adapter creates one ordinary repair instruction carrying the viewed Goal context; Assistant
  reuses an existing repair Goal/Work when appropriate, otherwise its reply names the new or reopened
  Goal ID so the operator can find its Kanban.
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

Current implementations: `packages/backend/tests/live/multimodalDelivery.live.ts`
(`bun run e2e:live:022`) proves variant 1 through real Assistant, Planner, Generator, Reviewer, C1,
and Browser presentation. `packages/backend/tests/live/conversationImage.live.ts`
(`bun run e2e:live:022:conversation`) proves variant 2 with one configured multimodal Assistant turn,
byte-identical receipt, and no Goal, Input, design, Work, Attention, responsibility Run, or Git
effect. Its accepted 2026-07-17 artifact is retained at
`test-artifacts/conversation-only-image-judgment-2026-07-17T13-47-59-750Z-78bfa429`; it also provides
the rotating Codex HTTPS-only raw-stream canary for `024`. Deterministic Assistant-tool coverage
proves adoption, design-only reuse, and portable paths without repeating the expensive delivery chain.

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

Current implementation: `packages/backend/tests/e2e/cancelReopen.browser.ts`
(`bun run e2e:browser:023`) uses the production Goal control API, production Coordinator, real
Browser Harness, and managed Git. It cancels an active Work plus its dependent, verifies the retained
browser archive, reopens into contract revision two, completes only newly planned Work, and retains a
second terminal Kanban capture proving that the reopened Work completed without erasing the archive.
Assistant tool selection is covered by the shared control contracts; adding a model call that can
only select the same validated operation would not add another safety boundary.

### HOPI-E2E-024: Vendor, Model, And Session Compatibility Matrix

| Field   | Value                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------- |
| Risk    | A supported vendor renders events but cannot use HOPI tools, images, cancellation, isolated configuration, or durable session recovery. |
| Reality | Contract executables for every vendor and a rotating real-provider canary.                                      |
| Fixture | One greeting, one read tool, one Goal creation tool, one image turn, and one interrupted turn.                  |
| Cost    | Keep full delivery on the primary vendor; rotate small live canaries across other vendors.                      |

Matrix:

| Capability                                        | Codex    | Claude   | OpenCode |
| ------------------------------------------------- | -------- | -------- | -------- |
| Non-interactive command and configured model      | Required | Required | Required |
| MCP tool call/result                              | Required | Required | Required |
| Assistant and responsibility session identity     | Required | Required | Required |
| Compatible resume and invalid-session rebuild     | Required | Required | Required |
| Revision-scoped responsibility workspace           | Required | Required | Required |
| Vendor switch rebuild from durable public history | Required | Required | Required |
| Image input                                       | Required | Required | Required |
| Process-group interruption and raw transcript     | Required | Required | Required |
| Normalized public event projection                | Required | Required | Required |

Pass conditions:

- Vendor differences stay inside adapter commands and normalization.
- Every Codex invocation selects the explicit HTTPS Responses provider with WebSocket support
  disabled; it never depends on an implicit CLI transport preference or fallback.
- Upper Assistant, Attention, Inbox, session, and delivery semantics remain identical.
- A compatible same-vendor speaking or Work responsibility session resumes; a vendor switch starts
  a new session from durable context.
- Responsibility sessions never cross Work, role, or material Work-revision boundaries, and
  Reflection never inherits one.
- Interrupted responsibility files remain available to the compatible replacement Attempt and are
  never reconstructed from model memory alone.
- Codex responsibility commands ignore implicit user configuration while retaining explicit HOPI
  model, reasoning, sandbox, network, writable roots, authentication, and project instructions.
- Internal Reflection briefs are excluded from reconstructed public conversation history.
- Tool effects are proven by canonical documents rather than assistant prose.
- Stderr and malformed vendor events remain visible without corrupting public success projection.
- The rotating Codex Live canary retains the raw stream and fails if it observes WebSocket setup,
  TLS-to-WebSocket fallback, or transport retry diagnostics.

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
priority. The recovery turn must ask for the newest public-history marker without repeating any
marker value itself; otherwise a matching reply proves only current-turn copying. The reply must
contain the newest marker, exclude the older marker, and exclude internal Reflection content.
Seeing the newest marker in retained history but following an older instruction is a model-contract
failure, not evidence that session storage lost the marker.

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

### HOPI-E2E-028: Agent-Led Project Attention Recovery And Reblocking

| Field   | Value                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| Risk    | Assistant claims recovery but Project remains ineligible, or a wrong judgment leaves Kanban silently stuck.       |
| Reality | Production Server, Coordinator, Assistant tool boundary, real Browser Harness, Git worktree, and task checkpoint. |
| Fixture | One active Goal covered by Project Attention; the post-resolve Generator reaches a failing checkpoint boundary.   |
| Cost    | Zero provider calls for Browser coverage; low for the separate real-Assistant canary.                             |

Actions:

1. Open the Goal Board with one Project Attention.
2. Verify the Project banner and ordinary waiting Work projection.
3. Ask Assistant to resolve the Project Attention through its normal tool boundary.
4. Hold the resumed Planner long enough to observe the unblocked working state.
5. Let Planning publish an Engineering Work whose next real task checkpoint fails closed.
6. Observe the replacement Project Attention and blocked Board state.

Pass conditions:

- Project Attention reason and creation time appear in the banner and Current Focus.
- Covered Work has `project_ineligible` and `waiting`, never an invented `Needs you` badge.
- Only a successful `hopi_resolve_attention` closes the original Attention, restores eligibility,
  and wakes a Planner Attempt.
- While Planner runs, the Project banner is absent and the Planning card is visibly working.
- A later execution-boundary failure creates a new Project Attention with a different identity and
  current reason; the original remains resolved as history.
- Reblocking does not create Goal- or Work-target Attention or perform destructive checkout mutation.

Primary invariants: `INV-01`, `INV-04`, `INV-05`, `INV-10`, `INV-14`.

Current Browser implementation: `packages/backend/tests/browser/projectAttentionRecovery.browser.ts`
(`bun run e2e:browser:028`). It uses deterministic model seams but production orchestration, UI,
Git worktrees, tool execution, and checkpoint failure. The configured-provider canary is
`packages/backend/tests/live/projectAttentionRecovery.live.ts` (`bun run e2e:live:028`); it verifies
that a real Assistant inspects already-applied external repair evidence, receives a successful
resolve tool result, and wakes a real Planner. It does not claim the read-only Assistant performed
the external repair itself or that the Goal completed. Both layers passed in the final integrated
2026-07-14 regression; the earlier provider-quota failure remains only as historical issue evidence.

### HOPI-E2E-029: Terminal Assistant Provider Error

| Field   | Value                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Risk    | A terminal provider failure appears as repeated generic status, false success, or endless work.       |
| Reality | Production Server, Coordinator, durable Assistant runtime, Browser Harness, and conversation UI.      |
| Fixture | One deterministic speaking turn emits Claude init, retry, synthetic reply, and terminal error events. |
| Cost    | Zero provider calls.                                                                                  |

Actions:

1. Submit one public Assistant message through the Browser.
2. Emit representative Claude retry telemetry followed by terminal provider failure.
3. Wait for the failed runtime manifest and event-target Attention.
4. Reopen the Assistant conversation and inspect the terminal error presentation.

Pass conditions:

- Terminal `is_error` wins over a contradictory `success` subtype.
- The event-specific speaking manifest remains at `attempt: 1`; Coordinator creates one event-target
  Attention and does not retry that user turn.
- Reflection may independently inspect the new Attention. Its runner invocation is not a retry of the
  failed speaking turn and therefore does not affect the event-specific attempt assertion.
- Cached session recovery is not attempted for provider failure.
- The conversation displays the provider error once, stops showing `Working`, and exposes neither
  repeated generic `system` rows nor false `success`.
- Raw retry and terminal events remain durable for diagnostics.

Primary invariants: `INV-01`, `INV-05`, `INV-10`.

Current Browser implementation: `packages/backend/tests/browser/assistantProviderError.browser.ts`
(`bun run e2e:browser:029`).

### HOPI-E2E-031: Safe Project Source Selection And Scoped Execution

| Field   | Value                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Risk    | A selected subdirectory is widened to its Git root, or empty/non-Git selection initializes or captures source without consent. |
| Reality | Production host-chooser boundary, Browser UI, Server, durable Project links, real Git/worktrees, preparation, and Preview.      |
| Fixture | One empty directory, one non-empty non-Git directory, and one monorepo with a selected app plus an out-of-scope sibling sentinel. |
| Cost    | Zero provider calls; role outcomes are deterministic because model wording cannot change path or Git safety.                    |

Actions:

1. Return a non-empty non-Git directory from the chooser and verify rejection without filesystem or Project effects.
2. Return an empty directory, require explicit UI confirmation, then initialize it as one `main` Repo and create the Project.
3. Select `apps/storefront` inside an existing monorepo and create a separate Project from that source scope.
4. Reload Coordinator and UI, then run one deterministic Planning/Engineering/Review/C1 path inside the selected app.
5. Run Repo preparation and Preview from the reviewed scoped integration and attempt one out-of-scope task mutation.

Pass conditions:

- Empty initialization occurs only after confirmation and a second emptiness check; failure removes only Git metadata created by that attempt.
- A non-empty non-Git directory and `.git`/`.hopi` metadata scopes are rejected without mutation or a partial Project link.
- `projects.yml` stores the canonical Git `repoPath` plus portable `projectPath`, and reload renders the selected source scope.
- Project `AGENTS.md`, `scripts/hopi/prepare`, responsibility cwd, and Preview resolve beneath `projectPath` while Git/worktree ownership remains at the Repo root.
- C1 accepts scoped source, fast-forwards the selected delivery checkout, and deterministically
  rejects a task commit that changes the sibling sentinel; the sibling remains unchanged.
- The complete link remains one publication gate and creates no Init Goal, Work, model Run, or extra workflow state.

Primary invariants: `INV-01`, `INV-04`, `INV-05`, `INV-06`, `INV-10`, `INV-12`, `INV-14`.

Implementation should extend the existing Project-link Browser fixture rather than create a second
chooser abstraction. Backend directory classification and scoped C1 tests remain the exact Contract
oracles; Browser evidence proves confirmation, error presentation, reload, and visible scope. A Live
model canary is not required unless implementation exposes a later decision that genuinely depends
on model interpretation.

The Browser runner keeps one production directory-picker queue and exercises all three source
classes in order. Deterministic responsibility outcomes are sufficient because the safety result is
owned by path classification, managed Git, scoped context/cwd, preparation, Preview, and C1 rather
than by model judgment. Its retained artifact must include the pre/post filesystem digests, durable
`projects.yml`, scoped responsibility paths, Preview process evidence, visible screenshots, and the
rejected out-of-scope integration result.

Current implementation: `packages/backend/tests/e2e/scopedProjectSource.e2e.ts`
(`bun run e2e:source:031`). The accepted zero-provider 2026-07-17 artifact is retained at
`test-artifacts/safe-scoped-project-source-2026-07-17T13-46-43-771Z-9310a3d7` with twelve screenshots,
actual zero provider usage, clean cleanup, and an unchanged sibling checkout after C1 rejection.

### HOPI-E2E-032: Durable Cross-Project Preference Judgment

| Field   | Value                                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| Risk    | Assistant forgets reusable feedback, stores one-off direction as a global rule, or silently changes active delivery. |
| Reality | Real Browser ingress and configured speaking Assistant; canonical Home document; deterministic Reflection.          |
| Fixture | Empty Home with no linked Project or Goal.                                                                            |
| Cost    | Two speaking-Assistant calls; no Planner, Generator, Reviewer, or delivery chain.                                     |

Actions:

1. Send one explicit durable preference that applies across Projects.
2. Wait for the public reply, then inspect the canonical Home preference and normalized tool stream.
3. Send a conflicting instruction explicitly limited to the current reply.
4. Compare the preference digest and inspect public state after the second reply.

Pass conditions:

- The first turn calls `hopi_write_preferences` once and records the reusable default as free
  Markdown under Assistant Home.
- The second turn follows the local instruction without calling the preference writer or changing
  the preference digest.
- Neither preference write nor one-off direction creates a Project, Goal, Planning request,
  responsibility Run, Attention, or Reflection trigger of its own.
- Deterministic contracts prove stale-digest rejection, empty-document clearing, same-session
  refresh, session rebuild, Planner-only immutable staging, and downstream role isolation.
- Browser screenshots, canonical documents, normalized events, raw Assistant streams, and model
  usage remain in the ordinary Test Run artifact.

Current Live implementation: `packages/backend/tests/live/preferenceJudgment.live.ts`
(`bun run e2e:live:032`). The accepted 2026-07-17 run is retained at
`test-artifacts/durable-preference-judgment-2026-07-17T06-44-41-288Z-4c9546be`.

### HOPI-E2E-033: Dependency Evidence And Artifact Handoff

| Field   | Value                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| Risk    | A dependent Work starts too early, repeats predecessor discovery, or cannot resolve accepted Run artifacts.       |
| Reality | Production Coordinator, RoleContextStager, durable Goal documents, immutable Run artifacts, real Git, and C1.     |
| Fixture | One Planning Work and two Engineering Works where the second transitively depends on the first accepted artifact. |
| Cost    | Zero provider calls; deterministic roles inspect the exact context that a configured Agent receives.              |

Actions:

1. Let Planner publish one sparse `W-produce -> W-consume` dependency chain.
2. Have the first Generator change source and emit one artifact outside canonical Project documents.
3. Accept and integrate that Work through Reviewer and C1.
4. Observe the Coordinator dispatch the dependent Generator only after the predecessor is done.
5. Read the predecessor Work, Evidence, and artifact manifest from the dependent Run context, then
   finish its ordinary Generator, Reviewer, C1, and completion path.

Pass conditions:

- `W-consume` never dispatches before `W-produce` is terminal and accepted.
- The dependent immutable authority includes the transitive predecessor Works and their referenced
  Evidence, but does not widen to unrelated terminal Works or historical Runs.
- `evidence-artifacts.json` maps portable `artifact:<run>/<path>` references to existing immutable
  files, names the owning Evidence documents, and is read-only.
- The dependent Agent can consume the artifact through its staged context without a Run lookup API,
  Assistant-home path, user checkout path, or model-memory handoff.
- Both Works retain their own Evidence, C1 reaches one clean release head, the selected delivery
  checkout stays clean and only fast-forwards at accepted C1, and final Planning completes the Goal.

Primary invariants: `INV-01`, `INV-02`, `INV-04`, `INV-05`, `INV-06`, `INV-10`, `INV-14`.

This is a deterministic E2E rather than a Live model case because model wording cannot strengthen
the handoff boundary. The production RoleRunner input is the boundary under test; one scripted
dependent Agent proves that the exact files are sufficient. Restart, Pause, and vendor session
continuity remain covered by `015`, `016`, and `024`; multiplying those states by this DAG would add
cost without a new owner or invariant.

Current implementation: `packages/backend/tests/contract/dependencyEvidenceHandoff.test.ts`, included
by `bun run e2e:contract`. It runs the production Coordinator and managed Git path through both Works,
their Reviewers, C1, and final Planning while the dependent Generator directly verifies staged
Evidence and immutable artifact bytes.

## Harness Self-Verification

Harness mechanics are deterministic repository tests, not HOPI product scenarios, so they do not
receive `HOPI-E2E-*` IDs or coverage rows. The repository test suite must prove:

- the read-only artifact summary derives status, execution, cleanup, invariant, usage, and optional
  HOPI state facts without writing into its source Run;
- registered resources clean up once in reverse order before terminal evidence is hashed;
- cleanup accepts an already-released owned process as success while preserving real signal errors;
- a generous logical-Run ceiling stops a runaway through the normal failure and cleanup path without
  imposing exact responsibility counts on passing scenarios;
- a cleanup failure or timeout prevents a requested pass, retains diagnostics, and invokes an
  available force action without retrying scenario behavior;
- phases and semantic checkpoints are append-only action evidence;
- a Regression child streams output, is terminated at its execution deadline, and retains the
  output emitted before termination; and
- each real Browser invocation retains created and closed target IDs with an empty leaked set.

Run the deterministic lifecycle and deadline cases with:

```sh
bun test packages/backend/tests/testRunArtifact.test.ts packages/backend/tests/liveHarness.test.ts
```

Run the owned-browser-resource proof with `bun run test:browser`. Its terminal `run.json` must index
`browser-resources.jsonl`, and every record must satisfy `created = closed` and `leaked = []`.

## Current Stopping Point

Do not run `e2e:regression:live` on each edit. Keep `e2e:preflight` cheap, retain `HOPI-E2E-002` as
the blank-to-completion smoke, and use the explicit Live Regression only for a release, scheduled
suite, or a change whose execution boundary requires its configured-provider canaries.

The 2026-07-17 completion pass stopped after `031`, the focused conversation-only `022` canary, and
`033` passed. They close every newly identified independent boundary using one zero-provider Browser
Run, one configured-provider Assistant turn, and one deterministic Coordinator E2E. Separate Live
cases for design revision, Pause, Preview repair, checkout isolation, dependency restart, or vendor
combinations would only multiply states already owned by `012`, `015`, `016`, `021`, and `024`.
Add another scenario only when a real failure reveals a new boundary or a product change invalidates
one of those compositions.

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

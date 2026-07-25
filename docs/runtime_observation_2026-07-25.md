# HOPI Runtime Observation: 2026-07-25

## Window

- Start: 2026-07-25 12:30:49 +0800
- End: 2026-07-25 13:00:49 +0800
- Runtime: `http://localhost:3000`
- Branch and implementation: `dev` at `2330b0d`
- Project: `P-b7e66869-0eb9-46af-bd76-6d3980511348`
- Goal: `G-扩展每日买卖信号与真实样本回测`

## Baseline

- Backend responds successfully and reports no active Run.
- The Goal is active.
- Generator Run `R-b1224919-6504-475a-a4f7-15d7e58880f2` finished with a
  published semantic failure, not an operational failure.
- Its complete proof measured a conservative exact-build upper bound of
  638.178 seconds against the contract's 480-second gate.
- Project Attention `A-9465b931-3d8a-4362-b677-f7ab4616ba72` remains unresolved
  and has been updated with the latest Run evidence.
- The observation will answer that existing decision through the Assistant,
  selecting a measured 720-second gate while preserving all other proof,
  review, and downstream constraints.

## Timeline

- 12:32:49: Submitted the decision through the visible Needs You reply path.
  The user message appeared optimistically before the backend turn completed.
- 12:32:49-12:33:18: Assistant created revision 23 and Planning Work
  `plan-0047`, then read current state and reported that the Attention was
  cleared.
- 12:33:34: Coordinator admitted Planner Run
  `R-8dfe1703-0ae6-43fd-85c9-010ad54c8632`.

## Observations

### O1: A Needs You message can display stale Attention facts

The canonical Attention body had been updated from the earlier 671.925-second
measurement to the latest 638.178-second measurement, but the visible Needs
You message still showed 671.925 seconds. The decision remained equivalent in
this case, but mutable Attention facts and the rendered request can diverge.

### O2: Assistant falsely reported that Attention was cleared

The Assistant turn called `hopi_create_work` and `hopi_read_state`; it did not
call `hopi_manage_attention`. Its state read returned an empty
`workspaceAttentions` array and its final reply said the Attention was cleared.
The public Goal API still reported the same Project Attention with
`resolvedAt: null`. The deterministic store correctly retained the Attention,
but the Assistant observed an incomplete projection and made a false factual
claim. This also leaves the already-answered Needs You request visibly open.

The system later self-corrected: after Planner publication, Project Reflection
woke the Project Assistant, which explicitly called
`hopi_manage_attention(resolve)`, received `resolved: true`, and emitted an
empty final reply. The Attention was then actually resolved at 12:40:30. This
is the desired recovery behavior, but it should not have required a second
Assistant turn.

### O3: A narrow decision caused an oversized state read

The Assistant turn used about 330,003 input tokens, including 264,192 cached
tokens, and 1,862 output tokens. `hopi_read_state` returned the complete Goal
body, long Work history, Attempt history, and the full design-file inventory
after the effect had already been applied. This is disproportionate to a
single threshold decision and is likely avoidable without reducing judgment.

### O4: Planner research was correct but disproportionate

Planner `R-8dfe1703-0ae6-43fd-85c9-010ad54c8632` took 6 minutes 47 seconds and
about 20 tool steps to publish a minimal 480-to-720-second contract change. It
enumerated the full design inventory and all historical Work, read large
sections repeatedly, and attempted three ad hoc frontmatter validators after
the first failed for an unavailable PyYAML import. Its final plan was correct
and minimal, but the turn accumulated 1,507,009 input tokens
(1,402,880 cached), 16,796 output tokens, and 4,250 reasoning tokens. The
effective new input was still roughly 104k tokens for a narrowly scoped,
well-specified revision.

- 12:40:07: Planner succeeded and published only the requested revision-23
  Work/design changes.
- 12:40:13: Coordinator admitted exactly one Generator,
  `R-76b2dff8-90b7-454a-b203-601493934161`.
- 12:40:13-12:40:21: Project Prepare completed successfully in 8.138 seconds
  and attached timing plus logs to the same Generator Attempt.

### O5: Needs You reply lost its Project conversation scope

Inbox event `EV-46eef155-7851-4d81-b487-a592b5040576`, created through the
MyQuant board's Reply action, contained only `attentionRefs`; it omitted
`projectId` and `goalId`. HOPI consequently ran it in the Home Assistant
session `019f9733-...`, while the subsequent Project Reflection used the
MyQuant Project session `019f972d-...`. The Home turn could still operate the
Project through explicit tool arguments, but it lost the intended persistent
Project conversation and produced the false "Attention cleared" conclusion.

### O6: The one-tool corrective Reflection was extremely expensive

The corrective Project Assistant turn performed exactly one Attention resolve
tool call and correctly produced no public message. Even so, its persistent
session accumulated 1,750,289 input tokens (1,600,512 cached), 4,107 output
tokens, and 982 reasoning tokens. Roughly 150k uncached input for a single
known-ID resolve indicates that vendor-native compaction either had not run or
had not reduced the active Project session enough. No compaction event was
visible in the turn transcript, so the runtime currently cannot distinguish
those cases.

### O7: Project guidance points to an unrelated historical Goal

The current MyQuant `AGENTS.md` tells every agent to read the design directory
for `G-2c5719c3-473d-4a81-8e88-565a7e407987`, even when the assignment belongs
to another Goal. Neither the Planner nor Generator was derailed in this
window, but the stale Project-level guidance creates unnecessary research and
can bias later runs toward obsolete authority.

## End State

- The observation window had exactly one Planner and one Generator. There was
  no duplicate admission, polling loop, or premature downstream dispatch.
- Project Prepare ran once inside the Generator Attempt, completed in 8.138
  seconds, and retained its log and timing in that same Run.
- The Generator changed only the accepted 480-to-720-second gate, passed its
  focused tests, and completed a fresh 661-second feasibility proof. The
  conservative exact-build upper bound was 598.103 seconds.
- At the window boundary, the first independent exact build was still active
  within its 600-second watchdog and was using one CPU core normally. It was
  not stalled.
- A post-window check at 13:03:21 showed that first exact build complete with
  an `ok` eight-file bundle. At 13:07:31, independent semantic validation found
  that its `native_v2_attestation_digest` did not match a fresh attestation.
  The Generator correctly rejected that candidate, began repairing the source
  binding, and stated that the exact-build sequence would restart from the
  beginning. It remained the only active Run; no invalid evidence or
  downstream Work was published.
- The backend emitted no HOPI runtime error during the window.

## Root Causes

### Reply routing

The frontend treats a reply to any Workspace Attention as Home-scoped, even
when the Attention is presented inside a Project conversation and carries that
Project ID. The resulting Inbox event therefore omits `projectId` and
`goalId`; session selection correctly follows the malformed event into Home.
The Attention reference and conversation location are independent facts and
should both be preserved.

### Missing Attention in `hopi_read_state`

The state reader removes `target` from every Workspace Attention. The tool
projection then filters Project Attention by that removed `target`. Any
Project-scoped state read therefore returns an empty `workspaceAttentions`
array. This deterministic projection mismatch caused the Assistant's false
"Attention cleared" conclusion.

### Oversized Assistant context

The selected-Goal form of `hopi_read_state` deliberately returns diagnostic
detail: the full Goal body, every Work runtime, and the design inventory. That
tool result was about 34 KB in this turn, while the much larger 330k/1.75m
input totals primarily reflect resumed persistent session context. The state
tool still needs a compact default, but it is not the sole cause; compaction
visibility and the lifetime of vendor sessions must be measured separately.

### Planner research cost

The Planner received a 23 KB assignment prompt and an immutable authority tree
containing 95 Goal files totaling about 490 KB. It then explored broadly and
created three custom validators for a two-file threshold change. The model's
result was correct, so the problem is not missing reasoning capability. The
authority surface does not make the current contract and directly affected
documents sufficiently prominent relative to historical revisions.

### Stale Needs You text

Open-request bookkeeping already uses the current canonical Attention, but the
visible card continues to render the historical Assistant message containing
the original `<NeedsYou>` body. Status transitions are current while mutable
facts inside the request are not.

## Recommended Order

1. Preserve Project conversation scope when replying to a Project Attention,
   while retaining the canonical Attention reference unchanged.
2. Preserve derived Project ownership in the Assistant state projection so
   Project Attention cannot disappear from `hopi_read_state`.
3. Make scope filter one compact state shape; read exact returned paths for
   full Goal/Work diagnostics.
4. Record vendor compaction events and active-context usage before changing
   compaction thresholds.
5. Keep public Needs You messages immutable; an Attention update wakes the
   Project Assistant so any corrected request is a new public message and the
   latest message becomes the Reply target.
6. Replace Goal-specific Project guidance with stable Project entry guidance;
   Goal authority already arrives through the assignment.

These are routing and projection corrections, not new Coordinator states or
workflow rules. Reflection itself should remain unchanged based on this
window: it woke once, repaired a real inconsistency, and stayed silent.

## Clean-start reset

The operator approved a complete HOPI data reset after the observation. This
is an operational reset of orchestration history, not a source rollback.

Source preservation boundary:

- MyQuant release `1d1aba3811ab3dfb6481804f1e8479c9a5ec197a` is the latest
  delivered source and must be materialized on the ordinary `main` branch
  before managed worktrees are removed.
- Financial-API release
  `493a3050c7f2b0e8d71f4abc1633504e894ebe8e` already equals its `main`.
- CardGame release `7447683184904662c6f6844a5ba99fcc19bd3c8b` already equals
  its active `dev`.
- game-asset-skill release
  `e59c37d7561cf9e895affd81f983baaac572a2cf` already equals its `main`.
- Existing HOPI Git refs remain recoverable until every managed worktree has
  been removed cleanly. No source commit is discarded.

Reset boundary:

- remove the external HOPI Home, including Inbox, Attention, sessions, Runs,
  cache, project registry, preferences, and browser state;
- remove managed integration and Work worktrees after source preservation;
- remove tracked Project `.hopi` histories from active source branches so a
  new Project cannot import old Goal authority;
- retain all non-`.hopi` source, Git history, credentials, and external data;
- recreate only the MyQuant Project, linked to MyQuant and Financial-API, then
  create one new Goal from the materialized release.

The new Goal carries only the current desired outcome and present source
state. It does not copy prior Accepted Inputs, Work DAG, Attempt history,
Attention, or provider sessions.

The first clean-start trial exposed one additional persistence boundary:
qualified C1 records are discoverable from the release commit ancestry, not
only from `.hopi`, Home files, managed worktrees, or active Git refs. A new
Project created directly from the old release therefore found a historical
Work reference during bootstrap.

For the linked MyQuant and Financial-API repositories, the clean baseline must
therefore be a parentless commit containing the exact preserved source tree.
The `hopi-clean-start-source-20260725` tag retains the former release and its
complete ancestry. Active `hopi/project/*` and `hopi/work/*` refs are moved
outside the active branch namespace before the Project is recreated. This
keeps every committed source state recoverable while making historical C1
records unreachable from the new release.

The second clean-start trial registered only `P-myquant`, linked MyQuant and
Financial-API, and created only `G-myquant-research-loop`. The first Planner
assignment contained no prior Goal, Work, Attempt, Attention, session, or C1
reference. It audited the preserved source and current local artifacts, then
proposed a new design and sparse Work DAG.

That proposal exposed a clean-bootstrap contract gap: all three Engineering
Work documents used `stage: implementation`, while the generated
`proposal-capabilities.json` required `stage: generate`. Publication rejected
the proposal, but the generic recovery model worked as designed. The settled
Attempt woke the Project Assistant; it inspected the rejection and proposal,
corrected the canonical design and Work documents, marked the completed
Planning Work done, recovered the Project, and observed the first Generator
start without operator input.

The recovery proves that old orchestration state is no longer required for
self-correction. It also shows avoidable cost: a fixed persistence shape was
available but not prominent enough, and the Zod union diagnostic collapsed
the useful field error to `Invalid input`. The general correction is not a
new workflow rule. The execution boundary must make the generated capability
file's exact publication effect explicit, and canonical document diagnostics
must retain the offending path and accepted values.

## Follow-up: Attention continuation and durable runtime data

The clean-start Goal later stopped at `eng-align-tushare-provenance` with a
Project Attention whose credential premise had become stale. The current
runtime did contain `TUSHARE_TOKEN`, but the Work remained at Reviewer and no
Attempt was active.

The first automatic Attention continuation proved that the Project Assistant
could resume its persistent conversation, inspect the exact Attention, and
advance the real task. It ran the Tushare preparation command and increased
the raw snapshot from 3,652 to 4,947 shards. It then incorrectly rendered an
optional request as `<NeedsYou>`, which stopped continuation even though no
operator input was required. The contract now defines `<NeedsYou>` only as the
case where no available Assistant or Project action can advance the Attention;
an unresolved ordinary reply receives one idle-boundary continuation instead.

After the operator-equivalent reply said to continue without a reusable
snapshot, the Assistant resolved the stale Attention, appended exact observed
facts to the Work, and explicitly retried Reviewer. This verified that the
Project owner can convert a stale user blocker into an independent Work
Attempt without Coordinator interpreting prose or inventing a recovery rule.

That Reviewer exposed a separate persistence error. Reviewer clean
materialization replaced the task worktree and removed the 4,947 ignored raw
files before review began. The new acquisition therefore restarted at zero;
the apparent initial cwd mismatch was not the data-loss cause. A later
Assistant turn correctly interrupted the redundant Reviewer, updated canonical
Design and Work, and changed the acquisition paths to the existing persistent
`HOPI_CACHE_DIR` boundary before retrying. The cache-backed retry is currently
making forward progress and no operator Attention is open.

The same run showed that a vendor shell tool may start a foreground command in
a different OS process group. Killing only the vendor group can leave that
command alive after interruption. HOPI now tracks descendant process groups
while Assistant and responsibility invocations are live and terminates every
observed group at settlement. Task worktree disposability, persistent cache
semantics, and detached-process effects are stated as execution facts in the
Assistant and responsibility contracts. No new lifecycle state, cache type,
or project-specific scheduler rule was added.

The first cache-backed Reviewer then reached an exact 900-second shell timeout
after growing the durable snapshot to 1,292 raw shards. Its published result
woke the Assistant, which reused the same Reviewer Session and retried without
operator input; the next Attempt resumed from those shards. The underlying
Codex Session shows that `900000` was the Reviewer's selected `timeout_ms`, not
a fixed adapter ceiling. On the next Attempt that same Session selected
`1800000`, and the command continued beyond 15 minutes while the cache kept
growing. The existing serialized command boundary therefore remains valid;
neither unified exec nor a HOPI command runner is required for this case.

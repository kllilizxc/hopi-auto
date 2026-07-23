# HOPI MVP Document Model

Status: forward document and authority reference
Last updated: 2026-07-18

This document owns the file-native layout, canonical document schemas, field authority, references,
and document-local invariants for [the HOPI MVP design](./mvp_design.md). Execution behavior belongs
to [the execution design](./mvp_execution.md), lifecycle visualization to
[the state machine](./mvp_state_machine.md), and publication mechanics to
[the publish protocol ADR](./mvp_publish_protocol.md).

## File-Native Layout

### Assistant home

```text
<hopi-home>/.hopi/
  home.yml
  projects.yml
  preference.md
  docs/
    assistant/
      attachments/
        <contentHash>/
          <fileName>
      inbox/
        <eventId>.md
    attention/
      <attentionId>.md
  runtime/
    agent-adapters.json
    assistant/
      session.json
      turns/
        <eventId>/
          events.jsonl
          transcript.log
      reflections/
        <reflectionId>/
          reflection.json
          prompt.md
          events.jsonl
          transcript.log
    delivery/
    leases/
    index/
```

`preference.md` is the one canonical user-preference document for this Assistant Home. It is free
Markdown containing only durable defaults that should apply across Projects. It has no record
schema, item lifecycle, or separate history model; an empty document means no stored defaults.
Explicit instructions in the current turn and
Project- or Goal-local authority override these defaults.

Speaking Assistant reads the current document on every turn and is its sole writer. Writes replace
the complete normalized document under an expected content digest, so normal publication provides
optimistic concurrency without adding preference IDs or a preference database. The model decides
whether feedback expresses a reusable default; one-off direction and Project-specific rules stay in
conversation or the existing Project/Goal documents. Updating this document alone has no Goal,
Planning, Reflection, or notification effect.

Managed Git checkouts are deliberately outside Assistant home and outside the selected checkout:

```text
<repo-parent>/.hopi-worktrees/<repo-name>/
  integration/
  work/<goalId>/<workId>/
```

An inbox event is conceptually `pending | handled`.

Its exact MVP front matter is:

```yaml
id: EV-1
receivedAt: 2026-07-11T09:00:00Z
status: pending
source: user
visibility: public
sourceDigest: <sha256>
attachments: []
context:
  projectId: P-1
  goalId: G-1
  attentionRefs:
    - project:P-1/goal:G-1/attention:A-1
  replyTo: home:H-1/event:EV-question
handledAt: null
reply: null
disposition: null
```

`source` is `user | reflection`; `visibility` is `public | internal`. New operator turns are exactly
`source: user, visibility: public`. A useful read-only Reflection creates exactly
`source: reflection, visibility: internal`. Older events without these fields default to
`user/public`.

`context` is optional. `projectId` and `goalId` appear together when the turn has a UI location.
`attentionRefs` contains zero or more complete canonical delivery identities:

- Goal-local: `project:<projectId>/goal:<goalId>/attention:<attentionId>`
- workspace: `home:<homeId>/attention:<attentionId>`

`replyTo` is present only on an explicit operator reply created from the Assistant message's Reply
control. It identifies the exact handled public Assistant request event and requires matching
`attentionRefs`. An ordinary message sent from the same Project or Goal may carry location context,
but never guesses this pointer from currently open Attention.

A Reflection handoff may contain only `attentionRefs`; a normal Goal-page turn may contain only the
Project/Goal pair; and one turn may contain both. New writes never use a bare Attention ID. Older
Inbox events with singular `attentionId` or local IDs in `attentionRefs` remain readable and are
interpreted in their stored Project/Goal context, but they are migration input rather than a second
reference form. Context is conversational and delivery correlation only; it grants no mutation
authority.
`handledAt`, `reply`, and the free non-control `disposition` string are all null while pending and
all present while handled. The Markdown body is the lossless received content or internal Reflection
brief. Identity, `source`, `receivedAt`, digest, attachments, context, and body are immutable. The
source digest covers the deterministically newline-normalized body and ordered attachment references.
For speaking turns, `answered` means no tool event was observed and `tools-used` means at least one
was observed. Neither value is proof of a side effect; canonical documents and tool results own that
truth.
Visibility is also immutable except for one transition: when a Reflection-sourced speaking turn
finishes, Coordinator publishes `internal -> public` atomically with any non-empty final reply.
`request_user` changes that reply from informational delivery to an operator-owned request; no reply
remains internal. Visibility never moves back and a user-sourced turn can never become internal.

- Public input is acknowledged only after the event document is durable; an internal handoff also
  becomes eligible only after its event document is durable.
- The event is the immutable receipt authority for received content and attachment references.
- It also owns the ordinary Assistant reply and disposition. HOPI tools, not reply prose or page
  context, create Project or Goal effects.
- A turn may call no tools, one tool, or tools targeting more than one Goal. The Inbox event stores
  no single-destination route state.
- Targeted Attention is an internal durable request for speaking-Assistant management. It is not
  user-visible until speaking revalidates, cannot safely resolve it, and publishes one reply.
- Processing failure that cannot be repaired creates targeted Attention for the event.
- Ordinary and Needs-you replies live in the speaking conversation. External webhook delivery may
  mirror that exact public reply; raw Attention never uses an out-of-band user path.
- Internal Reflection turns are absent from the conversation projection. If promoted, the projection
  shows only the speaking thread's reply and does not invent a user message for the Reflection brief.

A public-turn image is first stored as an immutable, content-addressed Assistant-home file under
`docs/assistant/attachments/`. Its Inbox `attachments` entry is the canonical Home-relative file
reference, never a browser-supplied absolute path. The content hash in the path is verified whenever
the file is resolved. The image bytes are supporting content and the Inbox event is their durable
receipt gate, so an acknowledged turn never names a missing upload. Unsupported media, size-limit
violations, and path traversal fail before the turn is accepted.

This receipt storage does not make an image part of a Project or Goal. It preserves the exact
conversation input for replay and lets Assistant inspect the current turn. Only a later explicit
Goal-targeted HOPI tool call may adopt selected attachments as Goal references. Accepted image input
may enter Goal, design, and Work prose only through the resulting Goal-local asset path;
Assistant-home paths and machine-local absolute image paths are never canonical authority. This
does not prohibit Project-relative source image paths or ordinary remote URLs.

Historical Inbox events may contain the removed `routeClaim` field. The compatibility reader keeps
it as provenance, but new turns never write it and no forward control rule depends on it.

`runtime/assistant/sessions/home.json` and
`runtime/assistant/sessions/projects/<projectId>.json` are rebuildable vendor-session caches, not
conversation authority:

```json
{
  "version": 4,
  "scope": "project:P-example",
  "transport": "opencode",
  "sessionId": "vendor-session-id",
  "contractDigest": "sha256",
  "runtimeDigest": "sha256"
}
```

Only `codex | claude | opencode` is accepted. HOPI selects the cache from immutable Inbox scope and
resumes it only when scope, transport, the initial Assistant context digest, and the stable-workspace
runtime digest match. The context digest covers the stable Assistant contract and current durable
preference digest. A missing, invalid, or incompatible cache starts a new vendor session from the
same initial context and ordered bounded Inbox history; it does not alter or synthesize canonical
turns.
An adapter may discard an already selected cache during a turn only when the vendor explicitly
reports that session missing or incompatible. Provider, quota, authentication, model, and process
failures do not imply session incompatibility and therefore do not rebuild conversation history.
The legacy global cache is discarded because its conversation scope cannot be recovered without
guessing. Per-turn `events.jsonl` stores normalized live
Assistant, tool-call, tool-result, status, and error events. `transcript.log` preserves raw process
output for debugging.

Every runtime `events.jsonl` uses newline as its record durability boundary. A concurrent reader
omits the sole non-newline-terminated tail and sees it on a later read after append completes. A
malformed newline-terminated record is durable corruption and remains a visible error; readers do
not silently discard it. Assistant turns, responsibility Attempts, and Reflection diagnostics share
this one rule.

Each `runtime/assistant/reflections/<reflectionId>/reflection.json` records a disposable assessment's
state digest, timing, and terminal runtime outcome. Its prompt, normalized events, and raw transcript
exist only for diagnostics. Reflection directories are not canonical conversation history and may be
removed. Only a submitted internal Inbox brief survives runtime cleanup. There is no durable
Reflection queue or Reflection lifecycle document.

Workspace Attention lives under Assistant home. Its location replaces a stored `scope` field.
It is used for inbox, project, or invalid-package problems without a safe Goal-local writer.
It uses the same five control fields as Goal-local Attention except that `target` is non-null and
must be exactly `home:<homeId>/event:<eventId>` or `project:<projectId>`.

`home.yml` is created once during Assistant-home initialization and owns immutable `homeId`. It is
required before Coordinator starts and travels with every lossless Assistant-home export; the
filesystem path of Assistant home is only a current machine binding.

Each version 4 `projects.yml` link owns `{ projectId, primaryRepoId, repos }`. Each Repo entry owns a
stable Project-local `repoId`, its current-machine `repoPath` Git-checkout locator, and an optional
portable `projectPath` relative to the Git root. Missing `projectPath` means `.`. The same Git Repo
may occur in several Projects, while duplicate Git identities remain invalid inside one Project.
Coordinator derives a Project-qualified Repo-adjacent managed integration path, then resolves the
Project's source scope inside that managed worktree from `projectPath`. The primary managed root
remains the canonical Project document root. `repoPath` supplies the Git object database and initial
HEAD only; HOPI never writes its branch, index, or working tree.

```yaml
version: 4
projects:
  - projectId: product-a
    primaryRepoId: web
    repos:
      - repoId: web
        repoPath: /home/operator/Code/product-web
        projectPath: apps/storefront
      - repoId: api
        repoPath: /home/operator/Code/product-api
```

Legacy Project `codingDefaults` are discarded during Assistant-home initialization. They are not
merged into Home settings because multiple Project values cannot deterministically define one
Home-wide role. `project.yml`, Goal documents, and runtime indexes do not duplicate model settings.

`runtime/agent-adapters.json.assistant` separately owns the Home-wide speaking Assistant and
Reflection adapter. It uses the same Codex, Claude, or OpenCode transport shapes but always runs from
the Assistant runtime root. It never inherits a Project link. UI updates merge fields compatible
with the selected transport so advanced binary/profile/permission settings are not silently lost;
switching transport replaces incompatible fields with that transport's safe defaults. `process` is
allowed only for responsibility adapters and is not a configurable Assistant transport.

`runtime/agent-adapters.json.roles` may separately override `planner`, `generator`, and `reviewer`.
The Home agent-settings panel edits these existing role entries rather than introducing a second
settings document. A missing role entry means inherit Home `defaults`; removing a role override
restores that fallback. Role settings affect only future responsibility Runs and never rewrite a
Project link, Goal, Work, or active Run command.

Version 1 through 3 links migrate by moving the binding's legacy release ref and registered managed
worktrees into its Project-qualified namespace without changing the selected checkout. A version 3
link carrying legacy `codingDefaults` is rewritten without that field. A missing legacy worktree is
rebuilt from its exact release ref. If both old and Project-qualified refs exist but disagree, or an
old-format Repo is shared by several Projects, migration raises Project Attention rather than
choosing a history. Each verified step is idempotent, and version 4 is published only after the new
ref and paths validate.
Legacy Engineering Work may still contain a `repos` field. Readers ignore it because Project Repo
membership is the execution environment; the field disappears whenever that Work is canonically
rewritten. No migration guesses whether an old subset was complete.

After a Repo or Assistant-home move, explicit Repo rebind repairs Git's managed-worktree
administration, relocates the Project-qualified Repo-adjacent managed root when needed, validates its
release projection, then changes the machine-local binding.
A single moved Repo and a complete moved Repo set use the same operation; the complete form requires
exactly the existing stable Repo IDs and publishes `projects.yml` only after every target validates.
This lets several stale old paths recover together without weakening duplicate-Git-identity checks.
Outside the legacy migration, a missing primary managed integration root is not reconstructed from
Git because its uncheckpointed canonical documents may be newer than the ref; that loss remains
Project Attention.

The managed root's `project.yml` remains authority for Project identity, Repo membership, and each
portable `projectPath`; the local link must match it after missing paths normalize to `.`.
If the release ref or project file is missing, corrupt, or disagrees, the home link still supplies
the canonical project target for workspace Attention; it never guesses or replaces identity.

### Managed project root

```text
<repo-parent>/.hopi-worktrees/<repo-name>/projects/<projectId>/integration/
  AGENTS.md
  .hopi/
    project.yml
    docs/
      index.md
      tech-debt.md
      goals/
        <goalId>/
          goal.md
          assets/
            <contentHash>/
              <fileName>
          design/
            index.md
            <topic>.md
          inputs/
            <sourceHomeId>/
              <eventId>.md
          work/
            <workId>.md
          attention/
            <attentionId>.md
          evidence/
            <evidenceId>.md
```

Assistant-home state and runtime data live outside every linked Repo and outside the HOPI source
checkout. `HOPI_HOME` selects their owner directory; when it is unset the production server uses
`$XDG_DATA_HOME/hopi`, or `~/.local/share/hopi` when `XDG_DATA_HOME` is unset. Integration and task
worktrees live under the Repo-adjacent root above. The managed
integration worktree is stable rather than disposable
because ordinary canonical document publications may precede their next Git checkpoint. Canonical
Project documents, `project.yml`, Project-qualified release refs, and task branch refs travel with a lossless
Project migration. User preferences travel with Assistant Home instead; Project-specific operating
rules remain in Project docs or Repo-local `AGENTS.md`.

A `Project × Goal` address whose Goal root contains no files is absent and public APIs report it as
not found. Once any file exists below that Goal root, `goal.md` and the rest of the Goal package
contract are mandatory; missing authority is corruption rather than absence. This distinction keeps
stale or cross-Project Board addresses from becoming server faults without hiding partial canonical
publication or filesystem damage.

Each responsibility dispatch uses one globally identified runtime directory. Project, Goal, Work,
and responsibility already belong in `attempt.json`; repeating them as filesystem ancestry adds no
identity or isolation:

```text
<hopi-home>/.hopi/runtime/runs/<runId>/
  context.md
  prompt.md
  result.json
  attempt.json
  events.jsonl
  transcript.log
  artifacts.json
  artifacts/
  scratch/
```

`attempt.json` records the responsibility, timing, process result, Coordinator application, and the
small execution identity resolved for that one Run: transport, configured model, and Codex reasoning
effort when applicable. RoleRunner
captures this identity before launching the process, so a later Home role model change cannot rewrite
history. Older or non-model Attempts may have no execution identity, and an older identity may retain
its model without a recorded reasoning effort; the UI reports those absences instead of substituting
current configuration. `events.jsonl` is an append-only stream of normalized
model messages and tool events used by the Work-detail UI. `transcript.log` preserves each raw
stdout/stderr line before vendor normalization or display truncation. These files are runtime
observability, not canonical authority.
The Goal/Work execution-cost view is computed from these records at read time. Vendor-reported usage
remains vendor-reported, paired tool-event timestamps support observed tool duration, and the
remaining Attempt wall time is explicitly approximate model/overhead time. The projection is not
written back into Goal, Work, Evidence, or retry state.
`scratch/` is a disposable writable temp root exposed to the responsibility process. It lets build
tools and short-lived local services operate inside the existing Run capability without granting
another source root; it is never source, Evidence, or Preview state. Reusable tool caches live at
`<hopi-home>/.hopi/cache/`, outside every Run. Before applying a valid result, Coordinator keeps a
verified Project-relative source path portable as-is; every declared Run-local proof file is copied
into the Run's `artifacts/`, its original diagnostic location is recorded in `artifacts.json`, and
the model-supplied path is replaced with `artifact:<runId>/<artifactName>`. Evidence may contain
either portable form but never an absolute local path. Once the responsibility process is gone and
its declared proof is preserved, Coordinator
removes `scratch/`; terminal scratch left by a process crash is removed during restart recovery.
On restart, a manifest still marked `running` becomes `interrupted`; Coordinator never reattaches its
child. The former `<projectId>/<goalId>/<workId>/<runId>` layout remains read-only compatible during
migration, but all new writes use the flat layout. Older Run directories without these files remain
readable as legacy Attempts but may have no message stream or raw transcript. Work front matter
`attempts` remains the authoritative count of published unsuccessful outcomes in the current
recovery episode; it is not the number of runtime Attempt records.

Operational recovery uses these existing Attempt records without making them canonical Work
semantics. For one Work, the current operational episode is the consecutive newest finished Attempts
with `application: operational_failure` after its latest resolved Work-target Attention. The third
failure ensures one ordinary open Work-target Attention. No operational counter is stored in Work,
Attention IDs, or UI projection, and no new Attention field or kind is introduced.

`project.yml` owns the stable Project ID, primary Repo ID, portable Repo membership and
`projectPath` values, and the current secondary release commits. Canonical absolute local filesystem
paths remain solely in Assistant-home `projects.yml`; runtime diagnostics may record the machine-
local source from which a portable artifact was preserved.
The primary Repo's release commit is the `project.yml`-containing C1 itself and is therefore implicit;
embedding its own hash would be self-referential. The integration target is derived as
`hopi/project/<projectId>/release`, not editable Project configuration. Goal completion means the
primary C1 and every secondary managed release projection are verified. User checkouts are outside
completion and recovery.

Root `AGENTS.md` is the model-readable project context entrypoint. It may describe stable repository
structure, responsibilities, commands, constraints, and links to deeper authoritative documents,
but it owns no HOPI lifecycle or scheduling fact. The kernel never parses its prose.

Planner bootstrap and responsibility context behavior belong to
[the execution design](./mvp_execution.md#fixed-responsibility-passes). Existing `AGENTS.md` content
has no automatic control effect.

Goals may reference ordinary supporting files anywhere appropriate in the project. Adopted user
images use `assets/<contentHash>/<fileName>` so retries are idempotent and the Goal remains portable.
No `notes`, `assets`, `archive`, or other supporting-file convention has lifecycle, eligibility, or
Kanban semantics.

## Document Authority

### `goal.md`

`goal.md` owns:

- Goal identity and title
- lifecycle: `active | paused | done | cancelled`
- priority, which is the only durable scheduling priority
- `contractRevision`
- objective, constraints, and non-goals
- success criteria
- `completionAttentionId`, non-null only while lifecycle is `done`

It does not store current focus, a workflow status, or completion prose. Current focus is derived
from nonterminal Work and open Attention. Completion detail belongs to completion Attention.

Material changes to objective, deliverable scope, constraints, non-goals, success criteria, or a
decision that changes expected behavior increment `contractRevision`. Explicit reopen also
increments it. Priority, lifecycle alone, Work decomposition, retry, findings, and `notBefore`
do not.

A new Goal is active and includes exactly one explicitly selected first Work: either Planning Work,
or one Assistant-dispatched Engineering Work at `generate`. The admission caller authors the Work
title, objective, and acceptance criteria; Coordinator supplies only structural fields such as ID,
initial stage, revision, dependency invariants, and dispatch provenance. Direct Engineering
admission does not assert that the Work completes the Goal; it only removes an unnecessary initial
Planning pass. A
non-active Goal cannot own a live Run lease:
Coordinator interrupts that Goal's admitted Runs without disturbing other Goals. Pause therefore
prevents new dispatch, interrupts running passes, and rejects any racing result publication or
integration. An interrupted pass may preserve isolated artifacts and Attempt diagnostics but
cannot advance canonical Work while paused. Material instructions may update a paused contract
without implicitly resuming it.

Resume ensures current Planning Work. Reopen increments the contract revision, resolves an open
old completion Attention as superseded, clears `completionAttentionId`, ensures Planning Work,
and never revives terminal Work.

Goal cancellation installs the Goal `cancelled` guard first, then cancels nonterminal Work and
resolves superseded Goal-local Attention. After a process crash, ordinary Reconciler cleanup follows
from the still-blocking Goal guard; startup has no cancellation-specific recovery path.
Cancellation preserves branches, Inputs, Evidence, and history and never silently reverts
integrated code. A workspace Attention whose target became irrelevant is resolved in a separate
idempotent Assistant-home publication. Attention target is immutable; a continuing problem at a
different root creates a new Attention.

### `design/**`

`design/index.md` is the current design map and concise summary. Topic files hold substantial
rationale and implementation design. Design documents never own Goal lifecycle, Work stage,
Attention resolution, or runtime state.

When Assistant adopts an Inbox image for a Goal, `design/references.md` records its Goal-relative
asset path, source Inbox event, and free-form purpose or usage boundary. It is an ordinary editable
design document, not an Asset schema, registry, approval surface, or control ledger. A user may
revise it through the same design tool as any other design document. If a machine-local image is
useful, Assistant must first adopt its durable Inbox attachment rather than write the absolute path
into Goal authority.

Goal-local design is the HOPI design surface shown in the UI and a living planning input, not an
approval workflow. A user may instruct Assistant to revise any of these documents. Assistant and
Planner interpret the instruction against the current Goal and decide whether the result is
documentation-only, changes the Goal contract, requires replanning, or requires Engineering Work.
When implementation is needed, established design is written before Planner exposes that Work.

The file path or fact that a design document changed has no automatic control effect. Coordinator
does not watch design edits to increment `contractRevision`, create Planning Work, or invalidate
Engineering Work. Models propose any required control-document changes under the ordinary Goal and
publication rules. There is no design status, `approvedAt`, per-document revision, or fixed
doc-to-work trigger mapping.

Assistant writes design through the HOPI design tool. That tool changes only the named Markdown
documents plus any Inbox images explicitly adopted in the same call. If implementation or
reassessment is needed, Assistant separately calls the Planning tool; there is no hidden file-presence
signal, unchanged `goal.md` convention, or automatic doc-to-code trigger.

### `inputs/<sourceHomeId>/<eventId>.md`

This immutable Goal-local Input owns the instruction accepted by a HOPI tool for the Goal. It contains
`sourceHomeId`, `sourceEventId`, `sourceDigest`, a lossless copy of the received content, and
durable attachment references. Only deterministic encoding normalization is allowed; semantic
normalization, summarization, or intent extraction belongs to model interpretation and never
replaces the original content.

Input keeps the original Assistant-home references so its digest still proves exactly what was
received. A Goal-local copy and its purpose are supporting design context, not a rewrite of Input.

The Inbox event remains authority for what was received. Goal Input is authority that a HOPI tool
accepted that turn as instruction inside this Goal. Its qualified path and matching digest are the
cross-root receipt that the Goal effect is durable. The same source event may therefore have one
Input in each explicitly targeted Goal. A digest mismatch is invalid rather than
last-writer-wins. Corrections create a new event and Input.

### `work/<workId>.md`

Each Work document owns one durable unit of execution.

Example engineering Work:

```yaml
---
id: W-12
title: Harden expedition scene re-entry
kind: engineering
stage: generate
notBefore: null
dependsOn: [W-11]
contractRevision: 4
evidenceRefs: []
attempts: 0
assistantDispatch: home:H-1/event:EV-42
---
```

`assistantDispatch` is optional immutable provenance. It appears only when speaking Assistant
directly admits the Work and identifies the accepted Inbox Input that consumed that Input's one
direct-Work allowance. Planner-created Work omits it; Planner may not add, remove, or change it on
an existing Work. This is not a workflow mode, authorship role, or completion marker.

The body owns the current execution objective, context, acceptance criteria, and relevant
references. Findings, observed results, and completion proof live in immutable Evidence and are
linked rather than copied into Work history.

When delivery persists the same fact in several Project artifacts, design names one canonical owner
and a one-way derivation path. This does not require one monolithic file: different facts may have
different owners in different documents or data files. Reports, summaries, API responses, and UI
models may remain stored for auditability or efficient reading, but they are materialized projections,
not peer authorities. Acceptance proves that each projection can be regenerated or reconciled from
its owner instead of making duplicated values mutually attest to one another.

This ownership is recorded in ordinary design prose and Work acceptance only when omission would be
materially ambiguous; it adds no frontmatter, artifact registry, or schema-mapping DSL. At a
deterministic persistence boundary, a closed accepted schema with unknown fields rejected is
preferred to an open-ended list of forbidden aliases. When an external or nondeterministic fact
cannot be recomputed, its bounded source snapshot, digest, or cited Evidence owns the fact and the
derived claim points back to it.

Valid stages:

| `kind` | Stages | Terminal |
| --- | --- | --- |
| `planning` | `plan | done | cancelled` | `done | cancelled` |
| `engineering` | `generate | review | done | cancelled` | `done | cancelled` |

Running, queued, scheduled, and blocked are projections. Dispatch creates a runtime Run but does
not change stage.

Planning Work omits engineering Git fields. For engineering Work:

- `assistantDispatch`, when present, is the canonical Inbox event reference for the one direct Work
  admitted from that Input; uniqueness is enforced across every Goal linked to the Home
- branch paths derive from Project, Goal, and Work identity; worktree paths derive from the Repo
  binding plus Goal and Work identity
- each Repo task branch HEAD is its current source checkpoint and is not copied into Work front matter
- a missing disposable task checkout may be rebuilt from that Repo's stable branch after migration
- before dispatch, Coordinator synchronizes the stable branch with the latest Repo release while
  preserving its checkpointed Work delta; this computed projection has no document field
- a plan that must discard the current Work delta creates a distinct Engineering Work identity;
  neither a contract rewrite nor retry resets the old branch
- `evidenceRefs` is an append-only ordered list of consumed Run and supporting Evidence; it
  does not map criteria through a schema or replace model judgment

The qualified Work identity derives each task branch and the one primary C1. Primary history must
contain exactly one reachable commit whose qualified Work trailer equals that identity exactly, and
that commit's tree must contain the engineering Work at `done`. Prefix or substring matches between
Work IDs are invalid. Secondary component commits are named by Repo and producer trailers but are
not independent C1 gates. Coordinator verifies the primary relation and the release manifest against
every linked Repo. Branch HEAD remains checkpoint authority but never owns Work stage or completion.

#### Planning Work invariant

Each Goal has at most one nonterminal Planning Work. A planning trigger reuses it if present,
replaces its concise Objective with the latest trigger, and preserves plus appends accepted Input and
reference paths; otherwise it creates a stable ID from the triggering event or planning cause. The
Objective describes the current reason to plan, not an append-only trigger history.

When selected, the initial Planning Work is a concise, caller-authored assignment: its title,
objective, and acceptance criteria state why Planning is needed and which planning result is
expected. Its body also points Planner at the current Goal and accepted Input paths; it does not copy
the Goal objective. Generic Planner responsibility belongs to the role prompt and result validator,
not repeated fixed prose in every Work. Goal creation omits empty optional constraints, non-goals,
and success-criteria sections instead of storing placeholder text. The Goal contract and verbatim
Input remain separate first-class documents because normalization and source provenance are
different facts.

Triggers include Goal creation with a Planning first Work, material contract change, resume,
reopen, an explicit speaking-Assistant planning request after Attention, and an active Goal with
neither nonterminal Work nor a current completion proposal. A stale Run result is not a planning
trigger because it has no authority to change the Goal or Work.

Clarification and final assessment remain model judgment inside the same Planning Work. The
document model adds no `clarify` or completion stage, approval flag, structured question, or
criteria-mapping field. A targeted question leaves Planning Work at `plan`; only final Planner
success may create an unclaimed targetless completion proposal as support before Coordinator changes
Planning Work to `done`. Detailed Planner behavior belongs to
[the execution design](./mvp_execution.md#planner).

Planning Work is ordinary schedulable Work, not a Goal-wide lock. Same-revision Planning and
Engineering may coexist; each Run is admitted only from its own current Work authority and exact
selected hashes. If Planner changes authority used by an admitted Run, that Run is interrupted when
possible and its racing result still fails the semantic publication guard.

A material Goal revision is the global authority boundary. Existing nonterminal Engineering Work
keeps the revision it was planned against and therefore becomes ineligible without changing its
stage, branch, or history. Planner must either bring each retained Work to the current revision,
reset it to `generate` when its implementation is invalidated, or cancel it. Planner success cannot
leave stale nonterminal Engineering Work. A completed or cancelled Planning Work is historical and
never reopened.

If another trigger arrives during Planner execution, the same Planning Work is updated. The old
Run may preserve artifacts but fails its semantic guard.

#### Dependencies and cancellation

`dependsOn` is the only causal-order and conflict-avoidance graph between Engineering Work. Only a
dependency at `done` satisfies an edge. References must exist in the same Goal, edges remain after
completion, and cycles are invalid. Planning Work is not a second dependency graph.

If Planner cannot establish that two writers are independent, it orders them. Missed overlap is
contained by task branches and handled by deterministic integration rejection and repair or
replanning.

Adding a dependency to materialized nonterminal engineering Work sets it to `generate`,
invalidates active or unaccepted output, preserves its branch, and requires synchronization with
the latest integration target after dependencies finish. Coordinator performs that synchronization
before the next pass and preserves the Work delta. If accepted Planning instead forbids reuse of
that delta, Planner assigns a new Work identity rather than asking Assistant to rebuild or reset the
existing branch.

Cancelling Work with nonterminal dependents first cancels those dependents transitively, then
cancels the selected Work. If that cascade is not clearly intended, cancellation is not published
and HOPI creates targeted Attention. Planner may later create replacement Work, but it never
rewrites the historical edges. Nonterminal Work may not depend on cancelled Work.
After the durable cancellation, Coordinator interrupts every affected live Run. Repeating the same
cancellation is idempotent. Cancellation changes only an execution route: it neither changes the
Goal contract nor requests Planning. If the Goal still requires the cancelled outcome, later
Planning may legitimately create a different Work identity. Removing that outcome from scope is a
material Goal revision instead.

#### Time and revision

`notBefore` is the MVP's only durable time gate. Null means eligible now; a future instant delays
dispatch. There are no Goal schedules, recurring schedules, or time-wait documents.

Each Work records the Goal contract revision it was planned against. Output from an older revision
is never applied. A material Goal revision leaves existing nonterminal Engineering Work at the old
revision so readiness exposes the real authority mismatch; Planner decides whether to retain,
reset, or cancel each route.

The publication protocol permits one non-semantic intermediate form: the open Planning Work may be
staged at exactly the next Goal revision before the Goal revision gate is written. Consumers treat
it as unconsumed support and never as eligible Work. Existing Engineering Work remains at its prior
revision across the Goal gate until Planner republishes or cancels it.

A result whose semantic guard is already stale remains Run-local Attempt history; it creates no
canonical Evidence and no planning request. Canonical unconsumed Evidence can still exist when a
process stops after its supporting write but before its Work gate, and remains provenance only.

#### Bounded recovery

Work has one retry counter:

```yaml
attempts: 2
```

`attempts` is the number of published reviewed implementation-repair outcomes in the current
recovery episode: Reviewer `reject` and deterministic pre-C1 integration rejection. They increment
the same counter regardless of the current engineering stage. `attention` publishes no owning-Work
outcome and does not increment attempts. A responsibility `fail` appends its Evidence but likewise
does not consume the repair counter; Coordinator then creates Work-target Attention so speaking
Assistant can decide whether Planning, retry, cancellation, or operator input is needed. The ordered
`evidenceRefs` retains consumed Evidence, from which models derive repair context.

Ordinary pass success never clears recovery. The counter clears only when a material contract
revision invalidates the episode, Planning publishes a materially changed plan, or Assistant invokes
the explicit retry control. Retry is audited by the durable Assistant turn, exact Work effect, and
settled Work Attention; it does not create Goal Input.

A timed autonomous retry uses Work `notBefore`. Conditions HOPI cannot resolve create targeted
Attention. When `attempts == maxAttempts`, targeted Attention is ensured before another attempt can
dispatch. A process crash before the Work gate may leave Evidence without incrementing `attempts`
and a new Run may retry it. An Attention-producing outcome intentionally leaves Work unchanged and
starts a new Run only after Attention resolves. HOPI never reconstructs either old transition.
Restart, a new Run, pass success, or a task branch commit never resets a published count. Terminal
Work remains in `work/`.

### `attention/<attentionId>.md`

Attention is the only durable model for a blocker or completion that Assistant may need to surface.
There is no separate decision entity or blocker entity. One nullable event reference records the
only wait relation that affects ownership.

```yaml
---
id: A-W12-storage-format
target: project:P-1/goal:G-4/work:W-12
createdAt: 2026-07-10T09:00:00Z
resolvedAt: null
notifiedAt: null
operatorRequest: null
retryRunId: null
---
```

`target` is exactly one canonical event, project, Goal, or Work reference, or null for completion.
An open targeted Attention projects as **Waiting for Assistant** while `operatorRequest` and
`retryRunId` are null, has no ownership badge while its one requested invocation is pending,
and projects as **Needs you** only while `operatorRequest` contains the exact
`home:<homeId>/event:<eventId>` public Assistant request awaiting a reply. `notifiedAt` is independent
delivery history and may be non-null in either projection.

Attention is open exactly when `resolvedAt` is null; there is no duplicate `status` field.

`createdAt` is the Coordinator's publication timestamp, not model-authored time. Responsibility
proposals carry the fixed parseable placeholder `1970-01-01T00:00:00.000Z`; Coordinator replaces it
while publishing every new targeted or completion Attention. The body and identity remain model
output. This keeps time in the deterministic persistence boundary without adding another field or
clock protocol.

Storage location derives ownership:

- Goal-local Attention may target its owning Goal or one Work inside it.
- Assistant-home Attention may target one event or linked project. Goal and Work problems belong
  in Goal-local Attention while the project root is writable.

A new targeted Attention produced by Planner, Generator, or Reviewer always targets that Run's
owning Work with the exact canonical reference
`project:<projectId>/goal:<goalId>/work:<workId>`. Coordinator supplies that exact value in the Run
contract and validates it before publication. A canonical document path such as
`.hopi/docs/goals/<goalId>/work/<workId>.md` is not an Attention target and is never accepted as an
alias. Goal-targeted documents remain readable as Goal-wide control facts, but responsibilities do
not choose between Goal and Work scope.

The model may resolve event-target Workspace Attention from an answer document diff. Project-target
Attention requires deterministic repair validation before resolution; reply prose alone cannot
declare a Project root healthy.

Because workspace project-target Attention is reserved for an invalid or unwritable root,
Assistant home permits at most one such open Attention per project. Repeated detection reuses the
unchanged notification; after resolution, a later recurrence creates a new ID.

Targeted Attention has exactly one immutable target. A Goal or project target covers its contained
nonterminal Work. A problem affecting unrelated roots creates one Attention per root; their bodies
may link each other, but that correlation owns no control state. Targetless Attention is a
completion proposal and update, and never blocks. Only final Planner success may create it as
support for the Planning Work `done` gate. Each Goal has at most one open targetless Attention not
yet claimed by `completionAttentionId`; Planner reuses it while its message remains accurate or
resolves it as superseded before creating another. Any accepted instruction that changes the
contract or requires new Planning must first resolve an unclaimed proposal, so no revision field
is needed on Attention. Work and inbox events do not copy a blocking field.

The body is free Markdown. The following headings are a writing convention for models, not a
schema or parser contract:

- Assistant clarification: exact question or condition, context, recommendation, trade-offs,
  consequence of delay, owner, retry condition, and Evidence. For Work-targeted problems, Work
  `attempts` remains authoritative; Attention may include only a creation-time summary.
- completion notification: delivered outcome, commits, checks, Evidence, limitations, and
  deferred follow-up
- resolution: references to the answering Input, blocker-clearing Evidence, completion delivery,
  or supersede reason

The canonical identity is `(projectId, goalId, attentionId)` for Goal-local Attention and
`(homeId, attentionId)` for workspace Attention. Inbox correlation always stores the complete
reference because local IDs may repeat across Goals or homes. The operator-visible notification
payload is immutable from creation. Resolution may append its answering Input or clearing Evidence
in the Markdown resolution section without changing the delivered notification. A materially
different operator message resolves the old Attention as superseded and creates a new ID.

Resolving targeted Attention and applying its effects uses one publication when `resolvedAt` is its
only gate; it installs supporting effects first and the resolution last. Any additional gate is a
separate publication. A cross-root answer uses the receipt sequence defined under Canonical
Publication. In its project phase, effects precede Goal Input, and Goal-local Attention resolution
is the final unblocking gate after that receipt. An answer has four model-visible decisions:
`continue` resumes the responsibility derived from current Work kind and stage, `retry` resets that
Work lineage, `cancel` makes the targeted Work terminal, and `revise` starts Planning under an
explicit same-contract or new-contract-revision mode. Only `revise` selects Planning because the
answer changes authority. It clears `operatorRequest` but leaves the old Attention open under
Assistant ownership until the represented change clears or supersedes the blocker. No continuation
field or answer-state document is stored. One dependency exception prevents self-blocking: when the
Attention targets the exact Planning Work being revised, the accepted authority update settles it
before Planner resumes. Condition-based Attention resolves only when its condition is cleared.

`notifiedAt` is null until an Attention-linked Reflection turn is durably exposed with its complete
handled reply in the speaking Assistant conversation. Informational delivery leaves
`operatorRequest` null. An actionable request records that exact handled event in `operatorRequest`;
only a user Inbox event whose immutable `context.replyTo` equals that pointer clears it after receipt
is durable and before Assistant continues. Only the explicit Reply action writes that `replyTo` and
the exact canonical Attention references; ordinary page context never infers them from open
Attention. By the end of that reply turn the old operator request must be resolved, cleared while a
represented revision proceeds, or replaced. None of these ownership transitions alone resolves the
Attention. Completion is marked notified and resolved in the same project publication. The
Assistant-home reply gate is always first, so a crash cannot
acknowledge delivery or transfer ownership without leaving a durable public turn whose recovery can
finish the exact linked Attention publications. Resolution facts do not change the immutable
notification payload or request delivery again.

The optional provider-neutral webhook configured by `HOPI_ATTENTION_WEBHOOK_URL` mirrors that
handled public Assistant reply; it never delivers raw Attention and never owns `notifiedAt`.
`webhookDeliveredAt` on the Inbox event is its separate durable acknowledgement. Webhook delivery is
at least once: a crash after the transport accepts the reply but before `webhookDeliveredAt` may
repeat the same event identity. Retry timing remains disposable runtime state, so no notification
ledger or exactly-once outbox is added.

### `evidence/**`

Evidence is immutable. Its front matter is a minimal provenance envelope containing stable
identity, creation time, qualified `producerRun` or Coordinator check, owning Goal or Work, and
referenced artifacts.

The Evidence body is free Markdown containing facts needed to defend an outcome, such as diffs,
commits, tests, runtime verification, Reviewer findings, integration results, or limitations.
Evidence existence alone does not consume a Run result. A result becomes consumed only when Work
canonically appends its Evidence to `evidenceRefs`; the qualified `producerRun` on referenced
Evidence then prevents that Run from affecting Work again. Evidence left unreferenced by a process
crash is preserved, but a later attempt uses a new Run rather than recovering the old transition.

For an Engineering responsibility, staged authority includes every Work reachable from the owning
Work through `dependsOn` and all Evidence named by those Works' append-only `evidenceRefs`. HOPI
resolves portable Run artifact references from that selected Evidence into one Run-local read-only
manifest. This is a projection of existing canonical Evidence and immutable Run storage, not a new
document type or a second source of truth.

The product derives one read-only browser URL from the immutable identity
`(Project, Goal, Evidence, artifact index)`. Resolution starts from that exact canonical Evidence
entry and may reach either preserved Run storage or a reviewed Project-relative file in a managed
integration root. The URL is only a transport projection: it creates no artifact registry, permits
no arbitrary filesystem path, and never replaces the Evidence reference as authority. Missing or
ambiguous files fail closed instead of opening a guessed location. Known image, media, document, and
data formats use their browser-safe media type; unknown or executable content remains inert text.

Corrections create new Evidence and may reference the superseded Evidence; existing Evidence is
never edited into a different claim. Raw transcripts are runtime data, and a success claim backed
only by a transcript is incomplete. `evidenceRefs` owns durable reachability and Run-result
consumption, but no criteria mapping. Criteria-to-Evidence mapping remains semantic model judgment,
not a kernel DSL.

### Audit and supporting files

The durable audit view is derived from canonical documents, immutable Inputs, Evidence, Attention,
and available Git history. Ordinary document publications do not wait for a Git commit; Coordinator
creates audit commits in the background and at critical checkpoints such as C1. Runtime Run records
enrich developer diagnostics when available but are not required for reconstruction. There is no
canonical Goal journal or archive lifecycle. Ordinary supporting files are allowed and may be
linked from canonical documents, but their names and locations carry no control semantics.

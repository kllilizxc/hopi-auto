# HOPI MVP Assistant

Status: forward Assistant authority
Last updated: 2026-07-19

This document owns the workspace Assistant conversation, its configured vendor session, HOPI tool
boundary, turn recovery, and UI behavior. Canonical schemas belong to
[the document model](./mvp_document_model.md), Goal and Work execution to
[the execution design](./mvp_execution.md), and lifecycle visualization to
[the state machine](./mvp_state_machine.md).

## Mental Model

The Assistant is one normal persistent conversation, executed by a Home-configured model adapter,
with a small set of HOPI tools. It is not
an intent parser, a staged-diff protocol, or a special workflow responsibility.

```text
User message -> durable conversation turn -> configured vendor session -> ordinary reply
                                                               \-> optional HOPI tool calls
                                                        -> canonical documents
                                                        -> Reconciler

semantic state change -> disposable Reflection -> optional internal brief -> speaking session
```

A greeting, question, acknowledgement, or discussion receives an ordinary conversational answer.
No Project or Goal effect occurs unless the Assistant chooses and successfully calls a HOPI mutation tool.
HOPI does not add keyword routing, prose parsing, an `actions[]` result, or a second model call to
classify the message.

Every public turn is already a durable **receipt** in Assistant Inbox. It becomes Goal authority only
when Assistant deliberately **adopts** it through an existing mutation tool. An optional suggestion,
future idea, or reference that should not change current delivery remains ordinary conversation: it
is still available in conversation history, but creates no Goal Input, Planning Work, or separate
`Note` state. The model judges the requested effect from meaning; HOPI adds no suggestion classifier
or trigger vocabulary.

The MVP has one operator-facing, workspace-wide Assistant thread per HOPI Home. The operator may
submit more messages while a turn is running; durable pending turns wait in receipt order. One
Assistant turn runs at a time so vendor conversation order remains coherent. Goal responsibility
Runs and the internal Reflection loop remain independent and may run concurrently. Multiple
operator-visible Assistant threads are deferred.

## Operator-Facing Communication

The speaking thread reports only the useful state delta and the operator's next action. The
operator should be able to scan a reply and answer two questions: what happened, and do I need to
do anything?

- Lead with the plain-language outcome or current condition. Prefer direct openings such as
  `Started`, `Completed`, `Could not continue`, or `Need your decision` in the operator's language.
- Default to one or two short sentences. Add detail only when it changes the operator's
  understanding or decision, or when the operator asks for it.
- When operator action is required, state one concrete question or instruction. When no action is
  required, do not invent a next step or narrate what the workflow will do next.
- Do not repeat the request or expose Goal, Work, Attention, Run, or event IDs; responsibility names;
  tool calls; document paths; internal stages; or verification process unless the operator asks or
  the detail is necessary to disambiguate a choice.
- An accepted effect must remain locatable from the operator's current view. When Assistant creates
  or changes a Goal other than the preferred page Goal, its final reply names that Goal and includes
  the exact Goal ID. This is a discoverability exception to hiding internal identifiers, not a new
  delivery notification or UI state.
- A recoverable internal problem remains silent unless its user-visible delay or consequence is
  itself useful information. HOPI reports exhausted recovery as a direct blocker and action.

This is a communication policy, not a response schema. HOPI does not parse replies, impose a hard
character limit, run a summarizer, or require fixed headings. Technical evidence remains available
in Kanban and Attempt details, while the Assistant conversation stays focused on conclusions and
actions.

## Speaking Thread And Reflection

The persistent Assistant conversation is the **speaking thread**. It is the only model session that
may call mutating HOPI tools, publish an operator-facing reply, or decide that the operator should be
interrupted.

Reflection is a disposable, read-only model Run that lets the Assistant notice progress or trouble
without waiting for a new user message. It is an internal runtime mechanism, not a second product
Assistant, responsibility pass, Work stage, durable workflow entity, or Kanban concept. A Reflection
is a logical fork: it receives a compact reason for waking and semantic facts changed since the last
assessed snapshot. It does not receive public conversation or another full current-state dump. The
speaking thread already owns conversation, and Reflection can reread bounded scoped state only after
the delta identifies a concrete candidate. Old Reflection briefs are not fed back into later
Reflection prompts. The implementation does not require a model vendor to clone a live session.

Reflection is a single read-only background analyst. User input never interrupts its model Run.
Every Run owns an immutable semantic snapshot; changes observed while it runs make the result stale,
so Coordinator lets the process finish, discards its prepared handoff, and assesses the latest
snapshot. Reflection follows one small protocol:

1. A meaningful state digest change records that a newer snapshot has not yet been assessed; it does
   not by itself start a model Run. Ordinary log appends remain outside the digest.
2. A snapshot is immediately eligible when it contains an Assistant-owned Attention, an unavailable
   Project, or a stale running Attempt. Otherwise it becomes eligible only after Coordinator has no
   deterministic action to take in an idle reconciliation tick that begins and ends with no
   responsibility Run active. Requiring a quiescent tick prevents a Run that finishes during an old
   scan from being mistaken for settled state before its result is reconciled. Normal automatic
   progress therefore coalesces across Planning, Generation, Review, C1, and final Planning. This
   immediate rule also applies to the first snapshot after process startup; only a non-urgent first
   snapshot establishes the silent baseline.
3. At most one Reflection runs per Home. Changes coalesce through the current digest instead of
   forming an event queue. A failed model transport never marks its digest assessed and enters one
   exponential backoff that survives later semantic changes. Those changes keep coalescing behind
   the same delay instead of resetting retries; after a small failure threshold, HOPI probes only at
   the capped interval until one Reflection succeeds and clears the backoff.
4. Reflection first decides from the supplied trigger and compact delta. Work facts contain only
   control state plus a bounded latest-Run outcome. It may reread bounded scoped HOPI state and follow
   an exact diagnostic path only when a concrete anomaly needs revalidation. It does not scan the
   HOPI archive speculatively. It cannot mutate canonical state or speak to the operator.
5. If no response or action is useful, it ends silently. A successful Reflection transport may
   express that result with an empty final message; empty output is `No action` in Reflection mode,
   not a failed model Run. Public user turns still require a non-empty reply; an internal speaking
   turn may remain silent, publish one informational final response, or call `request_user` before
   returning one exact question for a decision or external action. Only an explicit `handoff_to_main` call creates an
   internal brief. Reflection selects any Attention references it means to hand off; Coordinator
   validates but never infers or expands that selection. Coordinator publishes a brief only after
   confirming the observed digest is still current; it does not accept an `actions[]` plan.
6. The brief becomes a durable internal speaking Inbox item, not another model session. The same
   persistent speaking thread used for user turns rereads current state and
   decides whether to call normal HOPI tools, remain silent, or publish one explicit notification
   rewritten under the operator-facing communication policy. Internal IDs and diagnostics from the
   brief are not copied into that reply by default.

An eligible pending internal Inbox item is the durable ownership boundary for that assessment, so
Coordinator does not start another Reflection while that item can still run. Event-target Attention
instead makes the item ineligible: the original item remains pending for revalidation after the
blocker is resolved, but it must not suppress Reflection of newer semantic state. Reflection may
therefore hand off the Assistant-owned blocker or an unrelated new Goal Attention without retrying
the blocked item. Exact Attention references and `operatorRequest` preserve ownership independently
from informational delivery history.
This bounds failure without allowing one blocked internal item to stop workspace-wide observation.
When several urgent candidates coexist, Reflection normally restores an event-target speaking-turn
blocker before background Goal follow-up because it directly delays conversation. The model may
choose a more consequential urgent issue instead; this is prioritization guidance, not another
Coordinator queue or hard-coded Attention kind.
The consecutive-handoff guard follows the same ownership boundary: a handled speaking turn is
observable progress and resets the chain. Only a later handoff whose immediate predecessor is still
pending or Attention-blocked extends the chain. This catches recursive delivery failure without
mistaking several successfully handled state changes for a loop.

The semantic digest covers Goal lifecycle and revision, Work stage, dependency and recovery facts,
Attention lifecycle, Attempt completion/interruption, project availability, and C1 integration. It
excludes raw transcript growth and presentation-only changes. It is a lossless coalescing key, not a
list of model-call triggers. The single eligibility rule is whether HOPI needs immediate attention or
can still make deterministic automatic progress. A time-derived stale-Run observation is included
because a hung process may produce no state transition.

One state observation scans durable Run manifests once and derives one immutable, request-scoped
Attempt index. Every Goal and Work lookup in that observation reuses the index; no Work starts its
own archive scan, and the index is discarded after the observation rather than becoming cached
authority with invalidation rules. Terminal Attempt activity comes from its manifest. Only the
latest running Attempt reads mutable event and transcript activity needed for stale-Run detection.
Manifest reads use bounded concurrency so a larger Run archive increases work linearly without
creating an unbounded native-I/O allocation burst.

New user input has strict speaking priority. It may interrupt a Reflection-sourced internal speaking
turn, which remains pending and is revalidated later, but it never interrupts the read-only
Reflection Run. A user effect that changes canonical state invalidates the Reflection snapshot; the
finished stale result is discarded before any internal Inbox publication.

One eligible state digest is assessed at most once after a successful model Run. A digest deferred
while automatic work is progressing is not assessed and may become
eligible unchanged when the system reaches a settled boundary.
Internal handoffs are bounded; if repeated handoff-and-action cycles do not converge, HOPI creates
event-target Attention rather than recursively waking itself forever.

## Context Is Not Authority

The UI may attach the currently viewed Project and Goal as immutable turn context. Context changes
what the Assistant sees first and supplies defaults to read tools. It is not a route, lock, instruction, or
authorization to mutate that Goal.

The Assistant may answer from that context without calling a tool. A HOPI mutation tool always names its
actual Project, Goal, or Work target and validates it at call time. Therefore opening a Goal and
sending `hi` cannot create Goal Input, Planning Work, or any Kanban change.

The selected context is a convenience, not hidden memory. Current canonical documents read through
HOPI tools override stale conversational assumptions.

`hopi_read_state` returns a bounded current-state slice by default, not the whole durable archive. It exposes
active Runs explicitly; includes every Engineering Work plus only nonterminal Planning Work; and
inlines open Attention and each visible Work's latest Attempt while representing Goal, Work, and
design documents with compact current facts plus canonical paths. The default Work projection omits
cumulative Evidence-reference arrays and returns only their count and latest reference. It also
returns the latest finished Planning outcome once per Goal, so an empty Planning handoff is visible
without restaging historical Planning or scanning every Evidence document. Home- and Project-scoped
reads are navigation and control indexes: they omit Goal bodies, detailed Attempt paths, and other
payload that belongs to an exact Goal read. A Goal-scoped read expands those current details, and
exact bodies remain readable from returned paths when the current question requires them. This scope
progression keeps one tool result directly consumable without adding pagination or a query language.
Every open Attention projection includes its complete canonical `reference`. Tools copy that value
verbatim; models never reconstruct a reference from an Attention ID, target, or surrounding Project
state. Current diagnostic projections are observations computed at the response's `observedAt`.
An Attention body is the immutable rationale recorded when that Attention was created; keeping the
Attention open means it has not yet been resolved, not that every diagnostic claim in that rationale
is still current. The Assistant compares the current observations with that historical rationale and
may resolve an Attention whose premise no longer holds. The Assistant tool projection makes this
temporal boundary structural: live candidate integration appears as `currentCandidateIntegration`,
while the immutable Attention body appears as `creationRationale`. These names affect only the model
view; canonical documents and product APIs retain their domain fields. A `ready` result means the
current task and release inputs can pass the C1 source merge without Generator source repair; it
does not mean the Work is schedulable while an unrelated gate remains open.
An explicit `includeEvidence: true` Goal read expands the bounded Evidence bodies and resolved
artifact projections needed for a deliverable answer. Historical Planning, resolved Attention, and
other Evidence remain first-class Project documents and are read from exact paths only when needed.
This keeps current control facts prominent without introducing pagination, a query language, or a
second history store.

Every speaking-thread prompt names the immutable current Inbox event. Because even a bounded state
result can be much longer than the operator's message, `hopi_read_state` repeats that event ID,
body, and page context as the final `currentTurn` field of its result. This is attention anchoring,
not intent parsing or an action schema: the configured model still decides the reply and tools, but
it must continue the current event rather than completing a prior turn suggested by stale
conversation context.
Reflection state reads have no operator `currentTurn` and remain unchanged.

## Image Attachments And Goal References

The UI may attach or paste bounded raster images into a public user turn. HOPI stores every accepted
image under Assistant home before acknowledging the Inbox event, renders its thumbnail in the
conversation, lists its canonical attachment reference in the current-turn prompt, and supplies its
resolved local file to the configured transport as image input. This works for both a new session and
a resumed compatible vendor session.

Receipt and adoption are deliberately separate:

- Home receipt is mechanical and lossless. It makes the image available to the current Assistant
  turn and later conversation replay without claiming Project relevance.
- Goal adoption is a model decision. When an image matters to one Goal, Assistant includes that
  attachment and a free-form purpose in the same existing HOPI tool call that creates the Goal,
  writes design, or requests Planning.
- The tool copies the immutable bytes to Goal-local `assets/`, records path, provenance, and purpose
  in editable `design/references.md`, and publishes the Goal Input in the same Goal publication.
- The same Home attachment may be independently adopted by more than one Goal. Each Goal keeps its
  own portable copy; HOPI does not create cross-root links.

There is no image classifier, OCR service, attachment workflow, Asset lifecycle, or automatic
adoption rule. Omitting references from a tool call means the image remains conversation-only.
Assistant never silently converts arbitrary client paths into attachments. A missing or corrupt
accepted image fails closed instead of running a text-only interpretation that pretends to have
seen it.

Assistant-home attachment paths are receipt authority only and may never be copied into Goal,
design, or Work prose. If Assistant judges an image relevant, the same tool call must adopt it and
canonical Goal text may cite only the returned Goal-local `assets/` path. A mutation that contains
an Assistant-home attachment path without the corresponding adoption is rejected atomically. This
preserves model judgment about relevance while making it impossible to create a non-portable Goal
that later responsibilities can locate only by searching Assistant home.

## Durable Conversation And Runtime Session

Each accepted user message is first written as one durable public Inbox turn. A useful Reflection
handoff is written through the same store as one durable internal Inbox turn. The turn owns its exact
source content, attachments, optional page context, final Assistant reply, and terminal disposition.
`pending | handled` remains sufficient durable state:

- `pending` means the turn is queued, running, interrupted, or blocked by targeted Attention;
  those distinctions are derived from runtime facts and Attention.
- `handled` means a final Assistant reply is durable. It does not imply that the model called a tool.

A deterministic product control may execute a known HOPI tool directly and mirror its command and
reply into the same public Inbox history without invoking the model. While that request is between
its durable `pending` receipt and deterministic `handled` acknowledgement, Coordinator holds only a
transient admission guard so the speaking loop cannot race the request. This is not another Inbox
state or lease. If the process stops before acknowledgement, the guard disappears and the retained
pending turn becomes an ordinary idempotent Assistant recovery input.

The free-form disposition is diagnostic only: speaking turns use `answered` when no tool event was
observed and `tools-used` when one was. It never claims that a side effect was applied; durable
documents and the recorded tool result remain the only evidence of an effect.

`source: user | reflection` preserves provenance. `visibility: public | internal` controls only the
conversation projection. User turns are always public. Reflection turns begin internal; a non-empty
final response publishes them while an empty response leaves them hidden. These fields do not grant
mutation authority.

The vendor-qualified session cache and normalized live events are runtime data under
`.hopi/runtime/assistant/`. `session.json` stores `version`, `transport`, `sessionId`, the digest of
the durable initial Assistant contract, and the runtime-affinity digest. HOPI resumes that session
only while the configured transport and both digests match. A legacy bare Codex thread cache migrates to
`transport: codex`, but a cache without the current contract digest is rebuilt before another turn;
changing transport or the initial contract likewise invalidates the old cache instead of pretending
that vendor sessions or stale instructions are compatible. A model change within one transport may
reuse its session because the next invocation still receives the current configured model.

A vendor session must also remain attached to the stable HOPI Assistant workspace and adapter
runtime contract under which HOPI created it. The session manifest therefore stores a runtime digest
derived from that normalized workspace path and a HOPI-owned adapter revision. A missing or changed
digest is an incompatible cache and follows the same single rebuild path. This invalidates sessions
created before workspace affinity became part of the contract without querying or rewriting vendor
session storage on every turn.

Losing or invalidating vendor session state does not lose product truth: HOPI starts a new session
from the durable Home instructions, a fixed character budget of the newest public user-visible
exchanges, and the oldest pending turn. Internal Reflection turns are not reconstructed as conversation memory;
their durable effects are revalidated from current canonical state. Long-lived decisions belong in
Project, Goal, design, or preference documents rather than an unbounded vendor thread transcript.

For each speaking turn, normalized Assistant messages, tool calls, tool results, status, and errors
append to runtime `events.jsonl`; raw process output appends to `transcript.log`. Reflection keeps the
same diagnostics in its own runtime directory. The UI may poll or stream public turn events while a
turn is pending. The final Assistant message is copied into the Inbox turn before it becomes handled.
Runtime events improve observability but never authorize a Goal or Work transition.

The configured vendor owns transient retry inside one invocation. HOPI treats the vendor's
structured terminal result as authoritative: a terminal error is recorded as the turn failure and
shown to the operator rather than accepted as Assistant speech, retried by Coordinator, or treated
as evidence that a cached session is incompatible. The adapter preserves the vendor's exact
non-empty terminal diagnostic whether it is supplied as a scalar error, result, or error list before
classifying the failure. A session identity reported only by a terminal error is not persisted.
`system` is only a transport envelope;
initialization and retry telemetry remain nonterminal. HOPI rebuilds durable conversation history
exactly once only when the adapter explicitly reports that the cached session itself is missing or
incompatible. Raw vendor output remains diagnostic truth in `transcript.log`, while the conversation
shows a bounded, safe error summary and at most the latest retry status.

## Assistant Execution Boundary

The Assistant runs in a stable HOPI-owned runtime directory, not a user checkout, task worktree, or
managed project root. Each turn receives one exact execution envelope derived from the same resolved
transport, Project access preference, mode, roots, and network policy used to launch the provider.
The envelope is the single source for both process configuration and model-visible capability facts;
it never claims broader access than the launched process has. Project-local unrestricted access
defaults off, and Reflection remains read-only. This is execution capability, not product authority:
canonical mutations are accepted only through HOPI tools and source delivery is accepted only
through Engineering Work publication. The runtime root remains provider scratch space: its paths
are neither canonical nor
operator-addressable. Canonical Evidence with an available `operatorUrl` is operator-addressable. The
projection explicitly reports whether HOPI mutation tools are available in the current turn, so the
model does not infer capability from filesystem permissions.

HOPI exposes its tools through one local MCP server with a per-turn capability. Each supported
vendor adapter injects that same server using the vendor's native non-interactive configuration. The server
runs inside the Coordinator process and sends every mutation through the same validators,
controllers, publisher, and global publication queue used by the rest of HOPI. MCP is a transport
for model tool calls, not a second durable workflow or an Assistant-specific Action document.
OpenCode receives the stable workspace through both the process working directory and `PWD`, plus
the generated configuration through an explicit `OPENCODE_CONFIG` path. Before every OpenCode model
invocation, its native MCP inspection must report the injected
`hopi` server connected. Failure is a startup error, not model input: the turn stays pending and no
unverified model reply can substitute for the missing capability.

The non-interactive vendor invocation permits the injected `hopi` MCP server plus the local
execution described by its resolved execution envelope. The default Project setting keeps provider
access bounded; the Project-local full-access switch makes future non-Reflection invocations
unrestricted. The backend persists and resolves that setting at invocation start; browser
localStorage mirrors it for the Project UI but does not authorize execution by itself. Unrelated
personal MCP servers and provider configuration remain excluded.
The speaking Assistant may use the capabilities present in that envelope. Its prompt contains
the environment projection, current scoped state observation, resource ownership, and HOPI effect
semantics rather than a prescribed tool-selection procedure. Provider apps, plugins, memories, and
workflow tools remain excluded because they introduce competing product authority rather than
execution capability. Reflection has only HOPI read/handoff authority and receives no provider
skill catalog. Responsibility Agents remain free to use execution capabilities within accepted
Work. The MCP process has only a single-turn capability token, and the backend revokes that token
when the turn ends. Every built-in vendor adapter disables its interactive approval layer: Codex
uses `never`, Claude bypasses permission prompts, and OpenCode uses deterministic `allow` or `deny`
rules. This removes an impossible unattended UI prompt without becoming the authorization boundary.
Server-side capability validation, canonical target validation,
responsibility result validation, controllers, and the publisher form a blacklist of effects HOPI
will reject. Provider sandboxing enforces the resolved envelope; these product boundaries do not
pretend to infer semantic intent from shell commands. Reflection is always read-only because it has
read and handoff authority but no execution responsibility.

The initial session instructions state only durable operating rules and available tool semantics.
They do not require a fixed response shape or output file. Their digest is derived from those exact
instructions, so changing the contract transparently rebuilds one session from durable conversation
history rather than leaving a restarted backend on stale behavior. Subsequent user messages use
normal compatible vendor session resume. A public turn's final model answer is the operator-facing
reply. For an internal turn, a non-empty final answer is likewise the complete informational update;
an empty answer keeps the turn internal. No notification tool duplicates that native response.

Once one speaking invocation reaches terminal failure, the Inbox turn stays pending under one
event-target Attention. Coordinator does not rerun the same failed invocation: a later operator or
Assistant decision may explicitly retry after the condition changes. This keeps transport failure at
the execution boundary instead of turning it into a hidden workflow retry policy.

The model receives the current operator turn, bounded durable conversation, preferences, execution
environment, page context, and a timestamped scoped state observation. Goal and Project tools expose
validated preconditions and effects. Its goal is an effect whose scope, durability, and accessibility
match the operator's intent; conversation reports that effect but does not substitute for it. No
deterministic classifier maps prose, tool failures, or page context to a required operation; the model
judges the semantic owner and any missing authority from those facts. Current tool validation remains
authoritative when the observation or thread memory is stale.

## User Preferences

Speaking Assistant receives the current Assistant-home `preference.md` content and digest on every
turn, including resumed vendor sessions. This document contains only durable cross-Project defaults.
The model applies relevant defaults to its communication and judgment, while the current turn and
explicit Project or Goal authority always win. Reflection analysis does not receive or modify this
document.

Speaking Assistant is the sole preference writer. It uses model judgment rather than keywords,
classification fields, or a fixed feedback workflow to distinguish a reusable preference from a
one-off request. A write replaces the complete free-Markdown document using the exact digest from
the current turn; stale writes fail without partial change. There is no Preference agent, structured
preference record, or preference lifecycle.

A preference write records a default only. It does not wake Reflection, request Planning, interrupt
a Run, or mutate a Goal. When the same instruction should also change current delivery, Assistant
separately uses the existing design and Planning tools in that turn. This keeps remembering and
acting as two explicit effects instead of introducing a hidden trigger between them.

## MVP Tool Surface

The exact JSON schemas are implementation details, but the MVP exposes these capability families:

| Capability | Purpose | Durable effect |
| --- | --- | --- |
| Read HOPI state | Read Projects, Goals, design, Work, Attention, Evidence, Attempts, and derived Kanban | None |
| Manage Project | Create a Project, add a Repo, or rebind one or more moved Repos | Assistant-home Project links; create and add prepare an explicitly selected empty Repo when required |
| Write preferences | Replace durable cross-Project user defaults | Assistant-home `preference.md` |
| Create Goal | Create one Goal, record the current instruction, and select its first Planning or Engineering Work | Goal package, Goal Input, and exactly one first Work |
| Write design | Create or update Goal-local `design/**` Markdown | Design documents and explicitly adopted reference images |
| Create Work | Admit the current instruction as one Planning or Engineering Work | Goal Input and exactly one selected Work; Planning never retries Work or resolves Attention implicitly |
| Control Goal | Pause, resume, cancel, reopen, or reprioritize one Goal | Validated Goal lifecycle or priority transition |
| Control Work | Retry or defer one Work, or cancel one Engineering Work | Validated Work transition; retry and cancellation settle only affected Work Attention |
| Resolve Attention | Record that one exact reported condition has cleared | Attention settlement after the owning validator accepts the condition |
| Control Preview | Start or stop reviewed Preview | Runtime process only |
| Request user | Stage selected open Attention for an operator question from an internal turn | None by itself; the validated final response becomes the public Inbox reply and then records Attention `operatorRequest` |

Tools control canonical facts, never Kanban columns. Kanban changes only because its projection
observes the resulting Goal, Work, Run, or Attention truth.

Every mutation returns its verified canonical effect and any Attention references it settled. The
model does not infer success from the requested verb or reconstruct state from prose. Results omit
derived continuation, Kanban predicates, and unrelated open Attention; Assistant reads current state
only when the next decision actually needs them.

A failed Preview produces an ordinary Assistant turn with Project and Goal context. Assistant uses
the existing design and Create Work capabilities when source repair is needed; Preview has no
special repair operation or repair workflow.

Every work-domain operation shared by the product UI and speaking Assistant uses the same domain
validator and document store. Host configuration is deliberately outside that parity: model and
full-access settings remain direct operator UI/API controls and are not model tools. Directory
pickers obtain a host path, navigation changes presentation, and confirmation dialogs collect intent;
none is a separate Assistant capability. HOPI does not let Assistant call its own public HTTP UI
routes or duplicate their mutation logic.

Project management accepts `create`, `add_repo`, or `rebind_repos` as explicit changes. With no
operator-supplied path, Assistant asks for the Project directory instead of calling the tool. Create
and add classify the supplied path as part of the same operation: an existing Git Repo is linked,
while an empty directory or missing leaf whose parent exists is initialized and then linked. A
selected subdirectory already inside a Git worktree links that existing Repo with its relative
Project path; HOPI never initializes a nested Repo. Missing ancestors and non-empty non-Git
directories remain validation failures. Rebind accepts a partial set of moved Repo identities,
merges unchanged current bindings server-side, and never initializes a replacement path.

Project management and preference writes require a public user turn. An internal Reflection handoff
may diagnose Project state and ask the operator for a missing path, but cannot originate a new
Project binding or preference.

Project topology writes are durable before runtime topology changes. When the speaking Assistant
links or rebinds a Project or Repo, the current turn is allowed to publish its final reply first;
HOPI then rebuilds the Project runtime from the updated Assistant-home documents. This post-turn
refresh prevents a successful tool call from stopping its own Assistant session. A crash between the
write and refresh is harmless because restart reads the same durable Project links.

The changed Project is nevertheless visible to later HOPI tool calls in that same speaking turn.
This lets Assistant call Manage Project and then Create Goal as two ordinary semantic operations;
execution and reconciliation still begin only from the rebuilt runtime after the final reply.

Create Goal and Create Work share one optional reference input containing an existing durable Inbox
attachment reference and a free-form purpose. Write design expresses the same adoption as an
attachment change alongside document changes. These are MCP tool arguments, not model-produced
Action results or a workflow schema. The speaking Assistant selects them; the backend only validates
provenance and performs deterministic copy and Markdown publication.

`Create Goal` is complete admission of the current user instruction: its required `firstWork`
explicitly selects `planning` or `engineering`. For Planning, the Goal already contains the semantic
objective, so HOPI supplies one concise standard Planning contract instead of asking Assistant to
repeat it. An Engineering first Work supplies its complete title, objective, acceptance criteria,
and Repos. HOPI publishes the Goal Input and exactly that first Work in one publication; it never
infers omission as "no Work" or silently chooses a responsibility.

`Create Work` provides the same bounded admission for an existing active Goal. Its `planning` branch
selects same-contract or new-contract-revision Planning. Its `engineering` branch supplies one
complete, proportionate Work contract with Repos and dependencies and requires that no nonterminal
Planning Work exists. HOPI owns structural facts such as ID, initial stage, revision, and dispatch
provenance. Goal creation and Create Work each accept one Work rather than an array.

Planning and Engineering first Work have distinct domain effects and preconditions. A named model,
tool, workflow, or delivery path remains part of accepted authority. The product's explicit
Create-with-Planning UI selects the same standard Planning contract through the same domain boundary.

One Inbox Input may directly admit at most one Engineering Work across every Goal in the Home.
The canonical `assistantDispatch` reference and event-scoped serialization make exact replay
idempotent and reject a different or second direct Work. If the instruction needs multiple new
Work, the direct admission boundary rejects the second effect. Direct admission never claims Goal
completion; final Planning remains unchanged.

Creating Planning Work is an authority boundary, not a general way to remember conversation. It
adopts the current turn as Goal Input and may invalidate an active Planner. Assistant therefore leaves
a non-blocking suggestion conversation-only unless the operator intends it to change the current plan
or delivery. `Write design` is the corresponding explicit adoption when the requested durable effect
is documentation rather than implementation; it does not mechanically request Planning.

Starting Planning never retries, resets, cancels Engineering Work, or settles Attention. Open
Attention therefore remains the scheduling gate until Assistant explicitly resolves its exact
reference after judging the represented condition clear. Planner's empty proposal means only that
Planning changed no canonical contract or DAG; it does not claim that Coordinator will retry a
blocked responsibility.

Goal delivery and other HOPI effects are asynchronous after admission. Once a mutating tool reports
that the requested effect is accepted, the Assistant replies to the current user immediately from
that result. It does not sleep, poll state, or wait for Planner, Generator, Reviewer, C1, Preview, or
Reflection in the same speaking turn. Later completion, blocking, or decision-worthy state is
reported through the existing read-only Reflection path. This keeps one rule for every
long-running effect and avoids a second progress-watching workflow inside conversation.

Asynchrony begins after the speaking turn settles, not between related tool calls inside that turn.
The first Goal effect installs a process-local barrier for that Goal; later calls in the same turn
may extend the barrier to other Goals. Coordinator admits no responsibility Run for a touched Goal
until the final reply is durable or the turn fails, then wakes normal reconciliation. This prevents
a Planner from observing newly admitted Planning Work before a later related tool effect in the same turn,
without blocking unrelated Goals or adding a canonical phase.

The acceptance reply also identifies where the effect landed when that target is not the preferred
page Goal. Durable publication proves the effect happened; naming the returned Goal ID lets the
operator find its scoped Kanban without adding auto-navigation, prose parsing, or an effect ledger.

`Write design` addresses files relative to the selected Goal's `design/` root. If Assistant repeats that
Goal's exact canonical design prefix, the tool strips it instead of creating a nested `.hopi` tree;
any other control-root nesting is invalid. Repeated writes to the same normalized path in one call
collapse to the final content, so one logical document has one publication target.

When page context identifies a Project or Goal, the turn also receives a compact, timestamped state
observation containing the scoped Goal lifecycle and revision, nonterminal Work, open Attention,
active Runs, and available Evidence artifacts. This observation helps the model relate the current
instruction to existing delivery without prescribing an operation. It is not canonical authority:
every mutation still passes through the ordinary tool validator against current state, so a stale
observation cannot publish an invalid effect.

The available effects remain facts of the architecture. Assistant runtime writes do not integrate
linked source; Engineering Work, Reviewer, and C1 own that delivery path. Goal and Work tools expose
their preconditions and durable effects, including the fact that reopening a terminal Goal advances
its contract revision and materializes Planning. The model selects among those effects from the
operator's objective, conversation, scoped state, and environment. HOPI does not encode shell-error
parsing, package-manager rules, or automatic command-to-Work fallback.

Read tools return current bounded documents and projections rather than staging every linked Goal
into every prompt. Their runtime section identifies the latest Run and Attempt and supplies paths to
`attempt.json`, normalized events, raw transcript, staged context, prompt, and result without
inlining those potentially large files. Assistant decides what else to read. This keeps ordinary
conversation responsive and lets the architecture improve automatically with model tool-use
capability.

Tool scope is structurally namespaced by its argument and canonical reference, not inferred from an
ID's human-readable prefix. `home:<homeId>/...` references describe Home-owned Inbox or Attention
state, so their Home ID is never a Project argument. A workspace-wide state read omits Project and
Goal arguments, while a scoped read copies the exact Project and optional Goal IDs returned inside
current Project state. The tool boundary verifies that the Project actually belongs to the Home and
returns an ordinary tool-request rejection for a mismatched namespace instead of a server fault.
The same boundary classifies every explicit capability, argument, replay, and current-state guard
rejection as a tool result. Unexpected storage, publication, and implementation failures remain
server faults with their diagnostic stack.

A Goal-scoped read may explicitly request Evidence detail when the current user question requires a
deliverable body or artifact, such as "where is the report". That opt-in returns the bounded Evidence
body and gives each resolved artifact two deliberately distinct projections: `inspectionPath` is an
internal read-only path for Assistant inspection, while `operatorUrl` is the only address that may be
linked in an operator reply. This lets Assistant select the semantic deliverable without guessing
from a design, Work, or latest Attempt path and without exposing machine-local storage as navigation.
Ordinary Goal reads retain only the compact Evidence index, and workspace-wide reads omit Evidence
detail. `includeEvidence` is one bounded read choice made by the model, not a query language or a new
workflow concept. Reflection always receives the compact form because it revalidates control state
rather than consuming delivery payloads.

Reflection receives a narrower MCP capability containing only state read and `handoff_to_main`.
`handoff_to_main` may create one internal Inbox turn and has no Project or Goal effect. The speaking
thread receives its ordinary Goal and Work tools plus `request_user` for one exact decision or
external action. Capability mode is server-owned and cannot be selected by the model. A non-empty
final response from that internal turn is an informational update by default; an empty response stays
internal. Tool choice, rather than parsing message prose, owns only the operator-wait transition.

Every internal response paired with `request_user` is a self-contained decision request, not merely a list of choices. It
preserves enough material cause and consequence from the internal brief for the operator to
understand what changed, why HOPI cannot safely continue, what answer or action is needed, and the
non-obvious effect of viable alternatives. It includes a recommendation when HOPI has one. This is
expressed proportionally in ordinary language: concise means omitting irrelevant history, internal
IDs, and process narration, not omitting the causal context needed to decide. HOPI does not add a
request schema, prose parser, or frontend reconstruction rule.

When a Reflection brief exists specifically to deliver Attention, Reflection supplies exact
Assistant-owned canonical references as Inbox context. The speaking Assistant explicitly confirms
that same selection in `request_user`; Coordinator never widens or substitutes it. `request_user`
contains references only: the model's final response is the complete operator-facing question. It
rejects an empty, mismatched, stale, resolved, operator-owned, targetless, or
out-of-context selection.
Reflection may select a targetless completion Attention for an informational completion handoff;
the speaking Assistant must not pass that reference to `request_user`. Publishing the resulting
informational reply acknowledges and resolves that exact completion Attention.
One handoff selects either workspace Attention or Attention from exactly one Goal. Reflection chooses
the single coherent condition worth surfacing instead of combining unrelated scopes, and copies each
selected `reference` directly from `hopi_read_state`.
An internal Reflection handoff is advisory, not a second durable request from the operator. If the
speaking Assistant still fails after its normal one-time Session recovery, Coordinator terminates
that internal Inbox event with the failure retained in its turn record and creates no event-target
Attention. The underlying canonical state remains unchanged and can be assessed by a later semantic
change. A failed public user event still receives event-target Attention so user intent cannot be
lost. This boundary prevents Reflection from recursively reflecting on its own delivery failure.
Goal-local and workspace Attention use the same mechanism. After the speaking model returns,
Coordinator treats a non-empty final response as the one public informational reply and an empty
response as an internal no-op. When `request_user` was staged, that same final response is instead the
one public request; an empty response is invalid. Coordinator publishes the reply before publishing
`notifiedAt` for each selected still-current reference. A request additionally records the exact
handled event in `operatorRequest`. Recovery of an already handled public Reflection turn finishes
any missing acknowledgement. Targeted Attention remains open; completion Attention is notified and
resolved. The optional webhook
then mirrors only this handled public reply and records `webhookDeliveredAt` on the Inbox event. It
does not deliver raw Attention or control `notifiedAt`. This reuses Inbox context and existing
documents instead of adding a notification ledger or parsing brief text.

`request_user` stages ownership intent only; it does not publish at call time. After the final model
response is available, Coordinator revalidates every selected reference before publishing either the
reply or its ownership acknowledgement. Resolving a selected Attention later in the same turn makes
the request stale and rejects it rather than asking for an already unnecessary action.

Attention is a state fact, not a command protocol. A handoff may remain **Waiting for Assistant**
after an ordinary turn when its evidence is insufficient to resolve it. Coordinator records the
turn normally; a later state change or Assistant turn decides the next action. An informational
response does not settle a blocker, and there is no hidden follow-up model pass that tries to force a
decision.

## Tool Safety And Recovery

Every mutation tool receives the current Home and Inbox turn from its server-side capability; the
model cannot substitute another source event. The model supplies only the intended target and
operation arguments.

Mutation tools follow these rules:

- validate the target and current canonical state immediately before publication
- preserve the exact user turn as Goal Input when the effect belongs to a Goal
- use domain identity and expected current content for idempotency
- return stable document references and a concise result to Assistant
- reject stale, invalid, or unauthorized requests without partially advancing a control gate
- create or reuse targeted Attention when safe automatic recovery is exhausted

Each Goal or Work control is one atomic operation, not a required pair of model calls. A Work retry resets that Work
and settles every open Attention targeted exactly at it; cancellation settles only Attention for the
Work it makes terminal. Deferral changes scheduling time only. No control operation closes a Goal,
Project, or unrelated Work Attention.

The Assistant chooses ordinary operations from the verified state: it creates Engineering Work for
a bounded direct change; writes design and creates Planning Work when authority or decomposition changes;
uses Goal or Work Control for lifecycle changes; and resolves Attention only after the owning condition has
actually cleared. An explicit user reply is evidence for that judgment, never a forced
`continue`/`retry`/`revise`/`cancel` classification. There is no stored continuation object:
ordinary reconciliation derives the next responsibility from canonical Work facts.

An open targeted Attention is the scheduling gate for its target. Resolving it publishes
`resolvedAt` immediately, removes that gate, and may make the target eligible for dispatch; a later
operator request neither reopens it nor retracts a Run already admitted from the resolved state.
`request_user` instead stages the public request and, after the final response is durable, records
`operatorRequest` on each still-open reference without resolving it. The same open Attention then
projects **Needs you** and continues to block scheduling while the answer is absent. These causal
effects are part of the Assistant environment and tool descriptions; HOPI does not infer intent from
call order or impose a tool-sequence policy.

The decision boundary is invariant across simple and complex Work. If the current Work outcome,
acceptance contract, dependency graph, and delivery boundary remain valid and another invocation is
wanted, the answer is `retry`; that includes a previous invocation stopped by transient preparation,
network, provider, or capacity failure. `revise` is used only when those represented facts must
change. A Planner success with an empty proposal confirms that no such represented change was made.
When the transferred Attention remains open, Reflection returns that compact outcome to the speaking
Assistant, which applies a different real effect or requests genuinely missing authority; it does not
repeat the already answered choice.

An expected domain precondition failure, such as requesting Planning for a terminal Goal before
reopening it, is a recoverable tool error. The internal HTTP boundary returns a conflict response
with the concise domain message; the MCP adapter exposes it to the model as `isError`, and the same
turn may reread state and issue the valid corrective tool sequence. It does not stop the server,
fail the conversation transport, or print an unexpected-error stack. Unknown implementation faults
remain server errors and retain their full diagnostic log.

Project Attention deliberately uses optimistic Agent recovery. Assistant inspects and repairs the
reported Project condition, then resolves that exact workspace Attention when it judges the repair
complete. Successful resolution restores Project eligibility and wakes Coordinator without adding
an automatic revalidation loop. A wrong judgment is discovered by the ordinary downstream
fail-closed boundaries, which create a new Project Attention. A successful shell command alone is
not resolution, and Assistant must not report the Project unblocked unless the Attention tool call
succeeds.

A single conversation turn may call multiple tools and may affect more than one Goal. The old
single-destination Inbox route claim therefore is not part of the forward Assistant protocol.
Historical route claims remain readable only for migration and provenance.

If the process stops after a tool succeeds but before the final reply, the Inbox turn stays pending.
On resume, Assistant sees the durable tool result through current HOPI state. Repeated tool calls are
safe because Goal Input identity, Goal/Work lifecycle guards, content hashes, and existing target
documents make the operations idempotent. HOPI does not add a generic operation database or parse
reply prose to reconstruct effects.

## Attention And Interruption

Assistant ambiguity is handled conversationally whenever an ordinary answer is enough. Targeted
Attention is reserved for a durable condition that blocks unattended progress or for repeated
Assistant/tool failure that cannot be completed safely.

Needs-you and completion Attention appear in the same Assistant thread as system updates. Replying
with that message's explicit `Reply` action sends a normal user turn with `replyTo` and the exact
Attention references in context. An ordinary composer submission carries only selected Project and
Goal context and never guesses Attention references from currently open blockers. Assistant may read
current state and call the appropriate HOPI tool; no prose answer parser exists.

The canonical Attention reference, not `replyTo`, is the durable authority of an explicit reply.
`replyTo` preserves conversational provenance and normally matches the latest `operatorRequest`, but
it is not a lock: a newer notification may replace `operatorRequest` while an already received user
reply waits in FIFO. At processing time Coordinator revalidates the same exact open Attention and
returns it to Assistant ownership even when that notification pointer changed. The speaking
Assistant still rereads current state before applying the answer, so accepting the queued reply does
not apply stale prose mechanically or let it affect another Attention.

An unresolved notified Attention decorates the exact Assistant message that asked the question with
one quiet warning surface, a small `Needs you` label, and one text-only `Reply` action. The surface
uses a uniform boundary rather than a separate accent rail. Multiple open references from the same
message share that presentation and reply context. Resolution removes the decoration and returns the
message to ordinary conversation styling; it does not append a synthetic resolved row. The composer
shows reply context as lightweight text with one icon-only dismiss action, not another warning chip.
Assistant has no title header; a non-zero unresolved count follows the Reflection entry in the same
compact, top-edge, center-aligned floating control row. Without a count, Reflection remains at the
right edge. Kanban keeps its Work badge and focus projection but does not repeat Needs-you as a
separate page banner. Selecting the count focuses the newest unresolved public request in the
conversation; it does not implicitly enter reply context, which remains the exact message's `Reply`
action.

A **Needs you** projection must navigate to the exact public Assistant turn that acknowledged its
canonical Attention reference. The conversation loads older pages when necessary and focuses that
turn; Goal surfaces do not copy the reply, expose the internal Attention body, or persist another
notification link.

An Attention reference is exact reply authority, not ambient page context. For an explicit reply,
Assistant must finish the turn with every referenced operator request either resolved, transferred
back to Assistant ownership while a represented revision proceeds, or replaced by a new request.
Unrelated open Attention remains untouched. For ordinary turns, Assistant may still resolve a blocker
that a successful named effect demonstrably cleared, but no page-scoped bulk reconciliation is
required and no open reference is attached automatically.

Resolution is Assistant judgment, not a safety capability. Resolving Project Attention requests a
fresh Coordinator reconciliation and does not itself declare the Project executable. Each backend
boundary rechecks its own durable and safety preconditions before acting; a remaining failure creates
ordinary Project Attention again without importing a separate Attention kind or validation model.

After the configured bounded Assistant retry count, HOPI creates event-target Attention and stops
retrying that turn until the operator responds or the condition changes. A visible error replaces
an indefinite loading indicator.

## UI Behavior

The Assistant drawer shows one chronological conversation:

- submitting snapshots and clears the composer immediately, then appends one memory-only optimistic
  user row without waiting for the Inbox request. The response supplies the canonical event ID; the
  ordinary feed sync replaces the optimistic row when that exact event appears. A rejected request
  removes the row and restores its text, images, and reply context instead of losing the draft. No
  optimistic row enters the browser history snapshot or any durable document
- Conversation activity is one rebuildable tail projection, never an Inbox message, runtime event,
  or durable status row. It is rendered at most once and only after the newest conversation row.
  A running public speaking turn shows `Working`. When no public turn is running, an active
  Reflection or Reflection-sourced internal speaking turn shows `Thinking` without exposing its
  hidden prompt, messages, or tools. `Waiting to start` is used when public work is queued but no
  speaking or Reflection activity is running. The projection disappears when none of those owners
  remains active
- live activity synchronization is independent of chronological pagination. The Server projects a
  change cursor from existing Inbox handling timestamps, turn manifests, and runtime events; the
  client applies changed entries and removals by stable identity. It does not assume that only the
  newest received message can still change, nor retain a standalone completion after that completion
  is absorbed into its public reply
- normalized model messages and useful tool activity appear while a turn runs
- native provider thinking summaries appear only as internal collapsed activity. Count-only or
  content-free lifecycle telemetry such as Codex thread/turn boundaries, Claude initialization and
  successful result envelopes, OpenCode step boundaries, `thinking_tokens`, and `task_progress` is
  hidden; it remains available in the raw transcript but never creates a conversation row. A provider
  thought envelope can never become the final operator-facing reply
- raw provider errors remain in runtime diagnostics, but a recovered intermediate error does not
  compete with a successful final reply; the drawer presents a turn error only when the speaking
  turn itself fails
- a trailing tool stream is rendered directly without an aggregate summary. It becomes one
  collapsed historical Activity row only after a later non-tool conversation row establishes the
  boundary. The conversation-level activity projection is not such a boundary. Individual tool calls
  remain compact diagnostics rather than chat commands the operator must understand
- the final Assistant message replaces the running presentation when the turn is handled
- later user messages may be submitted without waiting for the current turn
- internal Reflection turns and their diagnostics are hidden
- a Reflection-driven reply appears only when the speaking thread explicitly promotes it; no fake
  user bubble is shown for that update
- operator-facing replies contain conclusions and required actions; internal process belongs in the
  existing collapsed activity and Attempt views
- Assistant replies and their action/completion projections render through one shared,
  presentation-only GFM surface. Headings, lists, quotes, emphasis, tables, task lists, inline and
  fenced code, and safe links may appear while the current streamed snapshot is incomplete. Raw
  HTML and Markdown images are not rendered; attachments remain explicit durable feed items.
  Artifact and `http(s)` links open in a new tab, while arbitrary machine-local paths remain
  non-clickable. User-authored bubbles and runtime/tool diagnostics remain literal
- A user turn renders its literal text and attachment thumbnails as one right-aligned vertical
  stack. Attachments never share the text bubble's horizontal layout or reduce its readable width;
  image-only turns use the same stack without fabricating an empty bubble
- targeted Attention is pinned as one direct request without displaying its internal identifier;
  replying preserves every open identifier associated with that exact message invisibly as context

Every `Virtuoso`-backed stream, including Assistant conversation, Attempt activity, Reflection Runs,
and Reflection event activity, is the sole authority for its row visibility and height. Its
variable-height rows do not add browser `content-visibility` estimates that can fight scroll
anchoring.

The composer may show the current Project/Goal context and let the operator clear it. Its wording is
`Context`, never `Route to`. There is no generic loading state without elapsed activity or a durable
failure path.

Assistant has no persistent title header. One explicitly debug-only Reflection entry floats in its
top-right corner, hidden until the pointer enters that corner or keyboard focus reaches the control;
the active back control and an overlay close control remain reachable. A soft masked shadow separates
these controls from conversation content without reserving a toolbar row. Opening Reflection lazily
polls runtime manifests and normalized `events.jsonl`, showing digest, status, handoff, errors, and
model/tool activity. Closing it stops polling. The Reflection list likewise has no page title or
refresh toolbar; automatic polling is its single refresh rule, while each Run retains the minimum
expandable identity needed to distinguish history. This view has no mutation controls, does not enter
ordinary conversation history, and does not make Reflection a product concept or canonical state.
The debug list keeps `completed` as the runtime status but projects its outcome as `Sent` when
`handoffEventId` is present and `No handoff` otherwise. The latter truthfully covers both a silent
assessment and a prepared brief discarded after its snapshot became stale, without adding another
Reflection state.

When Assistant is docked beside a Project surface, it is a structural pane whose background ends at
the workspace boundary, not a floating layer casting another shadow over it. The overlay drawer keeps
its shadow.

## Explicit Non-Goals

The MVP does not include:

- keyword or regex intent routing
- model-produced `actions[]`, `result.json`, or `response.md` for conversation turns
- staged canonical filesystem diffs as the Assistant command protocol
- direct Assistant source edits or direct Kanban column mutation
- parallel turns inside one speaking conversation
- multiple named or operator-visible Assistant threads, or transparent session resume across vendors
- a durable Reflection queue, Reflection workflow state, or Reflection-authored canonical mutation
- a general workflow/tool DSL or user-editable tool schemas
- treating selected Goal context as permission or proof of a requested side effect
- a polished durable Reflection administration or analytics surface

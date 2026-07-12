# HOPI MVP Assistant

Status: forward Assistant authority
Last updated: 2026-07-12

This document owns the workspace Assistant conversation, its Codex session, HOPI tool boundary,
turn recovery, and UI behavior. Canonical schemas belong to
[the document model](./mvp_document_model.md), Goal and Work execution to
[the execution design](./mvp_execution.md), and lifecycle visualization to
[the state machine](./mvp_state_machine.md).

## Mental Model

The Assistant is a normal persistent Codex conversation with a small set of HOPI tools. It is not
an intent parser, a staged-diff protocol, or a special workflow responsibility.

```text
User message -> durable conversation turn -> Codex thread -> ordinary reply
                                                   \-> optional HOPI tool calls
                                                        -> canonical documents
                                                        -> Reconciler

semantic state change -> disposable Reflection -> optional internal brief -> Codex thread
```

A greeting, question, acknowledgement, or discussion receives an ordinary conversational answer.
No Project or Goal effect occurs unless Codex chooses and successfully calls a HOPI mutation tool.
HOPI does not add keyword routing, prose parsing, an `actions[]` result, or a second model call to
classify the message.

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
is a logical fork: it receives a compact reason for waking, semantic facts changed since the last
assessed snapshot, the relevant current-state slice, and bounded public conversation context. Old
Reflection briefs are not fed back into later Reflection prompts. The implementation does not require
a model vendor to clone a live session.

Reflection follows one small protocol:

1. A meaningful state digest change records that a newer snapshot has not yet been assessed; it does
   not by itself start a model Run. Ordinary log appends remain outside the digest.
2. A snapshot is immediately eligible when it contains an unnotified Attention, an unavailable
   Project, or a stale running Attempt. Otherwise it becomes eligible only after Coordinator has no
   deterministic action to take in an idle reconciliation tick that begins and ends with no
   responsibility Run active. Requiring a quiescent tick prevents a Run that finishes during an old
   scan from being mistaken for settled state before its result is reconciled. Normal automatic
   progress therefore coalesces across Planning, Generation, Review, C1, and final Planning. This
   immediate rule also applies to the first snapshot after process startup; only a non-urgent first
   snapshot establishes the silent baseline.
3. At most one Reflection runs per Home. Changes coalesce to the newest eligible snapshot instead of
   forming an unbounded queue.
4. Reflection first decides from the supplied trigger and delta. It may reread bounded scoped HOPI
   state and follow an exact diagnostic path only when a concrete anomaly needs revalidation. It does
   not scan the HOPI archive speculatively. It cannot mutate canonical state or speak to the operator.
5. If no response or action is useful, it ends silently. Otherwise it may submit one concise internal
   brief through `handoff_to_main`; it does not return an `actions[]` plan.
6. The brief becomes an internal pending Inbox turn. The speaking thread rereads current state and
   decides whether to call normal HOPI tools, remain silent, or explicitly expose a final reply
   rewritten under the operator-facing communication policy. Internal IDs and diagnostics from the
   brief are not copied into that reply by default.

The semantic digest covers Goal lifecycle and revision, Work stage, dependency and recovery facts,
Attention lifecycle, Attempt completion/interruption, project availability, and C1 integration. It
excludes raw transcript growth and presentation-only changes. It is a lossless coalescing key, not a
list of model-call triggers. The single eligibility rule is whether HOPI needs immediate attention or
can still make deterministic automatic progress. A time-derived stale-Run observation is included
because a hung process may produce no state transition.

New user input has strict priority. Receiving a public user turn interrupts any active Reflection
and any currently running Reflection-sourced internal speaking turn, then lets the speaking thread
handle the public turn first. An interrupted internal turn remains pending and may be revalidated
after public input; it never blocks user speech merely because handoff already occurred. The
interrupted digest is not considered assessed; after the user turn, HOPI may assess one fresh
snapshot. State changes during a Reflection need not cancel it because the speaking thread always
revalidates before acting.

One eligible state digest is assessed at most once unless a user interruption invalidates that
assessment. A digest deferred while automatic work is progressing is not assessed and may become
eligible unchanged when the system reaches a settled boundary.
Internal handoffs are bounded; if repeated handoff-and-action cycles do not converge, HOPI creates
event-target Attention rather than recursively waking itself forever.

## Context Is Not Authority

The UI may attach the currently viewed Project and Goal as immutable turn context. Context changes
what Codex sees first and supplies defaults to read tools. It is not a route, lock, instruction, or
authorization to mutate that Goal.

Codex may answer from that context without calling a tool. A HOPI mutation tool always names its
actual Project, Goal, or Work target and validates it at call time. Therefore opening a Goal and
sending `hi` cannot create Goal Input, Planning Work, or any Kanban change.

The selected context is a convenience, not hidden memory. Current canonical documents read through
HOPI tools override stale conversational assumptions.

`hopi_read_state` returns a bounded current-state slice, not the whole durable archive. It exposes
active Runs explicitly; includes every Engineering Work plus only nonterminal Planning Work; and
inlines open Attention and each visible Work's latest Attempt while representing Goal, Work, and
design documents with compact current facts plus canonical paths. Exact bodies remain readable from
those paths when the current question requires them.
Historical Planning, resolved Attention, and Evidence bodies remain first-class Project documents
and are read from those paths only when needed. This keeps current control facts prominent without
introducing pagination, a query language, or a second history store.

Every speaking-thread prompt names the immutable current Inbox event. Because even a bounded state
result can be much longer than the operator's message, `hopi_read_state` repeats that event ID,
body, and page context as the final `currentTurn` field of its result. This is attention anchoring,
not intent parsing or an action schema: Codex still decides the reply and tools, but it must continue
the current event rather than completing a prior turn suggested by stale conversation context.
Reflection state reads have no operator `currentTurn` and remain unchanged.

## Image Attachments And Goal References

The UI may attach or paste bounded raster images into a public user turn. HOPI stores every accepted
image under Assistant home before acknowledging the Inbox event, renders its thumbnail in the
conversation, lists its canonical attachment reference in the current-turn prompt, and supplies its
resolved local file to the Codex turn as an image input. This works for both a new conversation and a
resumed persistent Codex session.

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
- `handled` means a final Assistant reply is durable. It does not imply that Codex called a tool.

The free-form disposition is diagnostic only: speaking turns use `answered` when no tool event was
observed and `tools-used` when one was. It never claims that a side effect was applied; durable
documents and the recorded tool result remain the only evidence of an effect.

`source: user | reflection` preserves provenance. `visibility: public | internal` controls only the
conversation projection. User turns are always public. Reflection turns begin internal and remain
hidden unless the speaking thread explicitly requests operator notification before completing them.
These fields do not grant mutation authority.

The Codex thread ID and normalized live events are runtime data under
`.hopi/runtime/assistant/`. HOPI resumes the same Codex thread for the next turn when possible.
Losing vendor session state does not lose product truth: HOPI starts a new Codex thread from the
durable Home instructions, a fixed character budget of the newest public user-visible exchanges, and
the oldest pending turn. Internal Reflection turns are not reconstructed as conversation memory;
their durable effects are revalidated from current canonical state. Long-lived decisions belong in
Project, Goal, design, or preference documents rather than an unbounded vendor thread transcript.

For each speaking turn, normalized Assistant messages, tool calls, tool results, status, and errors
append to runtime `events.jsonl`; raw process output appends to `transcript.log`. Reflection keeps the
same diagnostics in its own runtime directory. The UI may poll or stream public turn events while a
turn is pending. The final Assistant message is copied into the Inbox turn before it becomes handled.
Runtime events improve observability but never authorize a Goal or Work transition.

## Codex Execution Boundary

The Assistant runs in a stable HOPI-owned runtime directory, not a user checkout, task worktree, or
managed project root. It receives normal Codex conversation behavior and standard read-only shell
capability within that runtime directory. It does not receive direct write authority over canonical
project documents or source trees.

HOPI exposes its tools to Codex through one local MCP server with a per-turn capability. The server
runs inside the Coordinator process and sends every mutation through the same validators,
controllers, publisher, and global publication queue used by the rest of HOPI. MCP is a transport
for model tool calls, not a second durable workflow or an Assistant-specific Action document.

The non-interactive Codex invocation pre-approves tools only for this injected `hopi` MCP server;
it does not grant broader shell, filesystem, or unrelated MCP write authority. The MCP process has
only a single-turn capability token, and the backend revokes that token when the turn ends. Tool
approval therefore removes an impossible unattended UI prompt without becoming the authorization
boundary: server-side capability validation, canonical target validation, controllers, and the
publisher remain authoritative.

The initial thread instructions state only durable operating rules and available tool semantics.
They do not require a fixed response shape or output file. Subsequent user messages use normal
Codex session resume. A public turn's final Codex answer is the operator-facing reply; an internal
turn's answer remains hidden unless `notify_user` promoted that turn while it was pending.

Before admission, Assistant asks only when the requested outcome, target Project/Goal, or operator
intent is materially unclear. Once an instruction is clear enough to admit, Assistant calls the
appropriate HOPI tool without conducting a delivery interview; Planner owns technical and design
clarification discovered after admission. Current canonical state overrides thread memory, and the
current Inbox turn overrides suggestions from older conversation.

## MVP Tool Surface

The exact JSON schemas are implementation details, but the MVP exposes these capability families:

| Capability | Purpose | Durable effect |
| --- | --- | --- |
| Read HOPI state | Read Projects, Goals, design, Work, Attention, Evidence, Attempts, and derived Kanban | None |
| Create Goal | Create one Goal, record the current instruction, and start its initial Planning | Goal package and Goal Input |
| Write design | Create or update Goal-local `design/**` Markdown | Design documents and explicitly adopted reference images |
| Request planning | Record the current user instruction for a Goal and ensure Planning | Goal Input and Planning Work |
| Control Goal | Pause, resume, cancel, reopen, or set priority | Validated Goal/control documents |
| Control Work | Retry, cancel, or change `notBefore` | Validated Work documents |
| Resolve Attention | Record an operator answer after any required Goal/Work effects | Goal Input and Attention resolution |
| Control Preview | Start, stop, or request repair of Preview | Runtime process, or ordinary Planning request for repair |
| Notify operator | Expose the current internal Reflection turn's final speaking-thread reply | Inbox visibility only |

Tools control canonical facts, never Kanban columns. Kanban changes only because its projection
observes the resulting Goal, Work, Run, or Attention truth.

Create Goal, Write design, and Request planning share one optional reference input containing an
existing durable Inbox attachment reference and a free-form purpose. This is an MCP tool argument,
not a model-produced Action result or semantic schema. The speaking Assistant selects it; the
backend only validates provenance and performs the deterministic copy and Markdown publication.

`Create Goal` is complete admission of the current user instruction: it creates the Goal Input and
the initial Planning guard in one publication. `Request planning` is therefore unnecessary for that
same instruction and is normally used for a later instruction against an existing Goal, including a
design change that should now be implemented. If Codex repeats the idempotent request anyway, it
must not create another Input or Planning Work. HOPI does not add tool-order state just to forbid a
harmless model retry.

Goal delivery and other HOPI effects are asynchronous after admission. Once a mutating tool reports
that the requested effect is accepted, the Assistant replies to the current user immediately from
that result. It does not sleep, poll state, or wait for Planner, Generator, Reviewer, C1, Preview, or
Reflection in the same speaking turn. Later completion, blocking, or decision-worthy state is
reported through the existing interruptible Reflection path. This keeps one rule for every
long-running effect and avoids a second progress-watching workflow inside conversation.

`Write design` addresses files relative to the selected Goal's `design/` root. If Codex repeats that
Goal's exact canonical design prefix, the tool strips it instead of creating a nested `.hopi` tree;
any other control-root nesting is invalid. Repeated writes to the same normalized path in one call
collapse to the final content, so one logical document has one publication target.

The Assistant never implements source changes itself. When the operator asks to modify design and
then implement it, Codex first uses the design tool, then requests Planning. Planner reads the
published design and creates or updates Engineering Work. This keeps the conversational model
simple without bypassing Planner, Reviewer, worktree isolation, or C1 integration.

Read tools return current bounded documents and projections rather than staging every linked Goal
into every prompt. Their runtime section identifies the latest Run and Attempt and supplies paths to
`attempt.json`, normalized events, raw transcript, staged context, prompt, and result without
inlining those potentially large files. Codex decides what else to read. This keeps ordinary
conversation responsive and lets the architecture improve automatically with model tool-use
capability.

Reflection receives a narrower MCP capability containing only state read and `handoff_to_main`.
`handoff_to_main` may create one internal Inbox turn and has no Project or Goal effect. The speaking
thread receives the ordinary tool surface plus `notify_user`, which may only promote its current
Reflection-sourced turn from internal to public. Capability mode is server-owned and cannot be
selected by the model.

When a Reflection brief exists specifically to deliver one Goal-local Attention, its ordinary Inbox
context includes that `attentionId`. `notify_user` first exposes the durable pending turn, then uses
the existing canonical Attention delivery key to acknowledge that same notification. Targeted
Attention remains open; completion Attention is notified and resolved. A brief without this exact
link may still be exposed but cannot claim an Attention delivery. This reuses Inbox context and
`notifiedAt` instead of adding a notification-deduplication record or parsing the brief text.

## Tool Safety And Recovery

Every mutation tool receives the current Home and Inbox turn from its server-side capability; the
model cannot substitute another source event. The model supplies only the intended target and
operation arguments.

Mutation tools follow these rules:

- validate the target and current canonical state immediately before publication
- preserve the exact user turn as Goal Input when the effect belongs to a Goal
- use domain identity and expected current content for idempotency
- return stable document references and a concise result to Codex
- reject stale, invalid, or unauthorized requests without partially advancing a control gate
- create or reuse targeted Attention when safe automatic recovery is exhausted

A single conversation turn may call multiple tools and may affect more than one Goal. The old
single-destination Inbox route claim therefore is not part of the forward Assistant protocol.
Historical route claims remain readable only for migration and provenance.

If the process stops after a tool succeeds but before the final reply, the Inbox turn stays pending.
On resume, Codex sees the durable tool result through current HOPI state. Repeated tool calls are
safe because Goal Input identity, Goal/Work lifecycle guards, content hashes, and existing target
documents make the operations idempotent. HOPI does not add a generic operation database or parse
reply prose to reconstruct effects.

## Attention And Interruption

Assistant ambiguity is handled conversationally whenever an ordinary answer is enough. Targeted
Attention is reserved for a durable condition that blocks unattended progress or for repeated
Assistant/tool failure that cannot be completed safely.

Needs-you and completion Attention appear in the same Assistant thread as system updates. Replying
to one sends another normal user turn with the Attention reference in context. Codex may answer,
read current state, and call the appropriate HOPI tool; no separate answer parser exists.

After the configured bounded Assistant retry count, HOPI creates event-target Attention and stops
retrying that turn until the operator responds or the condition changes. A visible error replaces
an indefinite loading indicator.

## UI Behavior

The Assistant drawer shows one chronological conversation:

- a submitted user message appears immediately
- queued and currently running turns are distinguishable
- normalized Codex messages and tool activity appear while a turn runs
- tool calls are collapsed diagnostics, not chat commands the user must understand
- the final Assistant message replaces the running presentation when the turn is handled
- later user messages may be submitted without waiting for the current turn
- internal Reflection turns and their diagnostics are hidden
- a Reflection-driven reply appears only when the speaking thread explicitly promotes it; no fake
  user bubble is shown for that update
- operator-facing replies contain conclusions and required actions; internal process belongs in the
  existing collapsed activity and Attempt views
- targeted Attention is pinned as one direct request without displaying its internal identifier;
  replying preserves the identifier invisibly as context

The composer may show the current Project/Goal context and let the operator clear it. Its wording is
`Context`, never `Route to`. There is no generic loading state without elapsed activity or a durable
failure path.

The Assistant header may expose one explicitly debug-only Reflection entry. Opening it lazily polls
runtime Reflection manifests and normalized `events.jsonl`, showing digest, status, handoff, errors,
and model/tool activity. Closing it stops polling. This view has no mutation controls, does not enter
ordinary conversation history, and does not make Reflection a product concept or canonical state.
The debug list keeps `completed` as the runtime status but projects its outcome as `Sent` when
`handoffEventId` is present and `No action` otherwise, so silent assessments are distinguishable
without adding another Reflection state.

## Explicit Non-Goals

The MVP does not include:

- keyword or regex intent routing
- model-produced `actions[]`, `result.json`, or `response.md` for conversation turns
- staged canonical filesystem diffs as the Assistant command protocol
- direct Assistant source edits or direct Kanban column mutation
- parallel turns inside one Codex thread
- multiple named or operator-visible Assistant threads, or model-provider-neutral conversation resume
- a durable Reflection queue, Reflection workflow state, or Reflection-authored canonical mutation
- a general workflow/tool DSL or user-editable tool schemas
- treating selected Goal context as permission or proof of a requested side effect
- a polished durable Reflection administration or analytics surface

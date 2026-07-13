# Multi-vendor coding-agent support

Status: accepted transport design; production hardening items are tracked in the delivery order
below.

This document refines the transport boundary in `mvp_execution.md`. Canonical Goal, Work,
Attention, Evidence, and publication semantics remain vendor-independent and continue to be owned
by the MVP documents.

## 0. Engineering objective

HOPI supports Codex, Claude Code, and OpenCode as execution transports for both:

- the long-lived Workspace Assistant conversation; and
- disposable Planner, Generator, and Reviewer responsibility Runs.

“Supported” means more than accepting a transport string. A built-in transport must have a tested
non-interactive command, machine-readable output decoder, real vendor session identity when the
surface is conversational, deterministic HOPI tool injection, cancellation behavior, image policy,
and actionable startup/runtime failures.

The scheduler must not know vendor flags or event schemas. The durable workflow must not depend on
vendor transcripts or session storage.

## 1. Assumptions challenged

### Existing schema support is not production support

The repository already accepted `claude` and `opencode`, but this previously proved only that HOPI
could construct a process. It did not prove that the current CLIs could consume the command or that
the Workspace Assistant could call HOPI tools, recover a session, extract an untruncated reply, or
understand current OpenCode events.

### The vendors do not provide equivalent security boundaries

Codex exposes an internal sandbox flag, and current Claude Code has OS-backed Seatbelt/bubblewrap
sandboxing. OpenCode exposes tool-permission policy but no equivalent boundary used by HOPI: an
allowed shell command still executes with the HOPI process user's authority. Worktree isolation and
post-run fingerprints detect invalid changes; they cannot prevent destructive access outside the
worktree.

Therefore HOPI must not claim equal containment. Claude Runs fail closed when its native sandbox is
unavailable and disable the unsandboxed-command escape hatch. Supporting untrusted repositories or
remote tenancy through OpenCode requires a separate HOPI-owned OS/container isolation design.

### One model catalog cannot serve all transports

Claude aliases are vendor-defined, while OpenCode models are provider-qualified and depend on the
operator's configured providers. HOPI accepts free-form model IDs and may offer stable aliases, but
must not maintain a hard-coded OpenCode catalog that becomes false as provider configuration and
model availability change.

## 2. Atomic requirements

- **REQ-001 — Provider-neutral responsibility input:** Every built-in transport receives the same
  staged prompt, immutable context paths, HOPI environment variables, worktree/root selection, and
  deterministic `result.json` contract.
- **REQ-002 — Provider-neutral responsibility result:** Scheduler transitions depend only on
  validated `result.json`, source/canonical postconditions, exit status, and semantic freshness.
  Vendor prose and transcript events never advance Work.
- **REQ-003 — Machine-readable execution:** Codex uses JSONL, Claude Code uses `stream-json`, and
  OpenCode uses JSON run events. Every raw stdout/stderr line is retained before normalization.
- **REQ-004 — Prompt privacy and size:** Large responsibility prompts travel through stdin when the
  CLI supports it. They must not be placed in argv, where they are size-limited and visible in
  process listings.
- **REQ-005 — Real conversational identity:** Workspace Assistant sessions use the ID emitted by the
  vendor. HOPI must never synthesize a timestamp ID and pretend that the next process resumed it.
- **REQ-006 — Session recovery:** A missing or incompatible vendor session causes one rebuild from
  bounded durable public Inbox history. Product truth never depends on the vendor session.
- **REQ-007 — HOPI tool injection:** Workspace Assistant invocations load exactly one turn-scoped
  HOPI MCP server with a revocable token. Claude receives an explicit strict MCP config; OpenCode
  receives its native `mcp` config shape. A stale token cannot authorize a later process.
- **REQ-008 — Assistant least authority:** The Workspace Assistant may use HOPI MCP tools and
  read an explicitly supplied image. It must not edit Project source or canonical files directly.
- **REQ-009 — Role authority remains explicit:** Claude defaults to `acceptEdits` inside a required
  native sandbox, loads only HOPI's explicit CLI settings, and emits `bypassPermissions` only when
  adapter configuration explicitly selects it. OpenCode's repository/user permission policy is not
  silently converted into a broader HOPI security claim.
- **REQ-010 — Image behavior is transport-specific:** Codex and OpenCode receive native image/file
  arguments. Claude receives access to the containing directory and exact local paths in the
  prompt. Missing/unreadable/oversize images produce an operational Run failure, not silent omission.
- **REQ-011 — Multi-repo context:** Extra Project roots are supplied through a vendor-supported
  access mechanism when one exists. Lack of a vendor sandbox flag does not imply lack of process
  access and must not be represented as containment.
- **REQ-012 — Cancellation:** HOPI owns the child process lifecycle. Responsibility Runs terminate
  the process group; Workspace Assistant turns terminate their child and remain durably retryable.
- **REQ-013 — Version drift:** Command builders and decoders are fixture-tested against current
  vendor shapes. Unknown JSON remains visible as a status event, while missing final reply/session
  identity fails loudly.
- **REQ-014 — Configuration resolution:** Home defaults, Project defaults, and explicit role
  overrides retain the resolution order defined in `mvp_execution.md`. Changing a Project default
  affects future responsibility Runs only; it does not switch the Home Assistant. An optional
  Home-level Assistant override affects future speaking and Reflection turns without changing
  responsibility defaults.
- **REQ-015 — Model input:** Codex requires HOPI's normalized default model and reasoning effort.
  Claude and OpenCode may use the provider default when model is absent. OpenCode model input uses
  `provider/model` when explicitly set.
- **REQ-016 — Preflight visibility:** Before a transport is presented as ready, HOPI should report
  binary discovery, supported CLI version/range, authentication/provider readiness, configured
  model validity where queryable, and a non-secret diagnostic message.

## 3. Boundary and data flow

```text
Coordinator / Workspace Assistant
        |
        | HOPI invocation contract
        v
vendor adapter (Codex | Claude Code | OpenCode)
  - command and stdin
  - MCP/image/session/permission mapping
  - vendor event decoding
        |
        v
vendor CLI child process
        |
        +--> raw transcript.log (diagnostic source)
        +--> normalized runtime events (diagnostic projection)
        +--> result.json (responsibility control result only)
```

The adapter boundary is deliberately narrow. Adding a fourth vendor should require a config schema,
command builder, transcript decoder, Assistant session decoder, capability declaration, and
contract fixtures. It must not add a scheduler branch or new canonical workflow state.

Do not introduce a universal vendor-option DSL. Fields such as Codex reasoning effort, Claude
permission mode, and OpenCode agent/variant remain in their discriminated transport config because
they are not semantically interchangeable.

## 4. Capability matrix

| Capability | Codex | Claude Code | OpenCode |
| --- | --- | --- | --- |
| Responsibility mode | `exec --json` | `--print --output-format stream-json --verbose` | `run --format json` |
| Prompt transport | stdin | stdin | stdin |
| Assistant resume | `exec resume <id>` | `--resume <id>` | `--session <id>` |
| Session ID source | `thread.started.thread_id` | stream `session_id` | run-event `sessionID` |
| HOPI MCP | CLI config overrides | explicit `--mcp-config --strict-mcp-config` | generated native `mcp` config |
| Native image input | `--image` | no equivalent local attachment used by HOPI | `--file` |
| Extra path mechanism | `--add-dir` | `--add-dir` | normal process filesystem access |
| Internal OS sandbox exposed | yes | yes; required and fail-closed by HOPI | no equivalent |

## 5. Failure and edge-case policy

- **Binary missing or not executable:** fail before dispatch once preflight exists; until then return
  an operational failure with the exact transport and executable name.
- **Not authenticated/provider unavailable:** preserve stderr in the raw transcript and surface a
  redacted actionable failure. Never retry indefinitely as if this were semantic rejection.
- **Unknown model:** operational failure; do not silently fall back unless the operator configured a
  vendor-native fallback.
- **Permission request in non-interactive mode:** fail or follow the explicit adapter policy. Never
  block forever waiting for an invisible terminal prompt.
- **Session ID absent:** fail the Assistant turn. A fake ID would cause an unbounded chain of fresh
  sessions and is worse than a visible failure.
- **Saved session missing:** clear the saved identity and rebuild once from durable history. A second
  failure remains visible and pending.
- **Transport switched:** a provider-qualified session manifest should discard the previous vendor's
  session before the first invocation, rather than paying for a known-invalid resume attempt.
- **Malformed/partial JSON line:** retain the raw line and show a conservative status event. The
  deterministic result/final-reply requirement still decides success.
- **Vendor emits several assistant messages:** use the final vendor result when present; otherwise
  preserve all text parts from the latest assistant message, without the 400-character UI summary
  truncation applied to diagnostics.
- **Large prompt:** stdin avoids OS argv limits. The immutable bundle remains available by path so
  prompts do not need to duplicate every file.
- **Image unavailable:** fail visibly. A textual claim that an unseen image was inspected is invalid.
- **Cancellation with descendants:** responsibility process groups are terminated. Workspace
  Assistant should converge on the same process-group behavior if vendor CLIs begin spawning
  persistent descendants.
- **CLI format changes:** fixture failure blocks release; unknown events do not silently become
  successful control output.

## 6. Delivery order

### Delivered in the initial hardening slice

1. Claude uses verbose stream JSON, explicit permission mapping, a required native sandbox with no
   unsandboxed escape hatch, additional directories, and actual session resume.
2. OpenCode reads prompts from stdin, accepts file attachments, emits current event shapes, and
   resumes the emitted session ID.
3. Claude and OpenCode Workspace Assistants receive valid native MCP configurations.
4. Workspace Assistant final replies are decoded separately from truncated diagnostic summaries.
5. Current OpenCode `text` and completed `tool_use` events have contract fixtures.
6. The UI stops advertising a stale provider-specific OpenCode model catalog.

### Required production-hardening follow-ups

1. Migrate `runtime/assistant/session.json` to store `{ transport, sessionId }` and discard a session
   immediately when Home Assistant transport changes.
2. Add a read-only transport preflight service and UI readiness state for binary, version, auth,
   provider/model, and MCP startup checks.
3. Run opt-in real-CLI smoke tests in CI against pinned supported versions; keep unit fixtures for
   offline determinism.
4. Define HOPI-owned OS/container isolation for OpenCode before claiming safe execution of untrusted
   projects.
5. Add retention/cleanup for obsolete vendor sessions created before true resume support.

## 7. Acceptance criteria

A vendor is production-ready only when all of the following hold:

1. A Workspace Assistant can answer two turns with the same real vendor session ID.
2. The second turn can invoke a turn-scoped HOPI MCP tool and the token is rejected after completion.
3. Planner, Generator, and Reviewer can each produce a valid `result.json` through the vendor CLI.
4. Generator changes remain inside the expected task worktree; Reviewer and canonical-file
   postconditions still reject forbidden changes.
5. Cancellation terminates the process without publishing a successful result.
6. Auth, model, quota, permission, malformed output, missing session, and missing result failures are
   distinguishable in diagnostics.
7. Image behavior is tested or explicitly reported unsupported; images are never silently dropped.
8. No scheduler, publication, Goal, Work, Evidence, or Attention rule varies by vendor.

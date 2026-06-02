# HOPI Agent Handoff

Status date: 2026-06-02

This document is the handoff entry point for an agent with no prior chat context.

## Current State

HOPI is being rebuilt as a Bun-first, file-native autonomous goal orchestration system.

Phase 1 backend is complete:

- The disposable prototype backend was replaced with a deterministic Bun core.
- The backend reads and mutates file-native goal boards.
- A single-step scheduler advances one deterministic unit per call.
- Goal-scoped runtime run/step/message history is now persisted under `.hopi/runtime/**`.
- The runner boundary now streams typed runtime events into step history.
- A real `ProcessAgentRunner` and git `WorktreeManager` now exist behind that runner boundary.
- Goal-scoped durable `write-trace.jsonl` recording now exists for process-backed file writes.
- Configured planner / generator / reviewer / merger process adapters now exist through repo-local adapter config and typed outcome files.
- Built-in vendor transport adapters now exist for Codex, Claude Code, and OpenCode, backed by durable per-step `prompt.md` bundles.
- Built-in vendor transports now normalize machine-readable CLI output into structured step transcripts instead of storing raw vendor JSON lines.
- Deterministic merger execution now performs real git merge completion and settled-run cleanup.
- Durable write traces are now queryable, injected into relevant role context bundles, and surfaced through the Bun API and UI.
- Reviewer and merger prompts now apply explicit write-trace evidence policy, including engineering evidence-gap guidance when no durable traces exist.
- The first Goal assistant substrate slice is now implemented with durable `decisions.yml`, repo `preference.md`, Goal-scoped `assistant-thread.json`, planner-context plumbing for decisions/preferences, and minimum Bun API routes for those stores.
- Live Goal assistant execution is now implemented with an explicit Goal-scoped runtime call, constrained durable actions, assistant run bundles under `.hopi/runtime/**`, and scheduler cleanup for resolved decision blockers.
- Goal assistant inspection APIs and Bun UI surfacing are now implemented for assistant prompts, decision/thread viewing, assistant run summaries, and assistant run detail inspection.
- Exact assistant bundle inspection is now implemented on the Bun product path for `context.md`, `prompt.md`, `outcome.json`, and `result.json`.
- Repo preference editing is now implemented on the active Bun API/UI path, and assistant now supports structured `request_planning` and durable preference lifecycle actions.
- Assistant can now explicitly request decision topics, and the Bun product path now supports direct decision creation and resolution with visible blocker linking.
- Durable decision topics now also support optional exact `prompt` text, so assistant/API/UI can preserve the canonical user-facing question directly in `decisions.yml` instead of relying only on short summaries or thread history.
- Answer-driven `question_blocks` and `question_spans` now also match current durable decisions by exact stored `prompt` text when available, so question-based replies no longer need to repeat topic labels inside the question itself.
- Answer-driven `question_blocks` and `question_spans` now also match current durable decisions by deterministic stored `prompt` core text, so question-based replies can restate the canonical durable question more tersely without falling back to fuzzy topic inference.
- Decision resolution now clears linked visible blockers immediately, and the Bun UI now exposes an explicit `Reconcile Once` control for one deterministic scheduler step.
- Resolving a decision that was blocking engineering work now creates or reuses visible planner follow-through, rewires engineering blockers onto that planning task, and lets richer later planning requests upgrade the generic follow-through instead of duplicating it.
- Goal docs are now inspectable through the Bun API/UI with deterministic `bootstrapped` versus `curated` status, and planner prompts now apply explicit doc-status follow-through policy for durable `design.md`.
- Durable `planning-requests.yml` now exists as the planner follow-through input surface: assistant and API can open file-native planning requests linked to visible planning tasks, planner context consumes them, the Bun UI surfaces them, and planning task completion auto-resolves linked requests deterministically.
- Durable planning requests now also carry decision lineage plus explicit `design.md` / `todo.yml` update targets, and reused open requests preserve newer follow-through metadata instead of dropping it.
- Durable planning requests now also support explicit `goal.md` update targets, and planner follow-through evidence/policy now treats `goal.md`, `design.md`, and `todo.yml` as one inspectable requested-update contract.
- Planning requests now also support validated Goal-local relative requested-update paths beyond the built-in `goal.md` / `design.md` / `todo.yml` trio, and assistant/API/UI/planner evidence all share that same normalized path model.
- Engineering-linked decision resolution can now carry one explicit single or grouped planner follow-through directly through the shared decision-resolution path, and grouped engineering blockers rewire to the current grouped sink tasks instead of relying on a later separate planning action.
- Planning-linked decision resolution can now reuse the current planning task as the explicit follow-through surface, including grouped staged follow-through without introducing a duplicate wrapper planning task.
- Explicit decision resolution can now also create standalone visible planner follow-through before there is a reusable planning surface or affected engineering blocker, while preserving the current default no-follow-through behavior when no explicit follow-through is supplied.
- One durable decision answer can now also fan out into multiple independent visible planner workflows through higher-order `workflow_batch` follow-through, while still using only `decisions.yml` plus `planning-requests.yml` as durable truth.
- One user answer can now also resolve multiple durable decision topics at once and route those resolved topics through one shared visible planner follow-through, still using only `decisions.yml` plus `planning-requests.yml` as durable truth.
- Planning requests can now also carry explicit captured user answers when planning should react to durable answer context that does not map cleanly to decision topics first, and planner context now surfaces those captured answers alongside decision lineage and requested updates.
- Decision-answer follow-through can now also carry explicit non-decision captured answers on `planning`, `planning_batch`, and `workflow_batch` leafs, so one action can atomically resolve real decision topics and write the remaining durable answer context straight onto planning requests.
- Assistant and API can now also atomically open more than one independent durable planning workflow directly on the planning surface through shared higher-order `workflow_batch` planning requests, without routing that work through a decision-answer action first.
- Direct higher-order planning workflows can now also reuse one current visible planning surface as their first child workflow, so expanding an existing planning task into a richer workflow batch does not require a wrapper task.
- When direct higher-order planning workflows reuse a planning surface that is already blocking engineering, runtime now fans that engineering blocker out to every current workflow sink instead of only the first child workflow.
- Direct higher-order planning workflows now also support stable `workflowKey`, so later assistant or API calls can extend one durable direct workflow batch and still get full workflow-state reconstruction plus workflow-wide blocker retargeting.
- Standalone children inside direct higher-order planning workflows now also support stable `workflowTaskKey`, so later assistant or API calls can update one durable child in place without relying on low-level request ids or title collisions.
- Direct higher-order planning workflows now also support stable child-to-child `blockedByWorkflowKeys`, so later children can wait on earlier child sinks and keep rewiring as those upstream child sinks extend.
- Direct higher-order planning workflows now also support workflow-root shared `decisionRefs` and captured `answers`, so one durable workflow graph can carry common planning context without repeating it on every child.
- Decision-backed and answer-backed `workflow_batch` follow-through now also reuses that same durable direct-workflow graph surface, including `workflowKey`, `workflowTaskKey`, and `blockedByWorkflowKeys`, instead of maintaining a second weaker multi-workflow path.
- Decision-backed and answer-backed `workflow_batch` follow-through now also supports workflow-root shared captured `answers`, so one answer-driven workflow graph can carry common non-decision answer context without repeating it on every child.
- Workflow-root shared context is now durable across later `workflowKey` extensions by persisting shared decision lineage and shared answers on workflow-linked planning requests, so new children inherit the same workflow-root baseline even when later calls omit it.
- Direct and decision-backed workflow graphs can now also reuse one already-open grouped planning surface as their first child through stable `groupKey` authority, so runtime adopts the whole open group instead of forcing callers to replay grouped siblings just to preserve workflow membership.
- Higher-order workflow graphs now also get a generated durable top-level `W-*` identity by default when callers omit `workflowKey`, so direct and decision-backed `workflow_batch` flows inherit extension authority, blocker tracking, and shared-context persistence without requiring hand-crafted workflow keys.
- Decision `resolve`, `answer`, and `answers` Bun API routes now also return the full shared runtime result, so callers can observe `blockerRemoved`, creation metadata, full `followThrough`, and any runtime-generated `W-*` workflow key instead of losing that authority behind decision-only response bodies.
- Goal assistant `resolve_decision`, `record_answer`, and `record_answers` action results now also return the full shared decision-runtime follow-through shape, so assistant-run responses, persisted run detail, and the Bun UI no longer flatten workflow authority down to ad hoc `followThrough*Keys` summary fields.
- Answer-driven assistant and Bun API actions now also support one shared `sourceResponse`, so a less-structured raw user reply can be captured once and reused across multiple durable decision topics plus non-decision follow-through answers instead of repeating the same answer payload in every entry.
- Answer-driven assistant and Bun API actions now also support root `answerSources` plus per-item `answerSourceKey`, so one less-structured raw reply can first be explicitly extracted into reusable topic-specific snippets and then mapped across multiple durable decision topics plus non-decision follow-through answers without repeating snippet text or collapsing everything to one shared raw response.
- Answer-driven assistant and Bun API actions now also support excerpt-grounded `answerSources` through `sourceExcerpt`, so reusable extracted snippets can be lifted directly from one shared raw reply with deterministic validation instead of being retyped into the action payload.
- Answer-driven assistant and Bun API actions now also support direct item-level `sourceExcerpt`, so one decision answer or planner follow-through answer can be grounded in a shared raw reply without first introducing a one-off named answer-source bundle.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "labeled_sections"`, so one structured raw reply can automatically materialize multiple durable decision answers and planner follow-through answers without per-topic excerpts or named answer-source bundles.
- Answer-driven `record_answers` assistant and Bun API surfaces now also support `inferOpenDecisions` on top of labeled shared replies, so matching current open durable decisions can be resolved without repeating those same decision topics inside the action payload.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "ordered_items"`, so one ordered list-style shared reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers without labels, excerpts, or per-topic mapping.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "ordered_blocks"`, so one ordered multi-paragraph shared reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers without labels or per-topic mapping, while still preserving more than one paragraph per answer block.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "question_blocks"`, so one question-and-answer style shared reply can deterministically feed explicit decision answers, inferred current open decisions, planner follow-through answers, and remaining inferred decision topics even when the answer blocks themselves no longer repeat the topic name.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "question_spans"`, so one inline question-and-answer style shared reply can deterministically feed explicit decision answers, inferred current open decisions, planner follow-through answers, and remaining inferred decision topics even when the answer sentences themselves no longer repeat the topic name or sit in separate question paragraphs.
- Answer-driven `record_answers` assistant and Bun API surfaces now also support `inferDecisionTopics` on top of labeled shared replies, so remaining labeled sections can become new durable decision topics even when there is no preexisting open decision surface or explicit `answers[]` mapping.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "inline_topics"`, so one less-structured natural-language reply with inline topic clauses can deterministically feed explicit decision answers, inferred current open decisions, planner follow-through answers, and remaining inferred decision topics without line-based labeled sections or ordered-list structure.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_sentences"`, so one less-structured natural-language reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers when each sentence still mentions the relevant known topic somewhere inside it, without forcing inline labels at the front of the clause or ordered-list structure.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_paragraphs"`, so one less-structured natural-language reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers when each answer already lives in its own multi-sentence paragraph and that paragraph mentions the relevant known topic at least once, without requiring the topic name in every sentence.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_blocks"`, so one less-structured natural-language reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers when each answer starts with one anchor paragraph that names the topic and then continues through later unlabeled paragraphs until the next anchor paragraph appears.
- Decision-backed and answer-backed `workflow_batch` follow-through now also supports explicit `reuseTaskRef` and `reuseGroupKey`, so one answered decision can adopt an arbitrary current planning surface or grouped planning surface through the same shared workflow-graph runtime instead of relying only on narrow implicit planning-linked reuse.
- Durable planning workflow graphs are now independently inspectable through Bun API list/detail endpoints plus a dedicated Bun UI workflow section, including workflow-root shared context and child request detail reconstructed directly from `planning-requests.yml` plus current open tasks.
- Normalized tool transcript entries now also persist stable `toolInvocationKey` metadata, and reviewer/merger run evidence now correlates tool calls with their results through that durable key instead of flattening transcript history into unrelated summary strings.
- Normalized tool-call transcript summaries now also capture stable target detail such as shell commands and file paths when vendor payloads expose them, so run detail and reviewer/merger evidence can show what a tool invocation actually touched without introducing a second tool-log store.
- Durable repo preferences now also use one canonical structured `.hopi/preference.md` document with stable `preferenceKey`, active or retired lifecycle state, optional rationale, structured record/retire APIs, and assistant preference actions that no longer rely on append-only deduplicated bullet guidance.
- Planning follow-through now computes requested-update coverage from open requests plus durable write traces, surfaces that coverage in planning contexts, and deterministically sends planning review/merge work back to `planned` when explicit requested updates still lack durable evidence.
- Opening a visible decision blocker for a planning task now also enriches any existing open planning request on that task with the decision key, and defaults missing requested-update targets to `design.md` plus `todo.yml`.
- Planning requests now support optional stable `groupKey`, and Goal assistant can request grouped multi-task planning follow-through in one constrained action with deterministic intra-batch task dependencies.
- When a grouped planning task opens a new decision blocker, runtime now enriches the other open requests in that same planning group with the same decision lineage instead of relying on manual repeated `decisionRefs`.
- Grouped planning requests now also persist durable `groupTaskKey`, and later grouped batches can extend an existing planning group by depending on earlier grouped siblings without replaying the whole batch.
- Engineering work blocked on grouped planning follow-through now retargets to the current open grouped leaf tasks instead of resuming when an earlier grouped planning task finishes.
- Reviewer and merger prompts now correlate prior run history, artifact refs, transcript evidence, and durable write traces instead of relying on write-trace policy alone.
- Planning reviewer and merger prompts now also enforce durable follow-through evidence against open planning requests, planning write traces, and prior run evidence.
- The Bun backend now serves the active Bun UI at `/`.
- Deeper planner/runtime behavior still remains intentionally out of scope for the current implementation slice.

Use this command before and after backend work:

```sh
bun run check
```

Expected result: backend typecheck, Biome, and Bun tests pass.

## Authoritative Documents

Read these first:

- `README.md`: repo entry point and common commands.
- `docs/agent-handoff.md`: current state, guardrails, and next work.
- `docs/hopi-phase-1-authority.md`: canonical Phase 1 schema and runtime boundary.
- `docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md`: completed Phase 1 execution plan and rationale.
- `docs/superpowers/specs/2026-06-01-live-goal-assistant-execution-design.md`: current authority note for explicit Goal assistant execution.
- `docs/superpowers/specs/2026-06-01-goal-assistant-surfacing-and-inspection-design.md`: current authority note for assistant inspection APIs and Bun UI surfacing.
- `docs/superpowers/specs/2026-06-01-assistant-run-bundle-inspection-design.md`: current authority note for exact assistant bundle inspection on the Bun product path.
- `docs/superpowers/specs/2026-06-01-goal-assistant-preferences-and-planning-request-design.md`: current authority note for repo preference editing and safer assistant planning/preference actions.
- `docs/superpowers/specs/2026-06-02-structured-preference-lifecycle-design.md`: current authority note for canonical structured repo preferences with stable keys, active/retired lifecycle, and assistant/API preference mutations.
- `docs/superpowers/specs/2026-06-02-durable-decision-prompt-design.md`: current authority note for preserving exact user-facing decision questions directly on durable decision topics through shared runtime, assistant, API, and Bun UI surfaces.
- `docs/superpowers/specs/2026-06-02-prompt-grounded-question-interpretation-design.md`: current authority note for reusing exact durable decision prompts as the matching authority for question-block and question-span answer interpretation.
- `docs/superpowers/specs/2026-06-02-prompt-core-question-interpretation-design.md`: current authority note for deterministic prompt-core reuse on question-block and question-span answer interpretation when the shared reply question is shorter than the stored durable prompt.
- `docs/superpowers/specs/2026-06-02-shared-answer-source-design.md`: current authority note for reusing one less-structured raw user reply across multiple durable decision topics and non-decision follow-through answers.
- `docs/superpowers/specs/2026-06-02-named-answer-source-interpretation-design.md`: current authority note for reusing explicitly extracted topic-specific answer snippets across durable decision topics and non-decision follow-through answers without introducing a second durable store.
- `docs/superpowers/specs/2026-06-02-answer-source-excerpt-grounding-design.md`: current authority note for grounding reusable named answer sources directly in one shared raw reply through exact source excerpts.
- `docs/superpowers/specs/2026-06-02-direct-item-source-excerpt-design.md`: current authority note for grounding one decision answer or planner answer directly in a shared raw reply without first defining a named answer source.
- `docs/superpowers/specs/2026-06-02-labeled-source-response-interpretation-design.md`: current authority note for automatically materializing durable answers from one labeled shared raw reply without per-topic excerpt or mapping fields.
- `docs/superpowers/specs/2026-06-02-open-decision-labeled-answer-inference-design.md`: current authority note for resolving matching current open durable decisions directly from one labeled shared raw reply without repeating those decision topics inside `record_answers`.
- `docs/superpowers/specs/2026-06-02-ordered-source-response-interpretation-design.md`: current authority note for deterministically materializing durable answers from one ordered shared raw reply without labels, excerpts, or per-topic mapping.
- `docs/superpowers/specs/2026-06-02-ordered-block-source-response-design.md`: current authority note for deterministically materializing multi-paragraph durable answers from one ordered shared raw reply without labels or per-topic mapping.
- `docs/superpowers/specs/2026-06-02-question-block-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from question-and-answer style shared replies whose answer blocks no longer repeat the topic name.
- `docs/superpowers/specs/2026-06-02-question-span-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from inline question-and-answer shared replies without requiring separate question paragraphs.
- `docs/superpowers/specs/2026-06-02-labeled-decision-topic-inference-design.md`: current authority note for turning remaining labeled shared-reply sections into new durable decision topics without existing open decisions or explicit `answers[]` mapping.
- `docs/superpowers/specs/2026-06-02-inline-topic-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from natural-language inline topic clauses without line-based labeled sections or ordered-list structure.
- `docs/superpowers/specs/2026-06-02-topic-sentence-source-response-design.md`: current authority note for deterministically materializing durable answers from less-structured topic-mentioned sentences without front-loaded inline labels or ordered-list structure.
- `docs/superpowers/specs/2026-06-02-topic-paragraph-source-response-design.md`: current authority note for deterministically materializing durable answers from multi-sentence topic paragraphs without requiring topic mentions in every sentence.
- `docs/superpowers/specs/2026-06-02-topic-block-source-response-design.md`: current authority note for deterministically materializing durable answers from anchored multi-paragraph topic blocks without requiring topic mentions in every continuation paragraph.
- `docs/superpowers/specs/2026-06-02-decision-workflow-explicit-surface-reuse-design.md`: current authority note for explicit `reuseTaskRef` / `reuseGroupKey` parity on decision-backed and answer-backed `workflow_batch` follow-through.
- `docs/superpowers/specs/2026-06-02-planning-workflow-inspection-design.md`: current authority note for independent workflow-graph read surfaces on Bun API and UI, including workflow-root shared context and child request detail.
- `docs/superpowers/specs/2026-06-01-goal-assistant-decision-requests-and-management-design.md`: current authority note for assistant decision requests and direct decision management.
- `docs/superpowers/specs/2026-06-01-decision-resolution-follow-through-and-reconcile-controls-design.md`: current authority note for immediate decision-unblock follow-through and explicit reconcile controls.
- `docs/superpowers/specs/2026-06-01-write-trace-aware-review-and-merge-policy-design.md`: current authority note for trace-aware reviewer/merger prompt policy.
- `docs/superpowers/specs/2026-06-01-goal-docs-inspection-and-planner-doc-status-design.md`: current authority note for Goal doc inspection and planner durable doc-status policy.
- `docs/superpowers/specs/2026-06-01-durable-planning-requests-and-planner-follow-through-design.md`: current authority note for durable planning requests and deterministic planner follow-through.
- `docs/superpowers/specs/2026-06-01-decision-linked-planning-follow-through-design.md`: current authority note for decision-linked planning requests and explicit `design.md` / `todo.yml` follow-through targets.
- `docs/superpowers/specs/2026-06-01-planning-update-coverage-validation-design.md`: current authority note for requested-update coverage surfacing and scheduler hard guards on planning follow-through.
- `docs/superpowers/specs/2026-06-01-decision-driven-planning-request-enrichment-design.md`: current authority note for enriching open planning requests when visible decision blockers are opened for planning tasks.
- `docs/superpowers/specs/2026-06-01-decision-resolution-planner-follow-through-design.md`: current authority note for routing resolved engineering decisions through visible planner follow-through before engineering resumes.
- `docs/superpowers/specs/2026-06-01-goal-doc-planning-update-targets-design.md`: current authority note for using `goal.md` as a first-class planning follow-through target.
- `docs/superpowers/specs/2026-06-01-goal-doc-planning-update-paths-design.md`: current authority note for generalized Goal-local planning requested-update paths beyond the built-in core files.
- `docs/superpowers/specs/2026-06-01-decision-resolution-explicit-planner-workflows-design.md`: current authority note for carrying explicit single or grouped planner follow-through on engineering-linked decision resolution.
- `docs/superpowers/specs/2026-06-01-planning-linked-decision-follow-through-design.md`: current authority note for reusing the current planning surface when linked planning decisions resolve into explicit durable follow-through.
- `docs/superpowers/specs/2026-06-01-standalone-decision-follow-through-design.md`: current authority note for creating visible planner follow-through from an explicit answered decision before there is a blocker or reusable planning surface.
- `docs/superpowers/specs/2026-06-01-multi-workflow-answer-follow-through-design.md`: current authority note for fanning one durable answer out into multiple independent planner workflows under the same decision answer.
- `docs/superpowers/specs/2026-06-01-multi-decision-answer-follow-through-design.md`: current authority note for resolving multiple durable decision topics from one answer bundle and routing them through shared planner follow-through.
- `docs/superpowers/specs/2026-06-01-answer-backed-planning-requests-design.md`: current authority note for capturing non-decision user answers directly on durable planning requests.
- `docs/superpowers/specs/2026-06-01-mixed-answer-follow-through-design.md`: current authority note for atomically combining decision-backed answers with non-decision captured answers on the same planner follow-through.
- `docs/superpowers/specs/2026-06-01-direct-planning-workflow-batch-design.md`: current authority note for atomically opening more than one independent durable planning workflow directly on the planning surface.
- `docs/superpowers/specs/2026-06-01-direct-planning-workflow-reuse-design.md`: current authority note for reusing one existing planning surface as the first child in a direct higher-order planning workflow batch.
- `docs/superpowers/specs/2026-06-01-direct-planning-workflow-blocker-propagation-design.md`: current authority note for fanning engineering blockers out across every sink in a reused direct planning workflow batch.
- `docs/superpowers/specs/2026-06-01-direct-planning-workflow-extension-design.md`: current authority note for giving direct higher-order planning workflows a stable top-level identity and durable extension path.
- `docs/superpowers/specs/2026-06-01-direct-planning-workflow-child-key-design.md`: current authority note for giving standalone children inside direct higher-order planning workflows a stable durable child identity.
- `docs/superpowers/specs/2026-06-01-direct-planning-workflow-child-dependency-design.md`: current authority note for durable child-to-child dependencies inside direct higher-order planning workflows.
- `docs/superpowers/specs/2026-06-01-direct-planning-workflow-shared-context-design.md`: current authority note for carrying shared decision lineage and captured answers across an entire direct higher-order planning workflow graph.
- `docs/superpowers/specs/2026-06-01-decision-workflow-graph-follow-through-design.md`: current authority note for reusing the same direct-workflow graph surface on decision-backed and answer-backed `workflow_batch` follow-through.
- `docs/superpowers/specs/2026-06-01-decision-workflow-shared-answer-context-design.md`: current authority note for carrying shared non-decision captured answers across an entire decision-backed or answer-backed workflow graph.
- `docs/superpowers/specs/2026-06-01-workflow-shared-context-persistence-design.md`: current authority note for persisting workflow-root shared context across later `workflowKey` extensions without introducing a second workflow store.
- `docs/superpowers/specs/2026-06-01-grouped-planning-workflow-reuse-design.md`: current authority note for reusing one already-open grouped planning surface as the first child in direct or decision-backed workflow graphs.
- `docs/superpowers/specs/2026-06-01-generated-workflow-key-design.md`: current authority note for making higher-order workflow graphs durable by default through runtime-generated `W-*` workflow keys.
- `docs/superpowers/specs/2026-06-01-decision-api-follow-through-result-design.md`: current authority note for surfacing full shared decision-runtime results, including generated workflow keys, on Bun decision answer/resolve APIs.
- `docs/superpowers/specs/2026-06-01-assistant-decision-follow-through-result-design.md`: current authority note for surfacing the same shared decision-runtime follow-through structure on assistant action results, persisted run detail, and Bun UI run inspection.
- `docs/superpowers/specs/2026-06-02-transcript-tool-correlation-design.md`: current authority note for persisting stable tool invocation keys on normalized transcript events and correlating tool call/result evidence across run detail and reviewer/merger context.
- `docs/superpowers/specs/2026-06-02-transcript-tool-target-detail-design.md`: current authority note for extracting stable shell-command and file-target detail from normalized tool-call transcript events so review/merge evidence can show what a correlated invocation actually did.
- `docs/superpowers/specs/2026-06-01-grouped-planning-follow-through-design.md`: current authority note for grouped planning follow-through across more than one visible planning task.
- `docs/superpowers/specs/2026-06-01-grouped-planning-decision-enrichment-design.md`: current authority note for propagating decision lineage across grouped planning follow-through.
- `docs/superpowers/specs/2026-06-01-incremental-grouped-planning-extension-design.md`: current authority note for durable grouped task keys and later grouped planning extension.
- `docs/superpowers/specs/2026-06-01-grouped-planning-blocker-propagation-design.md`: current authority note for keeping engineering blocked on the current open grouped-planning leaves.
- `docs/superpowers/specs/2026-06-01-run-history-and-artifact-aware-review-merge-policy-design.md`: current authority note for run-history and artifact-aware reviewer/merger policy.
- `docs/superpowers/specs/2026-06-01-planning-follow-through-review-merge-policy-design.md`: current authority note for planning follow-through reviewer/merger policy.

Historical reference only:

- `docs/hopi-goal-kanban-assistant-unified-design.md`
- `docs/hopi-multi-agent-architecture.md`
- `docs/hopi-multi-agent-implementation-plan.md`

Those historical docs contain old prototype concepts. Do not implement from them unless a newer authority doc explicitly reintroduces a concept.

## Hard Constraints

- Use Bun by default.
- Use `Bun.serve()` for backend APIs.
- Do not add Express, CORS middleware, execa, Vite backend coupling, `todo.mjs`, or a project-local kanban CLI.
- Keep the design simple. Prefer one deterministic source of truth over duplicated state.
- Do not add short-term compatibility layers for deleted prototype fields.
- Keep commits small and verified.

Phase 1 task schema does not include:

- `candidate`
- `blocked` as a task status
- `dependencyTaskList`
- durable historical blockers in `todo.yml`

## Data Model

Goal board path:

```text
.hopi/docs/goals/<goalKey>/todo.yml
```

Audit event path:

```text
.hopi/docs/goals/<goalKey>/events.jsonl
```

Write trace path:

```text
.hopi/docs/goals/<goalKey>/write-trace.jsonl
```

Goal decision path:

```text
.hopi/docs/goals/<goalKey>/decisions.yml
```

Planning request path:

```text
.hopi/docs/goals/<goalKey>/planning-requests.yml
```

Repo preference path:

```text
.hopi/preference.md
```

Runtime overlay path:

```text
.hopi/runtime/**
```

Runtime files are ignored and may be regenerated.

Goal assistant thread path:

```text
.hopi/runtime/goals/<goalKey>/assistant-thread.json
```

Goal assistant run path:

```text
.hopi/runtime/goals/<goalKey>/assistant/runs/<assistantRunId>/
```

Canonical task shape:

```yaml
version: 1
goal:
  goalKey: example
  title: Example Goal
items:
  - ref: T-1
    kind: engineering
    status: planned
    title: Implement a backend task
    description: Make the behavior work.
    acceptanceCriteria:
      - The behavior is covered by tests.
    blockedBy: []
```

Task kinds:

- `planning`
- `engineering`

Task statuses:

- `planned`
- `in_progress`
- `in_review`
- `merging`
- `done`

Blocker kinds:

- `task`
- `decision`
- `merge_conflict`
- `intervention`

Failure kinds:

- `agent_failed`
- `reviewer_rejected`
- `merge_conflict`
- `timeout`

`blockedBy` contains only current unresolved blockers. When a task blocker references a task that is now `done`, the scheduler removes that blocker and writes a `task_blocker_resolved` event.

When a decision blocker references a `decisionKey` that is resolved in `decisions.yml`, the scheduler removes that blocker and writes a `decision_blocker_resolved` event.

## Backend Modules

Current backend source:

- `packages/backend/src/domain/board.ts`: canonical task, blocker, status, failure, and event types.
- `packages/backend/src/domain/validation.ts`: YAML parsing, schema normalization, duplicate ref checks, missing task blocker checks, and task blocker cycle checks.
- `packages/backend/src/storage/paths.ts`: `.hopi` path construction.
- `packages/backend/src/storage/lock.ts`: file lock with same-process queue and stale lock handling.
- `packages/backend/src/storage/boardStore.ts`: atomic board reads, mutations, and event appends.
- `packages/backend/src/storage/decisionStore.ts`: durable Goal decision storage in `decisions.yml`, including optional exact question prompts.
- `packages/backend/src/storage/preferenceStore.ts`: canonical structured repo preference storage with stable keys, active/retired lifecycle, and file-native migration/validation for `.hopi/preference.md`.
- `packages/backend/src/storage/planningRequestStore.ts`: durable Goal planning-request storage in `planning-requests.yml`.
- `packages/backend/src/runtime/assistantThreadStore.ts`: Goal-scoped assistant conversation overlay under `.hopi/runtime/**`.
- `packages/backend/src/runtime/decisionRequest.ts`: shared control-path helper for decision requests plus resolution-side visible blocker cleanup.
- `packages/backend/src/runtime/answerInterpretation.ts`: explicit answer materialization and validation for shared raw replies plus reusable named extracted answer sources, including exact-excerpt grounding both through named sources and direct item-level excerpts plus deterministic labeled-section extraction.
- `packages/backend/src/runtime/planningRequest.ts`: shared control-path helper for durable planning requests plus planning-task follow-through resolution.
- `packages/backend/src/assistant/goalAssistantContext.ts`: Goal-scoped assistant context and prompt bundle generation.
- `packages/backend/src/assistant/assistantRun.ts`: assistant run record types and validation.
- `packages/backend/src/assistant/assistantRunStore.ts`: read-side assistant run inspection store.
- `packages/backend/src/assistant/GoalAssistantRuntime.ts`: explicit Goal assistant execution runtime and constrained durable action application, including structured planning requests, decision requests, and structured preference record/retire lifecycle.
- `packages/backend/src/runtime/attemptStore.ts`: ignored runtime attempt budget overlay.
- `packages/backend/src/runtime/runHistory.ts`: runtime run, step, message, and summary types.
- `packages/backend/src/runtime/runHistoryStore.ts`: Goal-scoped run history persistence under `.hopi/runtime/goals/<goalKey>/run-history.json`.
- `packages/backend/src/runtime/goalDocsStore.ts`: deterministic bootstrap plus inspectable `goal.md` / `design.md` content and `bootstrapped` versus `curated` status.
- `packages/backend/src/runtime/roleProcessContext.ts`: per-step `context.md` / `prompt.md` bundle generation with role-specific boundaries, planner durable-input plumbing for `todo.yml`, `decisions.yml`, `planning-requests.yml`, structured `.hopi/preference.md`, Goal doc status, and reviewer/merger evidence correlation across run history, artifact refs, transcript summaries, write traces, and planning follow-through requests.
- `packages/backend/src/runtime/worktreeManager.ts`: run-scoped git worktree preparation and cleanup.
- `packages/backend/src/runtime/gitMergeExecutor.ts`: deterministic git merge completion and settled-run cleanup for merger success paths.
- `packages/backend/src/runtime/writeTrace.ts`: durable write-trace types.
- `packages/backend/src/runtime/writeTraceStore.ts`: Goal-scoped append-only `write-trace.jsonl` storage.
- `packages/backend/src/runtime/writeTraceRecorder.ts`: process-focused file-change snapshot recorder for compact durable traces.
- `packages/backend/src/agent/AgentRunner.ts`: event-streaming execution adapter contract and scripted `MockAgentRunner`.
- `packages/backend/src/agent/ProcessAgentRunner.ts`: process-backed runner that can execute in the repo root or a prepared worktree and stream runtime evidence.
- `packages/backend/src/agent/ConfiguredRoleProcessRunner.ts`: repo-local role adapter config, placeholder substitution, context bundle wiring, and typed outcome ingestion.
- `packages/backend/src/agent/vendorTransport.ts`: built-in Codex / Claude / OpenCode transport config parsing and command resolution.
- `packages/backend/src/agent/vendorTranscript.ts`: built-in vendor stream normalization into structured transcript events.
- `packages/backend/src/scheduler/reconcileOnce.ts`: deterministic one-step scheduler.
- `packages/backend/src/server.ts`: Bun API, SSE endpoint, and Bun-served UI shell.
- `packages/backend/src/index.ts`: public exports.

Current backend tests:

- `packages/backend/tests/validation.test.ts`
- `packages/backend/tests/boardStore.test.ts`
- `packages/backend/tests/decisionStore.test.ts`
- `packages/backend/tests/answerInterpretation.test.ts`
- `packages/backend/tests/attemptStore.test.ts`
- `packages/backend/tests/preferenceStore.test.ts`
- `packages/backend/tests/assistantThreadStore.test.ts`
- `packages/backend/tests/assistantRunStore.test.ts`
- `packages/backend/tests/runHistoryStore.test.ts`
- `packages/backend/tests/goalDocsStore.test.ts`
- `packages/backend/tests/planningRequestStore.test.ts`
- `packages/backend/tests/roleProcessContext.test.ts`
- `packages/backend/tests/agentRunner.test.ts`
- `packages/backend/tests/configuredRoleProcessRunner.test.ts`
- `packages/backend/tests/gitMergeExecutor.test.ts`
- `packages/backend/tests/processAgentRunner.test.ts`
- `packages/backend/tests/reconcileOnce.test.ts`
- `packages/backend/tests/server.test.ts`
- `packages/backend/tests/sampleGoals.test.ts`
- `packages/backend/tests/writeTraceStore.test.ts`
- `packages/backend/tests/worktreeManager.test.ts`

## Scheduler Rules

`reconcileOnce` performs at most one deterministic action per call.

Before dispatching work, it removes resolved task blockers:

```text
blockedBy.kind == task and referenced task status == done
```

Then it selects the first unblocked dispatchable task and applies:

```text
planning/planned       -> planner   -> success: in_review
planning/in_review     -> reviewer  -> success: merging, reject: planned
planning/merging       -> merger    -> success: done
engineering/planned    -> generator -> success: in_review
engineering/in_review  -> reviewer  -> success: merging, reject: planned
engineering/merging    -> merger    -> success: done, merge_conflict: planned until budget exhausted
```

During a runner call, the task is temporarily persisted as `in_progress`. After the runner returns, the scheduler persists the final status.

Failure attempt budgets are stored in `.hopi/runtime/attempts.json` with keys like:

```json
{
  "T-1:merge_conflict": 2
}
```

When a failure kind reaches the max attempt budget:

- `merge_conflict` writes `blockedBy: [{ kind: "merge_conflict", ref: artifactRef }]`.
- Other failure kinds write `blockedBy: [{ kind: "intervention", ref: "<taskRef>:<failureKind>" }]`.

System errors are not task failures. Adapter, route, schema, or storage errors should be reported as system errors and must not become task blockers.

Run history is stored in:

```text
.hopi/runtime/goals/<goalKey>/run-history.json
```

Model rules:

- a run starts when a task leaves `planned`
- a step records one `planner` / `generator` / `reviewer` / `merger` dispatch
- a run stays `active` through successful review/merge progression
- a run ends as `retryable`, `blocked`, `completed`, or `system_error`
- step messages are runtime overlay only; they do not mutate workflow truth
- step transcripts carry normalized vendor execution semantics for built-in transports
- step execution evidence may include worktree metadata and artifact references

Runtime adapter events currently supported:

- `message`
- `transcript`
- `worktree_prepared`
- `artifact`

Planner context bundles now also receive these durable inputs:

- `goal.md`
- `design.md`
- current `todo.yml` content
- `decisions.yml`
- `.hopi/preference.md`
- relevant write traces

Configured role adapters live at:

```text
.hopi/runtime/agent-adapters.json
```

Context bundles live at:

```text
.hopi/runtime/goals/<goalKey>/runs/<runId>/<stepId>/
```

Model rules:

- `context.md` carries task, Goal, and boundary context into role processes
- `prompt.md` is the transport-facing execution prompt built from the current context bundle
- `outcome.json` lets reviewer and merger return typed outcomes on exit `0`
- `goal.md` and `design.md` are bootstrapped if missing before configured role execution

Built-in vendor transports now supported in `.hopi/runtime/agent-adapters.json`:

- `process`
- `codex`
- `claude`
- `opencode`

`agent-adapters.json` may now also include a top-level `assistant` transport config alongside `roles`.

Model rules:

- built-in vendor transports keep `outcome.json` as the deterministic workflow contract
- Codex and Claude transports pass `prompt.md` through stdin
- OpenCode transports pass prompt content as the final non-interactive message argument
- built-in vendor stdout is normalized into compact transcript entries before it reaches run history
- raw `process` transports remain available for repo-local custom adapters

Merger success paths now have deterministic backend post-processing:

- engineering merger success performs a real git merge from the run branch into the root repo
- merge conflicts abort the root merge and flow through the existing retry/budget path
- settled success paths clean the run worktree and disposable branch
- planning merger success can complete without a run branch

Durable write traces are stored in:

```text
.hopi/docs/goals/<goalKey>/write-trace.jsonl
```

Model rules:

- entries are compact append-only JSON lines
- entries summarize changed repo-relative paths without file contents
- write traces do not alter scheduler decisions or workflow truth
- the current recorder is process-backed and works for both root and worktree execution

## API

Start the backend:

```sh
cd packages/backend
bun run start
```

Expected startup line:

```text
[API] Server listening on http://localhost:3000
```

Routes:

```text
GET  /api/preferences
POST /api/preferences
POST /api/preferences/record
POST /api/preferences/retire
GET  /api/goals/:goalKey/board
GET  /api/goals/:goalKey/docs
GET  /api/goals/:goalKey/planning-requests
POST /api/goals/:goalKey/planning-requests
GET  /api/goals/:goalKey/decisions
POST /api/goals/:goalKey/decisions
POST /api/goals/:goalKey/decisions/:decisionKey/resolve
GET  /api/goals/:goalKey/runs
GET  /api/goals/:goalKey/runs/:runId
GET  /api/goals/:goalKey/write-traces
GET  /api/goals/:goalKey/assistant/thread
GET  /api/goals/:goalKey/assistant/runs
GET  /api/goals/:goalKey/assistant/runs/:assistantRunId
GET  /api/goals/:goalKey/assistant/runs/:assistantRunId/bundle
POST /api/goals/:goalKey/assistant/messages
POST /api/goals/:goalKey/assistant/run
POST /api/goals/:goalKey/tasks
POST /api/goals/:goalKey/tasks/:taskRef/move
POST /api/goals/:goalKey/reconcile
GET  /api/events
GET  /
```

Default bootstrap note:

- `createServer()` now prefers `ConfiguredRoleProcessRunner` when `.hopi/runtime/agent-adapters.json` exists.
- If adapter config is absent, it still falls back to `MockAgentRunner`.

Create task request:

```json
{
  "ref": "T-1",
  "kind": "engineering",
  "title": "Implement atomic writes",
  "description": "Make writes safe.",
  "acceptanceCriteria": ["Concurrent writes are safe."],
  "blockedBy": []
}
```

Manual move request:

```json
{
  "status": "in_review",
  "reason": "manual transition"
}
```

## Frontend State

The active frontend is now served by the backend through a Bun HTML import at `/`.

Current UI capabilities:

- read-only board projection from `todo.yml`
- durable `goal.md` and `design.md` surfacing with `bootstrapped` versus `curated` status
- durable planning-request creation and surfacing linked to visible planning work
- durable workflow-graph surfacing with workflow-root shared context and child request detail
- decision-linked planning request surfacing with explicit `design.md` / `todo.yml` update targets
- deterministic planning follow-through coverage enforcement based on requested updates plus durable write traces
- automatic decision-to-planning enrichment for existing open planning requests on the same planning task
- run list for the current Goal
- step list for the selected run
- normalized transcript history for the selected step
- message history for the selected step
- structured step evidence for worktree path and artifact references when present
- selected-step durable write-trace rendering for run-scoped file-change evidence
- assistant prompt submission
- explicit one-step `Reconcile Once` control
- repo preference surfacing and editing
- direct decision topic creation and resolution
- decision topic surfacing
- assistant thread surfacing
- assistant run list, assistant run detail inspection, and exact bundle-file inspection for `context.md`, `prompt.md`, `outcome.json`, and `result.json`

Current non-UI Goal assistant substrate:

- durable Goal decisions in `decisions.yml`
- durable Goal planning requests in `planning-requests.yml`
- decision-linked planning request metadata for explicit `design.md` / `todo.yml` reshape intent
- shared decision-request flows that backfill planning request lineage and default requested updates when a planning task becomes visibly blocked by one decision
- engineering-linked decision resolution with explicit single or grouped planner follow-through on the shared planning-request path
- planning-linked decision resolution with explicit single or grouped follow-through that can reuse the current planning surface instead of creating a wrapper task
- standalone answered decision follow-through that can create visible planner work even before there is a blocker or reusable planning surface
- answer-first durable decision capture that lets assistant or API record one explicit answer, auto-create or reuse the durable decision topic, and route single or grouped planner follow-through through the same shared resolution helper
- higher-order answer follow-through that lets one durable decision answer fan out into multiple independent planner workflows without introducing another durable workflow store
- multi-decision answer capture that lets one user answer resolve several durable decision topics and attach one shared planner follow-through with combined decision lineage
- answer-backed planning requests that let assistant or API capture non-decision user answers directly on durable planning follow-through without inventing synthetic decision topics
- mixed answer follow-through that lets one durable decision-answer action also carry non-decision captured answers directly onto the same planner follow-through
- direct higher-order planning workflows that let assistant or API atomically open multiple independent durable planning workflows without routing through a decision-answer action first
- direct higher-order planning reuse that lets assistant or API expand one current planning surface into the first child of a richer workflow batch instead of spawning a wrapper task
- direct higher-order planning blocker propagation that keeps engineering blocked on every current sink when a reused planning blocker expands into a workflow batch
- direct higher-order planning extension that lets assistant or API add new child workflows onto one durable `workflowKey` and reconstruct the full current workflow state
- direct higher-order planning child reuse that lets assistant or API update one standalone child inside a durable direct workflow through stable `workflowTaskKey` instead of low-level request ids or title collisions
- direct higher-order planning child dependencies that let assistant or API wire one durable workflow child onto another child’s current sink through stable `blockedByWorkflowKeys`
- direct higher-order planning shared context that lets assistant or API carry one workflow-root set of shared `decisionRefs` and captured `answers` across every child in a durable direct workflow graph
- decision-backed workflow-graph follow-through that lets resolve_decision, record_answer, and record_answers reuse that same durable direct-workflow graph authority instead of looping through weaker answer-local multi-workflow logic
- decision-backed workflow shared-answer context that lets resolve_decision, record_answer, and record_answers carry one workflow-root set of shared non-decision captured answers across every child in an answer-driven workflow graph
- durable workflow-root shared-context persistence that lets both direct and answer-driven workflow graphs extend one `workflowKey` later without restating the same shared decision lineage or captured answers
- independent workflow-graph inspection that lets Bun API and UI read one current workflow graph by `workflowKey` with root shared context plus child request detail, instead of only exposing raw planning requests or earlier mutation results
- decision answer/resolve API surfacing that returns the full shared runtime result, including `blockerRemoved`, creation metadata, and generated workflow-graph keys, instead of trimming authority down to decision-only bodies
- assistant decision action-result surfacing that returns the same shared runtime follow-through structure, including generated workflow keys, instead of flattening decision follow-through into lossy summary arrays
- transcript tool-correlation evidence that persists stable tool invocation keys and stable tool target details, letting reviewer/merger context see real tool interactions instead of only flat transcript summaries
- durable structured repo preferences in `.hopi/preference.md`
- Goal-scoped assistant thread storage under `.hopi/runtime/**`
- deterministic Goal doc bootstrap plus status inspection for `goal.md` and `design.md`
- planner context wiring for Goal docs, decisions, planning requests, and preferences
- explicit Goal assistant execution with constrained durable actions, including grouped planning requests, `request_decision`, decision resolution with embedded planner follow-through, and durable preferences
- reviewer/merger context correlation across prior run history, artifact refs, transcript summaries, and write traces
- planning reviewer/merger follow-through policy grounded in planning requests and durable planning write traces
- scheduler hard guards that retry planning review/merge work when explicit requested updates still lack durable trace coverage
- grouped-planning blocker propagation that keeps engineering waiting on the current open grouped leaves instead of stale earlier grouped tasks

What is still missing:

- deeper answer interpretation when assistant should infer brand-new durable decision topics or planner-answer summaries directly from one less-structured reply without first relying on exact repeated durable question text, deterministic prompt-core reuse, explicit topic mentions inside each mapped block anchor paragraph, explicit topic mentions inside each mapped paragraph, explicit topic mentions inside each mapped sentence, explicit inline topic labels, line-based labeled sections, ordered reply structure, grounded excerpts, or per-topic mapping inside the action payload

`packages/frontend` remains only as an archived prototype reference and is no longer the product path.

## Recommended Next Work

Next high-leverage phase:

1. Continue deeper answer interpretation only if product needs assistant to infer brand-new durable decision topics or planner-answer summaries directly from one less-structured reply without first relying on exact repeated durable question text, deterministic prompt-core reuse, explicit topic mentions inside each mapped block anchor paragraph, explicit topic mentions inside each mapped paragraph, explicit topic mentions inside each mapped sentence, explicit inline topic labels, line-based labeled sections, ordered reply structure, grounded excerpts, or per-topic mapping in the action payload.

Keep this out of the next phase unless explicitly requested:

- A complex queue service.
- A database.
- Compatibility with deleted prototype schema fields.

## Handoff Checklist

Before handing off again:

- Run `bun run check` from the repo root.
- Confirm `git status --short` is clean or explain every remaining change.
- Update this document if the current state, commands, or next work changed.
- Commit documentation updates after verification.

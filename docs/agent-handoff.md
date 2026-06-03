# HOPI Agent Handoff

Status date: 2026-06-03

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
- Goal assistant inspection APIs and Bun UI surfacing are now implemented for assistant prompts, decision/thread viewing, assistant run summaries, and assistant run detail inspection, including surfaced resolved answer-interpretation formats on assistant action results.
- Exact assistant bundle inspection is now implemented on the Bun product path for `context.md`, `prompt.md`, `outcome.json`, and `result.json`.
- Repo preference editing is now implemented on the active Bun API/UI path, and assistant now supports structured `request_planning` and durable preference lifecycle actions.
- Assistant can now explicitly request decision topics, and the Bun product path now supports direct decision creation and resolution with visible blocker linking.
- Durable decision topics now also support optional exact `prompt` text, so assistant/API/UI can preserve the canonical user-facing question directly in `decisions.yml` instead of relying only on short summaries or thread history.
- Durable planning-request answers now also support optional exact `prompt` text, and shared answer interpretation now reuses those planner prompts as matching authority across question/topic reply surfaces when the shorter planner summary is not repeated verbatim.
- Answer-driven `question_blocks`, `question_clauses`, `question_spans`, `question_middle_spans`, `question_closing_spans`, `question_closing_blocks`, and `question_middle_blocks` now also match current durable decisions by exact stored `prompt` text when available, so question-based replies no longer need to repeat topic labels inside the question itself.
- Answer-driven `question_blocks`, `question_clauses`, `question_spans`, `question_middle_spans`, `question_closing_spans`, `question_closing_blocks`, and `question_middle_blocks` now also match current durable decisions by deterministic stored `prompt` core text, so question-based replies can restate the canonical durable question more tersely without falling back to fuzzy topic inference.
- Answer-driven `question_blocks`, `question_clauses`, `question_spans`, `question_middle_spans`, `question_closing_spans`, `question_closing_blocks`, and `question_middle_blocks` now also match current durable decisions by deterministic stored `prompt` keyword anchors, so question-based replies can reorder the canonical durable question’s meaningful words without requiring exact prompt-core containment or fuzzy NLP.
- Durable decisions and durable planner answers now also support explicit `matchHints`, so assistant/API can persist stable product-approved phrases as deterministic answer-interpretation authority when later replies should not depend on exact prompt reuse or ever-looser parser heuristics.
- Durable decisions and durable planner answers now also support explicit `summaryKey`, so assistant/API can persist one stable noun-phrase key as deterministic matching authority when later reusable answer sources should target a known consumer even if the visible summary or prompt wording drifts.
- Durable planner answers now also support explicit `answerKey`, so assistant/API can persist one stable row identity for the same captured planner-answer slot even when later writes change the answer text, and reusable `matching_answer_sources` can target that known planner answer without relying on summary wording or the previous answer payload.
- Brand-new durable decision topics and brand-new planner captured answers inferred from topic-shaped source responses now also get one synthesized canonical `prompt`, so later question-based replies can reuse durable question authority even when the original capture did not come from an explicit question surface.
- Durable decisions and durable planner answers created from stable summary-only payloads now also synthesize one canonical `prompt` automatically, and later explicit prompt input upgrades that synthesized default instead of getting stuck behind weaker summary-derived wording.
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
- Direct planning assistant and Bun API surfaces now also share the same interpreted planner-answer authority as decision follow-through, including `sourceResponse`, reusable `answerSources`, structured `sourceResponseFormat`, root `inferRemainingAnswers`, and workflow-root shared planner answers, so planner answers can materialize directly onto durable planning requests and workflow graphs without routing through a decision action first.
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
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "question_clauses"`, so one longer sentence with more than one self-contained natural question-and-answer clause can deterministically feed explicit decision answers, inferred current open decisions, planner follow-through answers, and remaining inferred decision topics without requiring sentence or paragraph boundaries between clauses.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "single_pending"`, so when current Goal state leaves exactly one unresolved decision answer slot or exactly one unresolved explicit planner-answer slot, one less-structured shared reply can materialize directly onto that one pending consumer without repeating question/topic anchors or ordered structure, and runtime deterministically rejects ambiguity if more than one pending consumer remains.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "pending_clauses"`, so one less-structured shared reply can deterministically feed more than one already-known pending decision or planner-answer consumer in current pending order without repeating question/topic anchors, labels, or ordered-list markers, as long as the reply naturally separates those answers into clause-level segments.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "pending_paragraphs"`, so one less-structured shared reply can deterministically feed more than one already-known pending decision or planner-answer consumer in current pending order without repeating question/topic anchors, labels, ordered-list markers, or clause splitting, as long as the reply naturally separates those answers into paragraph-level segments.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "pending_sentences"`, so one less-structured shared reply can deterministically feed more than one already-known pending decision or planner-answer consumer in current pending order without repeating question/topic anchors, labels, ordered-list markers, clause splitting, or paragraph splitting, as long as the reply naturally separates those answers into sentence-level segments.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "pending_conjunctions"`, so one less-structured shared reply can deterministically feed more than one already-known pending decision or planner-answer consumer in current pending order without repeating question/topic anchors, labels, ordered-list markers, sentence splitting, clause splitting, or paragraph splitting, as long as the reply naturally separates those answers with explicit conjunction connectors inside one sentence.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "pending_answer_sources"`, so one less-structured reply can first be lifted into an ordered reusable `answerSources` bundle and then deterministically feed more than one already-known pending decision or planner-answer consumer in current pending order without repeating question/topic anchors or mapping each snippet to a specific topic.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "matching_answer_sources"`, so one explicit reusable `answerSources` bundle can deterministically match more than one already-known pending decision or planner-answer consumer by source labels and hints instead of current pending order, without repeating question/topic anchors or writing per-topic `answerSourceKey` mappings on each consumer.
- Answer-driven assistant and Bun API actions now also support inferring remaining brand-new decision topics and remaining planner-answer summaries from leftover `pending_answer_sources` or `matching_answer_sources` entries, as long as those remaining reusable sources already carry explicit `summary` authority, explicit `summaryKey` authority, one stable `prompt` authority, exactly one stable `matchHint` authority, or one stable suffixed `answerSourceKey` authority like `launch-shape-answer`. Canonical noun-phrase prompts like `What should the pilot scope be?`, explicit question-shaped prompts like `How should rollout happen?`, explicit keys like `summaryKey: "launch-shape"`, one stable phrase hint like `launch shape`, and one noun-phrase key with an explicit `-answer` / `-source` suffix now all work. Multiple hints still fail closed, and generic unsuffixed `answerSourceKey` values still fail closed, so runtime does not have to guess.
- Leftover `pending_answer_sources` entries now also merge adjacent reusable source entries into one brand-new durable decision topic or one inferred planner-answer row when those leftovers already share explicit key-based authority like `decisionKey`, `answerKey`, or `summaryKey`, while still failing closed on non-contiguous repeats instead of silently splitting one durable topic or row across multiple outputs.
- Answer-driven assistant and Bun API actions can now also combine `inferDecisionTopics` with `followThrough.inferRemainingAnswers`, but only on `pending_answer_sources` or `matching_answer_sources` when every leftover reusable source entry is explicitly routed by durable `decisionKey` or durable `answerKey`. In that mixed route mode, runtime first consumes known decisions and explicit planner-answer slots, then grows brand-new decision topics from the decision-routed leftovers and inferred planner-answer rows from the planner-routed leftovers, while still failing closed on non-contiguous repeats or weaker leftover authorities like bare `summary`, `summaryKey`, `prompt`, `matchHints`, or suffix-only `answerSourceKey`.
- Explicit reusable `answerSources[*].route` is now also a hard family boundary for known consumer matching: `matching_answer_sources` only lets decision consumers see `route: "decision"` or unscoped entries and only lets planner consumers see `route: "planning"` or unscoped entries, while `pending_answer_sources` now fails closed when the next ordered entry is explicitly routed to the wrong family instead of silently consuming it onto the current decision/planner slot.
- Explicit reusable `answerSources[*].route` now also fails closed when a decision-only or planning-only mutation leaves a routed reusable source entry unreachable after materialization, so route-scoped answer sources cannot be silently ignored when the current surface has no valid consumer on that family.
- Repeated exact `sourceExcerpt` grounding now also requires explicit `sourceOccurrence` authority when the same excerpt text appears more than once inside one shared `sourceResponse`, so direct item excerpts and reusable answer-source excerpts no longer silently default to the first repeated match.
- Explicit decision-answer and planner-answer items can now also consume one already-merged reusable answer-source group through `answerSourceGroupKey`, so grouped reusable `answerSources` no longer have to be remapped back through a single-fragment `answerSourceKey` or repeated inline text when one consumer should reuse the full grouped materialization directly.
- Answer-driven and direct planning assistant/API surfaces now also support `sourceResponseFormat: "auto"`, so callers can let shared runtime deterministically choose the strongest successful existing interpretation surface by fixed authority priority instead of hard-coding `question_spans`, `topic_paragraphs`, `matching_answer_sources`, or one weaker pending-order fallback up front; `auto` now also rejects partially successful unit-based candidates that leave their own ordered/question/topic/pending/matching-run units unconsumed, explicit multi-label `labeled_sections` / `inline_topics` authority now fails closed instead of falling through to weaker later reinterpretation surfaces once those labels have been established but left incomplete, explicit reusable `answerSources` authority now also fails closed before weaker raw-reply surfaces can take over once the answer-source family has already been tried and still remains incomplete, and explicit `question_*` / `topic_*` anchor surfaces now fail closed only after they have already matched at least one consumer-specific unit and still remain incomplete, so generic paragraphs or sentences can still fall through to ordered or pending surfaces when no real anchor authority was ever established. Decision/direct-planning API responses and assistant action results now also surface `resolvedSourceResponseFormat`, and the same concrete deterministic provenance now also persists durably as `captureFormat` on resolved decisions plus materialized planner-answer rows, so later inspection of `decisions.yml` and `planning-requests.yml` can still see which deterministic surface produced the current answer after the immediate mutation response is gone.
- Assistant run detail inspection in the Bun UI now also surfaces `resolvedSourceResponseFormat` directly on each interpreted assistant action result, so the durable assistant-run inspection path can show which deterministic interpretation surface materialized a captured answer without requiring users to open raw `result.json`.
- Assistant run detail inspection in the Bun UI now also surfaces structured assistant `action` authority alongside `action_result`, so run readers can inspect the requested mutation shape itself, including reusable-source counts, inferred-answer flags, workflow reuse metadata, and linked durable decision/planning context without opening raw bundle files.
- Assistant thread inspection, bundled assistant context, and Bun assistant-run detail inspection now also surface richer structured `action_result` authority like durable request/task ids, workflow/group ids, preference ids, and grouped result metadata instead of leaving those ids trapped inside raw structured result payloads.
- Bun assistant-run detail inspection now also surfaces richer structured runtime-event authority like transcript tool names/keys/vendor event types, worktree branch/base metadata, artifact refs, and message levels instead of flattening runtime events down to one summary line.
- Assistant-thread history now also persists structured `action` and `action_result` authority instead of only lossy `actionType + summary`, and both Bun thread inspection plus bundled assistant context now reuse that same structured payload to surface requested mutation details, resolved interpretation formats, follow-through metadata, reusable-answer-source counts, inferred-answer flags, workflow reuse keys, linked decision refs, and other durable mutation authority without opening raw run records.
- Planner role context, Bun planning workflow inspection, Bun planning request inspection, and Bun decision inspection now also surface that durable interpreted-answer provenance instead of treating captured answers as summary-plus-text only: parsed planner context now shows decision `captureFormat` plus planner-answer `captureFormat`, Bun decision cards show resolved answer capture format, and Bun planning request / workflow summaries now keep the same exact `captureFormat` evidence visible on captured and workflow-shared answers.
- Planner role context, Bun decision inspection, Bun planning request inspection, and Bun workflow inspection now also surface the rest of the durable answer-matching authority alongside `captureFormat`: decisions show `summaryKey` and `matchHints`, while captured planner answers and workflow-shared answers now keep `summaryKey`, `answerKey`, `matchHints`, and `captureFormat` visible instead of flattening everything to prompt-plus-text.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "matching_runs"`, so one shared reply that repeatedly revisits the same already-known decision or explicit planner-answer consumer across contiguous paragraphs, sentences, clauses, or one whole reply can deterministically merge those repeated mentions into one answer run instead of over-splitting them into duplicate narrower items. That surface now also fails closed on orphan prose before the first matched run, between different matched consumers, or after the last matched run, while still allowing continuation prose to stay attached when the next matched unit belongs to the same consumer. This surface currently stays narrow on purpose: explicit answer consumers plus `inferOpenDecisions` only, and `auto` may use it as a later generic fallback when stronger existing surfaces fail, but it does not broaden `inferDecisionTopics` or `followThrough.inferRemainingAnswers`.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "question_spans"`, so one inline question-and-answer style shared reply can deterministically feed explicit decision answers, inferred current open decisions, planner follow-through answers, and remaining inferred decision topics even when the answer sentences themselves no longer repeat the topic name or sit in separate question paragraphs.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "question_middle_spans"` and `sourceResponseFormat: "question_middle_blocks"`, so one question-driven reply can deterministically feed explicit decision answers, inferred current open decisions, planner follow-through answers, and remaining inferred decision topics even when each answer keeps the question sentence or paragraph in the middle, with at least one leading and trailing answer unit around it, and adjacent spans or blocks are split by letting the unit immediately before the next question anchor become the leading unit of the next answer.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "question_closing_spans"`, so one inline answer-first shared reply can deterministically feed explicit decision answers, inferred current open decisions, planner follow-through answers, and remaining inferred decision topics even when the question sentence appears after the answer sentences that it closes.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "question_closing_blocks"`, so one answer-first multi-paragraph shared reply can deterministically feed explicit decision answers, inferred current open decisions, planner follow-through answers, and remaining inferred decision topics even when the question paragraph appears after the answer paragraphs that it closes.
- Answer-driven `record_answers` assistant and Bun API surfaces now also support `inferDecisionTopics` on top of labeled shared replies, so remaining labeled sections can become new durable decision topics even when there is no preexisting open decision surface or explicit `answers[]` mapping.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "inline_topics"`, so one less-structured natural-language reply with inline topic clauses can deterministically feed explicit decision answers, inferred current open decisions, planner follow-through answers, and remaining inferred decision topics without line-based labeled sections or ordered-list structure.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_clauses"`, so one less-structured natural-language reply with more than one self-contained natural topic clause inside one longer sentence can deterministically feed explicit decision answers, inferred current open decisions, planner follow-through answers, and remaining inferred decision topics without requiring sentence or paragraph boundaries.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_sentences"`, so one less-structured natural-language reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers when each sentence still mentions the relevant known topic somewhere inside it, without forcing inline labels at the front of the clause or ordered-list structure.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_spans"`, so one less-structured natural-language reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers when one anchor sentence names the topic and the following sentences stay on that same topic until the next anchor sentence appears, without requiring blank-line paragraph or block boundaries.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_closing_spans"`, so one less-structured natural-language reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers when one later closing sentence names the topic and the earlier sentences in that same stretch stay on that topic, without requiring the topic-bearing sentence to appear first or forcing blank-line paragraph or block boundaries.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_closing_blocks"`, so one less-structured natural-language reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers when one later closing paragraph names the topic and the earlier paragraphs in that same block stay on that topic, without requiring the topic-bearing paragraph to appear first.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_paragraphs"`, so one less-structured natural-language reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers when each answer already lives in its own multi-sentence paragraph and that paragraph mentions the relevant known topic at least once, without requiring the topic name in every sentence.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_middle_spans"` and `sourceResponseFormat: "topic_middle_blocks"`, so one less-structured natural-language reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers when each answer keeps one explicit topic-bearing sentence or paragraph in the middle, with at least one leading and trailing continuation unit around it, and adjacent spans or blocks are split by letting the unit immediately before the next anchor become the leading unit of the next answer.
- Answer-driven `topic_sentences` and `topic_paragraphs` now also match current durable decisions by deterministic stored `prompt` keyword anchors, so known decision answers no longer need to repeat the explicit topic label inside each mapped sentence or paragraph when the durable question wording already supplies enough authority.
- Answer-driven `inferDecisionTopics` now also supports `topic_clauses`, `topic_sentences`, `topic_spans`, `topic_middle_spans`, `topic_closing_spans`, `topic_closing_blocks`, `topic_paragraphs`, and `topic_middle_blocks`, so remaining topic-bearing clause, sentence, and block surfaces can become new durable decision topics without relying on inline labels, labeled sections, ordered structures, or explicit `answers[]` topic mapping.
- Answer-driven assistant and Bun API actions now also support `sourceResponseFormat: "topic_blocks"`, so one less-structured natural-language reply can deterministically feed explicit decision answers, inferred current open decisions, and planner follow-through answers when each answer starts with one anchor paragraph that names the topic and then continues through later unlabeled paragraphs until the next anchor paragraph appears.
- Answer-driven `topic_blocks` now also match current durable decisions by deterministic stored `prompt` keyword anchors, so known decision blocks no longer need their anchor paragraph to repeat the explicit topic label when the durable question wording already supplies enough authority.
- Answer-driven `inferDecisionTopics` now also supports `topic_blocks`, so remaining anchored multi-paragraph topic blocks can become new durable decision topics without requiring every paragraph to restate the topic or falling back to line-based labels, ordered structures, or explicit `answers[]` topic mapping.
- Topic-surface summary inference now also supports deterministic `as <topic>` phrases like `Use Bun-native auth as the auth strategy.` or `Start with five enterprise customers before broader launch as the pilot scope.`, so `topic_sentences`, `topic_paragraphs`, and `topic_blocks` no longer depend only on leading, prefixed, or trailing topic phrases when inferring new decision topics or remaining planner answers.
- Topic-surface summary inference now also supports deterministic copular topic phrases like `Bun-native auth should be the auth strategy.` or `Five enterprise customers should be the pilot scope.`, so `topic_sentences`, `topic_paragraphs`, and `topic_blocks` no longer misread those answer-first predicate forms as the durable topic summary itself when inferring new decision topics or remaining planner answers.
- Answer-driven `planning` and `planning_batch` follow-through now also support root `inferRemainingAnswers`, so the remaining unclaimed question/topic reply items can become shared planner captured answers without repeating non-decision summaries manually; this currently applies to `question_blocks`, `question_clauses`, `question_spans`, `question_middle_spans`, `question_closing_spans`, `question_closing_blocks`, `question_middle_blocks`, `topic_clauses`, `topic_sentences`, `topic_spans`, `topic_middle_spans`, `topic_closing_spans`, `topic_closing_blocks`, `topic_paragraphs`, `topic_middle_blocks`, and `topic_blocks`, and is intentionally kept disjoint from `inferDecisionTopics`.
- Decision-backed and answer-backed `workflow_batch` follow-through now also supports root `inferRemainingAnswers`, so remaining unclaimed question/topic reply items can become workflow-root shared planner captured answers after child explicit planner answers consume their own items, while still staying disjoint from `inferDecisionTopics`.
- Question-derived `inferDecisionTopics` and `inferRemainingAnswers` now also preserve the original question text as durable `prompt` authority on newly inferred decision topics and planner captured answers, so `question_blocks` / `question_clauses` / `question_spans` / `question_middle_spans` / `question_closing_spans` / `question_closing_blocks` / `question_middle_blocks` no longer lose the canonical user-facing question when runtime materializes those items automatically.
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
- `docs/superpowers/specs/2026-06-02-planner-answer-prompt-design.md`: current authority note for preserving exact user-facing planner-answer questions directly on durable planning requests and reusing those prompts as matching authority during answer interpretation.
- `docs/superpowers/specs/2026-06-02-prompt-grounded-question-interpretation-design.md`: current authority note for reusing exact durable decision prompts as the matching authority for question-block and question-span answer interpretation.
- `docs/superpowers/specs/2026-06-02-prompt-core-question-interpretation-design.md`: current authority note for deterministic prompt-core reuse on question-block and question-span answer interpretation when the shared reply question is shorter than the stored durable prompt.
- `docs/superpowers/specs/2026-06-02-prompt-keyword-question-interpretation-design.md`: current authority note for deterministic prompt-keyword anchor reuse on question-block and question-span answer interpretation when the shared reply question keeps the same meaningful prompt words but changes their order.
- `docs/superpowers/specs/2026-06-02-prompt-keyword-topic-interpretation-design.md`: current authority note for deterministic prompt-keyword anchor reuse on `topic_sentences` and `topic_paragraphs` when the answer prose keeps the durable prompt’s meaningful words but omits the explicit topic label.
- `docs/superpowers/specs/2026-06-02-durable-match-hint-design.md`: current authority note for persisting explicit durable `matchHints` on decisions and planner answers, so later answer interpretation can reuse stable product-approved phrases without adding a second alias store or broader parser heuristics.
- `docs/superpowers/specs/2026-06-03-durable-summary-key-design.md`: current authority note for persisting explicit durable `summaryKey` values on decisions and planner answers, so later reusable answer sources can deterministically match known consumers even when visible summaries or prompts are not the stable authority.
- `docs/superpowers/specs/2026-06-03-durable-planner-answer-key-design.md`: current authority note for persisting explicit durable `answerKey` values on planner answers, so later writes can update the same captured planner-answer row by stable identity and reusable answer sources can target that known planner answer without relying on summary wording or old answer text.
- `docs/superpowers/specs/2026-06-03-contiguous-matching-answer-source-merge-design.md`: current authority note for letting `matching_answer_sources` merge adjacent reusable source entries for one already-known decision or planner-answer consumer while still rejecting non-contiguous repeats.
- `docs/superpowers/specs/2026-06-03-contiguous-remaining-matching-answer-source-merge-design.md`: current authority note for letting leftover `matching_answer_sources` entries merge adjacent reusable source entries into one new decision topic or one inferred planner-answer row when they already share explicit key-based authority, while still rejecting non-contiguous repeats.
- `docs/superpowers/specs/2026-06-03-pending-answer-source-key-authority-design.md`: current authority note for letting `pending_answer_sources` honor explicit durable keys on ordered reusable source entries, so adjacent entries can merge into one known consumer and wrong-key or non-contiguous repeats fail closed instead of being silently consumed by order.
- `docs/superpowers/specs/2026-06-03-contiguous-remaining-pending-answer-source-merge-design.md`: current authority note for letting leftover `pending_answer_sources` entries merge adjacent reusable source entries into one new decision topic or one inferred planner-answer row when they already share explicit key-based authority, while still rejecting non-contiguous repeats.
- `docs/superpowers/specs/2026-06-03-mixed-answer-source-route-inference-design.md`: current authority note for allowing one reusable `answerSources` bundle to create both brand-new durable decision topics and brand-new inferred planner-answer rows in the same mutation, but only when the leftover sources are explicitly routed by durable `decisionKey` or durable `answerKey`.
- `docs/superpowers/specs/2026-06-03-answer-source-route-metadata-design.md`: current authority note for lifting mixed answer-source routing onto explicit per-source `route` metadata, so leftovers can choose the decision side or planner side without pre-inventing durable row keys while still failing closed on route/key conflicts or ambiguous grouping.
- `docs/superpowers/specs/2026-06-03-answer-source-route-family-boundary-design.md`: current authority note for making explicit per-source `route` metadata a hard decision/planning family boundary during known consumer matching, so route-scoped reusable sources cannot be silently consumed by the wrong family before leftover inference runs.
- `docs/superpowers/specs/2026-06-03-unreachable-answer-source-route-fail-closed-design.md`: current authority note for failing closed when a decision-only or planning-only mutation leaves an explicitly routed reusable source entry unreachable after materialization, so route-scoped answer sources cannot be silently ignored when the current surface has no valid consumer on that family.
- `docs/superpowers/specs/2026-06-03-repeated-source-excerpt-occurrence-design.md`: current authority note for requiring explicit `sourceOccurrence` when one exact excerpt appears more than once inside one shared `sourceResponse`, so excerpt grounding stays deterministic instead of silently defaulting to the first repeated match.
- `docs/superpowers/specs/2026-06-03-answer-source-group-key-design.md`: current authority note for letting reusable `answerSources` entries carry one explicit `sourceGroupKey`, so one materialized answer can span non-contiguous source fragments without relaxing consumer-selection authority or falling back to weaker parser regrouping.
- `docs/superpowers/specs/2026-06-03-grouped-answer-source-reference-design.md`: current authority note for letting explicit decision/planner answer items consume one already-merged reusable answer-source group through `answerSourceGroupKey`, so grouped reusable sources can be reused directly without overloading single-fragment `answerSourceKey`.
- `docs/superpowers/specs/2026-06-03-auto-source-response-format-design.md`: current authority note for `sourceResponseFormat: "auto"` as a deterministic meta-surface that chooses the strongest successful existing interpretation surface by fixed priority instead of introducing another fuzzy parser family.
- `docs/superpowers/specs/2026-06-03-resolved-source-response-format-surfacing-design.md`: current authority note for surfacing the concrete deterministic interpretation format that runtime actually used through Bun API mutation responses and assistant action results, so `sourceResponseFormat: "auto"` no longer remains opaque after a successful mutation.
- `docs/superpowers/specs/2026-06-03-assistant-run-resolved-format-inspection-design.md`: current authority note for surfacing `resolvedSourceResponseFormat` through assistant-run detail inspection in the Bun UI instead of leaving answer-interpretation provenance visible only in immediate mutation responses or raw bundle files.
- `docs/superpowers/specs/2026-06-03-assistant-run-action-authority-inspection-design.md`: current authority note for surfacing structured assistant `action` authority through Bun assistant-run detail inspection instead of leaving requested mutation shape visible only in raw run JSON.
- `docs/superpowers/specs/2026-06-03-assistant-action-result-authority-metadata-inspection-design.md`: current authority note for surfacing the richer durable metadata already present on structured assistant `action_result` payloads, so thread/context/run inspection no longer collapse those results down to summary plus one narrow provenance field.
- `docs/superpowers/specs/2026-06-03-assistant-runtime-event-authority-inspection-design.md`: current authority note for surfacing richer structured assistant runtime-event metadata through Bun assistant-run detail inspection instead of flattening transcript/worktree/artifact events down to one summary line.
- `docs/superpowers/specs/2026-06-03-assistant-thread-action-result-authority-design.md`: current authority note for persisting full structured assistant `action_result` data on assistant-thread history and reusing it across Bun thread inspection plus bundled assistant context instead of flattening that history down to summary-only text.
- `docs/superpowers/specs/2026-06-03-assistant-thread-action-authority-design.md`: current authority note for persisting full structured assistant `action` payloads on assistant-thread history and reusing them across Bun thread inspection plus bundled assistant context instead of flattening intent down to summary-only text.
- `docs/superpowers/specs/2026-06-03-assistant-action-authority-metadata-inspection-design.md`: current authority note for surfacing the richer durable metadata already present on structured assistant actions, so thread inspection and bundled assistant context no longer collapse that structured mutation authority down to just titles plus one or two generic fields.
- `docs/superpowers/specs/2026-06-03-durable-interpreted-answer-provenance-design.md`: current authority note for persisting that same concrete deterministic interpretation provenance as durable `captureFormat` metadata on resolved decision rows and materialized planner-answer rows instead of keeping it only in immediate mutation responses.
- `docs/superpowers/specs/2026-06-03-durable-answer-provenance-inspection-design.md`: current authority note for surfacing persisted `captureFormat` provenance through planner context, Bun decision inspection, Bun planning-request inspection, and Bun workflow inspection instead of leaving it trapped in raw durable state only.
- `docs/superpowers/specs/2026-06-03-durable-answer-authority-metadata-inspection-design.md`: current authority note for surfacing the rest of the persisted answer-matching authority (`summaryKey`, `answerKey`, and `matchHints`) through planner context, Bun decision inspection, Bun planning-request inspection, and Bun workflow inspection instead of flattening durable answers to prompt-plus-text.
- `docs/superpowers/specs/2026-06-03-auto-source-response-completeness-design.md`: current authority note for rejecting partially successful unit-based `auto` candidates that leave ordered/question/topic/pending/matching-run units unconsumed, so `auto` can continue searching for a later existing surface that fully captures the reply.
- `docs/superpowers/specs/2026-06-03-auto-label-surface-fail-closed-design.md`: current authority note for failing closed when explicit label authority has already been established by `labeled_sections` or multi-label `inline_topics`, instead of dropping to weaker later reinterpretation surfaces.
- `docs/superpowers/specs/2026-06-03-auto-answer-source-fail-closed-design.md`: current authority note for failing closed when explicit reusable `answerSources` authority remains incomplete after the answer-source family has already been tried, instead of dropping to weaker raw-reply reinterpretation surfaces.
- `docs/superpowers/specs/2026-06-03-auto-anchor-surface-fail-closed-design.md`: current authority note for failing closed when explicit `question_*` or `topic_*` anchor surfaces have already parsed anchored units but still remain incomplete, instead of dropping to weaker generic reinterpretation surfaces like `matching_runs`.
- `docs/superpowers/specs/2026-06-03-auto-anchor-authority-precision-design.md`: current authority note for refining that anchor fail-closed rule so `auto` only stops after `question_*` or `topic_*` surfaces have actually matched at least one consumer-specific unit, while purely generic paragraphs or sentences can still fall through to weaker ordered or pending surfaces.
- `docs/superpowers/specs/2026-06-02-inferred-topic-prompt-synthesis-design.md`: current authority note for synthesizing and persisting canonical prompts on brand-new inferred decision topics and planner answers that came from topic-shaped source responses without explicit question text.
- `docs/superpowers/specs/2026-06-02-summary-prompt-synthesis-design.md`: current authority note for synthesizing canonical prompts on summary-only durable decisions and planner answers, while still letting later explicit prompt text upgrade those synthesized defaults.
- `docs/superpowers/specs/2026-06-02-leading-topic-summary-interpretation-design.md`: current authority note for deterministic topic-summary inference from leading topic phrases like `Pilot scope should ...`.
- `docs/superpowers/specs/2026-06-02-prefixed-topic-summary-interpretation-design.md`: current authority note for deterministic topic-summary inference from prefixed topic phrases like `For auth strategy, ...`.
- `docs/superpowers/specs/2026-06-02-as-topic-summary-interpretation-design.md`: current authority note for deterministic topic-summary inference from `... as the auth strategy` style phrases across topic surfaces.
- `docs/superpowers/specs/2026-06-02-copular-topic-summary-interpretation-design.md`: current authority note for deterministic topic-summary inference from answer-first copular phrases like `Bun-native auth should be the auth strategy.` across topic surfaces.
- `docs/superpowers/specs/2026-06-02-topic-surface-decision-inference-design.md`: current authority note for deterministic brand-new decision-topic inference from remaining `topic_sentences` and `topic_paragraphs` without inline labels, labeled sections, or ordered reply structure.
- `docs/superpowers/specs/2026-06-02-prompt-keyword-topic-block-interpretation-design.md`: current authority note for deterministic prompt-keyword anchor reuse on `topic_blocks` when the block anchor paragraph keeps the durable prompt’s meaningful words but omits the explicit topic label.
- `docs/superpowers/specs/2026-06-02-shared-answer-source-design.md`: current authority note for reusing one less-structured raw user reply across multiple durable decision topics and non-decision follow-through answers.
- `docs/superpowers/specs/2026-06-02-named-answer-source-interpretation-design.md`: current authority note for reusing explicitly extracted topic-specific answer snippets across durable decision topics and non-decision follow-through answers without introducing a second durable store.
- `docs/superpowers/specs/2026-06-02-answer-source-excerpt-grounding-design.md`: current authority note for grounding reusable named answer sources directly in one shared raw reply through exact source excerpts.
- `docs/superpowers/specs/2026-06-02-direct-item-source-excerpt-design.md`: current authority note for grounding one decision answer or planner answer directly in a shared raw reply without first defining a named answer source.
- `docs/superpowers/specs/2026-06-02-labeled-source-response-interpretation-design.md`: current authority note for automatically materializing durable answers from one labeled shared raw reply without per-topic excerpt or mapping fields.
- `docs/superpowers/specs/2026-06-02-open-decision-labeled-answer-inference-design.md`: current authority note for resolving matching current open durable decisions directly from one labeled shared raw reply without repeating those decision topics inside `record_answers`.
- `docs/superpowers/specs/2026-06-02-ordered-source-response-interpretation-design.md`: current authority note for deterministically materializing durable answers from one ordered shared raw reply without labels, excerpts, or per-topic mapping.
- `docs/superpowers/specs/2026-06-02-ordered-block-source-response-design.md`: current authority note for deterministically materializing multi-paragraph durable answers from one ordered shared raw reply without labels or per-topic mapping.
- `docs/superpowers/specs/2026-06-02-single-pending-source-response-design.md`: current authority note for deterministically materializing one less-structured shared reply onto exactly one unresolved pending answer consumer without requiring question/topic anchors or ordered reply structure.
- `docs/superpowers/specs/2026-06-02-pending-clause-source-response-design.md`: current authority note for deterministically materializing more than one already-known pending answer consumer from one less-structured shared clause reply without repeated anchors or ordered-list markers.
- `docs/superpowers/specs/2026-06-02-pending-paragraph-source-response-design.md`: current authority note for deterministically materializing more than one already-known pending answer consumer from one less-structured shared paragraph reply without repeated anchors, ordered-list markers, or clause splitting.
- `docs/superpowers/specs/2026-06-02-pending-sentence-source-response-design.md`: current authority note for deterministically materializing more than one already-known pending answer consumer from one less-structured shared sentence reply without repeated anchors, ordered-list markers, clause splitting, or paragraph splitting.
- `docs/superpowers/specs/2026-06-02-pending-conjunction-source-response-design.md`: current authority note for deterministically materializing more than one already-known pending answer consumer from one less-structured shared conjunction-linked reply without repeated anchors, ordered-list markers, sentence splitting, clause splitting, or paragraph splitting.
- `docs/superpowers/specs/2026-06-02-pending-answer-source-order-design.md`: current authority note for deterministically materializing more than one already-known pending answer consumer from ordered reusable `answerSources` without per-topic mapping.
- `docs/superpowers/specs/2026-06-02-matching-answer-source-design.md`: current authority note for deterministically materializing more than one already-known pending answer consumer from reusable `answerSources` matched by source labels and hints instead of current pending order or per-topic mapping.
- `docs/superpowers/specs/2026-06-03-matching-run-source-response-design.md`: current authority note for deterministically materializing repeated stretches for already-known decision or planner-answer consumers into one merged answer run without widening into brand-new topic or remaining-planner inference.
- `docs/superpowers/specs/2026-06-03-matching-run-orphan-prose-design.md`: current authority note for keeping `matching_runs` narrow by failing closed on unmatched prose before the first run, between different consumers, or after the last run instead of silently absorbing orphan prose into the nearest known consumer.
- `docs/superpowers/specs/2026-06-03-matching-opening-run-source-response-design.md`: current authority note for deterministically materializing less-structured answer stretches whose already-known consumer anchor sits at the start, with later continuation prose attached to that same consumer.
- `docs/superpowers/specs/2026-06-03-matching-closing-run-source-response-design.md`: current authority note for deterministically materializing less-structured answer stretches whose already-known consumer anchor sits at the end, with earlier continuation prose attached to that same consumer.
- `docs/superpowers/specs/2026-06-03-auto-generic-run-fallback-design.md`: current authority note for letting `sourceResponseFormat: "auto"` keep probing deterministic generic run surfaces when earlier topic-family probes only matched by durable consumer keywords and never established explicit topic authority.
- `docs/superpowers/specs/2026-06-03-matching-middle-run-source-response-design.md`: current authority note for deterministically materializing less-structured answer stretches whose already-known consumer anchor sits in the middle, with leading and trailing continuation prose attached to that same consumer.
- `docs/superpowers/specs/2026-06-02-answer-source-remaining-inference-design.md`: current authority note for letting leftover ordered or matching reusable `answerSources` entries directly materialize brand-new decision topics or planner answers when those sources already carry explicit `summary` authority.
- `docs/superpowers/specs/2026-06-02-question-block-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from question-and-answer style shared replies whose answer blocks no longer repeat the topic name.
- `docs/superpowers/specs/2026-06-02-question-clause-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from more than one self-contained natural question-and-answer clause inside one longer sentence without requiring sentence or paragraph boundaries.
- `docs/superpowers/specs/2026-06-02-question-closing-block-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from answer-first question blocks whose final paragraph is the question, without requiring the question paragraph to appear first.
- `docs/superpowers/specs/2026-06-02-question-closing-span-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from answer-first question spans whose final sentence is the question, without requiring the question sentence to appear first.
- `docs/superpowers/specs/2026-06-02-question-span-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from inline question-and-answer shared replies without requiring separate question paragraphs.
- `docs/superpowers/specs/2026-06-02-labeled-decision-topic-inference-design.md`: current authority note for turning remaining labeled shared-reply sections into new durable decision topics without existing open decisions or explicit `answers[]` mapping.
- `docs/superpowers/specs/2026-06-02-inline-topic-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from natural-language inline topic clauses without line-based labeled sections or ordered-list structure.
- `docs/superpowers/specs/2026-06-02-topic-clause-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from more than one self-contained natural topic clause inside one longer sentence without requiring sentence or paragraph boundaries.
- `docs/superpowers/specs/2026-06-02-topic-sentence-source-response-design.md`: current authority note for deterministically materializing durable answers from less-structured topic-mentioned sentences without front-loaded inline labels or ordered-list structure.
- `docs/superpowers/specs/2026-06-02-topic-span-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from anchored multi-sentence topic spans without requiring blank-line paragraph or block boundaries.
- `docs/superpowers/specs/2026-06-02-topic-middle-anchor-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics when a topic-bearing sentence or paragraph sits in the middle of each answer stretch, with leading and trailing continuation units on both sides.
- `docs/superpowers/specs/2026-06-02-question-middle-anchor-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics when a question sentence or paragraph sits in the middle of each answer stretch, with leading and trailing answer units on both sides.
- `docs/superpowers/specs/2026-06-02-topic-closing-block-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from multi-paragraph topic blocks whose final paragraph names the topic, without requiring the topic-bearing paragraph to appear first.
- `docs/superpowers/specs/2026-06-02-topic-closing-span-source-response-design.md`: current authority note for deterministically materializing durable answers and inferred decision topics from multi-sentence topic spans whose final sentence names the topic, without requiring the topic-bearing sentence to appear first.
- `docs/superpowers/specs/2026-06-02-topic-paragraph-source-response-design.md`: current authority note for deterministically materializing durable answers from multi-sentence topic paragraphs without requiring topic mentions in every sentence.
- `docs/superpowers/specs/2026-06-02-topic-block-source-response-design.md`: current authority note for deterministically materializing durable answers from anchored multi-paragraph topic blocks without requiring topic mentions in every continuation paragraph.
- `docs/superpowers/specs/2026-06-02-topic-block-decision-inference-design.md`: current authority note for deterministic brand-new decision-topic inference from remaining anchored `topic_blocks` without requiring every paragraph to restate the topic.
- `docs/superpowers/specs/2026-06-02-follow-through-inferred-planner-answer-design.md`: current authority note for turning the remaining unclaimed question/topic reply items into shared planner captured answers through root `followThrough.inferRemainingAnswers`.
- `docs/superpowers/specs/2026-06-02-workflow-follow-through-inferred-planner-answer-design.md`: current authority note for extending root `followThrough.inferRemainingAnswers` onto decision-backed and answer-backed `workflow_batch`, so remaining unclaimed structured reply items can become workflow-root shared planner answers after child explicit answers consume their own items.
- `docs/superpowers/specs/2026-06-02-inferred-question-prompt-persistence-design.md`: current authority note for preserving original question text as durable `prompt` authority when `question_blocks` / `question_spans` automatically materialize planner answers or brand-new decision topics.
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
- `docs/superpowers/specs/2026-06-02-direct-planning-answer-interpretation-design.md`: current authority note for giving direct planning request, grouped planning, and direct workflow surfaces the same interpreted planner-answer authority as decision-backed follow-through.
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
- assistant run detail inspection now also surfaces `resolvedSourceResponseFormat` on interpreted assistant action results, so run readers can inspect answer-interpretation provenance without opening raw bundle files
- assistant run detail inspection now also surfaces structured assistant `action` authority like reusable-source counts, inferred-answer flags, workflow reuse metadata, and linked decision/planning context instead of only showing post-mutation results
- assistant thread inspection, bundled assistant context, and assistant run detail inspection now also surface richer structured assistant `action_result` authority like durable request/task ids, workflow/group ids, decision/preference ids, and grouped result metadata instead of flattening results to summary plus a small provenance subset
- assistant run detail inspection now also surfaces richer structured runtime-event authority like transcript tool names/keys/vendor event types, worktree branch/base metadata, artifact refs, and message levels instead of flattening runtime events to one summary line
- assistant thread inspection now also surfaces structured `action` and `action_result` authority like requested mutation details, reusable-answer-source counts, inferred-answer flags, workflow reuse keys, and resolved interpretation format instead of flattening history to `actionType | summary` only

Current non-UI Goal assistant substrate:

- durable Goal decisions in `decisions.yml`
- durable decision-prompt backfill that lets stronger later request/answer/resolve surfaces persist a missing canonical question onto an existing decision without overwriting an already-recorded prompt
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
- leading topic-summary interpretation that lets `topic_sentences`, `topic_paragraphs`, and `topic_blocks` infer durable decision-topic summaries and planner-answer summaries from leading phrases like `Pilot scope should ...`, instead of only from narrower trailing `... for pilot scope` forms
- prefixed topic-summary interpretation that lets those same topic surfaces infer durable summaries from phrases like `For auth strategy, ...` or `About pilot scope, ...`, instead of only from subject-leading or trailing-topic forms
- `as <topic>` summary interpretation that lets those same topic surfaces infer durable summaries from phrases like `Use Bun-native auth as the auth strategy.`, instead of only from leading, prefixed, or trailing-topic forms
- topic-span interpretation that lets one anchored topic sentence carry later continuation sentences without forcing blank-line paragraph or block boundaries
- question-closing-span interpretation that lets one later question sentence close a multi-sentence explanation without forcing the question sentence to appear first
- topic-closing-span interpretation that lets one later topic-bearing sentence close a multi-sentence explanation without forcing the topic-bearing sentence to appear first
- topic-closing-block interpretation that lets one later topic-bearing paragraph close a multi-paragraph explanation without forcing the topic-bearing paragraph to appear first
- transcript tool-correlation evidence that persists stable tool invocation keys and stable tool target details, letting reviewer/merger context see real tool interactions instead of only flat transcript summaries
- durable structured repo preferences in `.hopi/preference.md`
- Goal-scoped assistant thread storage under `.hopi/runtime/**`
- Goal-scoped assistant thread storage now also persists structured assistant `action` and `action_result` payloads instead of only lossy summary entries, and shared inspection helpers now surface the richer durable metadata already embedded in those actions
- deterministic Goal doc bootstrap plus status inspection for `goal.md` and `design.md`
- planner context wiring for Goal docs, decisions, planning requests, and preferences
- explicit Goal assistant execution with constrained durable actions, including grouped planning requests, `request_decision`, decision resolution with embedded planner follow-through, and durable preferences
- reviewer/merger context correlation across prior run history, artifact refs, transcript summaries, and write traces
- planning reviewer/merger follow-through policy grounded in planning requests and durable planning write traces
- scheduler hard guards that retry planning review/merge work when explicit requested updates still lack durable trace coverage
- grouped-planning blocker propagation that keeps engineering waiting on the current open grouped leaves instead of stale earlier grouped tasks
- contiguous explicit anchor-run merging that lets `question_*` and `topic_*` answer surfaces merge one known consumer across adjacent repeated matching units while still failing closed on non-contiguous repeats
- reusable answer-source decision-key authority that lets `matching_answer_sources` target an existing durable decision by explicit `decisionKey`, and lets remaining reusable source entries materialize a brand-new durable decision topic from that same explicit durable key without restating summary text
- contiguous matching answer-source merging that lets `matching_answer_sources` merge one known decision or planner-answer consumer across adjacent reusable source entries while still failing closed on non-contiguous repeats
- contiguous remaining matching answer-source merging that lets leftover `matching_answer_sources` entries merge one brand-new durable decision topic or one inferred planner-answer row across adjacent reusable source entries when those leftovers already share explicit key-based authority, while still failing closed on non-contiguous repeats
- explicit pending answer-source key authority that lets `pending_answer_sources` stop blindly consuming ordered reusable source entries once those entries already carry explicit durable keys, so adjacent entries can merge into one known decision or planner-answer consumer and wrong-key or non-contiguous repeats fail closed instead of being silently misassigned by order
- contiguous remaining pending answer-source merging that lets leftover `pending_answer_sources` entries merge one brand-new durable decision topic or one inferred planner-answer row across adjacent reusable source entries when those leftovers already share explicit key-based authority, while still failing closed on non-contiguous repeats
- mixed answer-source route inference that lets one reusable `answerSources` bundle simultaneously create brand-new durable decision topics and brand-new inferred planner-answer rows, when the leftover sources are explicitly routed either by per-source `route` metadata or by durable `decisionKey` / `answerKey` authority, so runtime still never has to guess the side
- answer-source route family boundaries that make explicit per-source `route` metadata a real hard boundary during known consumer matching too, so route-scoped reusable sources cannot be silently consumed by the wrong decision/planning family before leftover inference even starts
- unreachable answer-source route fail-closed semantics that reject decision-only or planning-only mutations when an explicitly routed reusable source entry remains unused after materialization, so route-scoped answer sources cannot be silently ignored just because the current surface lacks a valid consumer on that family
- repeated source-excerpt occurrence authority that makes direct item excerpts and reusable answer-source excerpts fail closed unless a repeated exact substring is disambiguated by explicit `sourceOccurrence`, so excerpt grounding no longer silently picks the first repeated match
- explicit answer-source group-key authority that lets reusable `answerSources` merge one materialized decision or planner answer across non-contiguous source entries through stable `sourceGroupKey`, while keeping consumer selection on existing `decisionKey`, `answerKey`, `summaryKey`, prompt, hint, or route authority instead of weaker regrouping heuristics
- explicit grouped answer-source references that let one decision answer or planner answer consume that already-merged grouped reusable answer through stable `answerSourceGroupKey`, without overloading single-fragment `answerSourceKey` semantics
- opening-anchored matching-run interpretation that lets one less-structured shared reply materialize explicit decision answers, explicit planner answers, and open decisions when each already-known consumer appears once at the start of its answer stretch, with at least one trailing continuation unit after that anchor
- closing-anchored matching-run interpretation that lets one less-structured shared reply materialize explicit decision answers, explicit planner answers, and open decisions when each already-known consumer appears once at the end of its answer stretch, with at least one leading continuation unit before that anchor
- middle-anchored matching-run interpretation that lets one less-structured shared reply materialize explicit decision answers, explicit planner answers, and open decisions when each already-known consumer appears once in the middle of its answer stretch, with at least one leading and trailing continuation unit around that anchor
- auto generic-run fallback precision that lets `sourceResponseFormat: "auto"` keep probing deterministic opening/closing generic-run surfaces when earlier topic-family probes only matched by durable prompt keywords and never established explicit topic authority, while still fail-closing on real explicit topic authority
- topic-unit ambiguity fail-closed semantics that keep `topic_clauses`, `topic_sentences`, `topic_paragraphs`, and the explicit `topic_*` anchor families from silently swallowing a second inferable topic summary once one decision or planner consumer has already matched the same reply unit, so leftover `inferDecisionTopics`, `inferRemainingAnswers`, and `auto` no longer succeed through over-consumed topic units

What is still missing:

- deeper answer interpretation when assistant should infer more than one pending answer or brand-new durable decision topics or planner-answer summaries directly from one less-structured reply without first relying on explicit reusable `answerSources`, explicit reusable `answerSources` matched by labels or hints, repeated-consumer `matching_runs`, middle-anchored `matching_middle_runs`, exact repeated durable question text, deterministic prompt-core reuse, deterministic prompt-keyword anchors, explicit durable `matchHints`, explicit question sentences or paragraphs, explicit conjunction boundaries, explicit sentence boundaries, explicit clause boundaries, explicit paragraph boundaries, explicit topic-bearing anchor sentences or paragraphs, explicit inline topic labels, line-based labeled sections, ordered reply structure, grounded excerpts, per-topic mapping inside the action payload, or `sourceResponseFormat: "auto"` either finding one already-implemented deterministic surface that fully captures the reply or failing closed on already-established explicit label, reusable-source, or question/topic-anchor authority

`packages/frontend` remains only as an archived prototype reference and is no longer the product path.

## Recommended Next Work

Next high-leverage phase:

1. Continue deeper answer interpretation only if product needs assistant to infer more than one pending answer or brand-new durable decision topics or planner-answer summaries directly from one less-structured reply without first relying on explicit reusable `answerSources`, explicit reusable `answerSources` matched by labels or hints, repeated-consumer `matching_runs`, middle-anchored `matching_middle_runs`, exact repeated durable question text, deterministic prompt-core reuse, deterministic prompt-keyword anchors, explicit durable `matchHints`, explicit question sentences or paragraphs, explicit conjunction boundaries, explicit sentence boundaries, explicit clause boundaries, explicit paragraph boundaries, explicit topic-bearing anchor sentences or paragraphs, explicit inline topic labels, line-based labeled sections, ordered reply structure, grounded excerpts, per-topic mapping in the action payload, or `sourceResponseFormat: "auto"` either finding one already-implemented deterministic surface that fully captures the reply or failing closed on already-established explicit label, reusable-source, or question/topic-anchor authority.

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

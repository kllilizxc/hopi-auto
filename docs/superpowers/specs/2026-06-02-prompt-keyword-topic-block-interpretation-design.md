# Prompt-Keyword Topic Block Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let answer-driven `topic_blocks` reuse durable decision prompts as deterministic anchor authority, so known open decisions no longer require each block’s anchor paragraph to repeat the explicit topic label.

## Why This Slice Exists

The prior topic-interpretation work already let:

- `topic_sentences`
- `topic_paragraphs`

reuse durable prompts through deterministic prompt-keyword matching.

But `topic_blocks` still had one narrower authority gap:

- block parsing depended on detecting an explicit topic anchor paragraph
- that anchor still had to contain the topic label directly
- durable prompt wording could not yet act as the anchor authority

This slice closes that gap without changing the broader multi-paragraph block model.

## Constraints

- keep `decisions.yml` as the only durable decision-topic authority
- do not add a second anchor-alias or parsed-block store
- preserve the current `topic_blocks` continuation-paragraph semantics
- stay deterministic
- do not introduce fuzzy prompt matching, synonym expansion, or semantic topic inference

## Implemented Scope

### Durable Prompt Matching During Block Anchor Detection

`topic_blocks` anchor detection now reuses the same deterministic matching ladder already used elsewhere:

1. normalized full-text containment
2. deterministic prompt-core containment
3. deterministic prompt-keyword anchor matching

That matching now applies while deciding whether a paragraph starts a new durable topic block.

This lets a block such as:

- `Adopt the Bun-native auth provider for the Bun-first product path.`
- followed by continuation paragraphs

anchor the existing auth decision even when the paragraph never says `auth strategy`.

### Durable Prompt Matching During Block Resolution

Once a block is anchored, later open-decision matching also uses the same normalized prompt candidate surface.

That keeps block parsing and block consumption on the same authority route instead of letting parsing and matching drift apart.

### Shared Product Path Coverage

Because the change lives in the shared interpreter, the active product paths inherit it automatically:

- Bun decision answer APIs
- Goal assistant answer actions

No product-path-specific block-interpretation branch is introduced.

## Non-Goals

- brand-new decision-topic inference from fully loose multi-paragraph prose
- semantic clustering across blocks
- manual prompt alias management
- changing how continuation paragraphs are attached once an anchor is found

## Acceptance Criteria

- current durable decisions can be resolved from `topic_blocks` when the anchor paragraph preserves the durable prompt’s meaningful words but omits the explicit topic label
- multi-paragraph continuation semantics remain unchanged
- Bun API and Goal assistant both use the same shared topic-block matcher
- runtime remains deterministic and does not introduce fuzzy prompt matching

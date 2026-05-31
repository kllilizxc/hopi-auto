# Goal Assistant Preferences And Planning Request Implementation Plan

Goal: close the next Goal assistant product loop with repo preference editing on the Bun path and structured assistant actions for planner requests and durable preference recording.

Architecture: repo preferences stay file-native in `.hopi/preference.md`, the backend exposes direct preference read/write routes plus SSE refresh, assistant actions expand with `request_planning` and `record_preference`, and the Bun UI consumes the same server surface without introducing any new overlay truth.

Tech Stack: Bun, TypeScript, Bun test, Bun HTML import UI

Completed implementation tasks:

- [x] Add structured repo preference recording with deduplication in `PreferenceStore`.
- [x] Add `GET /api/preferences` and `POST /api/preferences`.
- [x] Add assistant action support for `request_planning` and `record_preference`.
- [x] Update assistant prompt/context guidance to prefer the new actions over brittle full-document rewrites.
- [x] Extend the Bun UI with repo preference surfacing and editing.
- [x] Add SSE refresh for repo preference changes.
- [x] Verify through focused failing tests first, full `bun run check`, and local service sanity checks against the Bun-served product path.

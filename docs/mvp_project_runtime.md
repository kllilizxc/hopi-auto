# HOPI Project Runtime

Status: runtime capability authority
Last updated: 2026-08-14

Project runtime is deterministic infrastructure shared by every generic Worker Run and by Project
Preview. It prepares repository dependencies, materializes bounded workspaces, starts product
surfaces, and records facts. It never chooses Work, interprets a Report, or changes Goal state.

## Prepare adapter

A Project may provide executable `scripts/hopi/prepare`. HOPI invokes it before repository-backed
Runs and before Preview, with:

- `HOPI_PROJECT_ROOT`: the primary Project root;
- `HOPI_REPOS_FILE`: a generated manifest of every bound Repo and its current projection;
- `HOPI_PREPARE_RUNTIME_DIR`: writable invocation-specific runtime data;
- `HOPI_CACHE_DIR`: shared non-source cache.

Absence is a valid no-op. A present adapter must be executable, time-bounded, and source-clean. HOPI
records its command, result, duration, paths, and complete local log. Prepare failure settles the
enclosing Run or Preview with factual evidence; it does not create workflow state.

## Worker workspace

`none` Runs receive no task checkout. `read_only` and `isolated_write` Runs receive every bound Repo
at a Project-consistent projection. The primary Repo supplies the process cwd; `repos.json` names all
roots and the primary id. The Worker may inspect every bound Repo but must obey its declared
workspace mode.

Runtime scratch, caches, browser data, logs, reports, and artifacts live outside source. The kernel
fingerprints read-only roots and rejects mutation. Isolated-write Runs use stable task worktrees;
safe source changes are checkpointed when the Run settles.

## Preview adapter

A Project may provide executable `scripts/hopi/preview`. HOPI prepares the current formal release,
then starts Preview with the same Repo manifest and separate runtime/cache directories. The adapter
must emit one or more probeable surfaces. A URL or live process alone is not proof of Goal behavior;
it is only a runtime fact available to the Assistant and Workers.

Preview lifecycle is `starting | running | stopped | failed`. Sessions record release heads,
surfaces, process identity, preparation result, logs, timestamps, and failure reason. A release
update stops the stale Preview. HOPI owns process-group cleanup on stop, failure, restart, and
cancellation.

## Browser evidence

Managed browser automation, when installed, is a runtime capability. A Run instruction decides
whether browser evidence is relevant. The kernel supplies the harness and artifact root, verifies
ownership and cleanup, and preserves artifacts. It does not contain product-specific browser
acceptance rules.

## Boundary

Prepare and Preview are reusable Project capabilities. They are not Work kinds, stages, personas,
or completion gates. The Assistant decides which facts are sufficient; C1 alone owns accepted
Engineering publication.

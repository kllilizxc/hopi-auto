# React Frontend MVP Cutover

Status: complete
Last updated: 2026-07-11

## Decision

The original `packages/frontend` boundary and design language are retained. The earlier MVP
implementation incorrectly equated one product UI with one backend package and replaced the React
frontend with `packages/backend/src/ui`. Product-model simplification does not require package or
presentation-layer collapse.

The corrected architecture is:

```text
packages/frontend (React product UI)
              -> same-origin MVP API
packages/backend (Bun server + canonical runtime)
              -> file-native Assistant, Project, Goal, Work, Attention, Evidence
```

Bun imports the React entry through `packages/backend/src/product.html`, a thin production adapter
that keeps emitted asset URLs rooted inside the backend bundle. Its pre-React boot surface mirrors
`packages/frontend/index.html` under regression coverage. This restores a frontend package without
restoring Vite or adding a second runtime process.

For development only, `packages/frontend/dev.ts` provides a dedicated Bun HMR server and same-origin
API proxy. This is an optional development boundary, not another production authority.

## Preserved

- React component and route structure
- left navigation shell
- dark graphite surfaces
- purple, amber, green, and blue status language
- Kanban-first Goal view
- right-side Assistant drawer
- Project and Goal selection patterns

## Replaced

| Old frontend behavior | MVP behavior |
| --- | --- |
| mutable `todo.yml` task board | read-only Work projection |
| five task lanes including merge | Plan, Build, Review, Done |
| Goal-scoped Assistant Actions | workspace Inbox conversation and document proposals |
| manual reconcile/start/stop automation | automatic Coordinator loop plus Goal Pause/Resume |
| decision and planning-request authoring | model-owned design and Planning through Assistant input |
| per-Run session authority | Work facts, active-pass badge, and durable Evidence |
| Vite dev/build server | Bun HTML import and Bun bundler |

## Source Map

- `src/App.tsx`: product routes
- `src/components/Layout.tsx`: restored application shell
- `src/components/AssistantPanel.tsx`: workspace Assistant and Attention
- `src/pages/BoardView.tsx`: canonical Kanban projection and Preview
- `src/pages/GoalDocsPage.tsx`: Goal contract, design, and Evidence
- `src/pages/ProjectHomePage.tsx`: Project binding and rebind
- `src/lib/apiClient.ts`: intentionally small MVP API contract
- `src/components/ui`: HOPI adapters over HeroUI v3 interactive primitives
- `src/styles/app.css`: selected HeroUI/Tailwind component style entrypoint
- `src/styles/theme.css`: HOPI-to-HeroUI semantic token mapping
- `src/styles/ui.css`: stable adapter hooks and primitive overrides
- `src/index.css`: preserved business layout and message-stream visual system

Legacy session, task-mutation, Action, decision, and planning-workflow components were removed after
their visual patterns were carried into the MVP pages. They are not compatibility layers.

# Assistant Runtime Tool Key Persistence

Status: implemented
Date: 2026-06-03

## Goal

Preserve transcript `toolInvocationKey` across assistant run persistence and readback instead of only supporting it in formatter/UI layers.

## Gap

The assistant-side runtime already collected normalized transcript events with `toolInvocationKey`, and the shared inspection/UI layers already knew how to render that field. But assistant run persistence had one schema hole:

- `assistantRuntimeEventSchema` accepted transcript `toolName`
- `assistantRuntimeEventSchema` accepted transcript `vendorEventType`
- `assistantRuntimeEventSchema` did **not** accept transcript `toolInvocationKey`

Because assistant run records are validated through that schema on readback, `toolInvocationKey` was being silently stripped from assistant run results and `/api/goals/:goalKey/assistant/runs/:assistantRunId`, even though upstream transcript normalization had already captured it.

## Design

Add optional `toolInvocationKey` to the transcript branch of `assistantRuntimeEventSchema`.

This is the minimal root-cause fix:

- runtime collection stays unchanged
- result file shape stays aligned with the events runtime already emits
- assistant run store readback preserves the field instead of stripping it
- existing assistant event formatter/UI inspection immediately benefit without extra presentation changes

## Verification

- assistant run store tests confirm transcript `toolInvocationKey` survives parse/readback
- server assistant-run tests confirm both `/api/goals/:goalKey/assistant/run` and `/api/goals/:goalKey/assistant/runs/:assistantRunId` preserve transcript `toolInvocationKey`
- targeted backend tests, typecheck, and lint pass before commit

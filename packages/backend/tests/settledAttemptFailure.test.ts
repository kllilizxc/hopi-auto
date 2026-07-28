import { describe, expect, test } from 'bun:test'
import { parseGoalDocument, parseWorkDocument } from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import type { RunAttemptSummary } from '../src/runtime/runAttemptStore'
import { settledFailureWorkIds } from '../src/runtime/settledAttemptFailure'
import { workAssignmentHash } from '../src/runtime/workAssignment'

describe('settledFailureWorkIds', () => {
  test('pauses an unchanged Work after targeted Attention publication', async () => {
    const work = parseWorkDocument(`---
id: plan-initial
title: Plan the Goal
kind: planning
stage: plan
notBefore: null
dependsOn: []
contractRevision: 1
evidenceRefs: []
---
Plan the smallest complete delivery.
`)
    const goalPackage: GoalPackage = {
      goal: parseGoalDocument(`---
id: G-1
title: Deliver the Goal
lifecycle: active
priority: 1
contractRevision: 1
---
Deliver the Goal.
`),
      works: new Map([[work.attributes.id, work]]),
      attentions: new Map(),
      evidence: new Map(),
      inputs: [],
    }
    const attempt = {
      projectId: 'Project-1',
      goalId: 'G-1',
      workId: work.attributes.id,
      runId: 'R-1',
      responsibility: 'planner',
      status: 'finished',
      result: 'attention',
      application: 'attention',
      workHash: await workAssignmentHash(work),
    } as RunAttemptSummary

    await expect(
      settledFailureWorkIds(goalPackage, new Map([[work.attributes.id, [attempt]]])),
    ).resolves.toEqual(new Set([work.attributes.id]))
  })
})

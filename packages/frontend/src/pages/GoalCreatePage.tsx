import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  createProjectGoal,
  readProjectGoals,
  startGoalAutomation,
} from '../lib/api'
import { ScrollContainer } from '../components/ScrollContainer'

export function GoalCreatePage() {
  const { projectKey } = useParams<{ projectKey: string }>()
  const navigate = useNavigate()
  const [draft, setDraft] = useState({
    goalKey: '',
    title: '',
    objective: '',
    successCriteria: '',
  })

  const goalsQuery = useQuery({
    queryKey: ['project-goals', projectKey],
    queryFn: async () => {
      if (!projectKey) {
        throw new Error('Missing project key')
      }

      return readProjectGoals(projectKey)
    },
    enabled: Boolean(projectKey),
  })

  const createGoalMutation = useMutation({
    mutationFn: async () => {
      if (!projectKey) {
        throw new Error('Missing project key')
      }

      const result = await createProjectGoal(projectKey, {
        goalKey: draft.goalKey.trim(),
        title: draft.title.trim(),
        objective: draft.objective.trim(),
        successCriteria: draft.successCriteria
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
      })

      await startGoalAutomation(projectKey, result.goalKey).catch(() => undefined)
      return result
    },
    onSuccess: (result) => {
      navigate(
        `/projects/${encodeURIComponent(projectKey ?? '')}/board/${encodeURIComponent(result.goalKey)}`,
      )
    },
  })

  const existingGoals = useMemo(() => goalsQuery.data?.goals ?? [], [goalsQuery.data?.goals])

  return (
    <ScrollContainer axis="vertical" className="flex-1 bg-[#1A1A1A]" viewportClassName="h-full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 text-sm text-gray-400">
              <Link
                to="/projects"
                className="inline-flex items-center gap-2 rounded-lg border border-[#333] bg-[#141414] px-3 py-2 text-gray-300 transition-colors hover:bg-[#1b1b1b]"
              >
                <ArrowLeft className="h-4 w-4" />
                Projects
              </Link>
              <span>/</span>
              <span>{projectKey}</span>
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-white">Create Goal</h1>
            <p className="mt-2 text-sm text-gray-400">
              Seed the goal docs, initial planning task, and automation loop.
            </p>
          </div>
        </div>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-[#333] bg-[#141414] p-6">
            <div className="grid gap-4">
              <GoalField
                label="Goal key"
                value={draft.goalKey}
                onChange={(value) => setDraft((current) => ({ ...current, goalKey: value }))}
                placeholder="build-mvp-flow"
              />
              <GoalField
                label="Title"
                value={draft.title}
                onChange={(value) => setDraft((current) => ({ ...current, title: value }))}
                placeholder="Build MVP flow"
              />
              <GoalArea
                label="Objective"
                value={draft.objective}
                onChange={(value) => setDraft((current) => ({ ...current, objective: value }))}
                placeholder="Restore the project-goal-kanban loop."
              />
              <GoalArea
                label="Success criteria"
                value={draft.successCriteria}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, successCriteria: value }))
                }
                placeholder={'Project and goal creation work.\nAutomation reaches idle.'}
              />
            </div>

            {(createGoalMutation.error || goalsQuery.error) && (
              <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {String(
                  (createGoalMutation.error as Error | null)?.message ??
                    (goalsQuery.error as Error | null)?.message,
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => createGoalMutation.mutate()}
              disabled={
                createGoalMutation.isPending ||
                !projectKey ||
                !draft.goalKey.trim() ||
                !draft.title.trim() ||
                !draft.objective.trim()
              }
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-60"
            >
              {createGoalMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Create Goal
            </button>
          </div>

          <section className="rounded-2xl border border-[#333] bg-[#141414] p-6">
            <h2 className="text-lg font-semibold text-white">Existing Goals</h2>
            <div className="mt-4 grid gap-3">
              {existingGoals.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#333] bg-[#111] px-4 py-8 text-center text-sm text-gray-500">
                  No goals yet.
                </div>
              ) : (
                existingGoals.map((goal) => (
                  <Link
                    key={goal.goalKey}
                    to={`/projects/${encodeURIComponent(projectKey ?? '')}/board/${encodeURIComponent(goal.goalKey)}`}
                    className="rounded-xl border border-[#333] bg-[#111] px-4 py-3 transition-colors hover:bg-[#181818]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-white">{goal.title}</span>
                      <span className="rounded-full border border-[#333] px-2 py-0.5 text-[11px] uppercase tracking-wide text-amber-300">
                        {goal.goalKey}
                      </span>
                    </div>
                    {goal.objective && (
                      <p className="mt-2 line-clamp-2 text-sm text-gray-400">{goal.objective}</p>
                    )}
                  </Link>
                ))
              )}
            </div>
          </section>
        </section>
      </div>
    </ScrollContainer>
  )
}

function GoalField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="grid gap-2 text-sm text-gray-300">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-[#333] bg-[#111] px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-amber-400"
      />
    </label>
  )
}

function GoalArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="grid gap-2 text-sm text-gray-300">
      <span>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={label === 'Objective' ? 5 : 4}
        className="rounded-lg border border-[#333] bg-[#111] px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-amber-400"
      />
    </label>
  )
}

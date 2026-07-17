import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Flag, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  AppAlert,
  AppButton,
  AppForm,
  AppRouterLink,
  AppScrollShadow,
  AppSpinner,
  AppSurface,
  AppTextAreaField,
  AppTextField,
} from '../components/ui'
import { createGoal, readState } from '../lib/api'
import { buildGoalRoute } from '../lib/goalScope'
import { projectDisplayName } from '../lib/utils'

export function GoalCreatePage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const snapshotQuery = useQuery({ queryKey: ['mvp-state'], queryFn: readState })
  const mutation = useMutation({
    mutationFn: () =>
      createGoal(projectId ?? '', {
        title: title.trim(),
        objective: objective.trim(),
      }),
    onSuccess: async (goal) => {
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
      navigate(buildGoalRoute({ projectId: goal.projectId, goalId: goal.goal.id }, 'board'))
    },
  })

  if (!projectId) return <Navigate to="/projects" replace />
  const project = snapshotQuery.data?.projects.find((item) => item.projectId === projectId)

  return (
    <AppScrollShadow className="page-scroll">
      <div className="goal-create-page page-content narrow">
        <AppRouterLink className="back-link" to="/projects"><ArrowLeft /> Projects</AppRouterLink>
        <AppSurface className="goal-create-card panel-card">
          <header>
            <span className="goal-create-icon"><Flag /></span>
            <div>
              <span className="eyebrow" title={projectId}>
                {project ? projectDisplayName(project) : projectId}
              </span>
              <h1>Create a Goal</h1>
              <p>Describe the outcome. Planner will clarify only what is materially unclear.</p>
            </div>
          </header>

          {(mutation.error || snapshotQuery.error) && (
            <AppAlert className="error-banner">
              {mutation.error?.message ?? (snapshotQuery.error as Error | null)?.message}
            </AppAlert>
          )}

          <AppForm
            onSubmit={(event) => {
              event.preventDefault()
              if (title.trim() && objective.trim()) mutation.mutate()
            }}
          >
            <AppTextField
              autoFocus
              className="field"
              label="Goal title"
              onValueChange={setTitle}
              placeholder="Ship the first customer onboarding flow"
              value={title}
            />
            <AppTextAreaField
              className="field"
              label="Desired outcome"
              onValueChange={setObjective}
              placeholder="What should be true when this Goal is complete? Include constraints or success criteria you already know."
              rows={8}
              value={objective}
            />
            <div className="form-actions">
              <AppRouterLink className="secondary-button" to="/projects">Cancel</AppRouterLink>
              <AppButton className="primary-button" type="submit" disabled={!title.trim() || !objective.trim() || mutation.isPending}>
                {mutation.isPending ? <AppSpinner size="sm" /> : <Sparkles />}
                Create with Planning
              </AppButton>
            </div>
          </AppForm>
        </AppSurface>
      </div>
    </AppScrollShadow>
  )
}

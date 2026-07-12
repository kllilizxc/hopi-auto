import { useQuery } from '@tanstack/react-query'
import { FileText, FolderOpen, LayoutDashboard } from 'lucide-react'
import { createContext, useContext, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { readState, type AttentionView } from '../lib/api'
import { buildGoalRoute, readGoalRouteState, type GoalSurface } from '../lib/goalScope'
import { cn } from '../lib/utils'
import { AssistantPanel } from './AssistantPanel'
import { AppAlert, AppRouterLink, SelectField } from './ui'

interface ShellContextValue {
  openAssistant: (attention?: AttentionView) => void
}

const ShellContext = createContext<ShellContextValue | null>(null)

export function useShell() {
  const value = useContext(ShellContext)
  if (!value) throw new Error('useShell must be used inside Layout')
  return value
}

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const routeScope = readGoalRouteState(location.pathname)
  const [assistantReply, setAssistantReply] = useState<AttentionView | null>(null)
  const [assistantRequest, setAssistantRequest] = useState(0)
  const snapshotQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readState,
    refetchInterval: 2_000,
  })
  const snapshot = snapshotQuery.data

  const openAssistant = (attention?: AttentionView) => {
    setAssistantReply(attention ?? null)
    setAssistantRequest((value) => value + 1)
  }

  if (!routeScope) {
    const pageLabel = location.pathname.endsWith('/goals/new') ? 'New Goal' : 'Projects'
    return (
      <ShellContext.Provider value={{ openAssistant }}>
        <div className="standalone-shell">
          <header className="standalone-header">
            <AppRouterLink className="standalone-brand" to="/projects" aria-label="HOPI Projects">
              <span className="brand-mark">H</span>
              <span>
                <strong>HOPI</strong>
                <small>one-person operating system</small>
              </span>
            </AppRouterLink>
            <span>{pageLabel}</span>
          </header>
          <main className="standalone-main app-main">
            {snapshotQuery.isError && (
              <AppAlert className="global-error">{(snapshotQuery.error as Error).message}</AppAlert>
            )}
            <Outlet />
          </main>
        </div>
      </ShellContext.Provider>
    )
  }

  const surface: GoalSurface = location.pathname.includes('/docs/') ? 'docs' : 'board'
  const project = snapshot?.projects.find((item) => item.projectId === routeScope.projectId)

  const navigateToProject = (projectId: string) => {
    const nextProject = snapshot?.projects.find((item) => item.projectId === projectId)
    const nextGoal = nextProject?.goals[0]
    navigate(
      nextGoal
        ? buildGoalRoute({ projectId, goalId: nextGoal.id }, surface)
        : `/projects/${encodeURIComponent(projectId)}/goals/new`,
    )
  }

  return (
    <ShellContext.Provider value={{ openAssistant }}>
      <div className="goal-workspace">
        <AssistantPanel
          docked
          focusRequest={assistantRequest}
          initialReply={assistantReply}
          isOpen
          scope={routeScope}
          snapshot={snapshot}
          onClose={() => undefined}
        />

        <section className="goal-workspace-surface">
          <header className="workspace-topbar">
            <div className="workspace-switchers">
              <SelectField
                aria-label="Current Project"
                disabled={!snapshot}
                label="Project"
                onValueChange={navigateToProject}
                options={(snapshot?.projects ?? []).map((item) => ({
                  label: item.projectId,
                  value: item.projectId,
                }))}
                value={routeScope.projectId}
              />
              <SelectField
                aria-label="Current Goal"
                disabled={!project}
                label="Goal"
                onValueChange={(nextGoalId) =>
                  navigate(
                    buildGoalRoute(
                      { projectId: routeScope.projectId, goalId: nextGoalId },
                      surface,
                    ),
                  )
                }
                options={(project?.goals ?? []).map((item) => ({
                  label: item.title,
                  value: item.id,
                }))}
                value={routeScope.goalId}
              />
            </div>

            <nav className="workspace-tabs" aria-label="Goal workspace view">
              <AppRouterLink
                className={cn(surface === 'board' && 'active')}
                to={buildGoalRoute(routeScope, 'board')}
              >
                <LayoutDashboard /> Kanban
              </AppRouterLink>
              <AppRouterLink
                className={cn(surface === 'docs' && 'active')}
                to={buildGoalRoute(routeScope, 'docs')}
              >
                <FileText /> Goal docs
              </AppRouterLink>
            </nav>

            <div className="workspace-topbar-actions">
              <AppRouterLink
                aria-label="Projects"
                className="workspace-projects-link"
                to="/projects"
              >
                <FolderOpen /> <span>Projects</span>
              </AppRouterLink>
            </div>
          </header>

          <main className="workspace-main app-main">
            {snapshotQuery.isError && (
              <AppAlert className="global-error">{(snapshotQuery.error as Error).message}</AppAlert>
            )}
            <Outlet />
          </main>
        </section>
      </div>
    </ShellContext.Provider>
  )
}

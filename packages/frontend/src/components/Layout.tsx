import { useQuery } from '@tanstack/react-query'
import { Bot, FileText, FolderOpen, LayoutDashboard, X } from 'lucide-react'
import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { readState, type AttentionView } from '../lib/api'
import {
  buildGoalRoute,
  findNewestUnseenGoal,
  orderGoalsByRecency,
  orderProjectsByRecency,
  readGoalRouteState,
  readRecentGoal,
  readRecentProjects,
  rememberRecentProject,
  rememberRecentGoal,
  resolveProjectGoalId,
  selectProjectShortcuts,
  type GoalSurface,
} from '../lib/goalScope'
import { cn, projectDisplayName } from '../lib/utils'
import {
  AppAlert,
  AppRouterLink,
  AppTabs,
  IconButton,
  SelectField,
} from './ui'

const AssistantPanel = lazy(() =>
  import('./AssistantPanel').then((module) => ({ default: module.AssistantPanel })),
)

interface ShellContextValue {
  openAssistant: (attention?: AttentionView) => void
}

const COMPACT_WORKSPACE_QUERY = '(max-width: 1280px)'
const NARROW_PROJECT_SHORTCUT_QUERY = '(max-width: 1180px)'
const SINGLE_PROJECT_SHORTCUT_QUERY =
  '(max-width: 660px), (max-width: 900px) and (max-height: 560px)'

const ShellContext = createContext<ShellContextValue | null>(null)

export function useShell() {
  const value = useContext(ShellContext)
  if (!value) throw new Error('useShell must be used inside Layout')
  return value
}

function useCompactWorkspace() {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COMPACT_WORKSPACE_QUERY).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(COMPACT_WORKSPACE_QUERY)
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return compact
}

function projectShortcutLimit() {
  if (typeof window === 'undefined') return 3
  if (window.matchMedia(SINGLE_PROJECT_SHORTCUT_QUERY).matches) return 1
  if (window.matchMedia(NARROW_PROJECT_SHORTCUT_QUERY).matches) return 2
  return 3
}

function useProjectShortcutLimit() {
  const [limit, setLimit] = useState(projectShortcutLimit)

  useEffect(() => {
    const media = [
      window.matchMedia(SINGLE_PROJECT_SHORTCUT_QUERY),
      window.matchMedia(NARROW_PROJECT_SHORTCUT_QUERY),
    ]
    const update = () => setLimit(projectShortcutLimit())
    update()
    media.forEach((query) => query.addEventListener('change', update))
    return () => media.forEach((query) => query.removeEventListener('change', update))
  }, [])

  return limit
}

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const routeScope = readGoalRouteState(location.pathname)
  const [assistantReply, setAssistantReply] = useState<AttentionView | null>(null)
  const [assistantRequest, setAssistantRequest] = useState(0)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantActivated, setAssistantActivated] = useState(false)
  const [recentProjects] = useState(readRecentProjects)
  const [recentGoal, setRecentGoal] = useState(() =>
    routeScope ? readRecentGoal(routeScope.projectId) : null,
  )
  const knownGoalIds = useRef<Map<string, Set<string>> | null>(null)
  const compactWorkspace = useCompactWorkspace()
  const projectShortcutCount = useProjectShortcutLimit()
  const assistantDocked = !compactWorkspace
  const shouldRenderAssistant = assistantDocked || assistantActivated
  const snapshotQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readState,
    refetchInterval: 2_000,
  })
  const snapshot = snapshotQuery.data
  const routeProjectId = routeScope?.projectId
  const routeGoalId = routeScope?.goalId
  const project = snapshot?.projects.find((item) => item.projectId === routeProjectId)
  const routeGoalExists = Boolean(project?.goals.some((goal) => goal.id === routeGoalId))

  useEffect(() => {
    if (routeProjectId && routeGoalId && routeGoalExists) {
      const visitedAt = new Date()
      rememberRecentProject(routeProjectId, undefined, visitedAt)
      setRecentGoal(rememberRecentGoal(routeProjectId, routeGoalId, undefined, visitedAt))
    }
  }, [routeGoalExists, routeGoalId, routeProjectId])

  useEffect(() => {
    if (!snapshot) return
    const currentGoalIds = new Map(
      snapshot.projects.map((item) => [item.projectId, new Set(item.goals.map((goal) => goal.id))]),
    )
    const previousGoalIds = knownGoalIds.current
    knownGoalIds.current = currentGoalIds
    if (!previousGoalIds) return

    const observedAt = new Date()
    for (const item of snapshot.projects) {
      const previous = previousGoalIds.get(item.projectId)
      const newest = findNewestUnseenGoal(item.goals, item.projectId, previous)
      if (!newest) continue
      const preference = rememberRecentGoal(item.projectId, newest.id, undefined, observedAt)
      if (item.projectId === routeProjectId) setRecentGoal(preference)
    }
  }, [routeProjectId, snapshot])

  useEffect(() => setAssistantOpen(false), [location.pathname])

  const openAssistant = (attention?: AttentionView) => {
    setAssistantReply(attention ?? null)
    setAssistantActivated(true)
    setAssistantOpen(true)
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
            <div className="standalone-header-actions">
              <span>{pageLabel}</span>
              <IconButton
                className="global-assistant-button"
                type="button"
                aria-label="Open Assistant"
                title="Open Assistant"
                onClick={() => openAssistant()}
              >
                <Bot />
              </IconButton>
            </div>
          </header>
          <main className="standalone-main app-main">
            {snapshotQuery.isError && (
              <AppAlert className="global-error">{(snapshotQuery.error as Error).message}</AppAlert>
            )}
            <Outlet />
          </main>
          {shouldRenderAssistant && (
            <Suspense
              fallback={
                <AssistantLoading
                  docked={false}
                  open={assistantOpen}
                  onClose={() => setAssistantOpen(false)}
                />
              }
            >
              <AssistantPanel
                focusRequest={assistantRequest}
                initialReply={assistantReply}
                isOpen={assistantOpen}
                scope={null}
                snapshot={snapshot}
                onClose={() => setAssistantOpen(false)}
              />
            </Suspense>
          )}
        </div>
      </ShellContext.Provider>
    )
  }

  const surface: GoalSurface = location.pathname.includes('/docs/') ? 'docs' : 'board'
  const orderedProjects = orderProjectsByRecency(snapshot?.projects ?? [], recentProjects)
  const projectShortcuts = selectProjectShortcuts(
    orderedProjects,
    routeScope.projectId,
    projectShortcutCount,
  )
  const projectShortcutIds = new Set(projectShortcuts.map((item) => item.projectId))
  const overflowProjects = orderedProjects.filter(
    (item) => !projectShortcutIds.has(item.projectId),
  )
  const orderedGoals = orderGoalsByRecency(
    project?.goals ?? [],
    routeScope.projectId,
    recentGoal,
  )

  const navigateToProject = (projectId: string) => {
    const nextProject = snapshot?.projects.find((item) => item.projectId === projectId)
    const nextGoalId = resolveProjectGoalId(
      nextProject?.goals ?? [],
      projectId,
      readRecentGoal(projectId),
    )
    navigate(
      nextGoalId
        ? buildGoalRoute({ projectId, goalId: nextGoalId }, surface)
        : `/projects/${encodeURIComponent(projectId)}/goals/new`,
    )
  }

  return (
    <ShellContext.Provider value={{ openAssistant }}>
      <div className="goal-workspace">
        {shouldRenderAssistant && (
          <Suspense
            fallback={
              <AssistantLoading
                docked={assistantDocked}
                open={assistantDocked || assistantOpen}
                onClose={() => setAssistantOpen(false)}
              />
            }
          >
            <AssistantPanel
              docked={assistantDocked}
              focusRequest={assistantRequest}
              initialReply={assistantReply}
              isOpen={assistantDocked || assistantOpen}
              scope={routeScope}
              snapshot={snapshot}
              onClose={() => setAssistantOpen(false)}
            />
          </Suspense>
        )}

        <section className="goal-workspace-surface">
          <header className="workspace-topbar">
            <div className="workspace-switchers">
              <div className="project-switcher">
                <span className="app-select__label">Project</span>
                <div className="project-switcher__controls">
                  {projectShortcuts.length ? (
                    <AppTabs
                      aria-label="Recent Projects"
                      className={cn(
                        'project-switcher__tabs',
                        `project-switcher__tabs--${projectShortcuts.length}`,
                      )}
                      selectedKey={routeScope.projectId}
                      onSelectionChange={(key) => {
                        const projectId = String(key)
                        if (projectId !== routeScope.projectId) navigateToProject(projectId)
                      }}
                    >
                      <AppTabs.List className="project-switcher__tab-list">
                        {projectShortcuts.map((item) => {
                          const label = projectDisplayName(item)
                          return (
                            <AppTabs.Tab
                              className="project-switcher__tab"
                              id={item.projectId}
                              key={item.projectId}
                            >
                              <AppTabs.Indicator className="project-switcher__indicator" />
                              <span title={label}>{label}</span>
                            </AppTabs.Tab>
                          )
                        })}
                      </AppTabs.List>
                    </AppTabs>
                  ) : (
                    <span className="project-switcher__placeholder">
                      {snapshot ? 'No Projects' : 'Loading…'}
                    </span>
                  )}
                  {overflowProjects.length > 0 && (
                    <SelectField
                      aria-label="More Projects"
                      className="project-switcher__more"
                      onValueChange={navigateToProject}
                      options={overflowProjects.map((item) => ({
                        label: projectDisplayName(item),
                        value: item.projectId,
                      }))}
                      placeholder={`More ${overflowProjects.length}`}
                      popoverClassName="project-switcher__popover"
                      value={null}
                    />
                  )}
                </div>
              </div>
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
                options={orderedGoals.map((item) => ({
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
              <IconButton
                className="workspace-assistant-button"
                type="button"
                aria-label="Open Assistant"
                aria-expanded={assistantOpen}
                title="Open Assistant"
                onClick={() => openAssistant()}
              >
                <Bot />
              </IconButton>
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

function AssistantLoading({
  docked,
  open,
  onClose,
}: {
  docked: boolean
  open: boolean
  onClose: () => void
}) {
  return (
    <aside
      className={cn('assistant-drawer assistant-loading', open && 'open', docked && 'docked')}
      aria-hidden={!open}
    >
      <header className="assistant-header">
        <div>
          <span className="assistant-avatar"><Bot /></span>
          <span><strong>Assistant</strong><small>Workspace conversation</small></span>
        </div>
        {!docked && (
          <IconButton type="button" onClick={onClose} aria-label="Close assistant">
            <X />
          </IconButton>
        )}
      </header>
      <div className="route-loading assistant-loading-body" role="status" aria-live="polite">
        <span className="route-loading-mark" aria-hidden="true" />
        <strong>Opening Assistant</strong>
        <small>Loading the conversation…</small>
      </div>
    </aside>
  )
}

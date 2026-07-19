import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, FileText, FolderOpen, LayoutDashboard, X } from 'lucide-react'
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { readGoalBoard, readGoalDocs, readShellState, type AttentionView } from '../lib/api'
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
import { goalBoardQueryKey, goalDocsQueryKey } from '../lib/queryKeys'
import { shellPollInterval, STABLE_QUERY_NOTIFY_PROPS } from '../lib/queryPerformance'
import {
  loadAssistantPanel,
  loadBoardView,
  loadGoalDocsPage,
  preloadAssistantPanel,
  preloadProjectHomePage,
} from '../routeModules'
import { cn, projectDisplayName } from '../lib/utils'
import { AppAlert, AppRouterLink, AppTabs, IconButton, SelectField } from './ui'

const AssistantPanel = lazy(() =>
  loadAssistantPanel().then((module) => ({
    default: module.AssistantPanel,
  })),
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
  const queryClient = useQueryClient()
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
  const goalNavigationRequest = useRef(0)
  const compactWorkspace = useCompactWorkspace()
  const projectShortcutCount = useProjectShortcutLimit()
  const assistantDocked = !compactWorkspace
  const shouldRenderAssistant = assistantDocked || assistantActivated
  const snapshotQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readShellState,
    refetchInterval: shellPollInterval,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
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

  useEffect(() => {
    goalNavigationRequest.current += 1
    setAssistantOpen(false)
  }, [location.pathname])

  const openAssistant = useCallback((attention?: AttentionView) => {
    setAssistantReply(attention ?? null)
    setAssistantActivated(true)
    setAssistantOpen(true)
    setAssistantRequest((value) => value + 1)
  }, [])
  const shellContext = useMemo(() => ({ openAssistant }), [openAssistant])
  const surface: GoalSurface = location.pathname.includes('/docs/') ? 'docs' : 'board'
  const orderedProjects = useMemo(
    () => orderProjectsByRecency(snapshot?.projects ?? [], recentProjects),
    [recentProjects, snapshot?.projects],
  )
  const projectShortcuts = useMemo(
    () =>
      routeProjectId
        ? selectProjectShortcuts(orderedProjects, routeProjectId, projectShortcutCount)
        : [],
    [orderedProjects, projectShortcutCount, routeProjectId],
  )
  const projectShortcutIds = useMemo(
    () => new Set(projectShortcuts.map((item) => item.projectId)),
    [projectShortcuts],
  )
  const overflowProjects = useMemo(
    () => orderedProjects.filter((item) => !projectShortcutIds.has(item.projectId)),
    [orderedProjects, projectShortcutIds],
  )
  const overflowProjectOptions = useMemo(
    () =>
      overflowProjects.map((item) => ({
        label: projectDisplayName(item),
        value: item.projectId,
      })),
    [overflowProjects],
  )
  const orderedGoals = useMemo(
    () =>
      routeProjectId
        ? orderGoalsByRecency(project?.goals ?? [], routeProjectId, recentGoal)
        : [],
    [project?.goals, recentGoal, routeProjectId],
  )
  const goalOptions = useMemo(
    () =>
      orderedGoals.map((item) => ({
        label: item.title,
        value: item.id,
      })),
    [orderedGoals],
  )
  const prepareGoalSurface = useCallback(
    async (scope: { projectId: string; goalId: string }, nextSurface: GoalSurface) => {
      const queryKey =
        nextSurface === 'docs'
          ? goalDocsQueryKey(scope.projectId, scope.goalId)
          : goalBoardQueryKey(scope.projectId, scope.goalId)
      const cached = queryClient.getQueryData(queryKey) !== undefined
      const loadSurface = nextSurface === 'docs' ? loadGoalDocsPage() : loadBoardView()
      const prefetch =
        nextSurface === 'docs'
          ? queryClient.prefetchQuery({
              queryKey,
              queryFn: () => readGoalDocs(scope.projectId, scope.goalId),
            })
          : queryClient.prefetchQuery({
              queryKey,
              queryFn: () => readGoalBoard(scope.projectId, scope.goalId),
            })

      if (cached) {
        void prefetch
        await loadSurface
        return
      }
      await Promise.all([loadSurface, prefetch])
    },
    [queryClient],
  )
  const warmGoalSurface = useCallback(
    (scope: { projectId: string; goalId: string }, nextSurface: GoalSurface) => {
      void prepareGoalSurface(scope, nextSurface).catch(() => undefined)
    },
    [prepareGoalSurface],
  )
  const navigateToGoalSurface = useCallback(
    (scope: { projectId: string; goalId: string }, nextSurface: GoalSurface) => {
      const request = ++goalNavigationRequest.current
      void prepareGoalSurface(scope, nextSurface)
        .catch(() => undefined)
        .then(() => {
          if (request === goalNavigationRequest.current) {
            navigate(buildGoalRoute(scope, nextSurface))
          }
        })
    },
    [navigate, prepareGoalSurface],
  )
  const goalForProject = useCallback(
    (projectId: string) => {
      const nextProject = snapshot?.projects.find((item) => item.projectId === projectId)
      return resolveProjectGoalId(
        nextProject?.goals ?? [],
        projectId,
        readRecentGoal(projectId),
      )
    },
    [snapshot?.projects],
  )
  const warmProject = useCallback(
    (projectId: string) => {
      const goalId = goalForProject(projectId)
      if (goalId) warmGoalSurface({ projectId, goalId }, surface)
    },
    [goalForProject, surface, warmGoalSurface],
  )
  const navigateToProject = useCallback(
    (projectId: string) => {
      const nextGoalId = goalForProject(projectId)
      if (nextGoalId) {
        navigateToGoalSurface({ projectId, goalId: nextGoalId }, surface)
        return
      }
      goalNavigationRequest.current += 1
      navigate(`/projects/${encodeURIComponent(projectId)}/goals/new`)
    },
    [goalForProject, navigate, navigateToGoalSurface, surface],
  )

  if (!routeScope) {
    const pageLabel = location.pathname.endsWith('/goals/new') ? 'New Goal' : 'Projects'
    return (
      <ShellContext.Provider value={shellContext}>
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
                onFocus={preloadAssistantPanel}
                onClick={() => openAssistant()}
                onPointerDown={preloadAssistantPanel}
                onPointerEnter={preloadAssistantPanel}
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

  return (
    <ShellContext.Provider value={shellContext}>
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

        <section
          className={cn(
            'goal-workspace-surface',
            surface === 'board' && 'goal-workspace-surface--board',
          )}
        >
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
                      <AppTabs.List>
                        {projectShortcuts.map((item) => {
                          const label = projectDisplayName(item)
                          return (
                            <AppTabs.Tab
                              id={item.projectId}
                              key={item.projectId}
                              onFocus={() => warmProject(item.projectId)}
                              onPointerDown={() => warmProject(item.projectId)}
                              onPointerEnter={() => warmProject(item.projectId)}
                            >
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
                      options={overflowProjectOptions}
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
                  navigateToGoalSurface(
                    { projectId: routeScope.projectId, goalId: nextGoalId },
                    surface,
                  )
                }
                options={goalOptions}
                value={routeScope.goalId}
              />
            </div>

            <AppTabs
              className="workspace-tabs"
              onSelectionChange={(key) => {
                const nextSurface = String(key) as GoalSurface
                if (nextSurface !== surface) navigateToGoalSurface(routeScope, nextSurface)
              }}
              selectedKey={surface}
            >
              <AppTabs.List aria-label="Goal workspace view">
                <AppTabs.Tab
                  id="board"
                  onFocus={() => warmGoalSurface(routeScope, 'board')}
                  onPointerDown={() => warmGoalSurface(routeScope, 'board')}
                  onPointerEnter={() => warmGoalSurface(routeScope, 'board')}
                >
                  <LayoutDashboard /> Kanban
                </AppTabs.Tab>
                <AppTabs.Tab
                  id="docs"
                  onFocus={() => warmGoalSurface(routeScope, 'docs')}
                  onPointerDown={() => warmGoalSurface(routeScope, 'docs')}
                  onPointerEnter={() => warmGoalSurface(routeScope, 'docs')}
                >
                  <FileText /> Goal docs
                </AppTabs.Tab>
              </AppTabs.List>
            </AppTabs>

            <div className="workspace-topbar-actions">
              <IconButton
                className="workspace-assistant-button"
                type="button"
                aria-label="Open Assistant"
                aria-expanded={assistantOpen}
                title="Open Assistant"
                onFocus={preloadAssistantPanel}
                onClick={() => openAssistant()}
                onPointerDown={preloadAssistantPanel}
                onPointerEnter={preloadAssistantPanel}
              >
                <Bot />
              </IconButton>
              <AppRouterLink
                aria-label="Projects"
                className="workspace-projects-link"
                to="/projects"
                onFocus={preloadProjectHomePage}
                onPointerDown={preloadProjectHomePage}
                onPointerEnter={preloadProjectHomePage}
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
      <div className="assistant-corner-chrome assistant-corner-chrome--loading">
        {!docked && (
          <IconButton type="button" onClick={onClose} aria-label="Close assistant">
            <X />
          </IconButton>
        )}
      </div>
      <div className="route-loading assistant-loading-body" role="status" aria-live="polite">
        <span className="route-loading-mark" aria-hidden="true" />
        <strong>Opening Assistant</strong>
        <small>Loading the conversation…</small>
      </div>
    </aside>
  )
}

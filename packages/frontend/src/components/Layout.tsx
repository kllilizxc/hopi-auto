import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, FileText, FolderOpen, Route as RouteIcon, X } from 'lucide-react'
import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { type AttentionView, readGoalDocs, readGoalRoute, readShellState } from '../lib/api'
import { readAssistantPageScope } from '../lib/assistantContext'
import {
  type GoalSurface,
  buildGoalRoute,
  buildProjectRoute,
  findNewestUnseenGoal,
  orderProjectsByRecency,
  projectCompletionIdentities,
  readGoalRouteState,
  readRecentGoals,
  readRecentProjects,
  readSeenProjectCompletions,
  rememberRecentGoal,
  rememberRecentProject,
  rememberSeenProjectCompletions,
  resolveProjectGoalId,
  unseenProjectCompletionCount,
} from '../lib/goalScope'
import { goalDocsQueryKey, goalRouteQueryKey } from '../lib/queryKeys'
import {
  CANONICAL_POLL_INTERVAL_MS,
  STABLE_QUERY_NOTIFY_PROPS,
  shellPollInterval,
} from '../lib/queryPerformance'
import { cn, projectDisplayName } from '../lib/utils'
import {
  loadAssistantPanel,
  loadRouteView,
  loadGoalDocsPage,
  preloadAssistantPanel,
  preloadProjectHomePage,
} from '../routeModules'
import { PeerSwitcher } from './PeerSwitcher'
import { AppAlert, AppRouterLink, AppTabs, IconButton } from './ui'

const AssistantPanel = lazy(() =>
  loadAssistantPanel().then((module) => ({
    default: module.AssistantPanel,
  })),
)

interface ShellContextValue {
  openAssistant: (attention?: AttentionView) => void
  selectGoal: (goalId: string) => void
  warmGoal: (goalId: string) => void
}

const COMPACT_WORKSPACE_QUERY = '(max-width: 1280px)'

const ShellContext = createContext<ShellContextValue | null>(null)

function projectNeedsYouLabel(count: number) {
  return `${count} ${count === 1 ? 'request needs' : 'requests need'} your reply`
}

function projectCompletionLabel(count: number) {
  return `${count} new Goal${count === 1 ? '' : 's'} completed`
}

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

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const routeScope = readGoalRouteState(location.pathname)
  const assistantScope = readAssistantPageScope(location.pathname)
  const projectOnlyRoute = Boolean(assistantScope && !routeScope)
  const assistantScopeKey = assistantScope?.projectId ?? 'home'
  const [assistantReply, setAssistantReply] = useState<AttentionView | null>(null)
  const [assistantRequest, setAssistantRequest] = useState(0)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantActivated, setAssistantActivated] = useState(false)
  const [, setCompletionReadVersion] = useState(0)
  const [recentProjects] = useState(readRecentProjects)
  const knownGoalIds = useRef<Map<string, Set<string>> | null>(null)
  const compactWorkspace = useCompactWorkspace()
  const assistantDocked = !compactWorkspace
  const assistantDockedForRoute = projectOnlyRoute || assistantDocked
  const shouldRenderAssistant = projectOnlyRoute || assistantDocked || assistantActivated
  const snapshotQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readShellState,
    refetchInterval: projectOnlyRoute ? CANONICAL_POLL_INTERVAL_MS : shellPollInterval,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })
  const snapshot = snapshotQuery.data
  const snapshotReady = Boolean(snapshot)
  const routeProjectId = routeScope?.projectId ?? assistantScope?.projectId
  const routeGoalId = routeScope?.goalId
  const project = snapshot?.projects.find((item) => item.projectId === routeProjectId)
  const routeProjectExists = Boolean(project)
  const routeGoalExists = Boolean(project?.goals.some((goal) => goal.id === routeGoalId))

  useEffect(() => {
    if (!routeProjectId || !routeProjectExists) return
    const visitedAt = new Date()
    rememberRecentProject(routeProjectId, undefined, visitedAt)
    if (routeGoalId && routeGoalExists) {
      rememberRecentGoal(routeProjectId, routeGoalId, undefined, visitedAt)
    }
  }, [routeGoalExists, routeGoalId, routeProjectExists, routeProjectId])

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
      rememberRecentGoal(item.projectId, newest.id, undefined, observedAt)
    }
  }, [snapshot])

  useEffect(() => {
    if (!snapshot) return
    let initialized = false
    for (const item of snapshot.projects) {
      if (readSeenProjectCompletions(item.projectId) !== null) continue
      rememberSeenProjectCompletions(item.projectId, projectCompletionIdentities(item.goals))
      initialized = readSeenProjectCompletions(item.projectId) !== null || initialized
    }
    if (initialized) setCompletionReadVersion((value) => value + 1)
  }, [snapshot])

  useEffect(() => {
    setAssistantOpen(false)
  }, [location.pathname])

  const openAssistant = useCallback((attention?: AttentionView) => {
    setAssistantReply(attention ?? null)
    setAssistantActivated(true)
    setAssistantOpen(true)
    setAssistantRequest((value) => value + 1)
  }, [])
  const surface: GoalSurface = location.pathname.includes('/docs/') ? 'docs' : 'route'
  const orderedProjects = useMemo(
    () => orderProjectsByRecency(snapshot?.projects ?? [], recentProjects),
    [recentProjects, snapshot?.projects],
  )
  const projectSwitcherItems = orderedProjects.map((item) => {
    const completionCount = unseenProjectCompletionCount(
      item.goals,
      readSeenProjectCompletions(item.projectId),
    )
    return {
      id: item.projectId,
      label: projectDisplayName(item),
      ...(item.needsYouCount > 0
        ? {
            badge: {
              count: item.needsYouCount,
              label: projectNeedsYouLabel(item.needsYouCount),
            },
          }
        : {}),
      ...(completionCount > 0
        ? {
            completion: {
              label: projectCompletionLabel(completionCount),
            },
          }
        : {}),
    }
  })
  const prepareGoalSurface = useCallback(
    async (scope: { projectId: string; goalId: string }, nextSurface: GoalSurface) => {
      const queryKey =
        nextSurface === 'docs'
          ? goalDocsQueryKey(scope.projectId, scope.goalId)
          : goalRouteQueryKey(scope.projectId, scope.goalId)
      const loadSurface = nextSurface === 'docs' ? loadGoalDocsPage() : loadRouteView()
      const prefetch =
        nextSurface === 'docs'
          ? queryClient.prefetchQuery({
              queryKey,
              queryFn: () => readGoalDocs(scope.projectId, scope.goalId),
            })
          : queryClient.prefetchQuery({
              queryKey,
              queryFn: () => readGoalRoute(scope.projectId, scope.goalId),
            })

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
      navigate(buildGoalRoute(scope, nextSurface))
      warmGoalSurface(scope, nextSurface)
    },
    [navigate, warmGoalSurface],
  )
  const goalForProject = useCallback(
    (projectId: string) => {
      const nextProject = snapshot?.projects.find((item) => item.projectId === projectId)
      return resolveProjectGoalId(nextProject?.goals ?? [], projectId, readRecentGoals(projectId))
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
      navigate(buildProjectRoute(projectId))
    },
    [goalForProject, navigate, navigateToGoalSurface, surface],
  )
  const acknowledgeProjectCompletions = useCallback(
    (projectId: string) => {
      const item = snapshot?.projects.find((project) => project.projectId === projectId)
      if (!item) return
      const seen = readSeenProjectCompletions(projectId)
      if (unseenProjectCompletionCount(item.goals, seen) === 0) return
      rememberSeenProjectCompletions(projectId, projectCompletionIdentities(item.goals))
      setCompletionReadVersion((value) => value + 1)
    },
    [snapshot?.projects],
  )
  const warmGoal = useCallback(
    (goalId: string) => {
      if (routeProjectId) warmGoalSurface({ projectId: routeProjectId, goalId }, surface)
    },
    [routeProjectId, surface, warmGoalSurface],
  )
  const selectGoal = useCallback(
    (goalId: string) => {
      if (routeProjectId && goalId !== routeGoalId) {
        navigateToGoalSurface({ projectId: routeProjectId, goalId }, surface)
      }
    },
    [navigateToGoalSurface, routeGoalId, routeProjectId, surface],
  )
  const projectRouteGoalId =
    projectOnlyRoute && routeProjectId ? goalForProject(routeProjectId) : null
  useEffect(() => {
    if (!projectOnlyRoute || !snapshotReady || !routeProjectId) return
    if (!routeProjectExists) {
      navigate('/projects', { replace: true })
      return
    }
    if (projectRouteGoalId) {
      navigateToGoalSurface({ projectId: routeProjectId, goalId: projectRouteGoalId }, surface)
    }
  }, [
    navigate,
    navigateToGoalSurface,
    projectOnlyRoute,
    projectRouteGoalId,
    routeProjectExists,
    routeProjectId,
    snapshotReady,
    surface,
  ])
  const shellContext = useMemo(
    () => ({ openAssistant, selectGoal, warmGoal }),
    [openAssistant, selectGoal, warmGoal],
  )

  if (!routeProjectId) {
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
              <span>Projects</span>
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
                key={assistantScopeKey}
                focusRequest={assistantRequest}
                initialReply={assistantReply}
                isOpen={assistantOpen}
                scope={assistantScope}
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
      <div className={cn('goal-workspace', projectOnlyRoute && 'goal-workspace--project-only')}>
        {shouldRenderAssistant && (
          <Suspense
            fallback={
              <AssistantLoading
                docked={assistantDockedForRoute}
                open={projectOnlyRoute || assistantDocked || assistantOpen}
                onClose={() => setAssistantOpen(false)}
              />
            }
          >
            <AssistantPanel
              key={assistantScopeKey}
              docked={assistantDockedForRoute}
              focusRequest={assistantRequest}
              initialReply={assistantReply}
              isOpen={projectOnlyRoute || assistantDocked || assistantOpen}
              scope={assistantScope}
              snapshot={snapshot}
              onClose={() => setAssistantOpen(false)}
            />
          </Suspense>
        )}

        {routeScope ? (
          <section
            className={cn(
              'goal-workspace-surface',
              surface === 'route' && 'goal-workspace-surface--route',
            )}
          >
            <header className="workspace-topbar">
              <div className="workspace-switchers">
                <PeerSwitcher
                  ariaLabel="Recent Projects"
                  items={projectSwitcherItems}
                  label="Project"
                  moreAriaLabel="More Projects"
                  onActivate={acknowledgeProjectCompletions}
                  onSelectionChange={navigateToProject}
                  onWarm={warmProject}
                  placeholder={snapshot ? 'No Projects' : 'Loading…'}
                  selectedKey={routeScope.projectId}
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
                    id="route"
                    onFocus={() => warmGoalSurface(routeScope, 'route')}
                    onPointerDown={() => warmGoalSurface(routeScope, 'route')}
                    onPointerEnter={() => warmGoalSurface(routeScope, 'route')}
                  >
                    <RouteIcon /> Route
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
                <AppAlert className="global-error">
                  {(snapshotQuery.error as Error).message}
                </AppAlert>
              )}
              <Outlet />
            </main>
          </section>
        ) : (
          <>
            <header className="workspace-topbar project-assistant-topbar">
              <div className="workspace-switchers">
                <PeerSwitcher
                  ariaLabel="Recent Projects"
                  items={projectSwitcherItems}
                  label="Project"
                  moreAriaLabel="More Projects"
                  onActivate={acknowledgeProjectCompletions}
                  onSelectionChange={navigateToProject}
                  onWarm={warmProject}
                  placeholder={snapshot ? 'No Projects' : 'Loading…'}
                  selectedKey={routeProjectId}
                />
              </div>
              <div className="workspace-topbar-actions">
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
            {snapshotQuery.isError && (
              <AppAlert className="global-error project-assistant-global-error">
                {(snapshotQuery.error as Error).message}
              </AppAlert>
            )}
          </>
        )}
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

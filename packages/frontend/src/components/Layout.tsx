import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, FolderOpen, LayoutDashboard, TerminalSquare } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { readProjects } from '../lib/api'
import {
  buildGoalRoute,
  type GoalScope,
  readGoalRouteState,
  readRememberedGoalScope,
  resolveNavigableGoalScope,
  writeRememberedGoalScope,
} from '../lib/goalScope'
import { cn } from '../lib/utils'

const LAST_SCOPED_GOAL_STORAGE_KEY = 'hopi:last-scoped-goal'

export function Layout() {
  const location = useLocation()
  const routeState = readGoalRouteState(location.pathname)
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: readProjects,
  })
  const [rememberedScope, setRememberedScope] = useState<GoalScope | null>(() =>
    readRememberedGoalScope(LAST_SCOPED_GOAL_STORAGE_KEY),
  )

  useEffect(() => {
    if (!routeState.goalKey) {
      return
    }

    const nextScope: GoalScope = {
      projectKey: routeState.projectKey,
      goalKey: routeState.goalKey,
    }
    setRememberedScope(nextScope)
    writeRememberedGoalScope(LAST_SCOPED_GOAL_STORAGE_KEY, nextScope)
  }, [routeState.goalKey, routeState.projectKey])

  const navigableScope = useMemo(
    () =>
      resolveNavigableGoalScope(
        routeState,
        rememberedScope,
        projectsQuery.data?.projects ?? [],
      ),
    [projectsQuery.data?.projects, rememberedScope, routeState],
  )
  const boardHref = buildGoalRoute(navigableScope, 'board')
  const sessionHref = buildGoalRoute(navigableScope, 'session')
  const docsHref = buildGoalRoute(navigableScope, 'docs')
  const hasScopedGoal = Boolean(navigableScope?.goalKey)
  const isProjectsSurface =
    location.pathname.startsWith('/projects') &&
    !location.pathname.includes('/board/') &&
    !location.pathname.includes('/session/') &&
    !location.pathname.includes('/docs/')

  return (
    <div className="min-h-screen flex bg-[#1A1A1A] text-gray-200">
      <aside className="flex w-64 flex-col border-r border-[#333] bg-[#141414]">
        <div className="border-b border-[#333] p-4">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <LayoutDashboard className="h-5 w-5 text-purple-500" />
            HOPI Agent
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <Link
            to="/projects"
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 transition-colors',
              isProjectsSurface
                ? 'bg-purple-500/10 text-purple-400'
                : 'text-gray-400 hover:bg-[#2A2A2A] hover:text-gray-200',
            )}
          >
            <FolderOpen className="h-4 w-4" />
            Projects
          </Link>
          <Link
            to={boardHref}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 transition-colors',
              location.pathname.includes('/board/')
                ? 'bg-purple-500/10 text-purple-400'
                : hasScopedGoal
                  ? 'text-gray-400 hover:bg-[#2A2A2A] hover:text-gray-200'
                  : 'text-gray-600',
            )}
          >
            <LayoutDashboard className="h-4 w-4" />
            Kanban Board
          </Link>
          <Link
            to={sessionHref}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 transition-colors',
              location.pathname.includes('/session/')
                ? 'bg-purple-500/10 text-purple-400'
                : hasScopedGoal
                  ? 'text-gray-400 hover:bg-[#2A2A2A] hover:text-gray-200'
                  : 'text-gray-600',
            )}
          >
            <TerminalSquare className="h-4 w-4" />
            Active Sessions
          </Link>
          <Link
            to={docsHref}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 transition-colors',
              location.pathname.includes('/docs/')
                ? 'bg-purple-500/10 text-purple-400'
                : hasScopedGoal
                  ? 'text-gray-400 hover:bg-[#2A2A2A] hover:text-gray-200'
                  : 'text-gray-600',
            )}
          >
            <FileText className="h-4 w-4" />
            Goal Docs
          </Link>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

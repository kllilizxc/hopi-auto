import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, FolderOpen, LayoutDashboard, TerminalSquare } from 'lucide-react';
import { readProjects, type ProjectRecord } from '../lib/api';
import { cn } from '../lib/utils';

const LAST_SCOPED_GOAL_STORAGE_KEY = 'hopi:last-scoped-goal';

export function Layout() {
  const location = useLocation();
  const routeState = readRouteState(location.pathname);
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: readProjects,
  });
  const [rememberedScope, setRememberedScope] = useState<GoalScope | null>(() =>
    readRememberedGoalScope(),
  );

  useEffect(() => {
    if (!routeState.goalKey) {
      return;
    }

    const nextScope: GoalScope = {
      projectKey: routeState.projectKey,
      goalKey: routeState.goalKey,
    };
    setRememberedScope(nextScope);
    writeRememberedGoalScope(nextScope);
  }, [routeState.goalKey, routeState.projectKey]);

  const navigableScope = useMemo(
    () =>
      resolveNavigableScope(routeState, rememberedScope, projectsQuery.data?.projects ?? []),
    [projectsQuery.data?.projects, rememberedScope, routeState],
  );
  const boardHref = buildScopedHref(navigableScope, 'board');
  const sessionHref = buildScopedHref(navigableScope, 'session');
  const docsHref = buildScopedHref(navigableScope, 'docs');
  const hasScopedGoal = Boolean(navigableScope?.goalKey);
  const isProjectsSurface =
    location.pathname.startsWith('/projects') &&
    !location.pathname.includes('/board/') &&
    !location.pathname.includes('/session/') &&
    !location.pathname.includes('/docs/');

  return (
    <div className="min-h-screen bg-[#1A1A1A] text-gray-200 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[#141414] border-r border-[#333] flex flex-col">
        <div className="p-4 border-b border-[#333]">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-purple-500" />
            HOPI Agent
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <Link
            to="/projects"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
              isProjectsSurface
                ? "bg-purple-500/10 text-purple-400"
                : "hover:bg-[#2A2A2A] text-gray-400 hover:text-gray-200"
            )}
          >
            <FolderOpen className="w-4 h-4" />
            Projects
          </Link>
          <Link
            to={boardHref}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
              location.pathname.includes('/board/')
                ? "bg-purple-500/10 text-purple-400"
                : hasScopedGoal
                  ? "hover:bg-[#2A2A2A] text-gray-400 hover:text-gray-200"
                  : "text-gray-600"
            )}
          >
            <LayoutDashboard className="w-4 h-4" />
            Kanban Board
          </Link>
          <Link
            to={sessionHref}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
              location.pathname.includes('/session/')
                ? "bg-purple-500/10 text-purple-400"
                : hasScopedGoal
                  ? "hover:bg-[#2A2A2A] text-gray-400 hover:text-gray-200"
                  : "text-gray-600"
            )}
          >
            <TerminalSquare className="w-4 h-4" />
            Active Sessions
          </Link>
          <Link
            to={docsHref}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
              location.pathname.includes('/docs/')
                ? "bg-purple-500/10 text-purple-400"
                : hasScopedGoal
                  ? "hover:bg-[#2A2A2A] text-gray-400 hover:text-gray-200"
                  : "text-gray-600"
            )}
          >
            <FileText className="w-4 h-4" />
            Goal Docs
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

interface RouteState {
  projectKey: string | null;
  goalKey: string | null;
}

interface GoalScope extends RouteState {
  goalKey: string;
}

function readRouteState(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length >= 4 && parts[0] === 'projects') {
    const projectKey = decodeURIComponent(parts[1] ?? '');
    const leaf = parts[2];
    if ((leaf === 'board' || leaf === 'session' || leaf === 'docs') && parts[3]) {
      return {
        projectKey,
        goalKey: decodeURIComponent(parts[3]),
      };
    }
    return {
      projectKey,
      goalKey: null,
    };
  }

  if (parts.length >= 2 && (parts[0] === 'board' || parts[0] === 'session' || parts[0] === 'docs')) {
    return {
      goalKey: decodeURIComponent(parts[1]),
      projectKey: null,
    };
  }

  return {
    goalKey: null,
    projectKey: null,
  };
}

function resolveNavigableScope(
  routeState: RouteState,
  rememberedScope: GoalScope | null,
  projects: ProjectRecord[],
): GoalScope | null {
  if (routeState.goalKey) {
    return {
      projectKey: routeState.projectKey,
      goalKey: routeState.goalKey,
    };
  }

  if (routeState.projectKey) {
    const project = projects.find((entry) => entry.projectKey === routeState.projectKey);
    if (project?.lastOpenedGoalKey) {
      return {
        projectKey: routeState.projectKey,
        goalKey: project.lastOpenedGoalKey,
      };
    }
    return null;
  }

  if (rememberedScope) {
    return rememberedScope;
  }

  const fallbackProject = projects.find((entry) => entry.lastOpenedGoalKey);
  if (!fallbackProject?.lastOpenedGoalKey) {
    return null;
  }

  return {
    projectKey: fallbackProject.projectKey,
    goalKey: fallbackProject.lastOpenedGoalKey,
  };
}

function buildScopedHref(scope: GoalScope | null, leaf: 'board' | 'session' | 'docs') {
  if (!scope) {
    return '/projects';
  }

  if (scope.projectKey) {
    return `/projects/${scope.projectKey}/${leaf}/${scope.goalKey}`;
  }

  return `/${leaf}/${scope.goalKey}`;
}

function readRememberedGoalScope(): GoalScope | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(LAST_SCOPED_GOAL_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as RouteState;
    if (!parsed.goalKey) {
      return null;
    }
    return {
      projectKey: parsed.projectKey ?? null,
      goalKey: parsed.goalKey,
    };
  } catch {
    return null;
  }
}

function writeRememberedGoalScope(scope: GoalScope) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(LAST_SCOPED_GOAL_STORAGE_KEY, JSON.stringify(scope));
}

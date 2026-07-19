import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AppLoadingNotice } from './components/ui'
import { initializeMessageStreamCache } from './lib/messageStreamCache'
import {
  loadBoardView,
  loadGoalCreatePage,
  loadGoalDocsPage,
  loadProjectHomePage,
} from './routeModules'
import { NAVIGATION_CACHE_GC_INTERVAL_MS } from './lib/queryPerformance'

initializeMessageStreamCache()

const BoardView = lazy(() =>
  loadBoardView().then((module) => ({ default: module.BoardView })),
)
const GoalDocsPage = lazy(() =>
  loadGoalDocsPage().then((module) => ({ default: module.GoalDocsPage })),
)
const GoalCreatePage = lazy(() =>
  loadGoalCreatePage().then((module) => ({ default: module.GoalCreatePage })),
)
const ProjectHomePage = lazy(() =>
  loadProjectHomePage().then((module) => ({ default: module.ProjectHomePage })),
)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: NAVIGATION_CACHE_GC_INTERVAL_MS,
      staleTime: 1_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="projects" element={<RouteBoundary><ProjectHomePage /></RouteBoundary>} />
            <Route
              path="projects/:projectId/goals/new"
              element={<RouteBoundary><GoalCreatePage /></RouteBoundary>}
            />
            <Route
              path="projects/:projectId/board/:goalId"
              element={<RouteBoundary><BoardView /></RouteBoundary>}
            />
            <Route
              path="projects/:projectId/docs/:goalId"
              element={<RouteBoundary><GoalDocsPage /></RouteBoundary>}
            />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function RouteBoundary({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<RouteLoading />}>
      {children}
    </Suspense>
  )
}

function RouteLoading() {
  return (
    <AppLoadingNotice
      detail="Loading this surface…"
      label="Opening workspace"
    />
  )
}

export default App

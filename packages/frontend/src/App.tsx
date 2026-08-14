import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AppLoadingNotice } from './components/ui'
import { initializeMessageStreamCache } from './lib/messageStreamCache'
import { initializeNavigationCache } from './lib/navigationCache'
import { NAVIGATION_CACHE_GC_INTERVAL_MS } from './lib/queryPerformance'
import {
  loadRouteView,
  loadGoalDocsPage,
  loadProjectHomePage,
} from './routeModules'

initializeMessageStreamCache()

const RouteView = lazy(() =>
  loadRouteView().then((module) => ({ default: module.RouteView })),
)
const GoalDocsPage = lazy(() =>
  loadGoalDocsPage().then((module) => ({ default: module.GoalDocsPage })),
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
initializeNavigationCache(queryClient)

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="projects" element={<RouteBoundary><ProjectHomePage /></RouteBoundary>} />
            <Route path="projects/:projectId" element={null} />
            <Route
              path="projects/:projectId/goals/new"
              element={<Navigate to="../.." relative="path" replace />}
            />
            <Route
              path="projects/:projectId/route/:goalId"
              element={<RouteBoundary><RouteView /></RouteBoundary>}
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

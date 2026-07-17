import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'

const BoardView = lazy(() =>
  import('./pages/BoardView').then((module) => ({ default: module.BoardView })),
)
const GoalDocsPage = lazy(() =>
  import('./pages/GoalDocsPage').then((module) => ({ default: module.GoalDocsPage })),
)
const GoalCreatePage = lazy(() =>
  import('./pages/GoalCreatePage').then((module) => ({ default: module.GoalCreatePage })),
)
const ProjectHomePage = lazy(() =>
  import('./pages/ProjectHomePage').then((module) => ({ default: module.ProjectHomePage })),
)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
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
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading-mark" aria-hidden="true" />
      <strong>Opening workspace</strong>
      <small>Loading this surface…</small>
    </div>
  )
}

export default App

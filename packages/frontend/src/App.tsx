import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { BoardView } from './pages/BoardView'
import { GoalDocsPage } from './pages/GoalDocsPage'
import { GoalCreatePage } from './pages/GoalCreatePage'
import { ProjectHomePage } from './pages/ProjectHomePage'

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
            <Route path="projects" element={<ProjectHomePage />} />
            <Route path="projects/:projectId/goals/new" element={<GoalCreatePage />} />
            <Route
              path="projects/:projectId/board/:goalId"
              element={<BoardView />}
            />
            <Route
              path="projects/:projectId/docs/:goalId"
              element={<GoalDocsPage />}
            />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App

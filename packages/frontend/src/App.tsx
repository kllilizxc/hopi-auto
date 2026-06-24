import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { BoardView } from './pages/BoardView'
import { GoalDocsPage } from './pages/GoalDocsPage'
import { GoalCreatePage } from './pages/GoalCreatePage'
import { ProjectHomePage } from './pages/ProjectHomePage'
import { SessionView } from './pages/SessionView'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
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
            <Route path="projects/:projectKey/goals/new" element={<GoalCreatePage />} />
            <Route
              path="projects/:projectKey/board/:goalKey"
              element={<BoardView />}
            />
            <Route
              path="projects/:projectKey/docs/:goalKey"
              element={<GoalDocsPage />}
            />
            <Route
              path="projects/:projectKey/session/:goalKey"
              element={<SessionView />}
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App

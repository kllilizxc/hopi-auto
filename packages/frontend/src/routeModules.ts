export const loadRouteView = () => import('./pages/RouteView')
export const loadGoalDocsPage = () => import('./pages/GoalDocsPage')
export const loadProjectHomePage = () => import('./pages/ProjectHomePage')
export const loadAssistantPanel = () => import('./components/AssistantPanel')

export const preloadRouteView = () => void loadRouteView()
export const preloadGoalDocsPage = () => void loadGoalDocsPage()
export const preloadProjectHomePage = () => void loadProjectHomePage()
export const preloadAssistantPanel = () => void loadAssistantPanel()

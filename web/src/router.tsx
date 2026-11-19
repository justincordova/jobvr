import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { CompaniesPage } from '@/features/companies/companies-page'
import { FeedPage } from '@/features/feed/feed-page'
import { parseFeedSearch } from '@/features/feed/search'
import { LogsPage } from '@/features/logs/logs-page'
import { SettingsPage } from '@/features/settings/settings-page'

const rootRoute = createRootRoute({ component: AppShell })

const feedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseFeedSearch,
  component: FeedPage,
})

// Applied was its own page for a while; old links and home-screen shortcuts land on the view
const appliedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/applied',
  validateSearch: parseFeedSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/', search: { ...search, view: 'applied' }, replace: true })
  },
})

const companiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/companies',
  component: CompaniesPage,
})

// Companies are added automatically now; old links to Suggested land on Companies
const suggestedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suggested',
  beforeLoad: () => {
    throw redirect({ to: '/companies', replace: true })
  },
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
})

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: LogsPage,
})

const routeTree = rootRoute.addChildren([
  feedRoute,
  appliedRoute,
  companiesRoute,
  suggestedRoute,
  settingsRoute,
  logsRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
})
export { feedRoute }

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

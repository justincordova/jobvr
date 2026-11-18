import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { CompaniesPage } from '@/features/companies/companies-page'
import { AppliedPage, FeedPage } from '@/features/feed/feed-page'
import { parseAppliedSearch, parseFeedSearch } from '@/features/feed/search'
import { LogsPage } from '@/features/logs/logs-page'
import { SettingsPage } from '@/features/settings/settings-page'

const rootRoute = createRootRoute({ component: AppShell })

const feedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseFeedSearch,
  // Applied used to be a view of the feed; old links and bookmarks still work
  beforeLoad: ({ search }) => {
    if (search.view === 'applied') {
      throw redirect({ to: '/applied', search: { ...search, view: undefined }, replace: true })
    }
  },
  component: FeedPage,
})

const appliedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/applied',
  validateSearch: parseAppliedSearch,
  component: AppliedPage,
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

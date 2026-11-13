import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { ApplicationsPage } from '@/features/applications/applications-page'
import { CompaniesPage } from '@/features/companies/companies-page'
import { FeedPage } from '@/features/feed/feed-page'
import { parseFeedSearch } from '@/features/feed/search'
import { SettingsPage } from '@/features/settings/settings-page'
import { SuggestedPage } from '@/features/suggested/suggested-page'

const rootRoute = createRootRoute({ component: AppShell })

const feedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseFeedSearch,
  component: FeedPage,
})

const applicationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/applications',
  component: ApplicationsPage,
})

const companiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/companies',
  component: CompaniesPage,
})

const suggestedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suggested',
  component: SuggestedPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  feedRoute,
  applicationsRoute,
  companiesRoute,
  suggestedRoute,
  settingsRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })
export { feedRoute }

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

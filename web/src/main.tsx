import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from '@/components/toast'
import { router } from '@/router'
import { setupPwaUpdates } from '@/lib/pwa'
import '@/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    // Offline, still ask: reads get the service worker's saved copy (or fail),
    // writes fail fast so the rollback and "Can't reach jobvr" toast run, instead
    // of pausing quietly until the browser says it's back online
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'always' },
  },
})

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in the document')
}

setupPwaUpdates()

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
)

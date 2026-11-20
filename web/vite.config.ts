/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The app offers "Reload" (src/lib/pwa.ts) instead of swapping code mid-edit
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'jobvr',
        short_name: 'jobvr',
        description: 'New-grad SWE roles from your companies, as they post.',
        theme_color: '#0e1115',
        background_color: '#0e1115',
        display: 'standalone',
        id: '/',
        scope: '/',
        start_url: '/',
        // Long-press the home-screen icon
        shortcuts: [
          {
            name: 'Saved',
            url: '/?view=saved',
            icons: [{ src: '/pwa-192.png', sizes: '192x192' }],
          },
          {
            name: 'Applied',
            url: '/?view=applied',
            icons: [{ src: '/pwa-192.png', sizes: '192x192' }],
          },
        ],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is precached; API reads fall back to their last response offline
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health/, /^\/reference/, /^\/openapi\.json/],
        runtimeCaching: [
          {
            // Readable offline (subway): always the network first; the last
            // response only when the request fails. Writes are never cached.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              /^\/api\/(jobs|settings|companies)(\/|$)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'jobvr-api',
              // A dead subway signal can hang a request for a minute; fall back after 6 s
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  // Marks a fallback copy so the app can say it's showing saved data
                  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
                    if (!cachedResponse) return cachedResponse
                    const headers = new Headers(cachedResponse.headers)
                    headers.set('X-Jobvr-Offline', '1')
                    return new Response(await cachedResponse.blob(), {
                      status: cachedResponse.status,
                      headers,
                    })
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // React + TanStack land around 165 kB gzip; the PWA caches it after the first load
    chunkSizeWarningLimit: 700,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})

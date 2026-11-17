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
        // App shell only: API calls always go to the network
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health/, /^\/reference/, /^\/openapi\.json/],
        runtimeCaching: [],
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

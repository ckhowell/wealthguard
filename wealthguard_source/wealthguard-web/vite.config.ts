import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'WealthGuard',
        short_name: 'WealthGuard',
        description: 'Personal wealth & intelligence terminal',
        theme_color: '#f59e0b', // amber-500 — single brand accent
        background_color: '#0c0a09',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/favicon.svg', sizes: '192x192 512x512', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [
          // Google Fonts — cache-first, 1 year
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // Read-heavy API calls — stale-while-revalidate so offline still renders the
          // last known state but fresh data lands on next tick.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/holdings') ||
              url.pathname.startsWith('/api/portfolio/summary') ||
              url.pathname.startsWith('/api/fx-rates/latest') ||
              url.pathname.startsWith('/api/accounts') ||
              url.pathname.startsWith('/api/net-worth/history') ||
              url.pathname.startsWith('/api/podbits/narratives') ||
              url.pathname.startsWith('/api/podbits/facets') ||
              url.pathname.startsWith('/api/health'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'wg-api',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 },
            },
            method: 'GET',
          },
          // Mutations + heavy endpoints — network only, never cache
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/transactions/import') ||
              url.pathname.startsWith('/api/export/all') ||
              url.pathname.startsWith('/api/podbits/episodes/') ||
              url.pathname.startsWith('/api/podbits/analyze'),
            handler: 'NetworkOnly',
            method: 'GET',
          },
        ],
      },
      devOptions: {
        enabled: false, // keep dev server clean; SW only in prod builds
      },
    }),
  ],
  server: {
    host: true,
    allowedHosts: [
      'given-ethics-part-gauge.trycloudflare.com',
      'mortgages-sufficiently-hist-homework.trycloudflare.com',
      'concept-spice-invitations-building.trycloudflare.com',
      '.trycloudflare.com',
      'localhost',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  define: {
    // Use relative paths for production - empty string means same-origin
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || ''),
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    allowedHosts: true,
    proxy: {
      '/api/v1/auth': 'http://localhost:8086',
      '/api/v1': 'http://localhost:8088',
    },
  },
  plugins: [
    react(),
    VitePWA({
      injectRegister: false,
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 3,
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 16,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: ({ request }) => ['script', 'style', 'worker'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-assets',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: ({ request }) => ['image', 'font'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'media-assets',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 256,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Guide Helper',
        short_name: 'Guide Helper',
        description: 'Create, publish, and revisit tourist routes with photos on an interactive map',
        id: '/',
        lang: 'ru',
        start_url: '/map',
        scope: '/',
        theme_color: '#1a1a2e',
        background_color: '#121225',
        display: 'standalone',
        categories: ['travel', 'navigation', 'photo'],
        shortcuts: [
          {
            name: 'Карта',
            short_name: 'Карта',
            url: '/map',
            icons: [
              {
                src: 'pwa-192x192.png',
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
          {
            name: 'Каталог',
            short_name: 'Каталог',
            url: '/explore',
            icons: [
              {
                src: 'pwa-192x192.png',
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
        ],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})

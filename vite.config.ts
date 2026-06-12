import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',

        // Service worker strategy: cache app shell + assets on install
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],

          // Raised from the 2 MiB default — the app bundle legitimately exceeds
          // 2 MiB due to PDF (jsPDF), offline DB (Dexie), charts (Recharts) and
          // the Supabase client. manualChunks below splits the build so that
          // individual chunks stay well under this ceiling, but we keep a
          // generous safety net for future growth.
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MiB

          // Do NOT cache Supabase API calls — always go to network for live data
          navigateFallback: 'index.html',
          runtimeCaching: [
            {
              // Cache Google Fonts and other CDN assets
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },

        // Web App Manifest
        manifest: {
          name: 'GharbFeed',
          short_name: 'GharbFeed',
          description: 'Système de gestion de stock et caisse — Alimentation animale',
          theme_color: '#10b981',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait-primary',
          scope: '/',
          start_url: '/',
          icons: [
            {
              src: 'logo.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable',
            },
            {
              src: 'logo.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
      }),
    ],

    build: {
      rollupOptions: {
        output: {
          // Split heavyweight vendor libraries into separate chunks so that:
          //   1. Each chunk stays well below the 10 MiB workbox ceiling.
          //   2. Browsers can cache unchanged chunks across deployments.
          manualChunks(id: string) {
            // ── PDF generation (jsPDF + autotable) ─────────────────────────
            if (id.includes('jspdf') || id.includes('jspdf-autotable')) {
              return 'vendor-pdf';
            }
            // ── Excel export (SheetJS / xlsx) ───────────────────────────────
            if (id.includes('/xlsx/') || id.includes('\\xlsx\\') || id.includes('sheetjs')) {
              return 'vendor-xlsx';
            }
            // ── Charts (Recharts + d3 utilities it pulls in) ────────────────
            if (id.includes('recharts') || id.includes('/d3-') || id.includes('\\d3-')) {
              return 'vendor-charts';
            }
            // ── Supabase client ─────────────────────────────────────────────
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            // ── Offline DB (Dexie + dexie-react-hooks) ──────────────────────
            if (id.includes('dexie')) {
              return 'vendor-dexie';
            }
            // ── Animation (Framer Motion) ───────────────────────────────────
            if (id.includes('framer-motion') || id.includes('motion/react')) {
              return 'vendor-motion';
            }
            // ── React ecosystem (router, dom) ───────────────────────────────
            if (id.includes('react-router') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            // ── Everything else from node_modules ───────────────────────────
            if (id.includes('node_modules')) {
              return 'vendor-misc';
            }
            // App source code falls into the default entry chunk
          },
        },
      },
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

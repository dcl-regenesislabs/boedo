import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sceneShims, sceneSrc } from '../ui/vite.config'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  // every URL the bundle emits is relative to editor.js: the package is served
  // from whatever directory the host page mounts it at
  base: './',
  resolve: {
    alias: { '@scene': sceneSrc, '@ui': path.resolve(here, '../ui/src') }
  },
  plugins: [sceneShims(), react()],
  define: {
    'process.env.NODE_ENV': '"production"',
    __EDITOR_UI_BUILD__: JSON.stringify(new Date().toISOString())
  },
  build: {
    outDir: 'dist',
    // dist/scene-compiler and dist/scene are written by others (scripts/build.mjs)
    emptyOutDir: false,
    cssCodeSplit: false,
    // fonts inside editor.css, so its hash covers them: a CSS url() cannot carry one
    assetsInlineLimit: () => true,
    rollupOptions: {
      input: path.resolve(here, 'src/main.tsx'),
      output: {
        format: 'es',
        // a lazily imported chunk could not be held to a hash (scripts/build.mjs refuses one)
        inlineDynamicImports: true,
        entryFileNames: 'editor.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) => (asset.name?.endsWith('.css') ? 'editor.css' : 'assets/[name]-[hash][extname]')
      }
    }
  }
})

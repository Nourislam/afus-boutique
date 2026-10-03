import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Content-Security-Policy for the renderer.
// - img-src: product/logo images are served by the custom app:// protocol or as data: URIs
// - frame-src data:: receipt/label previews are rendered in data: iframes
// - style-src 'unsafe-inline': React style attributes
// Nothing is loaded from the internet: the POS must work offline.
const BASE_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: app:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
]

const PRODUCTION_CSP = [...BASE_CSP, "script-src 'self'", "connect-src 'self'"].join('; ')

// The Vite dev server injects an inline React-refresh preamble and uses a
// websocket for hot reload; 'unsafe-eval' is still not allowed.
const DEV_CSP = [
  ...BASE_CSP,
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws://localhost:5173 http://localhost:5173",
].join('; ')

function contentSecurityPolicy() {
  let isBuild = false
  return {
    name: 'app-content-security-policy',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    transformIndexHtml(html) {
      return html.replace('content="%APP_CSP%"', `content="${isBuild ? PRODUCTION_CSP : DEV_CSP}"`)
    },
  }
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
})

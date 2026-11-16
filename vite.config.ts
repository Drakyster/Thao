import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Link previews (iMessage, Instagram, Messenger, WhatsApp...) need absolute
 * URLs for og:image. The GitHub Actions workflow passes the Pages URL in
 * SITE_URL; locally it is unset, so those tags are simply dropped.
 */
function siteUrl(): Plugin {
  const url = (process.env.SITE_URL ?? '').replace(/\/+$/, '')
  return {
    name: 'site-url',
    transformIndexHtml(html) {
      return url
        ? html.replaceAll('__SITE_URL__', url)
        : html.replace(/^[ \t]*<meta[^>]*__SITE_URL__[^>]*>\r?\n/gm, '')
    },
  }
}

// `base: './'` makes every asset path relative, so the build works at
// https://<user>.github.io/<any-repo-name>/ without knowing the repo name.
export default defineConfig({
  base: './',
  plugins: [react(), siteUrl()],
  build: {
    // Keep the CSS readable by older iPhones too (iOS 15.4+): the minifier then
    // keeps fallbacks such as 100vh before 100dvh, and writes media queries as
    // (max-height: 500px) instead of the range syntax Safari only reads since 16.4.
    cssTarget: ['safari15.4', 'ios15.4', 'chrome107', 'firefox104'],
    // the whole film is one bundle on purpose (about 170 kB gzipped, less than the photos)
    chunkSizeWarningLimit: 700,
  },
})

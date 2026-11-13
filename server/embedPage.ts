import type { Express } from 'express'
import path from 'node:path'
import { embedHostOrigins } from './embed.ts'

/**
 * The review panel's page (embed.html, src/embed): what host apps put in an
 * iframe. Served at /embed only while some host is configured, and only to
 * be framed by those hosts: `frame-ancestors` names their origins, so no
 * other site can wrap the panel to trick a reviewer into a click (the
 * session it holds can comment and give verdicts). The page is not cached,
 * so a host added or removed takes effect at once, and the raw file is not
 * reachable under its own name without these headers.
 */
export function embedFrameAncestors(origins: readonly string[]): string {
  return `frame-ancestors ${origins.join(' ')}`
}

export function serveEmbedPage(app: Express, dist: string): void {
  app.get(['/embed.html'], (_req, res) => res.sendStatus(404))
  app.get('/embed', (_req, res) => {
    const origins = embedHostOrigins()
    if (!origins.length) return res.sendStatus(404)
    res.set('Content-Security-Policy', embedFrameAncestors(origins))
    res.set('Cache-Control', 'no-store')
    res.set('Referrer-Policy', 'no-referrer')
    res.sendFile(path.join(dist, 'embed.html'))
  })
}

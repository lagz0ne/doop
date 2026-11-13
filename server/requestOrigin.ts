import type express from 'express'
import { env } from './env.ts'

/**
 * The origin a client reached this server at, for documents that must name it
 * back (OAuth protected-resource metadata, the MCP 401 challenge).
 *
 * A request for the configured public host gets BETTER_AUTH_URL's own origin.
 * A proxy in front may speak plain http to us and set (or overwrite)
 * X-Forwarded-Proto to http while every client uses https; echoing
 * req.protocol then publishes http:// URLs, and strict MCP clients refuse a
 * resource that differs from the https URL they called.
 *
 * Any other host (dev on :4300/:4301/:4400, a preview alias) is echoed from the
 * request as before, so those still validate.
 */
export function requestOrigin(req: express.Request): string {
  const host = req.get('host')
  const canonical = new URL(env.BETTER_AUTH_URL)
  if (host && host.toLowerCase() === canonical.host.toLowerCase()) return canonical.origin
  return `${req.protocol}://${host}`
}

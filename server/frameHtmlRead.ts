/* A bounded read of a frame's HTML, for agents: a frame's source runs to tens
   of kilobytes (inlined CSS, fonts, token blocks), most of which an edit does
   not touch. The resident agent's get_frame_html and MCP get_frame share it. */

export const MAX_HTML_READ_CHARS = 30_000
const DEFAULT_READ_CHARS = 20_000
const MAX_MATCHES = 5

export type HtmlRead = { ok: true; text: string } | { ok: false; error: string }

/** Up to five snippets around a literal query (case-insensitive), or the
 *  characters from offset, at most `limit` in all (1,000 to 30,000). */
export function readFrameHtml(html: string, opts: { query?: string; offset?: number; limit?: number }): HtmlRead {
  const query = String(opts.query || '').trim()
  const limit = Math.max(1000, Math.min(Number(opts.limit) || DEFAULT_READ_CHARS, MAX_HTML_READ_CHARS))
  if (query) {
    const haystack = html.toLowerCase()
    const needle = query.toLowerCase()
    const matches: number[] = []
    let cursor = 0
    while (matches.length < MAX_MATCHES) {
      const index = haystack.indexOf(needle, cursor)
      if (index < 0) break
      matches.push(index)
      cursor = index + Math.max(needle.length, 1)
    }
    if (matches.length === 0) return { ok: false, error: `query not found in frame HTML: ${query}` }
    const perMatch = Math.max(1000, Math.floor(limit / matches.length))
    const snippets = matches.map((index, match) => {
      const start = Math.max(0, index - Math.floor(perMatch / 2))
      const end = Math.min(html.length, start + perMatch)
      return `--- match ${match + 1} at ${index}, chars ${start}-${end} ---\n${html.slice(start, end)}`
    })
    return {
      ok: true,
      text: `Frame HTML: ${html.length} characters; ${matches.length} match(es) for "${query}".\n${snippets.join('\n')}`,
    }
  }
  const offset = Math.max(0, Math.min(Number(opts.offset) || 0, html.length))
  const end = Math.min(html.length, offset + limit)
  return {
    ok: true,
    text: `Frame HTML: ${html.length} characters. Returning chars ${offset}-${end}.${end < html.length ? ` Continue with offset=${end}, or use query for a targeted snippet.` : ''}\n\n${html.slice(offset, end)}`,
  }
}

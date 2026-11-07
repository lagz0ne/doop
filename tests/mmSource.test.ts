import { createHash, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LINK_STYLE, SOURCE_PAGE, allowLinkStyle, loadGatewayConfig, sourceLink, sourceOf, withSourceLink } from '../server/mmGateway.ts'

/* mm fork: the public side's "Source" link (the AGPL's section 13; server/mmGateway.ts) */
const TAG = 'v0.12.0-mm.2'
const URL_AT_TAG = `https://git.example.test/someone/doop/tree/${TAG}`
const HASH = `'sha256-${createHash('sha256').update(LINK_STYLE).digest('base64')}'`

describe('sourceOf', () => {
  it('takes the URL and the tag mm gives', () => {
    expect(sourceOf({ DOOP_SOURCE_URL: URL_AT_TAG, DOOP_SOURCE_TAG: TAG })).toEqual({ tag: TAG, url: URL_AT_TAG })
  })
  it('without a URL: this side\'s own page, named by the tag', () => {
    expect(sourceOf({ DOOP_SOURCE_TAG: TAG })).toEqual({ tag: TAG, url: `${SOURCE_PAGE}/${TAG}` })
    expect(sourceOf({}).url).toBe(`${SOURCE_PAGE}/unknown`)
  })
  it('refuses a URL that is not http(s), or carries credentials, and a tag that is not plain', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'https://u:p@git.example.test/x', 'not a url']) {
      expect(sourceOf({ DOOP_SOURCE_URL: u, DOOP_SOURCE_TAG: TAG }).url).toBe(`${SOURCE_PAGE}/${TAG}`)
    }
    expect(sourceOf({ DOOP_SOURCE_TAG: '"><script>' }).tag).toBe('unknown')
  })
  it('is part of the gateway config', () => {
    const pem = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) as string
    const c = loadGatewayConfig({ MM_GATEWAY_PUBLIC_KEY: pem, MM_GATEWAY_HOST: 'doop.example.test', DOOP_SOURCE_URL: URL_AT_TAG, DOOP_SOURCE_TAG: TAG })
    expect(c?.source).toEqual({ tag: TAG, url: URL_AT_TAG })
  })
})

describe('the link in a page', () => {
  it('goes just before </body>, once, escaped', () => {
    const page = withSourceLink('<!doctype html><html><body><div id="root"></div></BODY></html>', URL_AT_TAG)
    expect(page).toMatch(new RegExp(`<a id="mm-source" href="${URL_AT_TAG}"[^>]*>Source</a></BODY></html>$`))
    expect(page.match(/mm-source/g)?.length).toBe(1)
    expect(sourceLink('https://x.test/?a="b"&c<d>')).toContain('href="https://x.test/?a=&#34;b&#34;&#38;c&#60;d&#62;"')
  })
  it('at the end of a page with no </body>', () => {
    expect(withSourceLink('<p>x</p>', '/x')).toMatch(/<p>x<\/p><a id="mm-source"/)
  })
})

describe('allowLinkStyle', () => {
  it('leaves a policy alone where the style attribute already passes, or nothing checks it', () => {
    expect(allowLinkStyle("script-src 'self'")).toBe("script-src 'self'")
    expect(allowLinkStyle("default-src 'self'; style-src 'self' 'unsafe-inline'")).toBe("default-src 'self'; style-src 'self' 'unsafe-inline'")
  })
  it('adds the hash to style-src (or style-src-attr), and to a copy of default-src', () => {
    expect(allowLinkStyle("default-src 'self'; style-src 'self'")).toBe(`default-src 'self'; style-src 'self' 'unsafe-hashes' ${HASH}`)
    expect(allowLinkStyle("style-src 'self'; style-src-attr 'none'")).toBe(`style-src 'self'; style-src-attr 'unsafe-hashes' ${HASH}`)
    expect(allowLinkStyle("default-src 'self'")).toBe(`default-src 'self'; style-src-attr 'self' 'unsafe-hashes' ${HASH}`)
  })
  it("with a nonce or hash, 'unsafe-inline' does not count: the hash goes in", () => {
    expect(allowLinkStyle("style-src 'self' 'unsafe-inline' 'nonce-abc'")).toBe(`style-src 'self' 'unsafe-inline' 'nonce-abc' 'unsafe-hashes' ${HASH}`)
  })
})

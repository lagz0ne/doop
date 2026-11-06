import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { capFor, gatewayCap, loadGatewayConfig, pathOf, verifyAssertion } from '../server/mmGateway.ts'

/* mm fork: the sign-in gateway's assertion (server/mmGateway.ts), signed the
   way mm's gateway signs it: base64url(JSON {u, r, h, exp, n}) "." Ed25519 */
const gw = generateKeyPairSync('ed25519')
const other = generateKeyPairSync('ed25519')
const HOST = 'doop.acme.example.com'
const now = 1_800_000_000_000
const signWith = (key: typeof gw.privateKey, claims: Record<string, unknown>) => {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`
}
const good = { u: 'alice', r: 'designer', h: HOST, exp: now + 60_000, n: 'abc123' }

describe('verifyAssertion', () => {
  it('accepts the gateway signature for this host', () => {
    expect(verifyAssertion(signWith(gw.privateKey, good), gw.publicKey, HOST, now)).toEqual({ u: 'alice', r: 'designer' })
  })
  it('refuses another key, a changed body, no assertion', () => {
    expect(verifyAssertion(signWith(other.privateKey, good), gw.publicKey, HOST, now)).toBeNull()
    const [, sig] = signWith(gw.privateKey, good).split('.')
    const forged = Buffer.from(JSON.stringify({ ...good, r: 'owner' })).toString('base64url')
    expect(verifyAssertion(`${forged}.${sig}`, gw.publicKey, HOST, now)).toBeNull()
    for (const v of [undefined, '', '-', 'a.b', 'a.b.c', ['x', 'y']]) expect(verifyAssertion(v, gw.publicKey, HOST, now)).toBeNull()
  })
  it('refuses another host, an old exp, an unknown role, a bad name', () => {
    expect(verifyAssertion(signWith(gw.privateKey, { ...good, h: 'board.acme.example.com' }), gw.publicKey, HOST, now)).toBeNull()
    expect(verifyAssertion(signWith(gw.privateKey, { ...good, exp: now }), gw.publicKey, HOST, now)).toBeNull()
    expect(verifyAssertion(signWith(gw.privateKey, { ...good, exp: String(now + 60_000) }), gw.publicKey, HOST, now)).toBeNull()
    expect(verifyAssertion(signWith(gw.privateKey, { ...good, r: 'admin' }), gw.publicKey, HOST, now)).toBeNull()
    for (const u of ['Alice', 'a', '1bob', 'bob@x', 'x'.repeat(33), 7]) {
      expect(verifyAssertion(signWith(gw.privateKey, { ...good, u }), gw.publicKey, HOST, now)).toBeNull()
    }
  })
})

describe('roles', () => {
  it('owner and designer edit; member and viewer look', () => {
    expect(capFor('owner')).toBe('edit')
    expect(capFor('designer')).toBe('edit')
    expect(capFor('member')).toBe('view')
    expect(capFor('viewer')).toBe('view')
  })
  it('no gateway role for someone the gateway never let in', () => {
    expect(gatewayCap('nobody')).toBeUndefined()
    expect(gatewayCap(undefined)).toBeUndefined()
  })
})

describe('pathOf', () => {
  it('reads a path the way any router could: decoded, slashes collapsed, dots resolved, lower case', () => {
    for (const u of ['/api/auth/sign-up/email', '/API/Auth/sign-up/email', '/api/auth/%73ign-up/email', '//api/auth/sign-up/email',
      '/api/x/../auth/sign-up/email', '/api/x/%2e%2e/auth/sign-up/email', '\\api\\auth/sign-up/email', '/api/auth/sign-up/email?x=1']) {
      expect(pathOf(u)).toBe('/api/auth/sign-up/email')
    }
    expect(pathOf(undefined)).toBe('/')
  })
})

describe('loadGatewayConfig', () => {
  const pem = gw.publicKey.export({ type: 'spki', format: 'pem' }) as string
  it('is off without a key', () => {
    expect(loadGatewayConfig({})).toBeNull()
  })
  it('needs the host with the key, and the key with a host', () => {
    expect(() => loadGatewayConfig({ MM_GATEWAY_PUBLIC_KEY: pem })).toThrow(/MM_GATEWAY_HOST/)
    expect(() => loadGatewayConfig({ MM_GATEWAY_HOST: HOST })).toThrow(/no gateway key/)
  })
  it('takes an inline PEM (newlines as \\n too), refuses a key that is not ed25519', () => {
    const c = loadGatewayConfig({ MM_GATEWAY_PUBLIC_KEY: pem.replace(/\n/g, '\\n'), MM_GATEWAY_HOST: HOST.toUpperCase() })
    expect(c?.host).toBe(HOST)
    expect(c?.port).toBe(4401)
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }) as string
    expect(() => loadGatewayConfig({ MM_GATEWAY_PUBLIC_KEY: rsa, MM_GATEWAY_HOST: HOST })).toThrow(/ed25519/)
  })
})

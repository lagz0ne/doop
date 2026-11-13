import { useEffect, useState, type ReactNode } from 'react'
import type { LinkAccess } from '../../shared/canvasRole'
import { AuthCard, AuthCardText, AuthScreen } from '../components/ui/screen'
import { Button } from '../components/ui/button'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { useT, type PlainMessageKey } from '@/lib/i18n'

/** What GET /api/auth/link/info answers (server/shareLink.ts). */
interface LinkInfo {
  canvasId: string
  access: Exclude<LinkAccess, 'none'>
  password: boolean
  /** null while the link asks for a password */
  name: string | null
}

const BODY: Record<LinkInfo['access'], PlainMessageKey> = {
  view: 'canvas.joinBodyView',
  comment: 'canvas.joinBodyComment',
  review: 'canvas.joinBodyReview',
  edit: 'canvas.joinBodyEdit',
}

/* this browser's last name at a link door, so a returning guest does not retype it */
const NAME_KEY = 'doop:guest-name'

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * A signed-out visitor on a canvas link. When the link asks for a password,
 * or grants more than a look, the door comes first: a name, and the password
 * if there is one, traded for a guest session on this canvas
 * (POST /api/auth/link/session); a reload then opens the canvas as that
 * guest. A link to look at needs no door, and a canvas with no link at all
 * goes on to `fallback` (the read-only guest view, which a private canvas
 * turns into the sign-in form).
 */
export function LinkJoin({
  canvasId,
  fallback,
  onSignIn,
}: {
  canvasId: string
  fallback: ReactNode
  onSignIn: () => void
}) {
  const t = useT()
  const [info, setInfo] = useState<LinkInfo | null | undefined>(undefined)
  const [justLook, setJustLook] = useState(false)
  const [name, setName] = useState(rememberedName)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void fetch(`/api/auth/link/info?canvas=${encodeURIComponent(canvasId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<LinkInfo>) : null))
      .catch(() => null)
      .then((answer) => live && setInfo(answer))
    return () => {
      live = false
    }
  }, [canvasId])

  if (info === undefined) return <AuthScreen />
  if (!info || justLook || (info.access === 'view' && !info.password)) return <>{fallback}</>

  async function join() {
    if (busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/auth/link/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canvasId, name: name.trim(), password: info?.password ? password : undefined }),
      })
      if (!r.ok) {
        setError(
          r.status === 401
            ? t('canvas.joinWrongPassword')
            : r.status === 429
              ? t('canvas.joinTooMany')
              : t('canvas.joinFailed'),
        )
        return
      }
      try {
        localStorage.setItem(NAME_KEY, name.trim())
      } catch {
        /* private mode: the name is just not remembered */
      }
      location.reload()
    } catch {
      setError(t('canvas.joinFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthScreen>
      <AuthCard
        as="form"
        title={info.name ? t('canvas.joinTitle', { name: info.name }) : t('canvas.joinTitleProtected')}
        onSubmit={(e) => {
          e.preventDefault()
          void join()
        }}
      >
        <AuthCardText>{t(BODY[info.access])}</AuthCardText>
        <Field label={t('canvas.joinName')} labelVariant="form" htmlFor="link-join-name">
          <Input
            id="link-join-name"
            autoFocus
            autoComplete="name"
            maxLength={80}
            value={name}
            placeholder={t('canvas.joinNamePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {info.password && (
          <Field label={t('canvas.joinPassword')} labelVariant="form" htmlFor="link-join-password">
            <Input
              id="link-join-password"
              type="password"
              autoComplete="off"
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-label text-accent-ink">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={busy || !name.trim() || (info.password && !password)}
        >
          {t('canvas.joinSubmit')}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!info.password && (
            <Button type="button" variant="link" size="inline" onClick={() => setJustLook(true)}>
              {t('canvas.joinJustLook')}
            </Button>
          )}
          <Button type="button" variant="link" size="inline" className="ml-auto" onClick={onSignIn}>
            {t('canvas.joinSignIn')}
          </Button>
        </div>
      </AuthCard>
    </AuthScreen>
  )
}

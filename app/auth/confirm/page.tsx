import Link from 'next/link'

type ConfirmPageProps = {
  searchParams: Promise<{ token_hash?: string | string[]; type?: string | string[] }>
}

export default async function ConfirmPage({ searchParams }: ConfirmPageProps) {
  const params = await searchParams
  const tokenHash = typeof params.token_hash === 'string' ? params.token_hash : ''
  const type = typeof params.type === 'string' ? params.type : ''
  const canConfirm = tokenHash.length > 0 && type === 'email'

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link href="/" className="auth-brand">The Peaceful Pages <span>LIBRARY</span></Link>
        <p className="eyebrow">Email confirmation</p>
        <h1>{canConfirm ? 'Confirm your email.' : 'This link needs a fresh start.'}</h1>
        <p className="auth-copy">
          {canConfirm
            ? 'Tap the button below to confirm your email and continue to your one-time library registration.'
            : 'This confirmation link is missing or no longer valid. Sign in and request a fresh confirmation email.'}
        </p>
        {canConfirm ? (
          <form method="post" action="/auth/confirm">
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value="email" />
            <button className="primary-button auth-submit" type="submit">Confirm email</button>
          </form>
        ) : (
          <Link href="/auth/login" className="primary-button auth-submit">Go to sign in</Link>
        )}
        <p className="auth-footer"><Link href="/auth/login">Return to sign in</Link></p>
      </section>
    </main>
  )
}

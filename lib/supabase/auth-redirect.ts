export function getAuthRedirectUrl() {
  const developmentRedirect = process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL

  if (process.env.NODE_ENV === 'development' && developmentRedirect) {
    return developmentRedirect
  }

  return new URL('/auth/callback', window.location.origin).toString()
}

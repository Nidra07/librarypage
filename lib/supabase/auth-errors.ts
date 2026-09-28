type SupabaseAuthError = {
  code?: string
  message?: string
  status?: number
}

export function getAuthErrorMessage(error: SupabaseAuthError, fallback: string) {
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
    return 'Too many confirmation emails were requested. Please wait before trying again, then check your inbox and spam folder.'
  }

  if (error.code === 'email_not_confirmed') {
    return 'Please confirm your email address first. You can request a fresh confirmation email below.'
  }

  if (error.code === 'weak_password') {
    return 'Choose a stronger password and try again.'
  }

  return error.message?.trim() || fallback
}

export function getAuthRetryAfterSeconds(error: SupabaseAuthError) {
  const match = error.message?.match(/after\s+(\d+)\s+seconds?/i)
  return match ? Math.max(1, Number(match[1])) : 60
}

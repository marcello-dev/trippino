// Authentication helper module (ESM)
// Provides UI-agnostic helpers for auth state and logout.

import { getCsrfToken } from '/modules/csrf.js'

function apiBase() {
  return (window && window.APP_CONFIG && window.APP_CONFIG.API_BASE) || ''
}

export async function getCurrentUser() {
  try {
    const res = await fetch(`${apiBase()}/api/me`, { credentials: 'include' })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    return data && data.user ? data.user : null
  } catch (e) {
    return null
  }
}

export async function logout() {
  try {
    const token = await getCsrfToken()
    await fetch(`${apiBase()}/api/logout`, {
      method: 'POST',
      headers: token ? { 'CSRF-Token': token } : {},
      credentials: 'include'
    })
  } catch (e) {
    // swallow to keep UX smooth; caller may still clear local state
  }
}

// CSRF helper module (ESM)
// Exports a cached getCsrfToken() that fetches from /api/csrf-token using the configured API base.

let _csrfCache = null

export async function getCsrfToken() {
  if (_csrfCache) return _csrfCache
  try {
    const apiBase = (window && window.APP_CONFIG && window.APP_CONFIG.API_BASE) || ''
    const res = await fetch(`${apiBase}/api/csrf-token`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      _csrfCache = data.csrfToken
      return _csrfCache
    }
  } catch (e) {
    console.error('Failed to get CSRF token', e)
  }
  return null
}

export function clearCsrfTokenCache() {
  _csrfCache = null
}

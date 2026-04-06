export const BRAND_NAME = 'Fabu Code'
export const BRAND_SHORT_NAME = 'Fabu Code'
export const BRAND_TAGLINE = 'Build from source.'
export const BRAND_SUBTITLE =
  'A source-first coding CLI for OpenAI-compatible backends.'
export const BRAND_ACCENT_COLOR = '#A31F34'
export const BRAND_MASCOT_COLOR = '#A31F34'
export const BRAND_LOGO_WIDTH = 20
export const RECENT_ACTIVITY_TITLE = 'Recent activity'
export const RECENT_ACTIVITY_EMPTY = 'No recent sessions yet'
export const WHATS_NEW_TITLE = 'OpenAI updates'
export const QUICKSTART_TITLE = 'Get started'
export const GUEST_PASSES_TITLE = 'Guest passes'

export function formatBrandWelcome(
  username: string | null,
  maxUsernameLength = 20,
): string {
  if (!username || username.length > maxUsernameLength) {
    return `Welcome to ${BRAND_NAME}!`
  }
  return `Welcome back, ${username}!`
}

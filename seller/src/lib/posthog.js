import posthog from 'posthog-js'

if (typeof window !== 'undefined') {
  posthog.init(import.meta.env.PUBLIC_POSTHOG_KEY, {
    api_host: import.meta.env.PUBLIC_POSTHOG_HOST,
    defaults: '2026-05-30',
  })
}

export default posthog

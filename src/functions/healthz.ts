import { app, type HttpResponseInit } from '@azure/functions'

/** `GET /healthz` — unauthenticated, calls no external service. */
export function healthz(): HttpResponseInit {
  return { status: 200, jsonBody: { status: 'ok' } }
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- Azure Functions v4 discovers functions by importing this file and running app.http() as a side effect
app.http('healthz', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'healthz',
  handler: healthz,
})

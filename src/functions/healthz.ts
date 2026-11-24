import { app, type HttpResponseInit } from '@azure/functions'

/** `GET /healthz` — unauthenticated, calls no external service. */
export function healthz(): HttpResponseInit {
  return { status: 200, jsonBody: { status: 'ok' } }
}

app.http('healthz', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'healthz',
  handler: healthz,
})

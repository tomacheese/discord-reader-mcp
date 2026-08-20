import {
  search as jmespathSearch,
  type JSONValue,
} from '@jmespath-community/jmespath'

/** Thrown when a `jmespath` expression is invalid or fails to evaluate. */
export class JmespathError extends Error {}

/**
 * Applies a JMESPath projection to a Discord response body.
 * @param body - The Discord response body to project.
 * @param expression - The JMESPath expression, or `undefined` to return `body` unchanged.
 * @returns The projected value, or `body` itself when no expression is given.
 * @throws {JmespathError} When `expression` is invalid or evaluation fails.
 */
export function project(
  body: unknown,
  expression: string | undefined
): unknown {
  if (expression === undefined) return body
  try {
    return jmespathSearch(body as JSONValue, expression)
  } catch (err) {
    throw new JmespathError(
      `Invalid jmespath expression: ${(err as Error).message}`
    )
  }
}

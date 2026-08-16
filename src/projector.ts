import jmespath from "jmespath";

export class JmespathError extends Error {}

export function project(body: unknown, expression: string | undefined): unknown {
  if (expression === undefined) return body;
  try {
    return jmespath.search(body, expression);
  } catch (err) {
    throw new JmespathError(`Invalid jmespath expression: ${(err as Error).message}`);
  }
}

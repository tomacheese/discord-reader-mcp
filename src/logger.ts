const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const

/** The single source of truth for valid log level names, used across the logger and config validation. */
export type Level = keyof typeof LEVELS

/** `Level`'s member names as a tuple, for building a `zod` enum from it. */
export const LEVEL_NAMES = Object.keys(LEVELS) as [Level, ...Level[]]

/** Structured logger emitting one JSON line per call, filtered by level threshold. */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

/**
 * Creates a {@link Logger} that writes structured JSON lines to stdout.
 * Callers must never pass secret values or raw Discord payloads as `fields`.
 * @param threshold - Minimum level to emit (levels below it are suppressed).
 */
export function createLogger(threshold: Level): Logger {
  const emit = (
    level: Level,
    msg: string,
    fields?: Record<string, unknown>
  ) => {
    if (LEVELS[level] < LEVELS[threshold]) return
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        msg,
        ...fields,
      })
    )
  }
  return {
    debug: (m, f) => {
      emit('debug', m, f)
    },
    info: (m, f) => {
      emit('info', m, f)
    },
    warn: (m, f) => {
      emit('warn', m, f)
    },
    error: (m, f) => {
      emit('error', m, f)
    },
  }
}

type Level = 'info' | 'warn' | 'error';

type JsonRecord = Record<string, unknown>;

let context: JsonRecord = {};

export function setLogContext(ctx: JsonRecord) {
  context = { ...context, ...ctx };
}

// Useful for tests to avoid cross-test leakage.
export function clearLogContext() {
  context = {};
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeError(err: unknown): JsonRecord | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  // viem errors are often objects; preserve safely.
  if (typeof err === 'object') {
    try {
      return { ...(err as any) };
    } catch {
      return { message: String(err) };
    }
  }
  return { message: String(err) };
}

function writeHuman(level: Level, msg: string, data?: unknown) {
  const linePrefix = `[${level}] ${nowIso()} `;
  const writer =
    level === 'error'
      ? console.error
      : level === 'warn'
      ? console.warn
      : console.log;
  if (data === undefined || data === null || data === '') {
    writer(`${linePrefix}${msg}`);
  } else {
    writer(`${linePrefix}${msg}`, data);
  }
}

function writeJson(level: Level, event: string, fields: JsonRecord = {}) {
  const payload: JsonRecord = {
    ts: nowIso(),
    level,
    event,
    ...context,
    ...fields,
  };
  // Ensure it is a single JSON line.
  console.log(
    JSON.stringify(payload, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v
    )
  );
}

export const log = {
  info: (msg: string, data?: unknown) => writeHuman('info', msg, data),
  warn: (msg: string, data?: unknown) => writeHuman('warn', msg, data),
  error: (msg: string, data?: unknown) => writeHuman('error', msg, data),

  json: (level: Level, event: string, fields?: JsonRecord) =>
    writeJson(level, event, fields ?? {}),

  jsonInfo: (event: string, fields?: JsonRecord) =>
    writeJson('info', event, fields ?? {}),
  jsonWarn: (event: string, fields?: JsonRecord) =>
    writeJson('warn', event, fields ?? {}),
  jsonError: (event: string, fields?: JsonRecord) =>
    writeJson('error', event, fields ?? {}),

  jsonInfoWithError: (event: string, err: unknown, fields?: JsonRecord) =>
    writeJson('info', event, {
      ...(fields ?? {}),
      error: normalizeError(err),
    }),
  jsonWarnWithError: (event: string, err: unknown, fields?: JsonRecord) =>
    writeJson('warn', event, {
      ...(fields ?? {}),
      error: normalizeError(err),
    }),
  jsonErrorWithError: (event: string, err: unknown, fields?: JsonRecord) =>
    writeJson('error', event, {
      ...(fields ?? {}),
      error: normalizeError(err),
    }),

  exception: (event: string, err: unknown, fields?: JsonRecord) =>
    writeJson('error', event, {
      ...(fields ?? {}),
      error: normalizeError(err),
    }),
};

export type { Level, JsonRecord };

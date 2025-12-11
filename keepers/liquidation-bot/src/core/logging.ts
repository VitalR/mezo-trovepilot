export const log = {
  info: (msg: string, data?: unknown) =>
    console.log(`[info] ${msg}`, data ?? ''),
  warn: (msg: string, data?: unknown) =>
    console.warn(`[warn] ${msg}`, data ?? ''),
  error: (msg: string, data?: unknown) =>
    console.error(`[error] ${msg}`, data ?? ''),
};

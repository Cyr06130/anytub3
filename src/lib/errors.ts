/**
 * User-presentable message from an unknown thrown value. `fallback` replaces
 * the stringified value for non-Error throws (UI copy beats `[object Object]`).
 */
export function errorMessage(e: unknown, fallback?: string): string {
  if (e instanceof Error) return e.message;
  return fallback ?? String(e);
}

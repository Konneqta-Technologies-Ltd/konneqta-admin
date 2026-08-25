/**
 * Minimal central logger for server-side code.
 *
 * Standardises the `[scope] message` format used across the admin app and
 * gives a single seam to swap in a real provider (Sentry, Axiom, …) later
 * without touching call sites.
 */
export const logger = {
  error(scope: string, message: string, detail?: unknown) {
    if (detail === undefined) {
      console.error(`[${scope}] ${message}`);
    } else {
      console.error(`[${scope}] ${message}`, detail);
    }
  },
  warn(scope: string, message: string, detail?: unknown) {
    if (detail === undefined) {
      console.warn(`[${scope}] ${message}`);
    } else {
      console.warn(`[${scope}] ${message}`, detail);
    }
  },
};

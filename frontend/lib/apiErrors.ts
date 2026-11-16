// Plain-language messages for requests that never got an answer from the backend.
// Pure function so it can be tested without a browser.

/**
 * `timedOut` is true when we aborted the request ourselves because it took too long.
 * Anything else that stops a request before a response arrives (backend not running,
 * wrong URL, connection refused) shows up in the browser as a TypeError.
 */
export function describeFetchFailure(apiBase: string, timedOut: boolean, timeoutMs: number): string {
  if (timedOut) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    return (
      `The backend at ${apiBase} did not answer within ${seconds} seconds. ` +
      "It may be busy. Wait a moment and try again."
    );
  }

  return (
    `Cannot reach the Fraudverse backend at ${apiBase}. ` +
    "Check that it is running, then try again."
  );
}

/** Read timeouts: reads are quick, runs and the advisor search score or replay many payments. */
export const TIMEOUT_MS = {
  read: 30_000,
  advisor: 120_000,
  launch: 300_000,
} as const;

/** Invalidates in-flight reads when the room or signed-in account changes. */
export class RequestScope {
  private controller = new AbortController();
  reset() {
    this.controller.abort();
    this.controller = new AbortController();
  }
  get signal() { return this.controller.signal; }
  accepts(signal: AbortSignal) { return signal === this.controller.signal && !signal.aborted; }
}

/**
 * `signal`, but also aborted after `ms`: a request stalled on a dead
 * connection would otherwise never settle and wedge whatever awaits it.
 */
export function withTimeout(signal?: AbortSignal, ms = 10_000): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  setTimeout(abort, ms);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  controller.signal.addEventListener("abort", () => signal?.removeEventListener("abort", abort), { once: true });
  return controller.signal;
}

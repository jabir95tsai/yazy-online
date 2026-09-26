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

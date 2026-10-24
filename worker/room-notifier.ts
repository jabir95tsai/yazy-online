import type { DurableObjectState, WebSocket as WorkerWebSocket } from "@cloudflare/workers-types";

declare const WebSocketPair: { new (): { 0: WorkerWebSocket; 1: WorkerWebSocket } };
declare const WebSocketRequestResponsePair: new (request: string, response: string) => unknown;

/**
 * One per table. Holds the table's open sockets and tells them "something
 * changed" — never the state itself, which stays in D1 for clients to read.
 */
export class RoomNotifier {
  constructor(private readonly ctx: DurableObjectState) {
    // Keep-alive pings are answered without waking (or billing) the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong") as Parameters<DurableObjectState["setWebSocketAutoResponse"]>[0],
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    }
    if (request.method === "POST") {
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send("changed");
        } catch {
          // Already closing; its client reconnects and re-reads on its own.
        }
      }
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }

  webSocketMessage() {}

  webSocketClose(socket: WorkerWebSocket, code: number) {
    // 1005/1006 mean "no status"; close() rejects them, so answer with 1000.
    try { socket.close(code === 1005 || code === 1006 ? 1000 : code); } catch { /* already closed */ }
  }
}

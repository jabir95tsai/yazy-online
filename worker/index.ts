import type { D1Database, DurableObjectNamespace } from "@cloudflare/workers-types";
import handler from "vinext/server/app-router-entry";
import { runScheduledCleanup } from "@/lib/cleanup";

export { RoomNotifier } from "./room-notifier";

const LIVE_PATH = /^\/api\/rooms\/([A-Z0-9]{6})\/live$/;

interface Env {
  // Described with the DOM `Request`/`Response` rather than the Workers
  // `Fetcher`, because this binding is handed straight to vinext, whose
  // handler is typed against the DOM shapes. The two differ (the Workers
  // `Request` carries an extra `fetcher` property) and using `Fetcher` here
  // makes the call to `handler.fetch` below fail to typecheck.
  ASSETS: { fetch(request: Request): Response | Promise<Response> };
  DB: D1Database;
  ROOM_NOTIFIER: DurableObjectNamespace;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Socket upgrades go straight to the table's notifier; vinext's route
    // handlers can't hand back a 101.
    const live = LIVE_PATH.exec(new URL(request.url).pathname);
    if (live && request.headers.get("upgrade") === "websocket") {
      const notifier = env.ROOM_NOTIFIER.get(env.ROOM_NOTIFIER.idFromName(live[1]));
      return notifier.fetch(request as never) as unknown as Response;
    }
    return handler.fetch(request, env, ctx);
  },

  scheduled(_controller: unknown, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runScheduledCleanup(env.DB).then((result) => {
        console.info("YAZY cleanup completed", result);
      }),
    );
  },
};

export default worker;

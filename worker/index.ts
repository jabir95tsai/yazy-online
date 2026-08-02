import type { D1Database } from "@cloudflare/workers-types";
import handler from "vinext/server/app-router-entry";
import { runScheduledCleanup } from "@/lib/cleanup";

interface Env {
  // Described with the DOM `Request`/`Response` rather than the Workers
  // `Fetcher`, because this binding is handed straight to vinext, whose
  // handler is typed against the DOM shapes. The two differ (the Workers
  // `Request` carries an extra `fetcher` property) and using `Fetcher` here
  // makes the call to `handler.fetch` below fail to typecheck.
  ASSETS: { fetch(request: Request): Response | Promise<Response> };
  DB: D1Database;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

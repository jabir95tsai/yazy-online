import handler from "vinext/server/app-router-entry";
import { cleanupExpiredSessions } from "@/lib/cleanup";

interface Env {
  ASSETS: Fetcher;
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
      cleanupExpiredSessions(env.DB).then((result) => {
        console.info("YAZY cleanup completed", result);
      }),
    );
  },
};

export default worker;

import vinext from "vinext";
import { defineConfig } from "vite";

// Must match `d1_databases[0].database_id` in `wrangler.jsonc`. Miniflare names
// the local SQLite file after this id, so a mismatch would put `npm run dev` and
// `wrangler d1 execute --local` on two different local databases. Local dev
// never reaches the remote D1 — that needs an explicit `--remote`.
const DATABASE_ID = "9544a7f4-dbf8-4ac3-9e8b-467f9a90fe36";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// `compatibility_flags` is intentionally omitted: the plugin merges this with
// `wrangler.jsonc`, and declaring `nodejs_compat` in both makes the Workers
// runtime refuse to start ("Compatibility flag specified multiple times").
const localBindingConfig = {
  main: "./worker/index.ts",
  // `wrangler.jsonc` pins APP_ENV to "production" for deploys, and the plugin
  // merges that file into the dev config. Without this override the local
  // Miniflare D1 would be treated as already migrated, so `ensureSchema()`
  // would skip table creation and every query would fail with "no such table".
  vars: {
    APP_ENV: "development",
  },
  d1_databases: [
    {
      binding: "DB",
      database_name: "yazy-friends-db",
      database_id: DATABASE_ID,
    },
  ],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});

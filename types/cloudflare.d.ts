/**
 * `cloudflare:workers` is a runtime-provided module with no shipped types.
 *
 * Worker types are pulled in per-file via `import type` rather than a global
 * `/// <reference types="@cloudflare/workers-types" />`. A global reference
 * would replace the DOM lib's `Request`/`Response`/`fetch` with the Workers
 * variants across the whole project, which breaks the React client in
 * `app/page.tsx` (it legitimately uses `localStorage`, `document`, and DOM
 * `fetch`). Keeping the two worlds separate is what lets one tsconfig cover
 * both halves of the app.
 */
declare module "cloudflare:workers" {
  // Consumers narrow this with a cast to the bindings they expect.
  export const env: unknown;
}

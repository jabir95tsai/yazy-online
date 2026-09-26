# design-sync notes

- This repo is an app, not a published library. The design system is `app/components/` (barrel: `app/components/index.ts`). `page.tsx` builds every screen from those components, so they're the real shipped UI, not copies.
- There's no package build, so `.design-sync/build.mjs` (the config's `buildCmd`) produces one. It writes `.design-sync/.cache/pkg/` (gitignored): an esbuild ESM `index.mjs`, a `.d.ts` tree from `tsc -p .design-sync/tsconfig.build.json`, `styles.css` (= `font-vars.css` + `app/globals.css`), and the Geist fonts. Its `package.json` name is `yazy-battle-ui`. Run it after staging `.ds-sync/`, because it borrows esbuild from there.
- Every converter run needs `--entry ./.design-sync/.cache/pkg/index.mjs --node-modules ./node_modules`. Without `--entry`, the converter looks for `node_modules/yazy-battle-ui` and crashes.
- All config paths (`srcDir`, `tsconfig`, `cssEntry`, `extraFonts`, `componentSrcMap`) are relative to `.design-sync/.cache/pkg`, hence the `../../../app/...` form.
- Several components share one file (`feedback.tsx`, `players.tsx`, `die.tsx`, …), so `componentSrcMap` pins each name to its file. When you add a component to a shared file, add a pin, or it loses its JSDoc and falls into the `general` group.
- Card groups come from `@category` tags in each component's JSDoc.
- Fonts: the app loads Geist through `next/font`, which sets `--font-geist-sans` on `<html>`. Designs don't get that, so `font-vars.css` defines the variable and `fonts/geist.css` ships the latin and latin-ext woff2 files (copied from `.vinext/fonts/geist-*`). CJK text falls back to the system font, same as in the app.
- `DieSprite` and `DiceShadowDefs` are excluded from cards. They're internals: the sprite needs the roll loop's `register`, and the defs are invisible. `DiceTray` and `HeroTray` include the defs themselves.
- `StillDie` is only sized inside `HeroTray` (`.hero-tray .die-still`). The `.friend-invite` pill has `margin-left: auto`, so `FriendAction` previews compose it inside a `FriendRow`.
- `Modal` calls `showModal()` on mount. Its card uses `cardMode: single` with viewport 760×520; anything narrower than 680px shows the mobile bottom-sheet layout, clipped.
- 21 cards use `cardMode: column` because their stories are wider than a grid cell (`[GRID_OVERFLOW]`).
- Playwright: `.ds-sync` installs `playwright@1.59.0`, which matches the cached `chromium-1217` in `%LOCALAPPDATA%\ms-playwright`. The repo's own browser regression tests can reuse it: `PLAYWRIGHT_MODULE=.ds-sync/node_modules/playwright/index.mjs node tests/browser-regression.mjs` against the dev server on :3100.
- Known render warns: none.

## Re-sync risks

- `font-vars.css` hard-codes `--font-geist-sans: "Geist"`. If `app/layout.tsx` changes its font, update this file and `fonts/`.
- The Geist woff2 files are a copy of next/font's download from 2026-08-01. They won't track upstream Geist updates.
- Previews use app layout classes (`account-panel`, `join-card`, `results-card`, `friend-group`, `players-strip`, `profile-field`, …) as containers, and `conventions.md` names them. Renaming any of them in `globals.css` silently unstyles those cards; re-validate `conventions.md` after CSS renames.
- Previews and conventions copy are zh-TW. Keep new copy in the app's voice.
- `.d.ts` output depends on repo TypeScript 5.9.3 and the root `tsconfig.json` (the build tsconfig extends it).

// Builds app/components into a small package the design-sync converter can
// read: an ESM entry, a .d.ts tree, and the app's stylesheet + fonts.
// Output: .design-sync/.cache/pkg (gitignored). Run from the repo root after
// staging .ds-sync/ (esbuild comes from there).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = process.cwd();
const out = resolve(root, ".design-sync/.cache/pkg");
const esbuild = createRequire(resolve(root, ".ds-sync/package.json"))("esbuild");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(root, "app/components/index.ts")],
  bundle: true,
  format: "esm",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  outfile: resolve(out, "index.mjs"),
  logLevel: "warning",
});

execFileSync(process.execPath, [
  resolve(root, "node_modules/typescript/bin/tsc"),
  "-p", resolve(root, ".design-sync/tsconfig.build.json"),
], { stdio: "inherit" });

// font-vars.css first: it defines the --font-geist-sans that globals.css reads.
writeFileSync(resolve(out, "styles.css"),
  readFileSync(resolve(root, ".design-sync/font-vars.css"), "utf8") + "\n" +
  readFileSync(resolve(root, "app/globals.css"), "utf8"));
cpSync(resolve(root, ".design-sync/fonts"), resolve(out, "fonts"), { recursive: true });

writeFileSync(resolve(out, "package.json"), JSON.stringify({
  name: "yazy-battle-ui",
  version: "0.1.0",
  type: "module",
  module: "index.mjs",
  types: "types/app/components/index.d.ts",
  peerDependencies: { react: "19.x", "react-dom": "19.x" },
}, null, 2) + "\n");
console.log(`built ${out}`);

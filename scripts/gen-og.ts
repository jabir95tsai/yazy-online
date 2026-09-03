/**
 * One-off generator for public/og.png. Not part of the app build — run by
 * hand (`node --experimental-strip-types scripts/gen-og.ts`) whenever the
 * share-card design changes, then screenshot the emitted HTML with a
 * headless browser.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PIP_RADIUS,
  renderResting,
  SHADOW_CORE,
  SHADOW_GLOW,
  SLOT_POSITIONS,
  SPRITE_SIZE,
} from "../lib/dice-animation.ts";

function dieSvg(value: number, glowId: string, coreId: string) {
  const frame = renderResting(value);
  const shell = [2, 1, 0]
    .map(
      (index) =>
        `<polygon points="${frame.faces[index].points}" fill="${frame.faces[index].fill}" stroke="#96a5c0" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round" />`,
    )
    .join("");
  const pips = [0, 1, 2]
    .map((index) => {
      const face = frame.faces[index];
      const circles = SLOT_POSITIONS.map(
        (slot, position) =>
          `<circle cx="${slot.cx}" cy="${slot.cy}" r="${PIP_RADIUS}" opacity="${face.pips[position]}" fill="#14315c" />`,
      ).join("");
      return `<g transform="matrix(${face.matrix})" opacity="${face.shade}">${circles}</g>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}" width="100%" height="100%">
      <defs>
        <radialGradient id="${glowId}">
          <stop offset="0%" stop-color="#fff" stop-opacity="0.1" />
          <stop offset="60%" stop-color="#fff" stop-opacity="0.04" />
          <stop offset="100%" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="${coreId}">
          <stop offset="0%" stop-color="#0a1424" stop-opacity="0.44" />
          <stop offset="55%" stop-color="#0a1424" stop-opacity="0.17" />
          <stop offset="100%" stop-color="#0a1424" stop-opacity="0" />
        </radialGradient>
      </defs>
      <g opacity="${frame.shadowOpacity}" transform="${frame.shadowTransform}">
        <ellipse rx="${SHADOW_GLOW.rx}" ry="${SHADOW_GLOW.ry}" fill="url(#${glowId})" />
        <ellipse rx="${SHADOW_CORE.rx}" ry="${SHADOW_CORE.ry}" fill="url(#${coreId})" />
      </g>
      <g transform="${frame.transform}">${shell}${pips}</g>
    </svg>`;
}

const dice = [4, 6, 1]
  .map((value, i) => dieSvg(value, `og-glow-${i}`, `og-core-${i}`))
  .map((svg) => `<span class="die">${svg}</span>`)
  .join("");

const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    background: #f6f4ef;
    font-family: "Noto Sans TC", "Microsoft JhengHei", sans-serif;
    color: #2b2825;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 34px;
    padding: 60px;
  }
  .brand {
    position: absolute;
    top: 44px;
    left: 56px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 22px;
    font-weight: 800;
  }
  .brand span:first-child {
    width: 40px;
    height: 40px;
    border-radius: 13px;
    background: #e8a06a;
    color: #3a2a19;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }
  .tray {
    background: #46423a;
    border-radius: 32px;
    padding: 44px 40px 30px;
    display: flex;
    align-items: flex-end;
    gap: 24px;
    box-shadow: 0 30px 70px -30px rgba(43,40,37,0.45);
  }
  .die {
    width: 110px;
    height: 110px;
    position: relative;
  }
  .die:nth-child(2) { transform: translateY(-12px); }
  h1 {
    font-size: 68px;
    font-weight: 800;
    letter-spacing: -0.03em;
    text-align: center;
  }
  p {
    font-size: 24px;
    color: #5d5852;
    text-align: center;
    max-width: 760px;
    line-height: 1.6;
  }
</style></head>
<body>
  <div class="brand"><span>Y</span><span>yazy</span></div>
  <div class="tray">${dice}</div>
  <h1>yazy battle!</h1>
  <p>開一桌，把六位代碼給朋友。沒有計時、沒有輸贏壓力，想聊多久就聊多久。</p>
</body></html>`;

/**
 * Written outside the repo so it never lands in `public/` — this markup is
 * the screenshot source, not something the app serves. Screenshot it with a
 * headless browser and save the result over `public/og.png` by hand.
 */
const outPath = join(tmpdir(), "yazy-og.html");
writeFileSync(outPath, html);
console.log(`wrote ${outPath}`);

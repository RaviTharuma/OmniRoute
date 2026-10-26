import test from "node:test";
import assert from "node:assert/strict";
import { buildFontFaceCss, fontStack, KIT_FACES } from "../../../scripts/docs/readme-fonts.mjs";

// The README diagrams embed the UI kit fonts as subset data: URIs (GitHub's camo proxy blocks
// every external fetch). These tests pin the contract the generators rely on.

test("buildFontFaceCss embeds one subset woff2 data URI per requested role", async () => {
  const { css, bytes } = await buildFontFaceCss({
    display: "Never stop coding.",
    mono: "376 AI PROVIDERS $0",
  });
  assert.equal((css.match(/@font-face/g) || []).length, 2);
  assert.match(
    css,
    /font-family:"CI Serif";font-style:normal;font-weight:400;src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)/
  );
  assert.match(css, /font-family:"CI Mono";font-style:normal;font-weight:500/);
  assert.ok(bytes.display > 500 && bytes.display < 20_000, `display subset ${bytes.display} bytes`);
  assert.ok(bytes.mono > 500 && bytes.mono < 20_000, `mono subset ${bytes.mono} bytes`);
  assert.doesNotMatch(css, /https?:\/\//);
});

test("a larger glyph set produces a larger subset (the subset really follows the text)", async () => {
  const small = await buildFontFaceCss({ ui: "ab" });
  const large = await buildFontFaceCss({ ui: "abcdefghijklmnopqrstuvwxyz0123456789 —→·" });
  assert.ok(large.bytes.ui > small.bytes.ui, `${large.bytes.ui} > ${small.bytes.ui}`);
});

test("roles not requested are not embedded", async () => {
  const { css } = await buildFontFaceCss({ ui: "x" });
  assert.equal((css.match(/@font-face/g) || []).length, 1);
  assert.doesNotMatch(css, /CI Serif|CI Mono/);
});

test("fontStack returns a Linux-safe stack that ends in a generic family", () => {
  assert.equal(
    fontStack("ui"),
    'font-family: "CI Sans", Inter, "Segoe UI", Arial, Helvetica, sans-serif'
  );
  assert.equal(
    fontStack("display"),
    'font-family: "CI Serif", "Instrument Serif", Georgia, "Times New Roman", serif'
  );
  assert.equal(
    fontStack("mono"),
    'font-family: "CI Mono", "IBM Plex Mono", Consolas, "Liberation Mono", monospace'
  );
  assert.equal(Object.keys(KIT_FACES).length, 4);
  assert.throws(() => fontStack("comic"), /unknown font role/);
});

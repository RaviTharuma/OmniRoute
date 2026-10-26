import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIT,
  themeCss,
  textRoleCss,
  svgOpen,
  gridDefs,
  esc,
} from "../../../scripts/docs/readme-diagram-theme.mjs";

const tokens = readFileSync("packages/ui-kit/src/ci-tokens.css", "utf8");

test("every kit color used by the diagrams exists verbatim in ci-tokens.css", () => {
  for (const hex of [
    "#fbfbf8",
    "#ffffff",
    "#040d10",
    "#031a1b",
    "#575f5f",
    "#d8ff00",
    "#0d191c",
    "#f1f7f7",
    "#c7cbc5",
  ]) {
    assert.ok(tokens.includes(hex), `${hex} missing from ci-tokens.css`);
  }
  assert.equal(KIT.light.accent, "#d8ff00");
  assert.equal(KIT.dark.bg, "#040d10");
});

test("themeCss declares the light palette and a dark override behind prefers-color-scheme", () => {
  const css = themeCss();
  assert.match(css, /:root\{[^}]*--bg:#fbfbf8[^}]*--accent:#d8ff00/);
  assert.match(
    css,
    /@media \(prefers-color-scheme: dark\)\{:root\{[^}]*--bg:#040d10[^}]*--ink:#ffffff/
  );
  assert.match(css, /--accent-ink:#040d10/);
});

test("text roles use the kit stacks and end in a generic family", () => {
  const css = textRoleCss();
  for (const cls of [
    ".kicker",
    ".headline",
    ".sub",
    ".body",
    ".mono",
    ".num",
    ".lbl",
    ".foot",
    ".cmd",
  ]) {
    assert.ok(css.includes(cls), cls);
  }
  assert.match(css, /\.headline\{[^}]*"CI Serif"[^}]*serif/);
  assert.match(css, /\.sub\{[^}]*"CI Sans"[^}]*Arial, Helvetica, sans-serif/);
  assert.match(css, /\.num\{[^}]*"CI Mono"[^}]*monospace/);
});

test("svgOpen emits an accessible root with title, desc and the style block", () => {
  const head = svgOpen({
    viewBox: "0 0 1200 548",
    title: "T",
    desc: "D",
    fontFaceCss: "@font-face{}",
  });
  assert.match(
    head,
    /^<svg viewBox="0 0 1200 548" xmlns="http:\/\/www\.w3\.org\/2000\/svg" role="img" aria-labelledby="t d">/
  );
  assert.match(head, /<title id="t">T<\/title>\n\s*<desc id="d">D<\/desc>\n\s*<style>/);
  assert.ok(head.includes("@font-face{}"));
  assert.ok(gridDefs("g1").includes('<pattern id="g1"'));
  assert.equal(esc("a<b>&"), "a&lt;b&gt;&amp;");
});

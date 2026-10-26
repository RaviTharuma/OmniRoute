// The Cheaper Inference UI Kit, as the README diagrams see it. Palette copied from
// packages/ui-kit/src/ci-tokens.css (tests/unit/docs/readme-diagram-theme.test.ts pins the hex
// codes against that file), text roles on the kit font stacks (scripts/docs/readme-fonts.mjs).
// One self-themed file per diagram: light values on :root, dark values behind
// prefers-color-scheme, evaluated by the viewer's browser even through GitHub's camo proxy.
import { fontStack } from "./readme-fonts.mjs";

export const KIT = {
  light: {
    bg: "#fbfbf8",
    surface: "#ffffff",
    ink: "#040d10",
    body: "#031a1b",
    muted: "#575f5f",
    border: "rgba(4,13,16,0.24)",
    grid: "rgba(4,13,16,0.06)",
    accent: "#d8ff00",
    accentInk: "#040d10",
  },
  dark: {
    bg: "#040d10",
    surface: "#0d191c",
    ink: "#ffffff",
    body: "#f1f7f7",
    muted: "#c7cbc5",
    border: "rgba(241,247,247,0.18)",
    grid: "rgba(241,247,247,0.05)",
    accent: "#d8ff00",
    accentInk: "#040d10",
  },
};

const vars = (tokens) =>
  Object.entries(tokens)
    .map(([k, v]) => `--${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${v}`)
    .join(";");

export function themeCss() {
  return `:root{${vars(KIT.light)}}\n@media (prefers-color-scheme: dark){:root{${vars(KIT.dark)}}}`;
}

export function textRoleCss() {
  return [
    `.kicker{${fontStack("mono")};font-weight:500;font-size:12px;letter-spacing:0.18em;fill:var(--muted)}`,
    `.headline{${fontStack("display")};font-weight:400;font-size:72px;fill:var(--ink)}`,
    `.sub{${fontStack("ui")};font-weight:400;font-size:23px;fill:var(--body)}`,
    `.body{${fontStack("ui")};font-weight:400;font-size:14px;fill:var(--muted)}`,
    `.mono{${fontStack("mono")};font-weight:500;font-size:13px;fill:var(--body)}`,
    `.num{${fontStack("mono")};font-weight:500;font-size:32px;fill:var(--ink)}`,
    `.lbl{${fontStack("mono")};font-weight:500;font-size:10px;letter-spacing:0.16em;fill:var(--muted)}`,
    `.foot{${fontStack("mono")};font-weight:500;font-size:10px;letter-spacing:0.16em;fill:var(--muted)}`,
    `.cmd{${fontStack("mono")};font-weight:500;font-size:16px;fill:var(--accent-ink)}`,
    `.bg{fill:var(--bg)} .surface{fill:var(--surface);stroke:var(--border)} .accent{fill:var(--accent)} .rule{stroke:var(--border)} .grid{stroke:var(--grid)}`,
  ].join("\n");
}

export const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function svgOpen({ viewBox, title, desc, fontFaceCss }) {
  return (
    `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="t d">\n` +
    `  <title id="t">${esc(title)}</title>\n` +
    `  <desc id="d">${esc(desc)}</desc>\n` +
    `  <style>\n${fontFaceCss}\n${themeCss()}\n${textRoleCss()}\n  </style>\n`
  );
}

export function gridDefs(id = "kitGrid") {
  return (
    `  <defs>\n    <pattern id="${id}" width="32" height="32" patternUnits="userSpaceOnUse">\n` +
    `      <path d="M 32 0 L 0 0 0 32" fill="none" class="grid" stroke-width="1"/>\n` +
    `    </pattern>\n  </defs>\n`
  );
}

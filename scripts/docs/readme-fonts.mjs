// Subsets the UI kit's @fontsource woff2 files to the glyphs a README SVG draws and returns
// @font-face rules with data: URIs, so the kit typography renders inside GitHub's <img>
// sandbox. The camo proxy blocks every external fetch (fonts included); inline data survives
// (rendered under camo's own Content-Security-Policy on 2026-10-26, see
// scripts/docs/readme-svg-shots.mjs). Faces: Instrument Serif (display), Inter (ui),
// IBM Plex Mono (mono) — the same packages the dashboard ships (packages/ui-kit).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import subsetFont from "subset-font";

const require = createRequire(import.meta.url);

export const KIT_FACES = {
  display: { pkg: "instrument-serif", family: "CI Serif", weight: 400 },
  ui: { pkg: "inter", family: "CI Sans", weight: 400 },
  uiBold: { pkg: "inter", family: "CI Sans", weight: 600 },
  mono: { pkg: "ibm-plex-mono", family: "CI Mono", weight: 500 },
};

// Linux-safe stacks: the embedded face first, the kit's own fallbacks after it, a generic
// family last (fontconfig without Arial/Helvetica in the stack falls back to a monospace).
const STACKS = {
  display: 'font-family: "CI Serif", "Instrument Serif", Georgia, "Times New Roman", serif',
  ui: 'font-family: "CI Sans", Inter, "Segoe UI", Arial, Helvetica, sans-serif',
  uiBold: 'font-family: "CI Sans", Inter, "Segoe UI", Arial, Helvetica, sans-serif',
  mono: 'font-family: "CI Mono", "IBM Plex Mono", Consolas, "Liberation Mono", monospace',
};

function faceFile({ pkg, weight }) {
  const pkgDir = dirname(require.resolve(`@fontsource/${pkg}/package.json`));
  return join(pkgDir, "files", `${pkg}-latin-${weight}-normal.woff2`);
}

export function fontStack(role) {
  if (!STACKS[role]) throw new Error(`unknown font role: ${role}`);
  return STACKS[role];
}

/**
 * @param {{ display?: string, ui?: string, uiBold?: string, mono?: string }} textByRole
 *   The exact characters the SVG draws with each face (concatenate every string drawn in
 *   that role). Roles that are absent or empty are not embedded.
 * @returns {Promise<{ css: string, bytes: Record<string, number> }>}
 */
export async function buildFontFaceCss(textByRole) {
  const parts = [];
  const bytes = {};
  for (const [role, text] of Object.entries(textByRole)) {
    const face = KIT_FACES[role];
    if (!face) throw new Error(`unknown font role: ${role}`);
    if (!text) continue;
    const glyphs = [...new Set(text)].join("");
    const woff2 = await subsetFont(readFileSync(faceFile(face)), glyphs, {
      targetFormat: "woff2",
    });
    bytes[role] = woff2.length;
    parts.push(
      `@font-face{font-family:"${face.family}";font-style:normal;font-weight:${face.weight};` +
        `src:url(data:font/woff2;base64,${Buffer.from(woff2).toString("base64")}) format("woff2")}`
    );
  }
  return { css: parts.join("\n"), bytes };
}

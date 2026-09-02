import JsonViewImport from "react18-json-view";

/**
 * Next/webpack yields the component; tsx/node:test yields the module namespace
 * (`{ default: Component, ... }`). Rendering the namespace throws
 * "Element type is invalid ... got: object".
 *
 * Read `.default` off `unknown` so tsc does not emit TS2339 on the typed
 * function import (dashboard-typecheck ratchet).
 */
const imported: unknown = JsonViewImport;

export const JsonView = (
  typeof imported === "function"
    ? imported
    : (imported as { default: typeof JsonViewImport }).default
) as typeof JsonViewImport;

import JsonViewImport from "react18-json-view";

/**
 * Next/webpack yields the component; tsx/node:test yields the module namespace
 * (`{ default: Component, ... }`). Rendering the namespace throws
 * "Element type is invalid ... got: object".
 */
export const JsonView = (
  typeof JsonViewImport === "function" ? JsonViewImport : JsonViewImport.default
) as typeof JsonViewImport;

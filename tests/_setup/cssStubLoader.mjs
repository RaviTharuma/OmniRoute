/**
 * Node test loader: treat CSS imports as empty modules.
 *
 * Request-log detail components import react18-json-view CSS. node:test + tsx
 * cannot load .css (ERR_UNKNOWN_FILE_EXTENSION). Production Next.js still
 * bundles those files; this hook is registered only from tests/_setup.
 */
export async function load(url, context, nextLoad) {
  const pathname = url.split("?")[0];
  if (pathname.endsWith(".css")) {
    return { format: "module", shortCircuit: true, source: "export default {};\n" };
  }
  return nextLoad(url, context);
}

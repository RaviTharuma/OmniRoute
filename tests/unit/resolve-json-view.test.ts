import test from "node:test";
import assert from "node:assert/strict";

import { JsonView } from "../../src/shared/components/resolveJsonView.ts";

test("JsonView resolves to a function under tsx/node:test namespace interop", () => {
  assert.equal(typeof JsonView, "function");
});

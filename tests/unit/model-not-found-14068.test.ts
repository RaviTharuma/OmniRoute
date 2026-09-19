import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_NOT_FOUND_CODE, buildModelNotFoundPayload } from "../../src/lib/model-not-found.ts";

test("#14068 buildModelNotFoundPayload uses stable code", () => {
  const body = buildModelNotFoundPayload("gateway/missing-alias");
  assert.equal(body.error.code, MODEL_NOT_FOUND_CODE);
  assert.match(body.error.message, /missing-alias/);
  assert.equal(body.error.param, "model");
});

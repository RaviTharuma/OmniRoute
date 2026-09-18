import assert from "node:assert/strict"
import test from "node:test"
import {
  MODEL_NOT_FOUND_CODE,
  buildModelNotFoundPayload,
  isKnownModelId,
} from "../../src/lib/model-not-found.ts"

test("#14068 buildModelNotFoundPayload uses stable code", () => {
  const body = buildModelNotFoundPayload("gateway/missing-alias")
  assert.equal(body.error.code, MODEL_NOT_FOUND_CODE)
  assert.match(body.error.message, /missing-alias/)
  assert.equal(body.error.param, "model")
})

test("#14068 isKnownModelId is case-insensitive", () => {
  assert.equal(isKnownModelId("Gateway/Alpha", new Set(["gateway/alpha"])), true)
  assert.equal(isKnownModelId("gateway/missing", new Set(["gateway/alpha"])), false)
})

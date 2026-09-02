/**
 * Local 400 context_length_exceeded must stay 400 on the stream-failure path.
 * A message-only overflow with no numeric status used to default to 502.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStreamFailurePayload } from "../../open-sse/utils/streamErrorFormat.ts";

test("normalizeStreamFailurePayload remaps message-only overflow to 400", () => {
  const overflow = normalizeStreamFailurePayload({
    error: {
      message:
        "Input exceeds context window for openai/gpt-5.6-codex: estimated 900000 input tokens, limit 872000.",
    },
  });
  assert.ok(overflow);
  assert.equal(overflow.status, 400);
  assert.equal(overflow.code, "context_length_exceeded");
  assert.equal(overflow.type, "invalid_request_error");
});

test("normalizeStreamFailurePayload leaves a generic failure at 502", () => {
  const boom = normalizeStreamFailurePayload({ message: "boom" });
  assert.ok(boom);
  assert.equal(boom.status, 502);
  assert.notEqual(boom.code, "context_length_exceeded");
});

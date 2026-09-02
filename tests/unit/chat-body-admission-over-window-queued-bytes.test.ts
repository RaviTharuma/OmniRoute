/**
 * Over-window bodies (~872k tokens) must reach compression + the 400 context
 * gate instead of dying as queued_bytes 503 at admission (#9940 / #11244).
 */
import test from "node:test";
import assert from "node:assert/strict";

const admissionModule = await import("../../src/shared/middleware/chatBodyAdmission.ts");
const {
  admitChatRequest,
  ChatAdmissionController,
  CHAT_ADMISSION_TOKEN_BYTES,
  CHAT_ADMISSION_CONTEXT_WINDOW_TOKENS,
  estimateAdmissionTokensFromBytes,
  isOverWindowAdmissionBody,
} = admissionModule;

const OVER_WINDOW_BYTES = CHAT_ADMISSION_CONTEXT_WINDOW_TOKENS * CHAT_ADMISSION_TOKEN_BYTES;

function chatRequest(body: string): Request {
  return new Request("http://x/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(body.length) },
    body,
  });
}

function responsesRequest(body: string): Request {
  return new Request("http://x/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(body.length) },
    body,
  });
}

function paddedChatBody(minBytes: number): string {
  const overhead = '{"messages":[{"role":"user","content":""}]}';
  const pad = Math.max(0, minBytes - overhead.length);
  return JSON.stringify({ messages: [{ role: "user", content: "x".repeat(pad) }] });
}

test("872k token estimate is the over-window admission boundary", () => {
  assert.equal(estimateAdmissionTokensFromBytes(OVER_WINDOW_BYTES), 872_000);
  assert.equal(isOverWindowAdmissionBody(OVER_WINDOW_BYTES), true);
  assert.equal(isOverWindowAdmissionBody(OVER_WINDOW_BYTES - CHAT_ADMISSION_TOKEN_BYTES), false);
});

test("over-window queued body skips queued_bytes 503 so it can reach the context gate", async () => {
  const controller = new ChatAdmissionController(1, 1024);
  const held = controller.tryAcquireHeavy();
  assert.ok(held);

  const pending = controller.acquireHeavyWithin(500, undefined, OVER_WINDOW_BYTES);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false, "over-window body must park, not 503 queued_bytes");
  assert.equal(controller.queuedBytes, 0, "over-window park must not consume the in-window budget");
  assert.deepEqual(controller.shedsByReason, {});

  const inWindow = await controller.acquireHeavyWithin(500, undefined, 2000);
  assert.equal(inWindow, null, "in-window over-budget wait still 503s");
  assert.deepEqual(controller.shedsByReason, { queued_bytes_budget: 1 });

  held.release();
  const lease = await pending;
  assert.ok(lease, "over-window waiter acquires capacity after release");
  lease.release();
  assert.equal(controller.activeHeavy, 0);
});

test("in-window waiters still consume queued-bytes after an over-window skip", async () => {
  const controller = new ChatAdmissionController(1, 1000);
  const held = controller.tryAcquireHeavy();
  assert.ok(held);

  const overflowParked = controller.acquireHeavyWithin(2_000, undefined, OVER_WINDOW_BYTES);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(controller.queuedBytes, 0);

  const inWindowParked = controller.acquireHeavyWithin(2_000, undefined, 400);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(controller.queuedBytes, 400, "in-window waiter still charges the budget");

  const overBudget = await controller.acquireHeavyWithin(2_000, undefined, 700);
  assert.equal(overBudget, null, "aggregate queued-bytes bound still applies to in-window waiters");
  assert.equal(controller.shedsByReason.queued_bytes_budget, 1);

  held.release();
  (await overflowParked)?.release();
  (await inWindowParked)?.release();
  assert.equal(controller.activeHeavy, 0);
});

test("admitChatRequest: over-window /v1/chat/completions body is not 503 queued_bytes", async () => {
  const controller = new ChatAdmissionController(1, 1024, 0);
  const held = controller.tryAcquireHeavy();
  assert.ok(held);

  const body = paddedChatBody(OVER_WINDOW_BYTES);
  const pending = admitChatRequest(chatRequest(body), {
    controller,
    largeBodyBytes: 32,
    hardMaxBytes: body.length + 1024,
    queueMs: 500,
  });
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false, "over-window chat body must wait, not 503");
  assert.deepEqual(controller.shedsByReason, {});

  held.release();
  const result = await pending;
  assert.equal(result.admit, true);
  if (result.admit) result.lease?.release();
  assert.equal(controller.activeHeavy, 0);
});

test("admitChatRequest: over-window /v1/responses body is not 503 queued_bytes", async () => {
  const controller = new ChatAdmissionController(1, 1024, 0);
  const held = controller.tryAcquireHeavy();
  assert.ok(held);

  const body = paddedChatBody(OVER_WINDOW_BYTES);
  const pending = admitChatRequest(responsesRequest(body), {
    controller,
    largeBodyBytes: 32,
    hardMaxBytes: body.length + 1024,
    queueMs: 500,
  });
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false, "over-window responses body must wait, not 503");
  assert.deepEqual(controller.shedsByReason, {});

  held.release();
  const result = await pending;
  assert.equal(result.admit, true);
  if (result.admit) result.lease?.release();
  assert.equal(controller.activeHeavy, 0);
});

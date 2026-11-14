import test from "node:test";
import assert from "node:assert/strict";

import { clearAllModelLockouts } from "../../open-sse/services/accountFallback.ts";
import { setCustomAliases } from "../../open-sse/services/modelDeprecation.ts";

import { createComboRoutingHarness } from "./_comboRoutingHarness.ts";

const h = await createComboRoutingHarness("strict-version-routing");
const {
  BaseExecutor,
  buildRequest,
  combosDb,
  handleChat,
  resetStorage,
  seedConnection,
  settingsDb,
} = h;
// Import after the harness establishes its isolated DATA_DIR; a static route import would bind
// database modules to the developer database before the fixture environment exists.
const { GET: getCombos } = await import("../../src/app/api/combos/route.ts");

const EXACT_MODEL = "claude-opus-5-5";
const NEWEST_FAMILY_MODEL = "claude-opus-5";
const OLDER_FAMILY_MODEL = "claude-opus-4-8";
const originalReadinessRetryFlag = process.env.STREAM_READINESS_STALL_RETRY;
const originalEarlyEofFailoverFlag = process.env.STREAM_EARLY_EOF_SIBLING_FAILOVER_ENABLED;

function requestBody(model: string, stream = false) {
  return {
    model,
    stream,
    messages: [{ role: "user", content: `Route ${model} without changing its version.` }],
  };
}

function canonicalClaudeModel(model: string | undefined): string | undefined {
  return model?.trim().toLowerCase().split("/").at(-1)?.replaceAll(".", "-");
}

function modelStep(id: string, providerId: string, model: string, connectionId: string) {
  return {
    id,
    kind: "model" as const,
    providerId,
    model,
    connectionId,
  };
}

function pingOnlyStream(): Response {
  return new Response(`: keepalive\n\ndata: ${JSON.stringify({ type: "ping" })}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function claudeSuccessStream(text: string, model = EXACT_MODEL): Response {
  return new Response(
    [
      "event: message_start",
      `data: ${JSON.stringify({
        type: "message_start",
        message: {
          id: "msg_strict_routing",
          type: "message",
          role: "assistant",
          model,
          usage: { input_tokens: 4, output_tokens: 0 },
        },
      })}`,
      "",
      "event: content_block_start",
      `data: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      })}`,
      "",
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      })}`,
      "",
      "event: message_delta",
      `data: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 3 },
      })}`,
      "",
      "event: message_stop",
      `data: ${JSON.stringify({ type: "message_stop" })}`,
      "",
    ].join("\n"),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

function deferredClaudeResponse(text: string, model: string) {
  const { promise, resolve } = Promise.withResolvers<void>();
  const response = async () => {
    await promise;
    return new Response(
      JSON.stringify({
        id: `msg_${model}`,
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 4, output_tokens: 3 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  return { response, release: resolve };
}

test.beforeEach(async () => {
  BaseExecutor.RETRY_CONFIG.delayMs = 0;
  process.env.STREAM_READINESS_STALL_RETRY = "false";
  process.env.STREAM_EARLY_EOF_SIBLING_FAILOVER_ENABLED = "false";
  setCustomAliases({});
  await resetStorage();
});

test.afterEach(async () => {
  BaseExecutor.RETRY_CONFIG.delayMs = h.originalRetryDelayMs;
  setCustomAliases({});
  await resetStorage();
});

test.after(async () => {
  if (originalReadinessRetryFlag === undefined) {
    delete process.env.STREAM_READINESS_STALL_RETRY;
  } else {
    process.env.STREAM_READINESS_STALL_RETRY = originalReadinessRetryFlag;
  }
  if (originalEarlyEofFailoverFlag === undefined) {
    delete process.env.STREAM_EARLY_EOF_SIBLING_FAILOVER_ENABLED;
  } else {
    process.env.STREAM_EARLY_EOF_SIBLING_FAILOVER_ENABLED = originalEarlyEofFailoverFlag;
  }
  await h.cleanup();
});

test("GET /api/combos advertises strict routing and returns its persisted config", async () => {
  await combosDb.createCombo({
    name: "strict-capability-advertisement",
    strategy: "priority",
    config: { strictModelRouting: true },
    models: [`claude/${EXACT_MODEL}`],
  });

  const response = await getCombos(new Request("http://localhost/api/combos"));
  const payload = (await response.json()) as {
    capabilities?: { strictModelRouting?: boolean };
    combos?: Array<{ name?: string; config?: { strictModelRouting?: boolean } }>;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.capabilities?.strictModelRouting, true);
  assert.equal(
    payload.combos?.find((combo) => combo.name === "strict-capability-advertisement")?.config
      ?.strictModelRouting,
    true
  );
});

test("strict and nonstrict requests never share an inflight response across effective models", async () => {
  const deprecatedModel = "claude-dedup-deprecated";
  const replacementModel = "claude-dedup-current";
  const connection = await seedConnection("claude", {
    name: "strict-dedup-identity",
    apiKey: "sk-test-strict-dedup-identity",
  });
  setCustomAliases({ [deprecatedModel]: replacementModel });
  await combosDb.createCombo({
    name: "strict-dedup-exact",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [modelStep("strict-dedup-model", "claude", deprecatedModel, connection.id)],
  });

  const strictUpstream = deferredClaudeResponse("strict exact response", deprecatedModel);
  const nonstrictUpstream = deferredClaudeResponse(
    "nonstrict replacement response",
    replacementModel
  );
  h.installRecordingFetch((call) =>
    call.model === deprecatedModel ? strictUpstream.response() : nonstrictUpstream.response()
  );
  const messages = [{ role: "user", content: "Do not share this inflight response." }];
  const nonstrictPending = handleChat(
    buildRequest({
      body: { model: `claude/${deprecatedModel}`, stream: false, temperature: 0, messages },
    })
  );
  const strictPending = handleChat(
    buildRequest({
      body: { model: "strict-dedup-exact", stream: false, temperature: 0, messages },
    })
  );
  await h.waitFor(() => h.calls.length > 0);
  strictUpstream.release();
  nonstrictUpstream.release();
  const [nonstrictResponse, strictResponse] = await Promise.all([nonstrictPending, strictPending]);
  const [nonstrictBody, strictBody] = await Promise.all([
    nonstrictResponse.json() as Promise<{ choices: Array<{ message: { content: string } }> }>,
    strictResponse.json() as Promise<{ choices: Array<{ message: { content: string } }> }>,
  ]);

  assert.equal(nonstrictResponse.status, 200);
  assert.equal(strictResponse.status, 200);
  assert.deepEqual(
    h.calls.map((call) => call.model).sort(),
    [replacementModel, deprecatedModel].sort()
  );
  assert.equal(nonstrictBody.choices[0].message.content, "nonstrict replacement response");
  assert.equal(strictBody.choices[0].message.content, "strict exact response");
});

test("strict image request never follows a vision-bridge model reroute", async () => {
  const exact = await seedConnection("deepseek", {
    name: "strict-vision-exact",
    apiKey: "sk-test-strict-vision-exact",
  });
  await seedConnection("openai", {
    name: "strict-vision-bridge-target",
    apiKey: "sk-test-strict-vision-bridge-target",
  });
  await settingsDb.updateSettings({
    modalityBridgeVisionEnabled: true,
    modalityBridgeVisionMode: "reroute",
    modalityBridgeVisionModel: "openai/gpt-4o-mini",
    modalityBridgeCacheEnabled: false,
  });
  await combosDb.createCombo({
    name: "strict-no-vision-combo",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [modelStep("strict-no-vision", "deepseek", "deepseek-chat", exact.id)],
  });

  h.installRecordingFetch();
  const response = await handleChat(
    buildRequest({
      body: {
        model: "strict-no-vision-combo",
        stream: false,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image without changing models." },
              {
                type: "image_url",
                image_url: {
                  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
                },
              },
            ],
          },
        ],
      },
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(h.calls, [], "vision bridge must not dispatch a different model");
});

test("strict exact routing keeps claude-opus-5-5 while failing over between providers", async () => {
  const anthropic = await seedConnection("claude", {
    name: "strict-exact-anthropic",
    apiKey: "sk-test-strict-anthropic",
  });
  const openrouter = await seedConnection("openrouter", {
    name: "strict-exact-openrouter",
    apiKey: "sk-test-strict-openrouter",
  });

  await combosDb.createCombo({
    name: "strict-exact-provider-failover",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [
      modelStep("exact-anthropic", "claude", EXACT_MODEL, anthropic.id),
      modelStep("exact-openrouter", "openrouter", EXACT_MODEL, openrouter.id),
    ],
  });

  h.installRecordingFetch((call) =>
    call.provider === "claude" ? h.failure(503, "fixture provider unavailable") : undefined
  );

  const response = await handleChat(
    buildRequest({ body: requestBody("strict-exact-provider-failover") })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(h.providersSeen(), ["claude", "host:openrouter.ai"]);
  assert.deepEqual(
    h.calls.map((call) => canonicalClaudeModel(call.model)),
    [EXACT_MODEL, EXACT_MODEL]
  );
});

test("strict exact combo ignores web-search model override", async () => {
  const exact = await seedConnection("claude", {
    name: "strict-web-search-exact",
    apiKey: "sk-test-strict-web-search-exact",
  });
  await seedConnection("openai", {
    name: "strict-web-search-override",
    apiKey: "sk-test-strict-web-search-override",
  });
  await settingsDb.updateSettings({ webSearchRouteModel: "openai/gpt-4o-mini" });

  await combosDb.createCombo({
    name: "strict-exact-web-search",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [modelStep("web-search-exact", "claude", EXACT_MODEL, exact.id)],
  });

  h.installRecordingFetch();

  const response = await handleChat(
    buildRequest({
      body: {
        ...requestBody("strict-exact-web-search"),
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      },
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(h.providersSeen(), ["claude"]);
  assert.deepEqual(
    h.calls.map((call) => canonicalClaudeModel(call.model)),
    [EXACT_MODEL]
  );
});

test("strict exact routing ignores prefix stripping and contradictory aliases", async () => {
  const exact = await seedConnection("claude", {
    name: "strict-prefix-exact",
    apiKey: "sk-test-strict-prefix-exact",
  });
  await seedConnection("openrouter", {
    name: "strict-prefix-older-alias",
    apiKey: "sk-test-strict-prefix-older-alias",
  });
  await settingsDb.updateSettings({
    stripModelPrefix: true,
    modelAliases: { [EXACT_MODEL]: `openrouter/${OLDER_FAMILY_MODEL}` },
  });

  await combosDb.createCombo({
    name: "strict-exact-prefix-alias",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [modelStep("prefix-exact", "claude", EXACT_MODEL, exact.id)],
  });

  h.installRecordingFetch();

  const response = await handleChat(
    buildRequest({ body: requestBody("strict-exact-prefix-alias") })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(h.providersSeen(), ["claude"]);
  assert.deepEqual(
    h.calls.map((call) => canonicalClaudeModel(call.model)),
    [EXACT_MODEL]
  );
});

test("nonstrict wrapper preserves a strict child target identity", async () => {
  const exact = await seedConnection("claude", {
    name: "strict-child-exact",
    apiKey: "sk-test-strict-child-exact",
  });
  await seedConnection("openrouter", {
    name: "strict-child-older-alias",
    apiKey: "sk-test-strict-child-older-alias",
  });
  await settingsDb.updateSettings({
    stripModelPrefix: true,
    modelAliases: { [EXACT_MODEL]: `openrouter/${OLDER_FAMILY_MODEL}` },
  });

  await combosDb.createCombo({
    name: "strict-child-leaf",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [modelStep("strict-child-model", "claude", EXACT_MODEL, exact.id)],
  });
  await combosDb.createCombo({
    name: "nonstrict-parent-wrapper",
    strategy: "priority",
    config: { maxRetries: 0, retryDelayMs: 0 },
    models: [{ id: "strict-child-ref", kind: "combo-ref", comboName: "strict-child-leaf" }],
  });

  h.installRecordingFetch();
  const response = await handleChat(
    buildRequest({ body: requestBody("nonstrict-parent-wrapper") })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(h.providersSeen(), ["claude"]);
  assert.deepEqual(
    h.calls.map((call) => canonicalClaudeModel(call.model)),
    [EXACT_MODEL]
  );
});

test("strict exact routing fails closed after declared targets and skips every model escape", async () => {
  const anthropic = await seedConnection("claude", {
    name: "strict-closed-anthropic",
    apiKey: "sk-test-strict-closed-anthropic",
  });
  const openrouter = await seedConnection("openrouter", {
    name: "strict-closed-openrouter",
    apiKey: "sk-test-strict-closed-openrouter",
  });
  await seedConnection("openai", {
    name: "strict-closed-global-fallback",
    apiKey: "sk-test-strict-global-fallback",
  });
  await settingsDb.updateSettings({ globalFallbackModel: "openai/gpt-4o-mini" });

  await combosDb.createCombo({
    name: "strict-exact-fail-closed",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [
      modelStep("closed-anthropic", "claude", EXACT_MODEL, anthropic.id),
      modelStep("closed-openrouter", "openrouter", EXACT_MODEL, openrouter.id),
    ],
  });

  h.installRecordingFetch((call) =>
    canonicalClaudeModel(call.model) === EXACT_MODEL
      ? h.failure(503, "fixture exact target unavailable")
      : undefined
  );

  const response = await handleChat(
    buildRequest({ body: requestBody("strict-exact-fail-closed") })
  );
  await response.text();

  assert.equal(
    response.ok,
    false,
    "strict routing must surface exhaustion instead of changing model"
  );
  assert.deepEqual(h.providersSeen(), ["claude", "host:openrouter.ai"]);
  assert.deepEqual(
    h.calls.map((call) => canonicalClaudeModel(call.model)),
    [EXACT_MODEL, EXACT_MODEL],
    "neither the global fallback nor an implicit older Claude may be dispatched"
  );
});

test("strict family/latest wrappers exhaust every newest-version provider before explicit downgrade", async () => {
  const newestAnthropic = await seedConnection("claude", {
    name: "strict-family-newest-anthropic",
    apiKey: "sk-test-strict-family-newest-anthropic",
  });
  const newestOpenrouter = await seedConnection("openrouter", {
    name: "strict-family-newest-openrouter",
    apiKey: "sk-test-strict-family-newest-openrouter",
  });
  const olderAnthropic = await seedConnection("claude", {
    name: "strict-family-older-anthropic",
    apiKey: "sk-test-strict-family-older-anthropic",
  });

  await combosDb.createCombo({
    name: "strict-opus-latest-version",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [
      modelStep("newest-anthropic", "claude", NEWEST_FAMILY_MODEL, newestAnthropic.id),
      modelStep("newest-openrouter", "openrouter", NEWEST_FAMILY_MODEL, newestOpenrouter.id),
    ],
  });
  await combosDb.createCombo({
    name: "strict-opus-previous-version",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [modelStep("older-anthropic", "claude", OLDER_FAMILY_MODEL, olderAnthropic.id)],
  });
  await combosDb.createCombo({
    name: "strict-opus-family-latest",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [
      {
        id: "latest-version-wrapper",
        kind: "combo-ref",
        comboName: "strict-opus-latest-version",
      },
      {
        id: "previous-version-wrapper",
        kind: "combo-ref",
        comboName: "strict-opus-previous-version",
      },
    ],
  });

  h.installRecordingFetch((call) =>
    canonicalClaudeModel(call.model) === NEWEST_FAMILY_MODEL
      ? h.failure(404, "fixture model not found")
      : undefined
  );

  const response = await handleChat(
    buildRequest({ body: requestBody("strict-opus-family-latest") })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    h.calls.map((call) => canonicalClaudeModel(call.model)),
    [NEWEST_FAMILY_MODEL, NEWEST_FAMILY_MODEL, OLDER_FAMILY_MODEL],
    "the T5 family fallback must not downgrade inside the first provider attempt"
  );
  assert.deepEqual(h.providersSeen(), ["claude", "host:openrouter.ai", "claude"]);
  clearAllModelLockouts();

  h.installRecordingFetch((call) =>
    canonicalClaudeModel(call.model) === NEWEST_FAMILY_MODEL
      ? h.failure(404, "fixture model not found")
      : undefined
  );
  const repeatedResponse = await handleChat(
    buildRequest({ body: requestBody("strict-opus-family-latest") })
  );
  assert.equal(repeatedResponse.status, 200);
  assert.deepEqual(
    h.calls.map((call) => canonicalClaudeModel(call.model)),
    [NEWEST_FAMILY_MODEL, NEWEST_FAMILY_MODEL, OLDER_FAMILY_MODEL],
    "a prior older-version success must not pin or promote it ahead of recovered newer targets"
  );
});

test("strict streaming readiness failure advances only to the next declared exact account", async () => {
  const first = await seedConnection("claude", {
    name: "strict-stream-first",
    apiKey: "sk-test-strict-stream-first",
  });
  const second = await seedConnection("claude", {
    name: "strict-stream-second",
    apiKey: "sk-test-strict-stream-second",
  });
  await settingsDb.updateSettings({ globalFallbackModel: `claude/${OLDER_FAMILY_MODEL}` });

  await combosDb.createCombo({
    name: "strict-exact-stream-readiness",
    strategy: "priority",
    config: { strictModelRouting: true, maxRetries: 0, retryDelayMs: 0 },
    models: [
      modelStep("stream-first", "claude", EXACT_MODEL, first.id),
      modelStep("stream-second", "claude", EXACT_MODEL, second.id),
    ],
  });

  h.installRecordingFetch((call) =>
    call.index === 0 ? pingOnlyStream() : claudeSuccessStream("strict stream recovered")
  );

  const response = await handleChat(
    buildRequest({ body: requestBody("strict-exact-stream-readiness", true) })
  );
  const wire = await response.text();

  assert.equal(response.status, 200);
  assert.match(wire, /strict stream recovered/);
  assert.equal(h.calls.length, 2);
  assert.notEqual(
    h.calls[0].authorization,
    h.calls[1].authorization,
    "readiness failure must advance to the explicitly declared sibling account"
  );
  assert.deepEqual(
    h.calls.map((call) => canonicalClaudeModel(call.model)),
    [EXACT_MODEL, EXACT_MODEL],
    "stream recovery must not invoke an older Claude sibling or the global fallback"
  );
});

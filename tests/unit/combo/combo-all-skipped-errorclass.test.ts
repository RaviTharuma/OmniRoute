/**
 * Combo all-skipped 503 must carry a typed errorClass (quota_exhausted /
 * expired / no_credentials), never null, and must not remap the body to the
 * generic "pre-dispatch filters" sentence.
 *
 * Related-not-duplicate: #12136 (empty stream then combo skip) and #12137
 * (GitHub Models combo 400). This is combo-terminal 503 + errorClass=null.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-combo-skip-errorclass-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "combo-skip-errorclass-secret";

const {
  classifyComboSkipErrorClass,
  resolveAllSkippedTerminal,
  resolveAllSkippedTerminalFromTrace,
} = await import("../../../open-sse/services/combo/allSkippedTerminal.ts");
const { handleComboChat } = await import("../../../open-sse/services/combo.ts");
const { registerQuotaFetcher } = await import("../../../open-sse/services/quotaPreflight.ts");
const { createInvocationId, getComboTrace, resetComboTraceStore } =
  await import("../../../open-sse/services/combo/decisionTrace.ts");
const dbCore = await import("../../../src/lib/db/core.ts");
const providersDb = await import("../../../src/lib/db/providers.ts");

beforeEach(() => resetComboTraceStore());

test.after(() => {
  dbCore.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function log() {
  return { info() {}, warn() {}, debug() {}, error() {} };
}

test("classifyComboSkipErrorClass maps quota / expired / no-credentials tokens", () => {
  assert.equal(classifyComboSkipErrorClass("quota_cutoff"), "quota_exhausted");
  assert.equal(classifyComboSkipErrorClass("quota_exhausted"), "quota_exhausted");
  assert.equal(classifyComboSkipErrorClass("credits_exhausted"), "quota_exhausted");
  assert.equal(classifyComboSkipErrorClass("expired"), "expired");
  assert.equal(classifyComboSkipErrorClass("availability"), "no_credentials");
  assert.equal(classifyComboSkipErrorClass("credential_gate"), "no_credentials");
  assert.equal(
    classifyComboSkipErrorClass({
      skipMessage: "Skipping openai/a — connection c1 status=expired",
    }),
    "expired"
  );
  assert.equal(
    classifyComboSkipErrorClass({ skipMessage: "Skipping openai/b — no credentials available" }),
    "no_credentials"
  );
  assert.equal(classifyComboSkipErrorClass("circuit_open"), null);
});

test("resolveAllSkippedTerminal never returns null errorClass and lists mixed classes", () => {
  const mixed = resolveAllSkippedTerminal(["expired", "quota_exhausted", "no_credentials"]);
  assert.notEqual(mixed.errorClass, null);
  assert.deepEqual(mixed.errorClasses, ["quota_exhausted", "expired", "no_credentials"]);
  assert.equal(mixed.errorClass, "quota_exhausted,expired,no_credentials");
  assert.match(mixed.message, /quota_exhausted/);
  assert.match(mixed.message, /expired/);
  assert.match(mixed.message, /no_credentials/);
  assert.doesNotMatch(mixed.message, /pre-dispatch filters/i);

  const empty = resolveAllSkippedTerminal([]);
  assert.equal(empty.errorClass, "all_targets_skipped");
  assert.doesNotMatch(empty.message, /pre-dispatch filters/i);
});

test("resolveAllSkippedTerminalFromTrace harvests decision-trace skip reasons", () => {
  const resolved = resolveAllSkippedTerminalFromTrace(
    {
      decisions: [
        { decision: "skipped_before_dispatch", reason: "quota_cutoff" },
        { decision: "skipped_before_dispatch", reason: "availability" },
        { decision: "dispatched" },
      ],
    },
    ["Skipping openai/a — connection c1 status=expired"]
  );
  assert.deepEqual(resolved.errorClasses, ["quota_exhausted", "expired", "no_credentials"]);
  assert.notEqual(resolved.errorClass, null);
});

test("handleComboChat: all members skipped (expired + quota_exhausted + no_credentials) returns typed errorClass", async () => {
  const expiredConn = await providersDb.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "Expired Codex",
    apiKey: "sk-expired-skip",
    testStatus: "expired",
  });
  const quotaConn = await providersDb.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "Quota 100%",
    apiKey: "sk-quota-skip",
    testStatus: "active",
  });

  registerQuotaFetcher("openai", async (connectionId: string) => {
    if (connectionId === quotaConn.id) {
      return { used: 100, total: 100, percentUsed: 1 };
    }
    return { used: 0, total: 100, percentUsed: 0 };
  });

  const invocationId = createInvocationId();
  const res = await handleComboChat({
    invocationId,
    body: { messages: [{ role: "user", content: "ping" }] },
    combo: {
      name: "gpt-5.6-sol-skip-terminal",
      strategy: "priority",
      models: [
        {
          kind: "model",
          providerId: "openai",
          model: "openai/expired-target",
          connectionId: expiredConn.id,
        },
        {
          kind: "model",
          providerId: "openai",
          model: "openai/quota-target",
          connectionId: quotaConn.id,
        },
        {
          kind: "model",
          providerId: "openai",
          model: "openai/nored-target",
        },
      ],
      config: { maxRetries: 0, retryDelayMs: 0, fallbackDelayMs: 0 },
    },
    handleSingleModel: async () => {
      throw new Error("no target should dispatch when every member is pre-skipped");
    },
    isModelAvailable: async (_modelStr: string, target?: { connectionId?: string | null }) => {
      if (target?.connectionId === expiredConn.id) return true;
      if (target?.connectionId === quotaConn.id) return true;
      return false;
    },
    log: log(),
    settings: {
      resilienceSettings: {
        quotaPreflight: {
          enabled: true,
          defaultThresholdPercent: 2,
          warnThresholdPercent: 20,
        },
      },
    },
    allCombos: null,
  });

  assert.equal(res.status, 503);
  const body = (await res.json()) as {
    error?: {
      message?: string;
      code?: string;
      errorClass?: string | null;
      errorClasses?: string[];
    };
  };
  assert.equal(body.error?.code, "ALL_TARGETS_SKIPPED");
  assert.ok(body.error?.errorClass, "errorClass must be typed, not null/undefined");
  assert.notEqual(body.error?.errorClass, null);
  assert.match(String(body.error?.errorClass), /quota_exhausted|expired|no_credentials/);
  assert.ok(
    body.error?.errorClasses?.includes("quota_exhausted"),
    "quota_exhausted must be in errorClasses"
  );
  assert.ok(body.error?.errorClasses?.includes("expired"), "expired must be in errorClasses");
  assert.ok(
    body.error?.errorClasses?.includes("no_credentials"),
    "no_credentials must be in errorClasses"
  );
  assert.doesNotMatch(String(body.error?.message), /pre-dispatch filters/i);
  assert.match(String(body.error?.message), /quota_exhausted|expired|no_credentials/);

  const trace = getComboTrace(invocationId);
  assert.equal(trace?.terminal?.status, 503);
  assert.ok(trace?.terminal?.errorClass, "decision-trace terminal.errorClass must not be null");
  assert.notEqual(trace?.terminal?.errorClass, null);
});

test("handleComboChat: all unavailable still 503 with typed no_credentials, not generic remap", async () => {
  const res = await handleComboChat({
    body: { messages: [{ role: "user", content: "ping" }] },
    combo: {
      name: "all-unavailable-typed",
      strategy: "priority",
      models: ["openai/a", "openai/b"],
      config: { maxRetries: 0, retryDelayMs: 0, fallbackDelayMs: 0 },
    },
    handleSingleModel: async () => {
      throw new Error("should not dispatch");
    },
    isModelAvailable: async () => false,
    log: log(),
    settings: null,
    allCombos: null,
  });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error?: { message?: string; errorClass?: string | null } };
  assert.equal(body.error?.errorClass, "no_credentials");
  assert.doesNotMatch(String(body.error?.message), /pre-dispatch filters/i);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCompression } from "../../../open-sse/services/compression/strategySelector.ts";
import { adaptBodyForCompression } from "../../../open-sse/services/compression/bodyAdapter.ts";
import type { CompressionConfig } from "../../../open-sse/services/compression/types.ts";

const COMPRESSIBLE_SYSTEM =
  "You are a helpful assistant.  Please make sure to provide a detailed explanation.\n\n\nThank you so much for your help!";
const COMPRESSIBLE_USER =
  "Please could you provide a detailed explanation of this implementation? Thank you so much for your help!\n\n\n   ";

function liteConfig(overrides: Partial<CompressionConfig> = {}): CompressionConfig {
  return {
    enabled: true,
    defaultMode: "lite",
    autoTriggerTokens: 0,
    cacheMinutes: 5,
    preserveSystemPrompt: true,
    comboOverrides: {},
    ...overrides,
  };
}

function standardConfig(overrides: Partial<CompressionConfig> = {}): CompressionConfig {
  return {
    enabled: true,
    defaultMode: "standard",
    autoTriggerTokens: 0,
    cacheMinutes: 5,
    preserveSystemPrompt: true,
    comboOverrides: {},
    cavemanConfig: {
      enabled: true,
      compressRoles: ["user", "system"],
      skipRules: [],
      minMessageLength: 10,
      preservePatterns: [],
      intensity: "full",
    },
    ...overrides,
  };
}

describe("Anthropic system prompt stays byte-stable under compression", () => {
  it("lite collapseWhitespace/dedup does not rewrite body.system", () => {
    const body = {
      model: "claude-sonnet-4-6",
      system: COMPRESSIBLE_SYSTEM,
      messages: [{ role: "user", content: COMPRESSIBLE_USER }],
    };

    const result = applyCompression(body, "lite", { config: liteConfig() });

    assert.equal(result.body.system, COMPRESSIBLE_SYSTEM);
    const user = (result.body.messages as Array<{ content: string }>)[0]?.content;
    assert.notEqual(user, COMPRESSIBLE_USER, "history may still compress");
  });

  it("caveman rules do not rewrite a string or block-array Anthropic system", () => {
    const stringBody = {
      system: COMPRESSIBLE_SYSTEM,
      messages: [{ role: "user", content: COMPRESSIBLE_USER }],
    };
    const arrayBody = {
      system: [
        { type: "text", text: COMPRESSIBLE_SYSTEM },
        { type: "text", text: "Second system block. Please make sure." },
      ],
      messages: [{ role: "user", content: COMPRESSIBLE_USER }],
    };

    const stringResult = applyCompression(stringBody, "standard", { config: standardConfig() });
    const arrayResult = applyCompression(arrayBody, "standard", { config: standardConfig() });

    assert.equal(stringResult.body.system, COMPRESSIBLE_SYSTEM);
    assert.deepEqual(arrayResult.body.system, arrayBody.system);
    const user = (stringResult.body.messages as Array<{ content: string }>)[0]?.content;
    assert.notEqual(user, COMPRESSIBLE_USER, "history may still compress");
  });

  it("adapter hoists body.system to role=system and restores the Claude field", () => {
    const body = {
      system: COMPRESSIBLE_SYSTEM,
      messages: [{ role: "user", content: "hello" }],
    };
    const adapter = adaptBodyForCompression(body);
    assert.equal(adapter.adapted, true);
    const messages = adapter.body.messages as Array<{ role: string; content: unknown }>;
    assert.equal(messages[0]?.role, "system");
    assert.equal(messages[0]?.content, COMPRESSIBLE_SYSTEM);

    const restored = adapter.restore({
      ...adapter.body,
      messages: [{ role: "system", content: "MANGLED" }, { role: "user", content: "hello" }],
    });
    assert.equal(restored.system, "MANGLED");
    assert.deepEqual(restored.messages, [{ role: "user", content: "hello" }]);
  });

  it("dropped preserveSystemPrompt still keeps Anthropic system when the default is honor-preserve", () => {
    const body = {
      system: COMPRESSIBLE_SYSTEM,
      messages: [{ role: "user", content: COMPRESSIBLE_USER }],
    };
    const result = applyCompression(body, "standard", {
      config: standardConfig({ preserveSystemPrompt: undefined as unknown as boolean }),
    });
    assert.equal(result.body.system, COMPRESSIBLE_SYSTEM);
  });
});

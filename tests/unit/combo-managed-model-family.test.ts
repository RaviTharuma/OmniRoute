import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveManagedModelFamilyTargets,
  type ManagedModelFamilyCatalogs,
} from "../../open-sse/services/combo/managedModelFamily.ts";

const catalogs: ManagedModelFamilyCatalogs = {
  claude: {
    authoritative: true,
    models: ["claude-opus-4-6", "claude-opus-5-5"],
  },
  antigravity: {
    authoritative: true,
    models: ["claude-opus-5-5-thinking-high", "claude-opus-4-8-thinking-high"],
  },
  github: {
    authoritative: true,
    models: ["claude-opus-5-5", "claude-opus-4-8"],
  },
};

const latestRule = {
  family: "claude-opus",
  mode: "latest" as const,
  providers: ["claude", "antigravity", "github"],
};

test("latest selects the newest catalog version then preserves provider order", () => {
  assert.deepEqual(resolveManagedModelFamilyTargets(latestRule, catalogs), [
    "claude/claude-opus-5-5",
    "antigravity/claude-opus-5-5-thinking-high",
    "github/claude-opus-5-5",
    "antigravity/claude-opus-4-8-thinking-high",
    "github/claude-opus-4-8",
    "claude/claude-opus-4-6",
  ]);
});

test("exact selects only the requested version and never upgrades or downgrades", () => {
  assert.deepEqual(
    resolveManagedModelFamilyTargets({ ...latestRule, mode: "exact", version: "4.8" }, catalogs),
    ["antigravity/claude-opus-4-8-thinking-high", "github/claude-opus-4-8"]
  );
});

test("non-authoritative provider catalogs cannot fabricate family availability", () => {
  assert.deepEqual(
    resolveManagedModelFamilyTargets(latestRule, {
      ...catalogs,
      claude: { authoritative: false, models: ["claude-opus-9-9"] },
    }),
    [
      "antigravity/claude-opus-5-5-thinking-high",
      "github/claude-opus-5-5",
      "antigravity/claude-opus-4-8-thinking-high",
      "github/claude-opus-4-8",
    ]
  );
});

test("unsupported families and malformed versions fail closed", () => {
  assert.deepEqual(
    resolveManagedModelFamilyTargets({ ...latestRule, family: "unknown-family" }, catalogs),
    []
  );
  assert.deepEqual(
    resolveManagedModelFamilyTargets({ ...latestRule, mode: "exact", version: "latest" }, catalogs),
    []
  );
});

test("future version in catalog automatically advances latest without config change", () => {
  const futureCatalogs = {
    ...catalogs,
    claude: {
      authoritative: true,
      models: [...catalogs.claude.models, "claude-opus-6"],
    },
  };
  const targets = resolveManagedModelFamilyTargets(latestRule, futureCatalogs);
  assert.equal(targets[0], "claude/claude-opus-6");
  assert.deepEqual(targets.slice(1, 4), [
    "claude/claude-opus-5-5",
    "antigravity/claude-opus-5-5-thinking-high",
    "github/claude-opus-5-5",
  ]);
});

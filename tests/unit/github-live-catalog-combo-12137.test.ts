/**
 * #12137 — explicit GitHub combo members vs live synced catalog.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { catalogContainsModel } from "../../src/lib/db/models/activeSyncedCatalog.ts";

test("fail-open when the GitHub catalog is not authoritative yet", () => {
  assert.equal(
    catalogContainsModel({ authoritative: false, models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5", source: "imported" }] }, "claude-sonnet-5"),
    null
  );
});

test("rejects explicit members missing from an authoritative GitHub catalog", () => {
  assert.equal(
    catalogContainsModel({ authoritative: true, models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5", source: "imported" }] }, "github/claude-fable-5"),
    false
  );
});

test("accepts prefixed and bare ids that are in the live catalog", () => {
  const catalog = { authoritative: true, models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5", source: "imported" }] };
  assert.equal(catalogContainsModel(catalog, "claude-sonnet-5"), true);
  assert.equal(catalogContainsModel(catalog, "github/claude-sonnet-5"), true);
});

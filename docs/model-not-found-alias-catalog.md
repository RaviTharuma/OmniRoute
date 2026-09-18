# Alias catalog + clear model-not-found (issue #14068)

## Problem

Clients that pin fallback chains of gateway-qualified aliases can get opaque combo 503s when aliases disappear or rename in live `/v1/models`.

## Behavior

1. Treat `/v1/models` as the single source of truth for alias identity.
2. `GET /v1/models/{id}` returns **404** `model_not_found` (with `param: "model"`) when the id is absent from the live catalog — not HTML and not a combo 503.
3. Prefer stable alias IDs; document renames when aliases must change.

Shared helper: `src/lib/model-not-found.ts` (`buildModelNotFoundPayload`, `isKnownModelId`).

# Alias catalog + clear model-not-found (issue #14068)

## Problem
Clients that pin fallback chains of gateway-qualified aliases can get opaque combo 503s when aliases disappear or rename in live `/v1/models`.

## Direction (WIP draft)
1. Treat `/v1/models` as the single source of truth for alias identity.
2. When a requested model/alias is absent from the live catalog, return a **clear model-not-found** response (not only "all targets were skipped by pre-dispatch filters").
3. Prefer stable alias IDs; document renames when aliases must change.

## Status
Scaffolding PR linked to https://github.com/diegosouzapw/OmniRoute/issues/14068. Implementation hooks still to land in the combo/pre-dispatch path.

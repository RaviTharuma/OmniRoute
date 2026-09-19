# Clear model-not-found for `GET /v1/models/{id}` (issue #14068)

## Behavior

`GET /v1/models/{id}` treats the live `/v1/models` catalog as the source of truth for alias
identity. When the requested id is absent from that catalog, the route returns **404** with a
stable `model_not_found` body:

```json
{
  "error": {
    "message": "The model `gateway/missing-alias` does not exist or is not present in the live /v1/models catalog.",
    "type": "invalid_request_error",
    "code": "model_not_found",
    "param": "model"
  }
}
```

Shared helper: `src/lib/model-not-found.ts` (`buildModelNotFoundPayload`), consumed by
`src/app/api/v1/models/modelById.ts`.

## Scope

This covers only the single-model lookup route (`GET /v1/models/{id}`). Issue #14068 also asks
for the same clear-model-not-found signal inside the combo/pre-dispatch `ALL_TARGETS_SKIPPED`
diagnostics (the "all targets were skipped by pre-dispatch filters" 503 case); that path is a
separate change and is not implemented here.
